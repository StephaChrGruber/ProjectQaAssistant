from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field, create_model

from ..db import get_db
from ..models.base_mongo_models import CustomTool, CustomToolAudit, CustomToolVersion, LocalToolJob
from ..repositories.factory import repository_factory
from ..rag.tool_runtime import ToolContext, ToolRuntime, ToolSpec, build_default_tool_runtime
from .tool_classes import VIRTUAL_CUSTOM_UNCATEGORIZED_KEY, normalize_class_key

logger = logging.getLogger(__name__)

MAX_CUSTOM_TOOL_CODE_CHARS = 200_000
MAX_CUSTOM_TOOL_RESULT_CHARS = 180_000
LOCAL_TOOL_JOB_POLL_INTERVAL_SEC = 0.35
_BUILTIN_TOOL_CATALOG_CACHE: dict[str, dict[str, Any]] | None = None


class CustomToolServiceError(RuntimeError):
    pass


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)


def slugify_tool_name(name: str) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    slug = re.sub(r"[^a-z0-9_]+", "_", raw)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug[:80]


def normalize_tool_name(name: str) -> str:
    slug = slugify_tool_name(name)
    return slug


def _builtin_tool_catalog_map() -> dict[str, dict[str, Any]]:
    global _BUILTIN_TOOL_CATALOG_CACHE
    if _BUILTIN_TOOL_CATALOG_CACHE is None:
        runtime = build_default_tool_runtime()
        out: dict[str, dict[str, Any]] = {}
        for row in runtime.catalog():
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            out[name] = row
        _BUILTIN_TOOL_CATALOG_CACHE = out
    return dict(_BUILTIN_TOOL_CATALOG_CACHE)


async def ensure_system_tool_configs_seeded() -> None:
    db = get_db()
    now = utc_now()
    catalog = _builtin_tool_catalog_map()
    for name, row in catalog.items():
        await db["system_tool_configs"].update_one(
            {"projectId": None, "name": name},
            {
                "$setOnInsert": {
                    "projectId": None,
                    "name": name,
                    "description": str(row.get("description") or ""),
                    "isEnabled": True,
                    "readOnly": bool(row.get("read_only", True)),
                    "timeoutSec": int(row.get("timeout_sec") or 45),
                    "rateLimitPerMin": int(row.get("rate_limit_per_min") or 40),
                    "maxRetries": int(row.get("max_retries") or 0),
                    "cacheTtlSec": int(row.get("cache_ttl_sec") or 0),
                    "requireApproval": bool(row.get("require_approval", False)),
                    "createdAt": now,
                    "updatedAt": now,
                }
            },
            upsert=True,
        )


async def load_effective_system_tool_settings(project_id: str) -> tuple[set[str], dict[str, dict[str, Any]]]:
    await ensure_system_tool_configs_seeded()
    db = get_db()
    rows = await db["system_tool_configs"].find(
        {"$or": [{"projectId": None}, {"projectId": project_id}]}
    ).to_list(length=1000)

    by_name: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        is_project = str(row.get("projectId") or "") == project_id
        prev = by_name.get(name)
        if not prev:
            by_name[name] = row
            continue
        prev_is_project = str(prev.get("projectId") or "") == project_id
        if is_project and not prev_is_project:
            by_name[name] = row

    catalog = _builtin_tool_catalog_map()
    enabled_names: set[str] = set(catalog.keys())
    overrides: dict[str, dict[str, Any]] = {}
    for name in list(catalog.keys()):
        cfg = by_name.get(name)
        if not isinstance(cfg, dict):
            continue
        if not bool(cfg.get("isEnabled", True)):
            if name in enabled_names:
                enabled_names.remove(name)
            continue
        overrides[name] = {
            "description": str(cfg.get("description") or catalog[name].get("description") or ""),
            "timeout_sec": int(cfg.get("timeoutSec") or catalog[name].get("timeout_sec") or 45),
            "rate_limit_per_min": int(cfg.get("rateLimitPerMin") or catalog[name].get("rate_limit_per_min") or 40),
            "max_retries": int(cfg.get("maxRetries") or catalog[name].get("max_retries") or 0),
            "cache_ttl_sec": int(cfg.get("cacheTtlSec") or catalog[name].get("cache_ttl_sec") or 0),
            "read_only": bool(cfg.get("readOnly", catalog[name].get("read_only", True))),
            "require_approval": bool(cfg.get("requireApproval", catalog[name].get("require_approval", False))),
        }
    return enabled_names, overrides


