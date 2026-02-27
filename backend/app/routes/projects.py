from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..repositories.factory import repository_factory
from ..repositories.projects_repository import (
    get_project as repo_get_project,
    list_projects as repo_list_projects,
    parse_project_object_id,
    serialize_project,
)
from ..services.documentation import (
    DocumentationError,
    generate_project_documentation,
    generate_project_documentation_from_local_context,
    list_project_documentation,
    read_project_documentation_file,
)
from ..services.audit_events import list_audit_events as list_project_audit_events
from ..services.project_metrics import (
    build_qa_metrics_payload,
    summarize_tool_event_rows,
)
from ..services.remote_branches import list_project_branches as resolve_project_branches

router = APIRouter(prefix="/projects", tags=["projects"])


class GenerateDocumentationReq(BaseModel):
    branch: str | None = None


class GenerateLocalDocumentationReq(BaseModel):
    branch: str | None = None
    local_repo_root: str | None = None
    local_repo_file_paths: list[str] = []
    local_repo_context: str

def _parse_project_id_or_400(project_id: str):
    try:
        return parse_project_object_id(project_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid project_id") from exc


async def _load_project_or_404(project_id: str) -> dict[str, Any]:
    _parse_project_id_or_400(project_id)
    project = await repo_get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.get("")
async def list_projects(x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    return await repo_list_projects()

@router.get("/{project_id}")
async def get_project(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await _load_project_or_404(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return serialize_project(p)


@router.get("/{project_id}/branches")
async def list_project_branches(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await _load_project_or_404(project_id)
    branches = await resolve_project_branches(project_id, p)
    return {"branches": branches}


@router.post("/{project_id}/documentation/generate")
async def generate_documentation(
    project_id: str,
    req: GenerateDocumentationReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await generate_project_documentation(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
        )
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/documentation/generate-local")
async def generate_documentation_local(
    project_id: str,
    req: GenerateLocalDocumentationReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await generate_project_documentation_from_local_context(
            project_id=project_id,
            branch=req.branch,
            local_repo_root=req.local_repo_root or "",
            local_repo_file_paths=req.local_repo_file_paths or [],
            local_repo_context=req.local_repo_context or "",
            user_id=x_dev_user,
        )
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/documentation")
async def list_documentation(
    project_id: str,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await list_project_documentation(project_id=project_id, branch=branch)
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/documentation/file")
async def open_documentation_file(
    project_id: str,
    path: str,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await read_project_documentation_file(project_id=project_id, path=path, branch=branch)
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/tool-events")
async def list_tool_events(
    project_id: str,
    branch: str | None = None,
    chat_id: str | None = None,
    ok: bool | None = None,
    limit: int = 100,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    await _load_project_or_404(project_id)

    safe_limit = max(1, min(int(limit), 500))
    q: dict[str, Any] = {"project_id": project_id}
    if branch:
        q["branch"] = branch
    if chat_id:
        q["chat_id"] = chat_id
    if ok is not None:
        q["ok"] = bool(ok)

    rows = await repository_factory().project_telemetry.list_tool_events(
        query=q,
        limit=safe_limit,
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["_id"] = str(item.get("_id"))
        ts = item.get("created_at")
        if isinstance(ts, datetime):
            item["created_at"] = ts.isoformat() + "Z"
        out.append(item)

    return {"project_id": project_id, "items": out}


@router.get("/{project_id}/audit-events")
async def list_audit_events(
    project_id: str,
    branch: str | None = None,
    chat_id: str | None = None,
    event: str | None = None,
    limit: int = 120,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    await _load_project_or_404(project_id)
    items = await list_project_audit_events(
        project_id=project_id,
        branch=branch,
        chat_id=chat_id,
        event=event,
        limit=max(1, min(int(limit or 120), 1000)),
    )
    return {"project_id": project_id, "items": items}


@router.get("/{project_id}/tool-events/summary")
async def summarize_tool_events(
    project_id: str,
    hours: int = 24,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    await _load_project_or_404(project_id)

    safe_hours = max(1, min(int(hours), 24 * 90))
    since = datetime.utcnow() - timedelta(hours=safe_hours)
    match: dict[str, Any] = {"project_id": project_id, "created_at": {"$gte": since}}
    if branch:
        match["branch"] = branch

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": "$tool",
                "calls": {"$sum": 1},
                "ok": {"$sum": {"$cond": ["$ok", 1, 0]}},
                "errors": {"$sum": {"$cond": ["$ok", 0, 1]}},
                "cached_hits": {"$sum": {"$cond": ["$cached", 1, 0]}},
                "avg_duration_ms": {"$avg": "$duration_ms"},
            }
        },
        {"$sort": {"calls": -1, "_id": 1}},
    ]
    rows = await repository_factory().project_telemetry.aggregate_tool_events(
        pipeline=pipeline,
        limit=500,
    )
    total_calls, total_errors, items = summarize_tool_event_rows(rows)

    return {
        "project_id": project_id,
        "hours": safe_hours,
        "total_calls": total_calls,
        "total_errors": total_errors,
        "items": items,
    }


@router.get("/{project_id}/qa-metrics")
async def qa_metrics(
    project_id: str,
    hours: int = 24,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    await _load_project_or_404(project_id)

    safe_hours = max(1, min(int(hours), 24 * 180))
    since = datetime.utcnow() - timedelta(hours=safe_hours)

    tool_q: dict[str, Any] = {"project_id": project_id, "created_at": {"$gte": since}}
    if branch:
        tool_q["branch"] = branch

    tool_rows = await repository_factory().project_telemetry.list_tool_events(
        query=tool_q,
        projection={"_id": 0, "tool": 1, "ok": 1, "duration_ms": 1, "error_code": 1},
        limit=5000,
    )

    chat_q: dict[str, Any] = {"project_id": project_id, "updated_at": {"$gte": since}}
    if branch:
        chat_q["branch"] = branch
    chats = await repository_factory().project_telemetry.list_chats(
        query=chat_q,
        projection={"_id": 0, "messages": 1},
        limit=5000,
    )
    return build_qa_metrics_payload(
        project_id=project_id,
        hours=safe_hours,
        branch=branch,
        tool_rows=tool_rows,
        chats=chats,
    )
