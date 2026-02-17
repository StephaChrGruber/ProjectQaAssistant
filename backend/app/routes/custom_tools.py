from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import get_db
from ..deps import current_user
from ..models.base_mongo_models import CustomTool, CustomToolVersion
from ..services.custom_tools import (
    CustomToolServiceError,
    claim_local_tool_job_for_user,
    complete_local_tool_job,
    create_custom_tool_version,
    ensure_system_tool_configs_seeded,
    fail_local_tool_job,
    load_effective_system_tool_settings,
    normalize_secret_map,
    normalize_tool_name,
    publish_custom_tool_version,
    run_custom_tool_test,
    sanitize_custom_tool_code,
    sanitize_tool_schema,
    serialize_custom_tool,
    serialize_custom_tool_version,
    slugify_tool_name,
    utc_now,
)

router = APIRouter(tags=["custom_tools"])


class CreateCustomToolReq(BaseModel):
    projectId: str | None = None
    name: str
    description: str | None = None
    runtime: Literal["backend_python", "local_typescript"] = "backend_python"
    isEnabled: bool = True
    readOnly: bool = True
    requireApproval: bool = False
    timeoutSec: int = 45
    rateLimitPerMin: int = 40
    maxRetries: int = 0
    cacheTtlSec: int = 0
    inputSchema: dict[str, Any] = Field(default_factory=dict)
    outputSchema: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    initialCode: str
    changelog: str | None = None
    autoPublish: bool = True


class UpdateCustomToolReq(BaseModel):
    name: str | None = None
    description: str | None = None
    runtime: Literal["backend_python", "local_typescript"] | None = None
    isEnabled: bool | None = None
    readOnly: bool | None = None
    requireApproval: bool | None = None
    timeoutSec: int | None = None
    rateLimitPerMin: int | None = None
    maxRetries: int | None = None
    cacheTtlSec: int | None = None
    inputSchema: dict[str, Any] | None = None
    outputSchema: dict[str, Any] | None = None
    secrets: dict[str, str] | None = None
    tags: list[str] | None = None


class CreateVersionReq(BaseModel):
    code: str
    changelog: str | None = None
    publish: bool = False


class PublishVersionReq(BaseModel):
    version: int | None = None


class TestRunReq(BaseModel):
    projectId: str | None = None
    branch: str = "main"
    version: int | None = None
    args: dict[str, Any] = Field(default_factory=dict)


class ClaimLocalJobReq(BaseModel):
    projectId: str | None = None
    claimId: str | None = None


class CompleteLocalJobReq(BaseModel):
    claimId: str | None = None
    result: Any = None


class FailLocalJobReq(BaseModel):
    claimId: str | None = None
    error: str = "Local tool execution failed"


class UpdateSystemToolReq(BaseModel):
    projectId: str | None = None
    isEnabled: bool | None = None
    description: str | None = None
    readOnly: bool | None = None
    timeoutSec: int | None = None
    rateLimitPerMin: int | None = None
    maxRetries: int | None = None
    cacheTtlSec: int | None = None
    requireApproval: bool | None = None


def _as_iso(v: Any) -> str | None:
    if isinstance(v, datetime):
        return v.isoformat() + "Z"
    return None


