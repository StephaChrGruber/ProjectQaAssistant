import logging
from datetime import datetime, timedelta
import time
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import requests
import shutil
from urllib.parse import urljoin
from pathlib import Path
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership, Connector, LlmProfile
from ..settings import settings
from ..db import get_db
from ..rag.agent2 import answer_with_agent
from ..services.llm_profiles import resolve_project_llm_config
from ..services.feature_flags import (
    DEFAULT_FEATURE_FLAGS,
    load_project_feature_flags,
    update_project_feature_flags,
)
from ..services.automations import dispatch_automation_event
from ..utils.mongo import to_jsonable

router = APIRouter()
logger = logging.getLogger(__name__)

OLLAMA_DEFAULT_BASE_URL = "http://ollama:11434/v1"
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
VALID_CONNECTOR_TYPES = ("confluence", "jira", "github", "bitbucket", "azure_devops", "local")
FALLBACK_OLLAMA_MODELS = [
    "llama3.2:3b",
    "llama3.1:8b",
    "mistral:7b",
    "qwen2.5:7b",
]
FALLBACK_OPENAI_MODELS = [
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4o",
]
SECRET_MASK_PREFIX = "***"
SENSITIVE_KEYS = {
    "token",
    "api_token",
    "apitoken",
    "app_password",
    "apppassword",
    "pat",
    "password",
    "secret",
    "api_key",
    "llm_api_key",
}

MAX_PATH_PICKER_ENTRIES = 500

class CreateProject(BaseModel):
    key: str
    name: str
    description: str | None = None
    repo_path: str | None = None
    default_branch: str = "main"
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_profile_id: str | None = None
    extra: dict | None = None


class UpdateProject(BaseModel):
    name: str | None = None
    description: str | None = None
    repo_path: str | None = None
    default_branch: str | None = None
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_profile_id: str | None = None
    extra: dict | None = None


class UpsertConnector(BaseModel):
    isEnabled: bool = True
    config: dict = {}


class CreateLlmProfile(BaseModel):
    name: str
    description: str | None = None
    provider: str = "ollama"
    base_url: str | None = None
    model: str
    api_key: str | None = None
    isEnabled: bool = True


class UpdateLlmProfile(BaseModel):
    name: str | None = None
    description: str | None = None
    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    isEnabled: bool | None = None


class RunEvaluationsReq(BaseModel):
    questions: list[str]
    branch: str | None = None
    user: str | None = None
    max_questions: int = 8


class UpdateFeatureFlagsReq(BaseModel):
    enable_audit_events: bool | None = None
    enable_connector_health: bool | None = None
    enable_memory_controls: bool | None = None
    dry_run_tools_default: bool | None = None
    require_approval_for_write_tools: bool | None = None


def _serialize_project(p: Project) -> dict:
    llm_key = p.llm_api_key
    masked_llm_key = _mask_secret_value(llm_key) if llm_key else None
    return {
        "id": str(p.id),
        "key": p.key,
        "name": p.name,
        "description": p.description,
        "repo_path": p.repo_path,
        "default_branch": p.default_branch,
        "llm_provider": p.llm_provider,
        "llm_base_url": p.llm_base_url,
        "llm_model": p.llm_model,
        "llm_api_key": masked_llm_key,
        "llm_profile_id": p.llm_profile_id,
        "extra": p.extra or {},
        "createdAt": p.createdAt.isoformat() if p.createdAt else None,
    }


def _serialize_llm_profile(profile: LlmProfile, *, include_secrets: bool = True) -> dict:
    out = {
        "id": str(profile.id),
        "name": profile.name,
        "description": profile.description,
        "provider": profile.provider,
        "base_url": profile.base_url,
        "model": profile.model,
        "isEnabled": profile.isEnabled,
        "createdAt": profile.createdAt.isoformat() if profile.createdAt else None,
        "updatedAt": profile.updatedAt.isoformat() if profile.updatedAt else None,
    }
    if include_secrets:
        out["api_key"] = _mask_secret_value(profile.api_key) if profile.api_key else None
    return out


def _is_sensitive_key(key: str) -> bool:
    low = str(key or "").strip().lower()
    normalized = low.replace("-", "_")
    return normalized in SENSITIVE_KEYS


def _is_masked_secret(value: str | None) -> bool:
    raw = (value or "").strip()
    return bool(raw) and (raw == "__KEEP__" or raw.startswith(SECRET_MASK_PREFIX))


