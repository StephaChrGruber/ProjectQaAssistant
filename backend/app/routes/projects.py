# app/routes/projects.py
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Any
from bson import ObjectId
import subprocess
from datetime import datetime, timedelta

from ..db import get_db  # however you access Mongo (Motor/PyMongo)
from ..services.documentation import (
    DocumentationError,
    generate_project_documentation,
    generate_project_documentation_from_local_context,
    list_project_documentation,
    read_project_documentation_file,
)

router = APIRouter(prefix="/projects", tags=["projects"])


class GenerateDocumentationReq(BaseModel):
    branch: str | None = None


class GenerateLocalDocumentationReq(BaseModel):
    branch: str | None = None
    local_repo_root: str | None = None
    local_repo_file_paths: list[str] = []
    local_repo_context: str

def oid(x: Any) -> ObjectId:
    try:
        return ObjectId(str(x))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project_id")

def project_to_json(p: dict) -> dict:
    # IMPORTANT: convert ObjectId to str so FastAPI can JSON encode it
    p = dict(p)
    p["_id"] = str(p["_id"])
    key = str(p.get("llm_api_key") or "").strip()
    if key:
        p["llm_api_key"] = "***" + key[-4:] if len(key) > 4 else "***"
    return p


def _pctl(values: list[int], p: float) -> int:
    if not values:
        return 0
    sorted_vals = sorted(values)
    idx = int(round((max(0.0, min(p, 1.0))) * (len(sorted_vals) - 1)))
    return int(sorted_vals[idx])

@router.get("")
async def list_projects(x_dev_user: str | None = Header(default=None)):
    # If you're enforcing your POC auth header:
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    # Adjust collection name to your schema
    cursor = get_db().projects.find(
        {},
        {
            "name": 1,
            "key": 1,
            "description": 1,
            "repo_path": 1,
            "default_branch": 1,
            "llm_provider": 1,
            "llm_base_url": 1,
            "llm_model": 1,
            "llm_profile_id": 1,
        },
    ).sort("name", 1)
    items = await cursor.to_list(length=500)
    return [project_to_json(p) for p in items]

