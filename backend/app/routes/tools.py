from __future__ import annotations
from fastapi import APIRouter, Depends, Request, HTTPException
from typing import Any, Optional
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
from ..services.tool_classes import (
    class_descendants,
    class_map as tool_class_map,
    class_key_to_path,
    list_tool_classes,
    normalize_class_key,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def get_db(request: Request):
    # adjust to your app (motor client). Example:
    return request.app.state.db


@router.get("/tools/catalog")
async def tools_catalog(
    project_id: Optional[str] = None,
    class_key: Optional[str] = None,
    include_subclasses: bool = True,
):
    if project_id:
        runtime = await build_runtime_for_project(project_id)
    else:
        runtime = build_default_tool_runtime()
    rows = runtime.catalog()
    class_filter = normalize_class_key(class_key)
    if class_filter:
        classes = await list_tool_classes(
            include_builtin=True,
            include_custom=True,
            include_disabled=False,
            include_virtual_uncategorized=True,
        )
        allowed = class_descendants(classes, class_filter) if include_subclasses else {class_filter}
        rows = [r for r in rows if str(r.get("class_key") or "").strip() in allowed]
    return {"tools": rows}


@router.get("/tools/classes")
async def tools_classes(
    include_disabled: bool = False,
):
    rows = await list_tool_classes(
        include_builtin=True,
        include_custom=True,
        include_disabled=bool(include_disabled),
        include_virtual_uncategorized=True,
    )
    return {"classes": rows, "count": len(rows)}


@router.get("/tools/catalog/availability")
async def tools_catalog_availability(
    project_id: str,
    branch: str = "main",
    chat_id: Optional[str] = None,
    user: Optional[str] = None,
    class_key: Optional[str] = None,
    include_subclasses: bool = True,
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
        class_rows = await list_tool_classes(
            include_builtin=True,
            include_custom=True,
            include_disabled=False,
            include_virtual_uncategorized=True,
        )
        class_filter = normalize_class_key(class_key)
        allowed_class_keys: set[str] | None = None
        if class_filter:
            allowed_class_keys = class_descendants(class_rows, class_filter) if include_subclasses else {class_filter}
        rows: list[dict] = []

        for item in runtime.catalog():
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            item_class_key = str(item.get("class_key") or "").strip()
            if allowed_class_keys is not None and item_class_key not in allowed_class_keys:
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


@router.get("/tools/classes/availability")
async def tools_classes_availability(
    project_id: str,
    branch: str = "main",
    chat_id: Optional[str] = None,
    user: Optional[str] = None,
    include_unavailable: bool = False,
    include_empty: bool = True,
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
        class_rows = await list_tool_classes(
            include_builtin=True,
            include_custom=True,
            include_disabled=False,
            include_virtual_uncategorized=True,
        )
        by_class = tool_class_map(class_rows)
        class_counts: dict[str, dict[str, int]] = {key: {"total": 0, "available": 0} for key in by_class}

        for item in runtime.catalog():
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            spec = runtime._tools.get(name)
            if not spec:
                continue
            class_key = str(item.get("class_key") or "").strip()
            if not class_key:
                continue
            stat = class_counts.setdefault(class_key, {"total": 0, "available": 0})
            stat["total"] += 1
            allowed, reason = runtime._is_tool_allowed(name, spec, policy)
            if allowed:
                cap_allowed, _cap_reason = await runtime._tool_capability_allowed(name, spec, ctx)
                allowed = cap_allowed
            if allowed:
                stat["available"] += 1

        out: list[dict[str, Any]] = []
        for key, row in by_class.items():
            stat = class_counts.get(key) or {"total": 0, "available": 0}
            total_count = int(stat.get("total") or 0)
            available_count = int(stat.get("available") or 0)
            if not include_empty and total_count <= 0:
                continue
            available = available_count > 0
            if not include_unavailable and not available:
                continue
            out.append(
                {
                    "key": key,
                    "display_name": str(row.get("display_name") or key),
                    "description": str(row.get("description") or "").strip() or None,
                    "parent_key": str(row.get("parent_key") or "").strip() or None,
                    "path": str(row.get("path") or class_key_to_path(key)),
                    "origin": str(row.get("origin") or "custom"),
                    "scope": str(row.get("scope") or "global"),
                    "is_enabled": bool(row.get("is_enabled", True)),
                    "available": available,
                    "total_tools": total_count,
                    "available_tools": available_count,
                }
            )

        out.sort(key=lambda row: str(row.get("key") or ""))
        return {
            "project_id": project_id,
            "branch": ctx.branch,
            "chat_id": ctx.chat_id,
            "user": ctx.user_id,
            "count": len(out),
            "classes": out,
        }
    except Exception as err:
        logger.exception("tools.classes.availability.error project=%s", project_id)
        raise HTTPException(500, f"Could not load tool class availability: {err}")


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