def _mask_secret_value(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if len(raw) <= 4:
        return SECRET_MASK_PREFIX
    return f"{SECRET_MASK_PREFIX}{raw[-4:]}"


def _mask_secrets_in_config(value: object) -> object:
    if isinstance(value, dict):
        out: dict[str, object] = {}
        for k, v in value.items():
            if _is_sensitive_key(str(k)):
                out[str(k)] = _mask_secret_value(str(v) if v is not None else "")
            else:
                out[str(k)] = _mask_secrets_in_config(v)
        return out
    if isinstance(value, list):
        return [_mask_secrets_in_config(x) for x in value]
    return value


def _merge_masked_secrets(existing: dict, incoming: dict) -> dict:
    if not isinstance(existing, dict):
        existing = {}
    if not isinstance(incoming, dict):
        incoming = {}
    out = dict(incoming)
    for k, v in list(out.items()):
        key = str(k)
        if _is_sensitive_key(key) and isinstance(v, str) and _is_masked_secret(v):
            if key in existing:
                out[key] = existing.get(key)
    return out


async def _validate_llm_profile_id(profile_id: str | None) -> str | None:
    pid = (profile_id or "").strip()
    if not pid:
        return None
    try:
        doc = await LlmProfile.get(pid)
    except Exception:
        doc = None
    if not doc or not bool(doc.isEnabled):
        raise HTTPException(400, "Invalid llm_profile_id")
    return str(doc.id)


def _normalize_ollama_tags_url(base_url: str | None) -> str:
    base = (base_url or settings.LLM_BASE_URL or OLLAMA_DEFAULT_BASE_URL).rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + "/api/tags"


def _discover_ollama_models(base_url: str | None) -> tuple[list[str], str | None]:
    try:
        res = requests.get(_normalize_ollama_tags_url(base_url), timeout=3)
        res.raise_for_status()
        data = res.json() or {}
        raw = data.get("models") or []
        names: list[str] = []
        for item in raw:
            name = (item or {}).get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
        if names:
            # Keep stable order while deduplicating.
            deduped = list(dict.fromkeys(names))
            return deduped, None
    except Exception as err:
        return FALLBACK_OLLAMA_MODELS, str(err)

    return FALLBACK_OLLAMA_MODELS, None


def _normalize_openai_base(base_url: str | None) -> str:
    base = (base_url or OPENAI_DEFAULT_BASE_URL).rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    return base + "/"


def _normalize_openai_api_key(api_key: str | None) -> str:
    key = (api_key or "").strip()
    if not key:
        return ""
    # Legacy placeholder from local/Ollama mode should never be used for OpenAI.
    if key.lower() == "ollama":
        return ""
    return key


def _looks_like_chat_model(model_id: str) -> bool:
    mid = (model_id or "").strip().lower()
    if not mid:
        return False

    # Keep likely chat/completions-capable models and drop obviously unrelated families.
    allow_prefixes = ("gpt-", "chatgpt-", "o1", "o3", "o4", "omni-")
    deny_contains = (
        "embedding",
        "whisper",
        "tts",
        "transcribe",
        "moderation",
        "realtime",
        "audio",
        "image",
        "vision",
    )
    if any(part in mid for part in deny_contains):
        return False
    return mid.startswith(allow_prefixes)


def _discover_openai_models(base_url: str | None, api_key: str | None) -> tuple[list[str], str | None]:
    key = _normalize_openai_api_key(api_key)
    if not key:
        return FALLBACK_OPENAI_MODELS, None

    endpoint = urljoin(_normalize_openai_base(base_url), "models")
    try:
        res = requests.get(
            endpoint,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=6,
        )
        res.raise_for_status()
        data = res.json() or {}
        raw = data.get("data") or []
        models: list[str] = []
        for item in raw:
            mid = (item or {}).get("id")
            if isinstance(mid, str) and _looks_like_chat_model(mid):
                models.append(mid.strip())

        if models:
            # Sorted for stable UX; dedupe while preserving sorted order.
            deduped = list(dict.fromkeys(sorted(models)))
            return deduped, None
        return FALLBACK_OPENAI_MODELS, "OpenAI returned no chat-capable models for this key."
    except requests.HTTPError as err:
        status = err.response.status_code if err.response is not None else None
        if status == 401:
            return FALLBACK_OPENAI_MODELS, "Unauthorized (401). Check OpenAI API key."
        if status == 429:
            return FALLBACK_OPENAI_MODELS, "Rate limited or quota exceeded (429). Check billing/quota."
        return FALLBACK_OPENAI_MODELS, str(err)
    except Exception as err:
        return FALLBACK_OPENAI_MODELS, str(err)


def _path_picker_roots() -> list[Path]:
    raw = (settings.PATH_PICKER_ROOTS or "").split(",")
    roots: list[Path] = []
    for item in raw:
        p = item.strip()
        if not p:
            continue
        try:
            resolved = Path(p).expanduser().resolve()
            if resolved.exists() and resolved.is_dir():
                roots.append(resolved)
        except Exception:
            continue
    if roots:
        return roots

    # PATH_PICKER_ROOTS may be intentionally empty; default to the project root
    # so admins can still browse useful directories without exposing full "/".
    try:
        project_root = Path(__file__).resolve().parents[3]
        if project_root.exists() and project_root.is_dir():
            return [project_root]
    except Exception:
        pass

    cwd = Path.cwd()
    if cwd.exists() and cwd.is_dir():
        return [cwd]
    return [Path("/")]


def _is_allowed_path(path: Path, roots: list[Path]) -> bool:
    for root in roots:
        if str(root) == "/":
            return True
        if path == root or root in path.parents:
            return True
    return False


def _eval_sources_count_from_tool_events(tool_events: list[dict]) -> int:
    count = 0
    for ev in tool_events or []:
        if not isinstance(ev, dict) or not bool(ev.get("ok")):
            continue
        result = ev.get("result")
        if isinstance(result, dict):
            for key in ("matches", "items", "hits", "files", "entries", "changed_files"):
                val = result.get(key)
                if isinstance(val, list):
                    count += len(val)
                    break
            else:
                count += 1
        else:
            count += 1
    return count


def _http_ok(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    auth: tuple[str, str] | None = None,
    timeout: int = 8,
) -> tuple[bool, str]:
    try:
        res = requests.get(url, headers=headers, auth=auth, timeout=timeout)
        if 200 <= res.status_code < 300:
            return True, "ok"
        return False, f"{res.status_code} {res.reason}"
    except Exception as err:
        return False, str(err)


def _has_any_nonempty(values: list[object]) -> bool:
    for item in values:
        if isinstance(item, str):
            if item.strip():
                return True
            continue
        if item is not None and str(item).strip():
            return True
    return False


def _connector_is_configured(connector: Connector, project_repo_path: str = "") -> bool:
    ctype = str(connector.type or "")
    cfg = connector.config or {}

    if ctype == "local":
        paths = cfg.get("paths")
        has_paths = isinstance(paths, list) and _has_any_nonempty(list(paths))
        repo_path = str(cfg.get("repo_path") or "").strip() or str(project_repo_path or "").strip()
        return has_paths or bool(repo_path)

    if ctype in {"github", "git"}:
        owner = str(cfg.get("owner") or "").strip()
        repo = str(cfg.get("repo") or "").strip()
        token = str(cfg.get("token") or "").strip()
        return bool(owner and repo and token)

    if ctype == "bitbucket":
        workspace = str(cfg.get("workspace") or "").strip()
        repo = str(cfg.get("repo_slug") or cfg.get("repo") or "").strip()
        token = str(cfg.get("token") or "").strip()
        username = str(cfg.get("username") or "").strip()
        app_password = str(cfg.get("app_password") or cfg.get("appPassword") or "").strip()
        has_auth = bool(token) or bool(username and app_password)
        return bool(workspace and repo and has_auth)

    if ctype == "azure_devops":
        organization = str(cfg.get("organization") or cfg.get("org") or "").strip()
        project = str(cfg.get("project") or "").strip()
        repository = str(cfg.get("repository") or cfg.get("repo") or "").strip()
        pat = str(cfg.get("pat") or cfg.get("token") or "").strip()
        return bool(organization and project and repository and pat)

    if ctype == "confluence":
        base_url = str(cfg.get("baseUrl") or "").strip()
        email = str(cfg.get("email") or "").strip()
        api_token = str(cfg.get("apiToken") or "").strip()
        return bool(base_url and email and api_token)

    if ctype == "jira":
        base_url = str(cfg.get("baseUrl") or "").strip()
        email = str(cfg.get("email") or "").strip()
        api_token = str(cfg.get("apiToken") or "").strip()
        return bool(base_url and email and api_token)

    return False


def _connector_health(connector: Connector, *, project_repo_path: str = "") -> dict[str, object]:
    started = time.perf_counter()
    ctype = str(connector.type or "")
    cfg = connector.config or {}
    ok = False
    detail = "not_checked"
    severity = "warning"

    if ctype == "local":
        paths = cfg.get("paths")
        if isinstance(paths, list) and any(str(x).strip() for x in paths):
            ok = True
            severity = "info"
            detail = "local paths configured"
        else:
            repo_path = str(cfg.get("repo_path") or "").strip() or str(project_repo_path or "").strip()
            if repo_path:
                if repo_path.lower().startswith("browser-local://"):
                    ok = True
                    severity = "info"
                    detail = "browser-local repo configured (checked on client)"
                elif Path(repo_path).exists():
                    ok = True
                    severity = "info"
                    detail = "using project local repo path"
                else:
                    detail = f"local repo path missing on backend: {repo_path}"
            else:
                detail = "no local paths configured"
    elif ctype in {"github", "git"}:
        owner = str(cfg.get("owner") or "").strip()
        repo = str(cfg.get("repo") or "").strip()
        token = str(cfg.get("token") or "").strip()
        if owner and repo and token:
            ok, detail = _http_ok(
                f"https://api.github.com/repos/{owner}/{repo}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
        else:
            detail = "missing owner/repo/token"
    elif ctype == "bitbucket":
        base = str(cfg.get("base_url") or cfg.get("baseUrl") or "https://api.bitbucket.org/2.0").rstrip("/")
        workspace = str(cfg.get("workspace") or "").strip()
        repo = str(cfg.get("repo_slug") or cfg.get("repo") or "").strip()
        token = str(cfg.get("token") or "").strip()
        username = str(cfg.get("username") or "").strip()
        app_password = str(cfg.get("app_password") or cfg.get("appPassword") or "").strip()
        if workspace and repo and token:
            ok, detail = _http_ok(
                f"{base}/repositories/{workspace}/{repo}",
                headers={"Authorization": f"Bearer {token}"},
            )
        elif workspace and repo and username and app_password:
            ok, detail = _http_ok(
                f"{base}/repositories/{workspace}/{repo}",
                auth=(username, app_password),
            )
        else:
            detail = "missing workspace/repo/credentials"
    elif ctype == "azure_devops":
        base = str(cfg.get("base_url") or cfg.get("baseUrl") or "https://dev.azure.com").rstrip("/")
        org = str(cfg.get("organization") or cfg.get("org") or "").strip()
        project = str(cfg.get("project") or "").strip()
        repo = str(cfg.get("repository") or cfg.get("repo") or "").strip()
        pat = str(cfg.get("pat") or cfg.get("token") or "").strip()
        if org and project and repo and pat:
            url = f"{base}/{org}/{project}/_apis/git/repositories/{repo}?api-version=7.0"
            ok, detail = _http_ok(url, auth=("", pat))
        else:
            detail = "missing organization/project/repository/pat"
    elif ctype == "confluence":
        base = str(cfg.get("baseUrl") or "").rstrip("/")
        email = str(cfg.get("email") or "").strip()
        token = str(cfg.get("apiToken") or "").strip()
        space_key = str(cfg.get("spaceKey") or "").strip()
        if base and email and token:
            url = f"{base}/wiki/rest/api/space/{space_key}" if space_key else f"{base}/wiki/rest/api/space?limit=1"
            ok, detail = _http_ok(url, auth=(email, token))
        else:
            detail = "missing baseUrl/email/apiToken"
    elif ctype == "jira":
        base = str(cfg.get("baseUrl") or "").rstrip("/")
        email = str(cfg.get("email") or "").strip()
        token = str(cfg.get("apiToken") or "").strip()
        if base and email and token:
            ok, detail = _http_ok(f"{base}/rest/api/3/myself", auth=(email, token))
        else:
            detail = "missing baseUrl/email/apiToken"
    else:
        detail = "unsupported connector type"

    if ok:
        severity = "info"

    return {
        "id": str(connector.id),
        "type": ctype,
        "isEnabled": bool(connector.isEnabled),
        "ok": bool(ok),
        "severity": severity,
        "detail": detail,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "updatedAt": connector.updatedAt.isoformat() if connector.updatedAt else None,
    }


async def _persist_connector_health_snapshot(project_id: str, items: list[dict[str, object]]) -> None:
    if not items:
        return
    now = datetime.utcnow()
    docs: list[dict[str, object]] = []
    for row in items:
        docs.append(
            {
                "project_id": project_id,
                "connector_id": str(row.get("id") or ""),
                "type": str(row.get("type") or ""),
                "ok": bool(row.get("ok")),
                "severity": str(row.get("severity") or ""),
                "detail": str(row.get("detail") or ""),
                "latency_ms": int(row.get("latency_ms") or 0),
                "checked_at": now,
            }
        )
    try:
        await get_db()["connector_health_events"].insert_many(docs, ordered=False)
    except Exception:
        # Health checks should stay resilient even if history insert fails.
        return


def _empty_connector_health_history(project_id: str, safe_hours: int) -> dict[str, object]:
    return {
        "project_id": project_id,
        "hours": safe_hours,
        "checks": 0,
        "latest_checked_at": None,
        "series": [],
        "alerts": [],
    }


async def _build_connector_health_history(
    project_id: str,
    *,
    hours: int,
    limit: int = 1000,
    connector_ids: set[str] | None = None,
) -> dict[str, object]:
    safe_hours = max(1, min(int(hours or 24), 24 * 30))
    safe_limit = max(10, min(int(limit or 1000), 5000))
    allowed_ids = {str(x).strip() for x in (connector_ids or set()) if str(x).strip()}
    if connector_ids is not None and not allowed_ids:
        return _empty_connector_health_history(project_id, safe_hours)

    since = datetime.utcnow() - timedelta(hours=safe_hours)
    query: dict[str, object] = {"project_id": project_id, "checked_at": {"$gte": since}}
    if allowed_ids:
        query["connector_id"] = {"$in": list(allowed_ids)}
    rows = await get_db()["connector_health_events"].find(
        query,
        {"_id": 0},
    ).sort("checked_at", -1).limit(safe_limit).to_list(length=safe_limit)

    by_connector: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("connector_id") or "")
        if not cid:
            continue
        by_connector[cid].append(row)

    series: list[dict[str, object]] = []
    alerts: list[dict[str, object]] = []
    for connector_id, items in by_connector.items():
        sorted_items = sorted(
            items,
            key=lambda r: r.get("checked_at") if isinstance(r.get("checked_at"), datetime) else datetime.min,
        )
        connector_type = str(sorted_items[-1].get("type") or "") if sorted_items else ""
        points: list[dict[str, object]] = []
        fail_count = 0
        consecutive_failures = 0
        last_failed_at: str | None = None

        for row in reversed(sorted_items):
            ok = bool(row.get("ok"))
            if not ok:
                fail_count += 1
            checked_at = row.get("checked_at")
            ts = checked_at.isoformat() + "Z" if isinstance(checked_at, datetime) else ""
            if (not ok) and not last_failed_at:
                last_failed_at = ts or None
            points.append(
                {
                    "ts": ts,
                    "ok": ok,
                    "latency_ms": int(row.get("latency_ms") or 0),
                    "severity": str(row.get("severity") or ""),
                }
            )

        for row in sorted(sorted_items, key=lambda r: r.get("checked_at") if isinstance(r.get("checked_at"), datetime) else datetime.min, reverse=True):
            if bool(row.get("ok")):
                break
            consecutive_failures += 1

        total = len(sorted_items)
        fail_rate = round((fail_count / total) * 100, 2) if total else 0.0
        series.append(
            {
                "connector_id": connector_id,
                "type": connector_type,
                "checks": total,
                "failures": fail_count,
                "fail_rate_pct": fail_rate,
                "points": points[-80:],  # keep payload small
            }
        )

        if total >= 3 and fail_count >= 1:
            if consecutive_failures >= 3:
                alerts.append(
                    {
                        "connector_id": connector_id,
                        "type": connector_type,
                        "severity": "high",
                        "kind": "consecutive_failures",
                        "message": f"{connector_type} has {consecutive_failures} consecutive failed checks.",
                        "consecutive_failures": consecutive_failures,
                        "fail_rate_pct": fail_rate,
                        "last_failed_at": last_failed_at,
                    }
                )
            elif fail_rate >= 50 and total >= 5:
                alerts.append(
                    {
                        "connector_id": connector_id,
                        "type": connector_type,
                        "severity": "medium",
                        "kind": "high_failure_rate",
                        "message": f"{connector_type} failure rate is {fail_rate}% over last {total} checks.",
                        "consecutive_failures": consecutive_failures,
                        "fail_rate_pct": fail_rate,
                        "last_failed_at": last_failed_at,
                    }
                )

    latest_checked = rows[0].get("checked_at") if rows and isinstance(rows[0], dict) else None
    latest_checked_at = latest_checked.isoformat() + "Z" if isinstance(latest_checked, datetime) else None
    return {
        "project_id": project_id,
        "hours": safe_hours,
        "checks": len(rows),
        "latest_checked_at": latest_checked_at,
        "series": sorted(series, key=lambda x: str(x.get("type") or "")),
        "alerts": alerts,
    }

@router.post("/admin/projects")
async def create_project(req: CreateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    existing = await Project.find_one(Project.key == req.key)
    if existing:
        raise HTTPException(409, "Project key already exists")

    llm_profile_id = await _validate_llm_profile_id(req.llm_profile_id)

    p = Project(
        key=req.key,
        name=req.name,
        description=req.description,
        repo_path=req.repo_path,
        default_branch=req.default_branch or "main",
        llm_provider=req.llm_provider,
        llm_base_url=req.llm_base_url,
        llm_model=req.llm_model,
        llm_api_key=None if _is_masked_secret(req.llm_api_key) else req.llm_api_key,
        llm_profile_id=llm_profile_id,
        extra=req.extra if isinstance(req.extra, dict) else {},
    )
    await p.insert()

    # Make creator admin member (optional)
    await Membership(userId=str(user.id), projectId=str(p.id), role="admin").insert()
    return _serialize_project(p)


@router.get("/admin/projects")
async def list_projects(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    projects = await Project.find_all().to_list()
    out = []
    for p in projects:
        connectors = await Connector.find(Connector.projectId == str(p.id)).to_list()
        out.append(
            {
                **_serialize_project(p),
                "connectors": [
                    {
                        "id": str(c.id),
                        "type": c.type,
                        "isEnabled": c.isEnabled,
                        "config": _mask_secrets_in_config(c.config or {}),
                        "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
                    }
                    for c in connectors
                ],
            }
        )
    return out


@router.patch("/admin/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")

    data = req.model_dump(exclude_unset=True)
    if "llm_profile_id" in data:
        data["llm_profile_id"] = await _validate_llm_profile_id(data.get("llm_profile_id"))
    if "llm_api_key" in data and isinstance(data.get("llm_api_key"), str) and _is_masked_secret(data.get("llm_api_key")):
        data.pop("llm_api_key", None)
    if "extra" in data and not isinstance(data.get("extra"), dict):
        data["extra"] = {}
    for k, v in data.items():
        setattr(p, k, v)
    await p.save()

    return _serialize_project(p)


@router.get("/admin/projects/{project_id}/feature-flags")
async def get_project_feature_flags(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    flags = await load_project_feature_flags(project_id)
    return {
        "project_id": project_id,
        "feature_flags": flags,
        "defaults": dict(DEFAULT_FEATURE_FLAGS),
    }


@router.patch("/admin/projects/{project_id}/feature-flags")
async def patch_project_feature_flags(project_id: str, req: UpdateFeatureFlagsReq, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    data = req.model_dump(exclude_unset=True)
    flags = await update_project_feature_flags(project_id, data)
    return {
        "project_id": project_id,
        "feature_flags": flags,
        "defaults": dict(DEFAULT_FEATURE_FLAGS),
    }


@router.delete("/admin/projects/{project_id}")
async def delete_project(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")

    db = get_db()

    # Legacy chat-store format kept messages in a separate collection.
    legacy_chat_docs = await db["chats"].find(
        {"projectId": project_id},
        {"_id": 1},
    ).to_list(length=50000)
    legacy_chat_ids = [str(d.get("_id")) for d in legacy_chat_docs if d.get("_id") is not None]

    connectors_res = await db["connectors"].delete_many({"projectId": project_id})
    memberships_res = await db["memberships"].delete_many({"projectId": project_id})
    chats_res = await db["chats"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )
    chunks_res = await db["chunks"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )
    docs_res = await db["docs"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )
    automations_res = await db["automations"].delete_many({"project_id": project_id})
    automation_runs_res = await db["automation_runs"].delete_many({"project_id": project_id})
    notifications_res = await db["notifications"].delete_many({"project_id": project_id})

    messages_deleted = 0
    if legacy_chat_ids:
        msg_res = await db["messages"].delete_many({"chatId": {"$in": legacy_chat_ids}})
        messages_deleted = int(msg_res.deleted_count or 0)

    await p.delete()

    chroma_path = Path(settings.CHROMA_ROOT) / project_id
    chroma_deleted = False
    chroma_error: str | None = None
    if chroma_path.exists():
        try:
            shutil.rmtree(chroma_path)
            chroma_deleted = True
        except Exception as err:
            chroma_error = str(err)

    return {
        "projectId": project_id,
        "projectKey": p.key,
        "deleted": {
            "project": 1,
            "connectors": int(connectors_res.deleted_count or 0),
            "memberships": int(memberships_res.deleted_count or 0),
            "chats": int(chats_res.deleted_count or 0),
            "messages": messages_deleted,
            "chunks": int(chunks_res.deleted_count or 0),
            "docs": int(docs_res.deleted_count or 0),
            "automations": int(automations_res.deleted_count or 0),
            "automation_runs": int(automation_runs_res.deleted_count or 0),
            "notifications": int(notifications_res.deleted_count or 0),
        },
        "chroma": {
            "path": str(chroma_path),
            "deleted": chroma_deleted,
            "error": chroma_error,
        },
    }


@router.get("/admin/projects/{project_id}/connectors")
async def list_project_connectors(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    connectors = await Connector.find(Connector.projectId == project_id).to_list()
    return [
        {
            "id": str(c.id),
            "type": c.type,
            "isEnabled": c.isEnabled,
            "config": _mask_secrets_in_config(c.config or {}),
            "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
        }
        for c in connectors
    ]


@router.get("/admin/projects/{project_id}/connectors/health")
async def project_connectors_health(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    flags = await load_project_feature_flags(project_id)
    if not bool(flags.get("enable_connector_health", True)):
        return {
            "project_id": project_id,
            "enabled": False,
            "total": 0,
            "ok": 0,
            "failed": 0,
            "items": [],
        }
    connectors = await Connector.find(Connector.projectId == project_id).to_list()
    project_repo_path = str(project.repo_path or "").strip()
    configured_connectors = [
        c
        for c in connectors
        if bool(c.isEnabled) and _connector_is_configured(c, project_repo_path)
    ]
    items = [_connector_health(c, project_repo_path=project_repo_path) for c in configured_connectors]
    await _persist_connector_health_snapshot(project_id, items)
    ok_count = sum(1 for row in items if bool(row.get("ok")))
    failed_count = max(0, len(items) - ok_count)
    history = await _build_connector_health_history(
        project_id,
        hours=72,
        limit=1200,
        connector_ids={str(c.id) for c in configured_connectors},
    )
    try:
        await dispatch_automation_event(
            project_id,
            event_type="connector_health_checked",
            payload={
                "project_id": project_id,
                "total_connectors": len(items),
                "ok_connectors": ok_count,
                "failed_connectors": failed_count,
                "alerts_count": len(history.get("alerts") or []),
                "items": items[:20],
            },
        )
    except Exception:
        logger.exception("admin.connector_health.automation_dispatch_failed project=%s", project_id)
    return {
        "project_id": project_id,
        "enabled": True,
        "total": len(items),
        "ok": ok_count,
        "failed": failed_count,
        "items": items,
        "alerts": history.get("alerts") or [],
        "history": {
            "checks": history.get("checks") or 0,
            "latest_checked_at": history.get("latest_checked_at"),
        },
    }


@router.get("/admin/projects/{project_id}/connectors/health/history")
async def project_connectors_health_history(project_id: str, hours: int = 72, limit: int = 2000, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    flags = await load_project_feature_flags(project_id)
    if not bool(flags.get("enable_connector_health", True)):
        return {
            "project_id": project_id,
            "enabled": False,
            "hours": max(1, min(int(hours or 72), 24 * 30)),
            "checks": 0,
            "latest_checked_at": None,
            "series": [],
            "alerts": [],
        }
    connectors = await Connector.find(Connector.projectId == project_id).to_list()
    project_repo_path = str(project.repo_path or "").strip()
    configured_ids = {
        str(c.id)
        for c in connectors
        if bool(c.isEnabled) and _connector_is_configured(c, project_repo_path)
    }
    history = await _build_connector_health_history(
        project_id,
        hours=hours,
        limit=limit,
        connector_ids=configured_ids,
    )
    history["enabled"] = True
    return history


@router.put("/admin/projects/{project_id}/connectors/{connector_type}")
async def upsert_connector(
    project_id: str,
    connector_type: str,
    req: UpsertConnector,
    user=Depends(current_user),
):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    normalized_type = "github" if connector_type == "git" else connector_type
    if normalized_type not in VALID_CONNECTOR_TYPES:
        raise HTTPException(400, "Invalid connector type")

    existing = await Connector.find_one(Connector.projectId == project_id, Connector.type == normalized_type)
    now = datetime.utcnow()

    if existing:
        existing.isEnabled = req.isEnabled
        existing.config = _merge_masked_secrets(existing.config or {}, req.config or {})
        existing.updatedAt = now
        await existing.save()
        doc = existing
    else:
        doc = Connector(
            projectId=project_id,
            type=normalized_type,
            isEnabled=req.isEnabled,
            config=req.config or {},
            createdAt=now,
            updatedAt=now,
        )
        await doc.insert()

    return {
        "id": str(doc.id),
        "type": doc.type,
        "isEnabled": doc.isEnabled,
        "config": _mask_secrets_in_config(doc.config or {}),
        "updatedAt": doc.updatedAt.isoformat() if doc.updatedAt else None,
    }


@router.get("/admin/llm/options")
async def llm_options(
    openai_api_key: str | None = None,
    openai_base_url: str | None = None,
    user=Depends(current_user),
):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    ollama_models, ollama_error = _discover_ollama_models(OLLAMA_DEFAULT_BASE_URL)
    resolved_openai_key = _normalize_openai_api_key(
        (openai_api_key or "").strip()
        or (settings.OPENAI_API_KEY or "").strip()
        or (settings.LLM_API_KEY or "").strip()
    )
    openai_models, openai_error = _discover_openai_models(openai_base_url, resolved_openai_key)

    errors: list[str] = []
    if ollama_error:
        errors.append(f"Ollama: {ollama_error}")
    if openai_error:
        errors.append(f"OpenAI: {openai_error}")

    return {
        "providers": [
            {
                "value": "ollama",
                "label": "Ollama (local)",
                "defaultBaseUrl": OLLAMA_DEFAULT_BASE_URL,
                "requiresApiKey": False,
            },
            {
                "value": "openai",
                "label": "ChatGPT / OpenAI API",
                "defaultBaseUrl": OPENAI_DEFAULT_BASE_URL,
                "requiresApiKey": True,
            },
        ],
        "ollama_models": ollama_models,
        "openai_models": openai_models,
        "discovery_error": " | ".join(errors) if errors else None,
        "ollama_discovery_error": ollama_error,
        "openai_discovery_error": openai_error,
    }


@router.get("/admin/fs/list")
async def list_paths(path: str | None = None, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    roots = _path_picker_roots()
    roots_out = [str(r) for r in roots]

    if not path:
        dirs = [
            {
                "name": (r.name or str(r)),
                "path": str(r),
            }
            for r in roots
        ]
        return {
            "path": "",
            "parent": None,
            "roots": roots_out,
            "directories": dirs,
        }

    try:
        current = Path(path).expanduser().resolve()
    except Exception:
        raise HTTPException(400, "Invalid path")

    if not _is_allowed_path(current, roots):
        raise HTTPException(400, "Path not allowed by PATH_PICKER_ROOTS")

    if not current.exists() or not current.is_dir():
        raise HTTPException(404, "Directory not found")

    directories = []
    try:
        for entry in sorted(current.iterdir(), key=lambda p: p.name.lower()):
            if not entry.is_dir():
                continue
            if entry.name.startswith("."):
                continue
            if not _is_allowed_path(entry.resolve(), roots):
                continue
            directories.append({"name": entry.name, "path": str(entry.resolve())})
            if len(directories) >= MAX_PATH_PICKER_ENTRIES:
                break
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    parent: str | None = None
    if current.parent != current and _is_allowed_path(current.parent.resolve(), roots):
        parent = str(current.parent.resolve())

    return {
        "path": str(current),
        "parent": parent,
        "roots": roots_out,
        "directories": directories,
    }


@router.get("/admin/connectors/catalog")
async def connector_catalog(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    return {
        "types": [
            {"type": "github", "label": "GitHub"},
            {"type": "bitbucket", "label": "Bitbucket"},
            {"type": "azure_devops", "label": "Azure DevOps"},
            {"type": "local", "label": "Local Repository"},
            {"type": "confluence", "label": "Confluence"},
            {"type": "jira", "label": "Jira"},
        ]
    }


@router.get("/llm/profiles")
async def list_llm_profiles_public(user=Depends(current_user)):
    profiles = await LlmProfile.find(LlmProfile.isEnabled == True).to_list()
    return [_serialize_llm_profile(p, include_secrets=False) for p in profiles]


@router.get("/admin/llm/profiles")
async def list_llm_profiles(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    profiles = await LlmProfile.find_all().to_list()
    return [_serialize_llm_profile(p, include_secrets=True) for p in profiles]


@router.post("/admin/llm/profiles")
async def create_llm_profile(req: CreateLlmProfile, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    now = datetime.utcnow()
    doc = LlmProfile(
        name=req.name.strip(),
        description=(req.description or "").strip() or None,
        provider=(req.provider or "ollama").strip().lower() or "ollama",
        base_url=(req.base_url or "").strip() or None,
        model=req.model.strip(),
        api_key=None if _is_masked_secret(req.api_key) else (req.api_key or "").strip() or None,
        isEnabled=bool(req.isEnabled),
        createdAt=now,
        updatedAt=now,
    )
    await doc.insert()
    return _serialize_llm_profile(doc, include_secrets=True)


@router.patch("/admin/llm/profiles/{profile_id}")
async def update_llm_profile(profile_id: str, req: UpdateLlmProfile, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    doc = await LlmProfile.get(profile_id)
    if not doc:
        raise HTTPException(404, "LLM profile not found")

    data = req.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "name" and isinstance(v, str):
            v = v.strip()
        if k == "description" and isinstance(v, str):
            v = v.strip() or None
        if k == "provider" and isinstance(v, str):
            v = v.strip().lower() or "ollama"
        if k == "base_url" and isinstance(v, str):
            v = v.strip() or None
        if k == "model" and isinstance(v, str):
            v = v.strip()
        if k == "api_key" and isinstance(v, str):
            if _is_masked_secret(v):
                continue
            v = v.strip() or None
        setattr(doc, k, v)
    doc.updatedAt = datetime.utcnow()
    await doc.save()
    return _serialize_llm_profile(doc, include_secrets=True)


@router.delete("/admin/llm/profiles/{profile_id}")
async def delete_llm_profile(profile_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    doc = await LlmProfile.get(profile_id)
    if not doc:
        raise HTTPException(404, "LLM profile not found")

    db = get_db()
    project_refs = await db["projects"].count_documents({"llm_profile_id": profile_id})
    chat_refs = await db["chats"].count_documents({"llm_profile_id": profile_id})
    await db["projects"].update_many({"llm_profile_id": profile_id}, {"$unset": {"llm_profile_id": ""}})
    await db["chats"].update_many({"llm_profile_id": profile_id}, {"$unset": {"llm_profile_id": ""}})
    await doc.delete()

    return {
        "deleted": True,
        "id": profile_id,
        "project_refs_cleared": int(project_refs),
        "chat_refs_cleared": int(chat_refs),
    }


@router.post("/admin/projects/{project_id}/evaluations/run")
async def run_project_evaluations(project_id: str, req: RunEvaluationsReq, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    clean_questions = [str(q).strip() for q in (req.questions or []) if str(q).strip()]
    if not clean_questions:
        raise HTTPException(400, "questions must not be empty")
    max_questions = max(1, min(int(req.max_questions), 30))
    clean_questions = clean_questions[:max_questions]

    llm = await resolve_project_llm_config(project.model_dump())
    branch = (req.branch or project.default_branch or "main").strip() or "main"
    eval_user = (req.user or "eval@system").strip() or "eval@system"

    rows: list[dict] = []
    started = datetime.utcnow()
    for idx, question in enumerate(clean_questions, start=1):
        q_started = datetime.utcnow()
        ok = True
        error_text: str | None = None
        answer = ""
        tool_events: list[dict] = []
        try:
            out = await answer_with_agent(
                project_id=project_id,
                branch=branch,
                user_id=eval_user,
                question=question,
                llm_base_url=llm.get("llm_base_url"),
                llm_api_key=llm.get("llm_api_key"),
                llm_model=llm.get("llm_model"),
                chat_id=f"{project_id}::eval::{idx}",
                include_tool_events=True,
            )
            answer = str((out or {}).get("answer") or "")
            tool_events = (out or {}).get("tool_events") or []
        except Exception as err:
            ok = False
            error_text = str(err)

        q_finished = datetime.utcnow()
        tool_calls = len(tool_events)
        sources_count = _eval_sources_count_from_tool_events(tool_events)
        rows.append(
            {
                "question": question,
                "ok": ok,
                "error": error_text,
                "answer_chars": len(answer),
                "tool_calls": tool_calls,
                "sources_count": sources_count,
                "latency_ms": int((q_finished - q_started).total_seconds() * 1000),
            }
        )

    finished = datetime.utcnow()
    total = len(rows)
    ok_count = sum(1 for r in rows if r["ok"])
    with_sources = sum(1 for r in rows if int(r.get("sources_count") or 0) > 0)
    avg_latency = int(round(sum(int(r["latency_ms"]) for r in rows) / total)) if total else 0
    avg_tool_calls = round(sum(float(r["tool_calls"]) for r in rows) / total, 2) if total else 0.0
    source_coverage = round((with_sources / total) * 100, 2) if total else 0.0

    run_doc = {
        "project_id": project_id,
        "branch": branch,
        "user": eval_user,
        "started_at": started,
        "finished_at": finished,
        "questions": rows,
        "summary": {
            "total": total,
            "ok": ok_count,
            "failed": total - ok_count,
            "with_sources": with_sources,
            "source_coverage_pct": source_coverage,
            "avg_latency_ms": avg_latency,
            "avg_tool_calls": avg_tool_calls,
        },
    }
    insert_res = await get_db()["evaluation_runs"].insert_one(run_doc)
    run_doc["id"] = str(insert_res.inserted_id)
    return to_jsonable(run_doc)


@router.get("/admin/projects/{project_id}/evaluations")
async def list_project_evaluations(project_id: str, limit: int = 20, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")
    safe_limit = max(1, min(int(limit), 100))
    rows = await get_db()["evaluation_runs"].find(
        {"project_id": project_id},
        {"questions.answer": 0},
    ).sort("started_at", -1).limit(safe_limit).to_list(length=safe_limit)
    out: list[dict] = []
    for row in rows:
        item = dict(row)
        item["id"] = str(item.pop("_id"))
        out.append(item)
    return {"project_id": project_id, "items": out}