def _sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _safe_identifier(raw: str) -> str:
    s = re.sub(r"\W+", "_", str(raw or "").strip())
    if not s:
        s = "arg"
    if s[0].isdigit():
        s = f"arg_{s}"
    return s


def _schema_type_to_python(schema: dict[str, Any]) -> Any:
    t = schema.get("type")
    if isinstance(t, list):
        for entry in t:
            if entry in {"string", "number", "integer", "boolean", "array", "object"}:
                t = entry
                break
    if t == "string":
        return str
    if t == "number":
        return float
    if t == "integer":
        return int
    if t == "boolean":
        return bool
    if t == "array":
        return list[Any]
    if t == "object":
        return dict[str, Any]
    return Any


class _StrictToolArgsBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class _LooseToolArgsBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


def build_args_model_from_schema(tool_id: str, schema: dict[str, Any]) -> tuple[type[BaseModel], bool]:
    schema_obj = schema if isinstance(schema, dict) else {}
    props = schema_obj.get("properties")
    required = set(schema_obj.get("required") or [])
    additional = schema_obj.get("additionalProperties", True)

    if not isinstance(props, dict) or not props:
        model_cls = create_model(
            f"CustomToolArgs_{tool_id}_Loose",
            __base__=_LooseToolArgsBase,
        )
        return model_cls, True

    fields: dict[str, tuple[Any, Any]] = {}
    used_names: set[str] = set()
    for original, prop_schema in props.items():
        key = str(original or "").strip()
        if not key:
            continue
        if not isinstance(prop_schema, dict):
            prop_schema = {}
        py_type = _schema_type_to_python(prop_schema)
        safe = _safe_identifier(key)
        while safe in used_names:
            safe = f"{safe}_x"
        used_names.add(safe)

        if key in required:
            default_val = Field(..., alias=key)
            ann = py_type
        else:
            if "default" in prop_schema:
                default_val = Field(default=prop_schema.get("default"), alias=key)
            else:
                default_val = Field(default=None, alias=key)
            ann = Optional[py_type]
        fields[safe] = (ann, default_val)

    base = _LooseToolArgsBase if bool(additional) else _StrictToolArgsBase
    model_cls = create_model(
        f"CustomToolArgs_{tool_id}",
        __base__=base,
        **fields,
    )
    return model_cls, bool(additional)


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    return value[:max_chars] + "...(truncated)"


def _safe_json_dumps(value: Any, *, max_chars: int | None = None) -> str:
    raw = json.dumps(value, ensure_ascii=False, default=str)
    if max_chars is None:
        return raw
    return _truncate_text(raw, max_chars)


_PYTHON_RUNNER = r"""
import asyncio
import inspect
import json
import sys
import traceback

def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, default=str))

def main():
    payload_raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(payload_raw)
    except Exception:
        _emit({"ok": False, "error": "invalid_payload", "trace": traceback.format_exc()})
        return

    code = payload.get("code") or ""
    args = payload.get("args") or {}
    context = payload.get("context") or {}
    secrets = payload.get("secrets") or {}
    if not isinstance(args, dict):
        args = {"value": args}
    if not isinstance(context, dict):
        context = {"value": context}
    if not isinstance(secrets, dict):
        secrets = {}
    context = dict(context)
    context["secrets"] = secrets

    namespace = {}
    try:
        exec(code, namespace, namespace)
    except Exception:
        _emit({"ok": False, "error": "compile_error", "trace": traceback.format_exc()})
        return

    run_fn = namespace.get("run")
    if not callable(run_fn):
        _emit({"ok": False, "error": "missing_run", "trace": "Custom tool code must define: def run(args, context): ..."})
        return

    try:
        result = run_fn(args, context)
        if inspect.isawaitable(result):
            result = asyncio.run(result)
        _emit({"ok": True, "result": result})
    except Exception:
        _emit({"ok": False, "error": "runtime_error", "trace": traceback.format_exc()})
        return

if __name__ == "__main__":
    main()
"""