def _mask_tool_secrets(secrets: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (secrets or {}).items():
        key = str(k or "").strip()
        if not key:
            continue
        raw = str(v or "")
        out[key] = "***" if raw else ""
    return out


def _serialize_tool_public(tool_doc: dict[str, Any], *, include_secrets: bool = False) -> dict[str, Any]:
    out = serialize_custom_tool(tool_doc, include_secrets=include_secrets)
    if not include_secrets:
        out["secrets"] = _mask_tool_secrets(tool_doc.get("secrets") if isinstance(tool_doc.get("secrets"), dict) else {})
    if out.get("createdAt"):
        out["createdAt"] = _as_iso(out["createdAt"])
    if out.get("updatedAt"):
        out["updatedAt"] = _as_iso(out["updatedAt"])
    return out


def _serialize_version_public(version_doc: dict[str, Any], *, include_code: bool = False) -> dict[str, Any]:
    out = serialize_custom_tool_version(version_doc, include_code=include_code)
    if out.get("createdAt"):
        out["createdAt"] = _as_iso(out["createdAt"])
    return out


def _require_admin(user) -> None:
    if not bool(getattr(user, "isGlobalAdmin", False)):
        raise HTTPException(403, "Global admin required")


async def _audit(
    *,
    action: str,
    user_id: str,
    tool_id: str | None,
    tool_name: str | None,
    project_id: str | None,
    ok: bool,
    details: dict[str, Any] | None = None,
) -> None:
    try:
        await get_db()["custom_tool_audit"].insert_one(
            {
                "toolId": tool_id,
                "toolName": tool_name,
                "projectId": project_id,
                "chatId": None,
                "userId": user_id,
                "action": action,
                "ok": bool(ok),
                "details": details or {},
                "createdAt": utc_now(),
            }
        )
    except Exception:
        # Keep custom tool operations resilient even if audit insert fails.
        pass


def _normalize_tool_bounds(req_data: dict[str, Any]) -> dict[str, Any]:
    out = dict(req_data)
    if "timeoutSec" in out and out["timeoutSec"] is not None:
        out["timeoutSec"] = max(1, min(int(out["timeoutSec"]), 3600))
    if "rateLimitPerMin" in out and out["rateLimitPerMin"] is not None:
        out["rateLimitPerMin"] = max(1, min(int(out["rateLimitPerMin"]), 6000))
    if "maxRetries" in out and out["maxRetries"] is not None:
        out["maxRetries"] = max(0, min(int(out["maxRetries"]), 5))
    if "cacheTtlSec" in out and out["cacheTtlSec"] is not None:
        out["cacheTtlSec"] = max(0, min(int(out["cacheTtlSec"]), 3600))
    return out


def _system_tool_to_public(row: dict[str, Any]) -> dict[str, Any]:
    out = {
        "id": str(row.get("_id") or ""),
        "projectId": row.get("projectId"),
        "name": row.get("name"),
        "description": row.get("description"),
        "isEnabled": bool(row.get("isEnabled", True)),
        "readOnly": bool(row.get("readOnly", True)),
        "timeoutSec": int(row.get("timeoutSec") or 45),
        "rateLimitPerMin": int(row.get("rateLimitPerMin") or 40),
        "maxRetries": int(row.get("maxRetries") or 0),
        "cacheTtlSec": int(row.get("cacheTtlSec") or 0),
        "requireApproval": bool(row.get("requireApproval", False)),
        "createdAt": _as_iso(row.get("createdAt")),
        "updatedAt": _as_iso(row.get("updatedAt")),
    }
    return out


async def _load_tool_or_404(tool_id: str) -> CustomTool:
    doc = await CustomTool.get(tool_id)
    if not doc:
        raise HTTPException(404, "Custom tool not found")
    return doc


async def _ensure_unique_tool_name(*, project_id: str | None, name: str, ignore_id: str | None = None) -> None:
    slug = normalize_tool_name(name)
    if not slug:
        raise HTTPException(400, "Tool name is required")
    q: dict[str, Any] = {"slug": slug, "projectId": project_id}
    row = await get_db()["custom_tools"].find_one(q, {"_id": 1})
    if row and str(row.get("_id")) != str(ignore_id or ""):
        raise HTTPException(409, "A custom tool with this name already exists in this scope")


@router.get("/admin/custom-tools")
async def list_custom_tools(
    project_id: str | None = Query(default=None),
    include_global: bool = Query(default=True),
    include_disabled: bool = Query(default=True),
    user=Depends(current_user),
):
    _require_admin(user)

    q: dict[str, Any] = {}
    if not include_disabled:
        q["isEnabled"] = True
    if project_id:
        if include_global:
            q["$or"] = [{"projectId": project_id}, {"projectId": None}]
        else:
            q["projectId"] = project_id

    rows = await get_db()["custom_tools"].find(q).sort("name", 1).to_list(length=1000)
    out = [_serialize_tool_public(row, include_secrets=False) for row in rows]
    return {"items": out}


@router.get("/admin/system-tools")
async def list_system_tools(
    project_id: str | None = Query(default=None),
    user=Depends(current_user),
):
    _require_admin(user)
    await ensure_system_tool_configs_seeded()
    q: dict[str, Any]
    if project_id:
        q = {"$or": [{"projectId": None}, {"projectId": project_id}]}
    else:
        q = {"projectId": None}
    rows = await get_db()["system_tool_configs"].find(q).sort([("name", 1), ("projectId", 1)]).to_list(length=1000)
    items = [_system_tool_to_public(row) for row in rows]
    effective: list[dict[str, Any]] = []
    if project_id:
        enabled, overrides = await load_effective_system_tool_settings(project_id)
        for name in sorted(enabled.union(set(overrides.keys()))):
            ov = overrides.get(name) or {}
            effective.append(
                {
                    "name": name,
                    "isEnabled": name in enabled,
                    "description": ov.get("description"),
                    "readOnly": ov.get("read_only"),
                    "timeoutSec": ov.get("timeout_sec"),
                    "rateLimitPerMin": ov.get("rate_limit_per_min"),
                    "maxRetries": ov.get("max_retries"),
                    "cacheTtlSec": ov.get("cache_ttl_sec"),
                    "requireApproval": ov.get("require_approval"),
                }
            )
    return {"items": items, "effective": effective}


@router.put("/admin/system-tools/{tool_name}")
async def upsert_system_tool(
    tool_name: str,
    req: UpdateSystemToolReq,
    user=Depends(current_user),
):
    _require_admin(user)
    await ensure_system_tool_configs_seeded()
    name = normalize_tool_name(tool_name)
    if not name:
        raise HTTPException(400, "Invalid tool name")

    existing = await get_db()["system_tool_configs"].find_one(
        {"projectId": (req.projectId or "").strip() or None, "name": name}
    )
    if not existing:
        base = await get_db()["system_tool_configs"].find_one({"projectId": None, "name": name})
        if not base:
            raise HTTPException(404, "System tool not found")
        existing = dict(base)
        existing["_id"] = ObjectId()
        existing["projectId"] = (req.projectId or "").strip() or None
        existing["createdAt"] = utc_now()

    now = utc_now()
    data = req.model_dump(exclude_unset=True)
    data = _normalize_tool_bounds(data)
    update: dict[str, Any] = {"updatedAt": now}
    for key in ("isEnabled", "readOnly", "requireApproval"):
        if key in data and data[key] is not None:
            update[key] = bool(data[key])
    for key in ("description",):
        if key in data and data[key] is not None:
            update[key] = str(data[key])
    for key in ("timeoutSec", "rateLimitPerMin", "maxRetries", "cacheTtlSec"):
        if key in data and data[key] is not None:
            update[key] = int(data[key])

    await get_db()["system_tool_configs"].update_one(
        {"projectId": (req.projectId or "").strip() or None, "name": name},
        {"$set": update, "$setOnInsert": {"createdAt": existing.get("createdAt") or now}},
        upsert=True,
    )
    row = await get_db()["system_tool_configs"].find_one({"projectId": (req.projectId or "").strip() or None, "name": name})
    return {"item": _system_tool_to_public(row or {})}


@router.post("/admin/custom-tools")
async def create_custom_tool(req: CreateCustomToolReq, user=Depends(current_user)):
    _require_admin(user)
    name = normalize_tool_name(req.name)
    if not name:
        raise HTTPException(400, "Tool name is required")
    await _ensure_unique_tool_name(project_id=req.projectId, name=name)

    now = utc_now()
    secret_map = normalize_secret_map(req.secrets)
    if req.runtime == "local_typescript" and secret_map:
        raise HTTPException(400, "Local TypeScript tools cannot store backend secrets")

    doc = CustomTool(
        projectId=(req.projectId or "").strip() or None,
        name=name,
        slug=slugify_tool_name(name),
        description=(req.description or "").strip() or None,
        runtime=req.runtime,
        isEnabled=bool(req.isEnabled),
        readOnly=bool(req.readOnly),
        requireApproval=bool(req.requireApproval),
        timeoutSec=max(1, min(int(req.timeoutSec), 3600)),
        rateLimitPerMin=max(1, min(int(req.rateLimitPerMin), 6000)),
        maxRetries=max(0, min(int(req.maxRetries), 5)),
        cacheTtlSec=max(0, min(int(req.cacheTtlSec), 3600)),
        inputSchema=sanitize_tool_schema(req.inputSchema),
        outputSchema=sanitize_tool_schema(req.outputSchema),
        secrets=secret_map,
        tags=[str(t).strip() for t in (req.tags or []) if str(t).strip()],
        latestVersion=0,
        publishedVersion=None,
        createdBy=str(user.email or ""),
        createdAt=now,
        updatedAt=now,
    )
    await doc.insert()

    version = await create_custom_tool_version(
        tool_id=str(doc.id),
        code=sanitize_custom_tool_code(req.initialCode),
        created_by=str(user.email or ""),
        changelog=req.changelog,
    )
    if req.autoPublish:
        version = await publish_custom_tool_version(
            tool_id=str(doc.id),
            version=int(version.version),
            user_id=str(user.email or ""),
        )

    await _audit(
        action="create",
        user_id=str(user.email or ""),
        tool_id=str(doc.id),
        tool_name=doc.name,
        project_id=doc.projectId,
        ok=True,
        details={"runtime": doc.runtime, "version": int(version.version)},
    )

    fresh = await get_db()["custom_tools"].find_one({"_id": doc.id})
    tool_out = _serialize_tool_public(fresh or {}, include_secrets=False)
    version_out = _serialize_version_public(version.model_dump(by_alias=True), include_code=False)
    return {"tool": tool_out, "version": version_out}


@router.get("/admin/custom-tools/{tool_id}")
async def get_custom_tool(tool_id: str, user=Depends(current_user)):
    _require_admin(user)
    tool = await _load_tool_or_404(tool_id)
    raw_tool = await get_db()["custom_tools"].find_one({"_id": tool.id})
    versions = await get_db()["custom_tool_versions"].find({"toolId": tool_id}).sort("version", -1).to_list(length=200)
    return {
        "tool": _serialize_tool_public(raw_tool or {}, include_secrets=True),
        "versions": [_serialize_version_public(v, include_code=False) for v in versions],
    }


@router.patch("/admin/custom-tools/{tool_id}")
async def update_custom_tool(tool_id: str, req: UpdateCustomToolReq, user=Depends(current_user)):
    _require_admin(user)
    tool = await _load_tool_or_404(tool_id)
    data = req.model_dump(exclude_unset=True)
    data = _normalize_tool_bounds(data)

    if "name" in data and data["name"] is not None:
        name = normalize_tool_name(data["name"])
        if not name:
            raise HTTPException(400, "Tool name cannot be empty")
        await _ensure_unique_tool_name(project_id=tool.projectId, name=name, ignore_id=tool_id)
        tool.name = name
        tool.slug = slugify_tool_name(name)
    if "description" in data:
        tool.description = (str(data["description"]).strip() or None) if data["description"] is not None else None
    if "runtime" in data and data["runtime"] is not None:
        tool.runtime = str(data["runtime"])
    if "isEnabled" in data and data["isEnabled"] is not None:
        tool.isEnabled = bool(data["isEnabled"])
    if "readOnly" in data and data["readOnly"] is not None:
        tool.readOnly = bool(data["readOnly"])
    if "requireApproval" in data and data["requireApproval"] is not None:
        tool.requireApproval = bool(data["requireApproval"])
    for num_field in ("timeoutSec", "rateLimitPerMin", "maxRetries", "cacheTtlSec"):
        if num_field in data and data[num_field] is not None:
            setattr(tool, num_field, int(data[num_field]))
    if "inputSchema" in data and data["inputSchema"] is not None:
        tool.inputSchema = sanitize_tool_schema(data["inputSchema"])
    if "outputSchema" in data and data["outputSchema"] is not None:
        tool.outputSchema = sanitize_tool_schema(data["outputSchema"])
    if "secrets" in data and data["secrets"] is not None:
        sec = normalize_secret_map(data["secrets"])
        runtime_after = str(tool.runtime or "backend_python")
        if runtime_after == "local_typescript" and sec:
            raise HTTPException(400, "Local TypeScript tools cannot store backend secrets")
        tool.secrets = sec
    if "tags" in data and data["tags"] is not None:
        tool.tags = [str(x).strip() for x in (data["tags"] or []) if str(x).strip()]

    if str(tool.runtime or "backend_python") == "local_typescript" and bool(tool.secrets):
        raise HTTPException(400, "Local TypeScript tools cannot store backend secrets")

    tool.updatedAt = utc_now()
    await tool.save()
    await _audit(
        action="update",
        user_id=str(user.email or ""),
        tool_id=str(tool.id),
        tool_name=tool.name,
        project_id=tool.projectId,
        ok=True,
        details={},
    )
    fresh = await get_db()["custom_tools"].find_one({"_id": tool.id})
    return {"tool": _serialize_tool_public(fresh or {}, include_secrets=False)}


@router.delete("/admin/custom-tools/{tool_id}")
async def delete_custom_tool(tool_id: str, user=Depends(current_user)):
    _require_admin(user)
    tool = await _load_tool_or_404(tool_id)
    await get_db()["custom_tool_versions"].delete_many({"toolId": tool_id})
    await tool.delete()
    await _audit(
        action="delete",
        user_id=str(user.email or ""),
        tool_id=tool_id,
        tool_name=tool.name,
        project_id=tool.projectId,
        ok=True,
        details={},
    )
    return {"deleted": True, "toolId": tool_id}


@router.get("/admin/custom-tools/{tool_id}/versions")
async def list_custom_tool_versions(tool_id: str, include_code: bool = False, user=Depends(current_user)):
    _require_admin(user)
    await _load_tool_or_404(tool_id)
    versions = await get_db()["custom_tool_versions"].find({"toolId": tool_id}).sort("version", -1).to_list(length=500)
    return {"items": [_serialize_version_public(v, include_code=include_code) for v in versions]}


@router.post("/admin/custom-tools/{tool_id}/versions")
async def add_custom_tool_version(tool_id: str, req: CreateVersionReq, user=Depends(current_user)):
    _require_admin(user)
    await _load_tool_or_404(tool_id)
    try:
        version = await create_custom_tool_version(
            tool_id=tool_id,
            code=req.code,
            changelog=req.changelog,
            created_by=str(user.email or ""),
        )
        if req.publish:
            version = await publish_custom_tool_version(
                tool_id=tool_id,
                version=int(version.version),
                user_id=str(user.email or ""),
            )
    except CustomToolServiceError as err:
        await _audit(
            action="create_version",
            user_id=str(user.email or ""),
            tool_id=tool_id,
            tool_name=None,
            project_id=None,
            ok=False,
            details={"error": str(err)},
        )
        raise HTTPException(400, str(err))

    await _audit(
        action="create_version",
        user_id=str(user.email or ""),
        tool_id=tool_id,
        tool_name=None,
        project_id=None,
        ok=True,
        details={"version": int(version.version), "publish": bool(req.publish)},
    )

    return {"version": _serialize_version_public(version.model_dump(by_alias=True), include_code=False)}


@router.post("/admin/custom-tools/{tool_id}/publish")
async def publish_custom_tool(tool_id: str, req: PublishVersionReq, user=Depends(current_user)):
    _require_admin(user)
    tool = await _load_tool_or_404(tool_id)
    target_version = req.version or int(tool.latestVersion or 0)
    if target_version <= 0:
        raise HTTPException(400, "Tool has no versions to publish")
    try:
        version = await publish_custom_tool_version(
            tool_id=tool_id,
            version=target_version,
            user_id=str(user.email or ""),
        )
    except CustomToolServiceError as err:
        await _audit(
            action="publish",
            user_id=str(user.email or ""),
            tool_id=tool_id,
            tool_name=tool.name,
            project_id=tool.projectId,
            ok=False,
            details={"error": str(err), "version": target_version},
        )
        raise HTTPException(400, str(err))

    await _audit(
        action="publish",
        user_id=str(user.email or ""),
        tool_id=tool_id,
        tool_name=tool.name,
        project_id=tool.projectId,
        ok=True,
        details={"version": target_version},
    )
    return {"version": _serialize_version_public(version.model_dump(by_alias=True), include_code=False)}


@router.post("/admin/custom-tools/{tool_id}/test-run")
async def test_run_custom_tool(tool_id: str, req: TestRunReq, user=Depends(current_user)):
    _require_admin(user)
    tool = await _load_tool_or_404(tool_id)
    raw_tool = await get_db()["custom_tools"].find_one({"_id": tool.id})

    version_num = req.version or int(tool.publishedVersion or 0) or int(tool.latestVersion or 0)
    if version_num <= 0:
        raise HTTPException(400, "No custom tool version available for test run")
    version = await CustomToolVersion.find_one(CustomToolVersion.toolId == tool_id, CustomToolVersion.version == version_num)
    if not version:
        raise HTTPException(404, "Requested custom tool version not found")

    project_id = (req.projectId or tool.projectId or "").strip()
    if not project_id:
        raise HTTPException(400, "projectId is required for test run")

    try:
        result = await run_custom_tool_test(
            tool_doc=raw_tool or {},
            version_doc=version.model_dump(by_alias=True),
            args=req.args or {},
            project_id=project_id,
            branch=(req.branch or "main").strip() or "main",
            user_id=str(user.email or ""),
        )
    except CustomToolServiceError as err:
        await _audit(
            action="test_run",
            user_id=str(user.email or ""),
            tool_id=tool_id,
            tool_name=tool.name,
            project_id=project_id,
            ok=False,
            details={"error": str(err), "version": version_num},
        )
        raise HTTPException(400, str(err))

    await _audit(
        action="test_run",
        user_id=str(user.email or ""),
        tool_id=tool_id,
        tool_name=tool.name,
        project_id=project_id,
        ok=True,
        details={"version": version_num},
    )

    return {"ok": True, "result": result, "version": int(version.version)}


@router.get("/admin/custom-tools/{tool_id}/audit")
async def list_custom_tool_audit(tool_id: str, limit: int = 120, user=Depends(current_user)):
    _require_admin(user)
    await _load_tool_or_404(tool_id)
    safe_limit = max(1, min(int(limit), 1000))
    rows = await get_db()["custom_tool_audit"].find({"toolId": tool_id}).sort("createdAt", -1).limit(safe_limit).to_list(length=safe_limit)
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["id"] = str(item.pop("_id", ""))
        if isinstance(item.get("createdAt"), datetime):
            item["createdAt"] = item["createdAt"].isoformat() + "Z"
        items.append(item)
    return {"items": items}


@router.post("/local-tools/jobs/claim")
async def claim_local_tool_job(req: ClaimLocalJobReq, user=Depends(current_user)):
    user_id = str(user.email or "").strip() or str(user.id)
    try:
        job = await claim_local_tool_job_for_user(
            user_id=user_id,
            project_id=(req.projectId or "").strip() or None,
            claim_id=(req.claimId or "").strip() or None,
        )
    except Exception:
        raise HTTPException(500, "Could not claim local tool job")
    if not job:
        return {"job": None}

    out = {
        "id": str(job.get("_id") or ""),
        "toolId": str(job.get("toolId") or ""),
        "toolName": str(job.get("toolName") or ""),
        "projectId": str(job.get("projectId") or ""),
        "branch": str(job.get("branch") or ""),
        "chatId": str(job.get("chatId") or "") or None,
        "runtime": str(job.get("runtime") or "local_typescript"),
        "version": job.get("version"),
        "code": str(job.get("code") or ""),
        "args": job.get("args") if isinstance(job.get("args"), dict) else {},
        "context": job.get("context") if isinstance(job.get("context"), dict) else {},
        "claimedBy": str(job.get("claimedBy") or "") or None,
        "expiresAt": _as_iso(job.get("expiresAt")),
        "createdAt": _as_iso(job.get("createdAt")),
        "updatedAt": _as_iso(job.get("updatedAt")),
    }
    return {"job": out}


@router.post("/local-tools/jobs/{job_id}/complete")
async def complete_local_job(job_id: str, req: CompleteLocalJobReq, user=Depends(current_user)):
    user_id = str(user.email or "").strip() or str(user.id)
    try:
        out = await complete_local_tool_job(
            job_id=job_id,
            user_id=user_id,
            result=req.result,
            claim_id=(req.claimId or "").strip() or None,
        )
    except CustomToolServiceError as err:
        raise HTTPException(400, str(err))
    return out


@router.post("/local-tools/jobs/{job_id}/fail")
async def fail_local_job(job_id: str, req: FailLocalJobReq, user=Depends(current_user)):
    user_id = str(user.email or "").strip() or str(user.id)
    try:
        out = await fail_local_tool_job(
            job_id=job_id,
            user_id=user_id,
            error=req.error,
            claim_id=(req.claimId or "").strip() or None,
        )
    except CustomToolServiceError as err:
        raise HTTPException(400, str(err))
    return out
