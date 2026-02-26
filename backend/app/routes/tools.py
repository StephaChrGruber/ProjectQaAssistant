from __future__ import annotations
from fastapi import APIRouter, Depends, Request, HTTPException
from typing import Optional
from bson import ObjectId
import logging

from ..models.tools import (
    RepoGrepRequest, RepoGrepResponse,
    OpenFileRequest, OpenFileResponse,
    KeywordSearchRequest, KeywordSearchResponse,
    ProjectMetadataResponse,
)
from ..utils.projects import get_project_or_404, project_meta
from ..utils.repo_tools import repo_grep_rg, repo_open_file
from ..rag.tool_runtime import ToolContext, build_default_tool_runtime
from ..services.custom_tools import build_runtime_for_project

router = APIRouter()
logger = logging.getLogger(__name__)


def get_db(request: Request):
    # adjust to your app (motor client). Example:
    return request.app.state.db


@router.get("/tools/catalog")
async def tools_catalog(project_id: Optional[str] = None):
    if project_id:
        runtime = await build_runtime_for_project(project_id)
    else:
        runtime = build_default_tool_runtime()
    return {"tools": runtime.catalog()}


@router.get("/tools/catalog/availability")
async def tools_catalog_availability(
    project_id: str,
    branch: str = "main",
    chat_id: Optional[str] = None,
    user: Optional[str] = None,
):
    try:
        runtime = await build_runtime_for_project(project_id)
        user_id = (user or "dev@local").strip() or "dev@local"
        ctx = ToolContext(
            project_id=project_id,
            branch=(branch or "main").strip() or "main",
            user_id=user_id,
            chat_id=(chat_id or None),
            policy={},
        )
        policy = runtime._policy_dict(ctx)
        rows: list[dict] = []

        for item in runtime.catalog():
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            spec = runtime._tools.get(name)
            if not spec:
                continue

            try:
                allowed, reason = runtime._is_tool_allowed(name, spec, policy)
                if allowed:
                    cap_allowed, cap_reason = await runtime._tool_capability_allowed(name, spec, ctx)
                    if not cap_allowed:
                        allowed = False
                        reason = cap_reason
            except Exception as err:
                logger.exception("tools.catalog.availability.capability_error project=%s tool=%s", project_id, name)
                allowed = False
                reason = f"capability_check_failed:{err}"

            row = dict(item)
            row["available"] = bool(allowed)
            if not allowed:
                row["blocked_reason"] = str(reason or "unavailable")
            rows.append(row)

        rows.sort(key=lambda x: str(x.get("name") or ""))
        blocked = [x for x in rows if not bool(x.get("available"))]
        return {
            "project_id": project_id,
            "branch": ctx.branch,
            "chat_id": ctx.chat_id,
            "user": ctx.user_id,
            "available_count": len(rows) - len(blocked),
            "blocked_count": len(blocked),
            "tools": rows,
        }
    except Exception as err:
        logger.exception("tools.catalog.availability.error project=%s", project_id)
        raise HTTPException(500, f"Could not load tool availability: {err}")


@router.get("/projects/{project_id}/metadata", response_model=ProjectMetadataResponse)
async def get_project_metadata(project_id: str, request: Request):
    db = get_db(request)
    p = await get_project_or_404(db, project_id)
    meta = project_meta(p)
    # enforce repo_path exists
    if not meta["repo_path"]:
        # keep it explicit to avoid confusing failures later
        meta["repo_path"] = ""
    return meta


@router.post("/tools/repo_grep", response_model=RepoGrepResponse)
async def repo_grep(req: RepoGrepRequest, request: Request):
    db = get_db(request)
    p = await get_project_or_404(db, req.project_id)
    repo_path = (p.get("repo_path") or "").strip()
    if not repo_path:
        return RepoGrepResponse(matches=[])

    matches = repo_grep_rg(
        repo_root=repo_path,
        pattern=req.pattern,
        glob=req.glob,
        case_sensitive=req.case_sensitive,
        regex=req.regex,
        max_results=req.max_results,
        context_lines=req.context_lines,
    )

    return RepoGrepResponse(
        matches=[
            {
                "path": m[0],
                "line": m[1],
                "column": m[2],
                "snippet": m[3],
                "before": m[4],
                "after": m[5],
            }
            for m in matches
        ]
    )


@router.post("/tools/open_file", response_model=OpenFileResponse)
async def open_file(req: OpenFileRequest, request: Request):
    db = get_db(request)
    p = await get_project_or_404(db, req.project_id)
    repo_path = (p.get("repo_path") or "").strip()
    if not repo_path:
        # you can also allow opening from a non-repo store if you want
        raise Exception("Project has no repo_path")

    s, e, content = repo_open_file(
        repo_root=repo_path,
        rel_path=req.path,
        ref=req.ref,
        start_line=req.start_line,
        end_line=req.end_line,
        max_chars=req.max_chars,
    )

    return OpenFileResponse(
        path=req.path,
        ref=req.ref,
        start_line=s,
        end_line=e,
        content=content,
    )


@router.post("/tools/keyword_search", response_model=KeywordSearchResponse)
async def keyword_search(req: KeywordSearchRequest, request: Request):
    db = get_db(request)

    q = {"project_id": req.project_id}
    if req.branch:
        q["branch"] = req.branch
    if req.source and req.source != "any":
        q["source"] = req.source

    # Mongo text search over chunks
    mongo_query = {
        **q,
        "$text": {"$search": req.query},
    }

    cursor = (
        db.chunks.find(
            mongo_query,
            {
                "score": {"$meta": "textScore"},
                "text": 1,
                "path": 1,
                "title": 1,
                "source": 1,
                "branch": 1,
            },
        )
        .sort([("score", {"$meta": "textScore"})])
        .limit(req.top_k)
    )

    hits = []
    async for doc in cursor:
        text = (doc.get("text") or "").strip()
        preview = text[:400] + ("…" if len(text) > 400 else "")
        hits.append(
            {
                "id": str(doc["_id"]),
                "score": float(doc.get("score") or 0.0),
                "path": doc.get("path"),
                "title": doc.get("title"),
                "source": doc.get("source"),
                "branch": doc.get("branch"),
                "preview": preview,
            }
        )

    return KeywordSearchResponse(hits=hits)