async def _run_python_tool_process(
    *,
    code: str,
    args: dict[str, Any],
    context: dict[str, Any],
    secrets: dict[str, str],
    timeout_sec: int,
) -> Any:
    payload = {
        "code": code,
        "args": args,
        "context": context,
        "secrets": secrets,
    }
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "-c",
        _PYTHON_RUNNER,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None
    assert proc.stderr is not None

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=_safe_json_dumps(payload).encode("utf-8")),
            timeout=max(1, timeout_sec),
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise CustomToolServiceError("Custom python tool timed out")

    if proc.returncode != 0:
        err = _truncate_text((stderr or b"").decode("utf-8", errors="replace"), 2000)
        raise CustomToolServiceError(f"Custom python tool exited with code {proc.returncode}: {err}")

    out_text = (stdout or b"").decode("utf-8", errors="replace")
    out_text = _truncate_text(out_text, MAX_CUSTOM_TOOL_RESULT_CHARS)
    try:
        decoded = json.loads(out_text or "{}")
    except Exception as err:
        err_preview = _truncate_text(out_text, 500)
        raise CustomToolServiceError(f"Custom python tool returned invalid JSON: {err_preview}") from err

    if not isinstance(decoded, dict):
        raise CustomToolServiceError("Custom python tool returned non-object JSON payload")
    if not bool(decoded.get("ok")):
        detail = str(decoded.get("trace") or decoded.get("error") or "custom tool failed").strip()
        raise CustomToolServiceError(detail)
    return decoded.get("result")


async def _log_custom_tool_audit(
    *,
    tool_id: str | None,
    tool_name: str | None,
    project_id: str | None,
    chat_id: str | None,
    user_id: str | None,
    action: str,
    ok: bool,
    details: dict[str, Any] | None = None,
) -> None:
    try:
        await CustomToolAudit(
            toolId=tool_id,
            toolName=tool_name,
            projectId=project_id,
            chatId=chat_id,
            userId=user_id,
            action=action,
            ok=ok,
            details=details or {},
            createdAt=utc_now(),
        ).insert()
    except Exception:
        logger.exception(
            "custom_tool.audit_failed action=%s tool=%s project=%s chat=%s",
            action,
            tool_name,
            project_id,
            chat_id,
        )


async def create_local_tool_job(
    *,
    tool_id: str,
    tool_name: str,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    version: int | None,
    code: str,
    args: dict[str, Any],
    context: dict[str, Any],
    timeout_sec: int,
) -> LocalToolJob:
    now = utc_now()
    expires = now + timedelta(seconds=max(30, timeout_sec + 20))
    job = LocalToolJob(
        toolId=tool_id,
        toolName=tool_name,
        projectId=project_id,
        branch=branch,
        userId=user_id,
        chatId=chat_id,
        runtime="local_typescript",
        version=version,
        code=code,
        args=args,
        context=context,
        status="queued",
        createdAt=now,
        updatedAt=now,
        expiresAt=expires,
    )
    await job.insert()
    return job


async def wait_for_local_tool_job(job_id: str, timeout_sec: int) -> Any:
    deadline = asyncio.get_event_loop().time() + max(1, timeout_sec)
    while True:
        current = await LocalToolJob.get(job_id)
        if not current:
            raise CustomToolServiceError("Local tool job not found")
        status = str(current.status or "")
        if status == "completed":
            return current.result
        if status in {"failed", "timeout", "cancelled"}:
            raise CustomToolServiceError(str(current.error or f"Local tool job failed ({status})"))
        if asyncio.get_event_loop().time() >= deadline:
            current.status = "timeout"
            current.error = "Local tool job timed out waiting for browser execution."
            current.updatedAt = utc_now()
            current.completedAt = utc_now()
            await current.save()
            raise CustomToolServiceError("Local tool job timed out waiting for browser execution")
        await asyncio.sleep(LOCAL_TOOL_JOB_POLL_INTERVAL_SEC)