@router.get("/{project_id}")
async def get_project(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_to_json(p)


@router.get("/{project_id}/branches")
async def list_project_branches(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    default_branch = (p.get("default_branch") or "main").strip() or "main"
    repo_path = (p.get("repo_path") or "").strip()
    if not repo_path:
        return {"branches": [default_branch]}

    try:
        proc = subprocess.run(
            [
                "git",
                "-C",
                repo_path,
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes/origin",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except Exception:
        return {"branches": [default_branch]}

    if proc.returncode != 0:
        return {"branches": [default_branch]}

    seen: set[str] = set()
    branches: list[str] = []
    for line in proc.stdout.splitlines():
        b = line.strip()
        if not b or b == "origin/HEAD":
            continue
        if b.startswith("origin/"):
            b = b[7:]
        if b and b not in seen:
            seen.add(b)
            branches.append(b)

    if default_branch in seen:
        branches = [default_branch] + [b for b in branches if b != default_branch]
    elif branches:
        branches = [default_branch] + branches
    else:
        branches = [default_branch]

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
        return await generate_project_documentation(project_id=project_id, branch=req.branch)
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

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    safe_limit = max(1, min(int(limit), 500))
    q: dict[str, Any] = {"project_id": project_id}
    if branch:
        q["branch"] = branch
    if chat_id:
        q["chat_id"] = chat_id
    if ok is not None:
        q["ok"] = bool(ok)

    cursor = get_db()["tool_events"].find(q).sort("created_at", -1).limit(safe_limit)
    rows = await cursor.to_list(length=safe_limit)
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["_id"] = str(item.get("_id"))
        ts = item.get("created_at")
        if isinstance(ts, datetime):
            item["created_at"] = ts.isoformat() + "Z"
        out.append(item)

    return {"project_id": project_id, "items": out}


@router.get("/{project_id}/tool-events/summary")
async def summarize_tool_events(
    project_id: str,
    hours: int = 24,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

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
    rows = await get_db()["tool_events"].aggregate(pipeline).to_list(length=500)
    items: list[dict[str, Any]] = []
    total_calls = 0
    total_errors = 0
    for row in rows:
        calls = int(row.get("calls") or 0)
        errors = int(row.get("errors") or 0)
        total_calls += calls
        total_errors += errors
        items.append(
            {
                "tool": str(row.get("_id") or ""),
                "calls": calls,
                "ok": int(row.get("ok") or 0),
                "errors": errors,
                "cached_hits": int(row.get("cached_hits") or 0),
                "avg_duration_ms": int(round(float(row.get("avg_duration_ms") or 0))),
            }
        )

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

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    safe_hours = max(1, min(int(hours), 24 * 180))
    since = datetime.utcnow() - timedelta(hours=safe_hours)

    tool_q: dict[str, Any] = {"project_id": project_id, "created_at": {"$gte": since}}
    if branch:
        tool_q["branch"] = branch

    tool_rows = await get_db()["tool_events"].find(
        tool_q,
        {"_id": 0, "tool": 1, "ok": 1, "duration_ms": 1, "error_code": 1},
    ).to_list(length=5000)

    per_tool: dict[str, dict[str, Any]] = {}
    all_durations: list[int] = []
    timeout_count = 0
    for row in tool_rows:
        tool = str(row.get("tool") or "unknown")
        ok = bool(row.get("ok"))
        duration_ms = int(row.get("duration_ms") or 0)
        err_code = str(row.get("error_code") or "").strip().lower()
        is_timeout = err_code == "timeout"
        if is_timeout:
            timeout_count += 1
        all_durations.append(duration_ms)
        slot = per_tool.setdefault(
            tool,
            {"tool": tool, "calls": 0, "errors": 0, "timeouts": 0, "durations": []},
        )
        slot["calls"] += 1
        if not ok:
            slot["errors"] += 1
        if is_timeout:
            slot["timeouts"] += 1
        slot["durations"].append(duration_ms)

    tool_summary: list[dict[str, Any]] = []
    for slot in per_tool.values():
        durations = [int(v) for v in (slot.get("durations") or [])]
        calls = int(slot.get("calls") or 0)
        tool_summary.append(
            {
                "tool": slot.get("tool"),
                "calls": calls,
                "errors": int(slot.get("errors") or 0),
                "timeouts": int(slot.get("timeouts") or 0),
                "avg_duration_ms": int(round(sum(durations) / calls)) if calls else 0,
                "p95_duration_ms": _pctl(durations, 0.95),
            }
        )
    tool_summary.sort(key=lambda x: int(x.get("calls") or 0), reverse=True)

    chat_q: dict[str, Any] = {"project_id": project_id, "updated_at": {"$gte": since}}
    if branch:
        chat_q["branch"] = branch
    chats = await get_db()["chats"].find(chat_q, {"_id": 0, "messages": 1}).to_list(length=5000)

    assistant_msgs = 0
    with_sources = 0
    grounded_failures = 0
    tool_calls_sum = 0
    for chat in chats:
        for msg in (chat.get("messages") or []):
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role") or "") != "assistant":
                continue
            assistant_msgs += 1
            meta = msg.get("meta") if isinstance(msg.get("meta"), dict) else {}
            sources = meta.get("sources") if isinstance(meta.get("sources"), list) else []
            if sources:
                with_sources += 1
            if meta.get("grounded") is False:
                grounded_failures += 1
            tool_summary_meta = meta.get("tool_summary") if isinstance(meta.get("tool_summary"), dict) else {}
            tool_calls_sum += int(tool_summary_meta.get("calls") or 0)

    source_coverage = round((with_sources / assistant_msgs) * 100, 2) if assistant_msgs else 0.0
    avg_tool_calls_per_answer = round(tool_calls_sum / assistant_msgs, 2) if assistant_msgs else 0.0

    return {
        "project_id": project_id,
        "hours": safe_hours,
        "branch": branch,
        "tool_calls": len(tool_rows),
        "tool_errors": sum(1 for r in tool_rows if not bool(r.get("ok"))),
        "tool_timeouts": timeout_count,
        "tool_latency_avg_ms": int(round(sum(all_durations) / len(all_durations))) if all_durations else 0,
        "tool_latency_p95_ms": _pctl(all_durations, 0.95),
        "assistant_messages": assistant_msgs,
        "answers_with_sources": with_sources,
        "source_coverage_pct": source_coverage,
        "grounded_failures": grounded_failures,
        "avg_tool_calls_per_answer": avg_tool_calls_per_answer,
        "tool_summary": tool_summary,
    }