async def execute_custom_tool(
    *,
    tool_doc: dict[str, Any],
    version_doc: dict[str, Any],
    args: dict[str, Any],
    ctx: ToolContext,
) -> Any:
    runtime = str(tool_doc.get("runtime") or "backend_python")
    code = str(version_doc.get("code") or "")
    if not code:
        raise CustomToolServiceError("Published custom tool code is empty")

    tool_id = str(tool_doc.get("_id") or "")
    tool_name = str(tool_doc.get("name") or "")
    timeout_sec = int(tool_doc.get("timeoutSec") or 45)
    context = {
        "project_id": ctx.project_id,
        "branch": ctx.branch,
        "user_id": ctx.user_id,
        "chat_id": ctx.chat_id,
        "tool_name": tool_name,
        "tool_id": tool_id,
        "runtime": runtime,
    }
    secrets = tool_doc.get("secrets") if isinstance(tool_doc.get("secrets"), dict) else {}

    if runtime == "backend_python":
        out = await _run_python_tool_process(
            code=code,
            args=args,
            context=context,
            secrets=secrets,
            timeout_sec=timeout_sec,
        )
        await _log_custom_tool_audit(
            tool_id=tool_id,
            tool_name=tool_name,
            project_id=ctx.project_id,
            chat_id=ctx.chat_id,
            user_id=ctx.user_id,
            action="execute",
            ok=True,
            details={"runtime": runtime},
        )
        return out

    if runtime == "local_typescript":
        if not ctx.user_id:
            raise CustomToolServiceError("Local tool execution requires a user context")
        safe_args = args if isinstance(args, dict) else {}
        job = await create_local_tool_job(
            tool_id=tool_id,
            tool_name=tool_name,
            project_id=ctx.project_id,
            branch=ctx.branch,
            user_id=ctx.user_id,
            chat_id=ctx.chat_id,
            version=(version_doc.get("version") if isinstance(version_doc.get("version"), int) else None),
            code=code,
            args=safe_args,
            context=context,
            timeout_sec=timeout_sec,
        )
        await _log_custom_tool_audit(
            tool_id=tool_id,
            tool_name=tool_name,
            project_id=ctx.project_id,
            chat_id=ctx.chat_id,
            user_id=ctx.user_id,
            action="job_queued",
            ok=True,
            details={"job_id": str(job.id), "runtime": runtime},
        )
        out = await wait_for_local_tool_job(str(job.id), timeout_sec=timeout_sec)
        await _log_custom_tool_audit(
            tool_id=tool_id,
            tool_name=tool_name,
            project_id=ctx.project_id,
            chat_id=ctx.chat_id,
            user_id=ctx.user_id,
            action="execute",
            ok=True,
            details={"runtime": runtime, "job_id": str(job.id)},
        )
        return out

    raise CustomToolServiceError(f"Unsupported custom tool runtime: {runtime}")


def _tool_sort_key(doc: dict[str, Any], project_id: str) -> tuple[int, str]:
    is_project = 0 if str(doc.get("projectId") or "") == project_id else 1
    return (is_project, str(doc.get("name") or ""))


async def _load_enabled_custom_tools_raw(project_id: str) -> list[dict[str, Any]]:
    db = get_db()
    rows = await db["custom_tools"].find(
        {
            "isEnabled": True,
            "$or": [{"projectId": project_id}, {"projectId": None}],
        }
    ).to_list(length=500)
    # Prefer project-scoped tools over global tools for name collisions.
    rows = sorted(rows, key=lambda d: _tool_sort_key(d, project_id))
    picked: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        if name not in picked:
            picked[name] = row
    return list(picked.values())


async def resolve_runtime_custom_tools(project_id: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    rows = await _load_enabled_custom_tools_raw(project_id)
    if not rows:
        return []
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    db = get_db()
    for row in rows:
        pv = row.get("publishedVersion")
        if not isinstance(pv, int) or pv <= 0:
            continue
        version = await db["custom_tool_versions"].find_one({"toolId": str(row.get("_id")), "version": pv})
        if not isinstance(version, dict):
            continue
        if str(version.get("status") or "") != "published":
            continue
        out.append((row, version))
    return out


async def build_runtime_for_project(project_id: str) -> ToolRuntime:
    try:
        enabled_builtin_names, builtin_overrides = await load_effective_system_tool_settings(project_id)
        runtime = build_default_tool_runtime(
            enabled_names=enabled_builtin_names,
            spec_overrides=builtin_overrides,
        )
    except Exception:
        logger.exception("system_tool.runtime_load_failed project=%s", project_id)
        runtime = build_default_tool_runtime()

    try:
        custom_pairs = await resolve_runtime_custom_tools(project_id)
    except Exception:
        logger.exception("custom_tool.runtime_load_failed project=%s", project_id)
        return runtime

    existing_names = set(runtime.tool_names())
    for tool_doc, version_doc in custom_pairs:
        tool_name = str(tool_doc.get("name") or "").strip()
        if not tool_name:
            continue
        if tool_name in existing_names:
            logger.warning("tool.name_override project=%s name=%s origin=custom", project_id, tool_name)

        schema = tool_doc.get("inputSchema") if isinstance(tool_doc.get("inputSchema"), dict) else {}
        model_cls, allow_extra = build_args_model_from_schema(str(tool_doc.get("_id")), schema)

        async def _handler(payload: BaseModel, ctx: ToolContext, *, _tool=tool_doc, _ver=version_doc):
            payload_data = payload.model_dump(by_alias=True)
            return await execute_custom_tool(
                tool_doc=_tool,
                version_doc=_ver,
                args=payload_data,
                ctx=ctx,
            )

        runtime.register(
            ToolSpec(
                name=tool_name,
                description=str(tool_doc.get("description") or "Custom tool"),
                model=model_cls,
                handler=_handler,
                timeout_sec=max(1, min(int(tool_doc.get("timeoutSec") or 45), 3600)),
                rate_limit_per_min=max(1, min(int(tool_doc.get("rateLimitPerMin") or 40), 6000)),
                read_only=bool(tool_doc.get("readOnly", True)),
                max_retries=max(0, min(int(tool_doc.get("maxRetries") or 0), 5)),
                cache_ttl_sec=max(0, min(int(tool_doc.get("cacheTtlSec") or 0), 3600)),
                require_approval=bool(tool_doc.get("requireApproval")),
                origin="custom",
                runtime=str(tool_doc.get("runtime") or "backend_python"),
                version=str(version_doc.get("version") or ""),
                allow_extra_args=allow_extra,
                class_key=normalize_class_key(tool_doc.get("classKey")) or VIRTUAL_CUSTOM_UNCATEGORIZED_KEY,
            )
        )
        existing_names.add(tool_name)
    return runtime


def sanitize_tool_schema(schema: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}, "required": [], "additionalProperties": True}
    out = dict(schema)
    if out.get("type") != "object":
        out["type"] = "object"
    props = out.get("properties")
    out["properties"] = props if isinstance(props, dict) else {}
    req = out.get("required")
    out["required"] = [str(x) for x in req if str(x).strip()] if isinstance(req, list) else []
    if "additionalProperties" not in out:
        out["additionalProperties"] = True
    return out


def sanitize_custom_tool_code(code: str) -> str:
    body = str(code or "").strip()
    if not body:
        raise CustomToolServiceError("Tool code cannot be empty")
    if len(body) > MAX_CUSTOM_TOOL_CODE_CHARS:
        raise CustomToolServiceError(f"Tool code exceeds {MAX_CUSTOM_TOOL_CODE_CHARS} characters")
    return body


def normalize_secret_map(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        key = str(k or "").strip()
        if not key:
            continue
        out[key] = str(v or "")
    return out


def serialize_custom_tool(tool_doc: dict[str, Any], *, include_secrets: bool = False) -> dict[str, Any]:
    class_key = normalize_class_key(tool_doc.get("classKey"))
    out = {
        "id": str(tool_doc.get("_id") or ""),
        "projectId": tool_doc.get("projectId"),
        "name": tool_doc.get("name"),
        "slug": tool_doc.get("slug"),
        "description": tool_doc.get("description"),
        "classKey": class_key,
        "runtime": tool_doc.get("runtime"),
        "isEnabled": bool(tool_doc.get("isEnabled", True)),
        "readOnly": bool(tool_doc.get("readOnly", True)),
        "requireApproval": bool(tool_doc.get("requireApproval", False)),
        "timeoutSec": int(tool_doc.get("timeoutSec") or 45),
        "rateLimitPerMin": int(tool_doc.get("rateLimitPerMin") or 40),
        "maxRetries": int(tool_doc.get("maxRetries") or 0),
        "cacheTtlSec": int(tool_doc.get("cacheTtlSec") or 0),
        "inputSchema": tool_doc.get("inputSchema") if isinstance(tool_doc.get("inputSchema"), dict) else {},
        "outputSchema": tool_doc.get("outputSchema") if isinstance(tool_doc.get("outputSchema"), dict) else {},
        "tags": tool_doc.get("tags") if isinstance(tool_doc.get("tags"), list) else [],
        "latestVersion": int(tool_doc.get("latestVersion") or 0),
        "publishedVersion": tool_doc.get("publishedVersion"),
        "createdBy": tool_doc.get("createdBy"),
        "createdAt": tool_doc.get("createdAt"),
        "updatedAt": tool_doc.get("updatedAt"),
    }
    if include_secrets:
        out["secrets"] = normalize_secret_map(tool_doc.get("secrets"))
    return out


def serialize_custom_tool_version(version_doc: dict[str, Any], *, include_code: bool = False) -> dict[str, Any]:
    out = {
        "id": str(version_doc.get("_id") or ""),
        "toolId": version_doc.get("toolId"),
        "version": int(version_doc.get("version") or 0),
        "status": str(version_doc.get("status") or "draft"),
        "checksum": str(version_doc.get("checksum") or ""),
        "changelog": version_doc.get("changelog"),
        "createdBy": version_doc.get("createdBy"),
        "createdAt": version_doc.get("createdAt"),
    }
    if include_code:
        out["code"] = str(version_doc.get("code") or "")
    return out


async def create_custom_tool_version(
    *,
    tool_id: str,
    code: str,
    created_by: str | None,
    changelog: str | None = None,
) -> CustomToolVersion:
    tool = await CustomTool.get(tool_id)
    if not tool:
        raise CustomToolServiceError("Custom tool not found")

    body = sanitize_custom_tool_code(code)
    next_version = int(tool.latestVersion or 0) + 1
    version = CustomToolVersion(
        toolId=str(tool.id),
        version=next_version,
        status="draft",
        code=body,
        checksum=_sha256_text(body),
        changelog=(changelog or "").strip() or None,
        createdBy=(created_by or "").strip() or None,
        createdAt=utc_now(),
    )
    await version.insert()

    tool.latestVersion = next_version
    tool.updatedAt = utc_now()
    await tool.save()
    return version


async def publish_custom_tool_version(*, tool_id: str, version: int, user_id: str | None) -> CustomToolVersion:
    tool = await CustomTool.get(tool_id)
    if not tool:
        raise CustomToolServiceError("Custom tool not found")

    doc = await CustomToolVersion.find_one(CustomToolVersion.toolId == tool_id, CustomToolVersion.version == version)
    if not doc:
        raise CustomToolServiceError("Custom tool version not found")

    await get_db()["custom_tool_versions"].update_many(
        {"toolId": tool_id, "status": "published"},
        {"$set": {"status": "archived"}},
    )
    doc.status = "published"
    await doc.save()

    tool.publishedVersion = version
    if not tool.isEnabled:
        tool.isEnabled = True
    tool.updatedAt = utc_now()
    await tool.save()

    await _log_custom_tool_audit(
        tool_id=str(tool.id),
        tool_name=tool.name,
        project_id=tool.projectId,
        chat_id=None,
        user_id=user_id,
        action="publish",
        ok=True,
        details={"version": version},
    )
    return doc


def extract_args_from_model(payload: BaseModel) -> dict[str, Any]:
    if not isinstance(payload, BaseModel):
        return {}
    data = payload.model_dump(by_alias=True)
    return data if isinstance(data, dict) else {}


async def run_custom_tool_test(
    *,
    tool_doc: dict[str, Any],
    version_doc: dict[str, Any],
    args: dict[str, Any],
    project_id: str,
    branch: str,
    user_id: str,
) -> Any:
    ctx = ToolContext(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        chat_id=None,
        policy={},
    )
    return await execute_custom_tool(tool_doc=tool_doc, version_doc=version_doc, args=args, ctx=ctx)


async def claim_local_tool_job_for_user(
    *,
    user_id: str,
    project_id: str | None = None,
    claim_id: str | None = None,
) -> dict[str, Any] | None:
    repo = repository_factory().local_tool_jobs
    now = utc_now()
    claim_token = (claim_id or "").strip() or f"{user_id}@{int(now.timestamp())}"
    row = await repo.claim_next_local_job(
        user_id=user_id,
        now=now,
        claim_token=claim_token,
        project_id=project_id,
    )
    if not row:
        return None
    row["_id"] = str(row.get("_id"))
    return row


async def complete_local_tool_job(
    *,
    job_id: str,
    user_id: str,
    result: Any,
    claim_id: str | None = None,
) -> dict[str, Any]:
    repo = repository_factory().local_tool_jobs
    now = utc_now()
    if not ObjectId.is_valid(job_id):
        raise CustomToolServiceError("Invalid local tool job id")
    row = await repo.get_local_job_for_user(job_id=job_id, user_id=user_id, claim_id=claim_id)
    if not row:
        raise CustomToolServiceError("Local tool job not found")
    if str(row.get("status") or "") not in {"running", "queued"}:
        raise CustomToolServiceError(f"Local tool job is not active (status={row.get('status')})")

    safe_result: Any = result
    try:
        preview = _safe_json_dumps(result, max_chars=MAX_CUSTOM_TOOL_RESULT_CHARS)
        if len(preview) >= MAX_CUSTOM_TOOL_RESULT_CHARS:
            safe_result = {"_truncated": True, "preview": preview}
    except Exception:
        safe_result = {"_truncated": True, "preview": _truncate_text(str(result), MAX_CUSTOM_TOOL_RESULT_CHARS)}

    await repo.mark_local_job_completed(
        job_id=str(row["_id"]),
        result=safe_result,
        now=now,
    )
    return {"id": str(row["_id"]), "status": "completed"}


async def fail_local_tool_job(
    *,
    job_id: str,
    user_id: str,
    error: str,
    claim_id: str | None = None,
) -> dict[str, Any]:
    repo = repository_factory().local_tool_jobs
    now = utc_now()
    if not ObjectId.is_valid(job_id):
        raise CustomToolServiceError("Invalid local tool job id")
    row = await repo.get_local_job_for_user(job_id=job_id, user_id=user_id, claim_id=claim_id)
    if not row:
        raise CustomToolServiceError("Local tool job not found")
    if str(row.get("status") or "") not in {"running", "queued"}:
        raise CustomToolServiceError(f"Local tool job is not active (status={row.get('status')})")

    await repo.mark_local_job_failed(
        job_id=str(row["_id"]),
        error=_truncate_text(str(error or "local tool execution failed"), 2000),
        now=now,
    )
    return {"id": str(row["_id"]), "status": "failed"}
