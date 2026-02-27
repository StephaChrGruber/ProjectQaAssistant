from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from ..repositories.factory import repository_factory
from ..services.global_chat_v2 import (
    append_global_message,
    build_context_key,
    build_global_chat_id,
    ensure_global_chat_envelope,
    get_context_config,
    list_context_configs,
    list_contexts_for_chat,
    list_global_messages,
    parse_context_key,
    set_message_pin_state,
    upsert_context_config,
)

router = APIRouter(prefix="/chat/global", tags=["chat-global"])


class SelectContextReq(BaseModel):
    chat_id: str
    project_id: str
    branch: str = "main"
    user: str | None = None


class PinReq(BaseModel):
    pin: bool = True
    reason: str | None = None


class PutContextConfigReq(BaseModel):
    chat_id: str
    user: str | None = None
    context_key: str | None = None
    project_id: str | None = None
    branch: str | None = None
    llm_profile_id: str | None = None
    tool_policy: dict[str, Any] | None = None


def _resolve_user(query_user: str | None, header_user: str | None) -> str:
    user = str(query_user or header_user or "").strip().lower()
    if not user:
        raise HTTPException(status_code=400, detail="user is required")
    return user


@router.get("/bootstrap")
async def bootstrap_global_chat(
    user: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    branch: str | None = Query(default=None),
    x_dev_user: str | None = Header(default=None),
):
    repos = repository_factory()
    chat_repo = repos.global_chat
    user_id = _resolve_user(user, x_dev_user)
    active_context_key = None
    if str(project_id or "").strip():
        active_context_key = build_context_key(str(project_id or "").strip(), str(branch or "main"))
    chat = await ensure_global_chat_envelope(user=user_id, active_context_key=active_context_key)
    chat_id = str(chat.get("chat_id") or build_global_chat_id(user_id))
    contexts_from_messages = await list_contexts_for_chat(chat_id=chat_id, limit=240)
    contexts_from_config = await list_context_configs(chat_id=chat_id, user=user_id, limit=240)
    merged: dict[str, dict[str, Any]] = {}
    for item in contexts_from_messages:
        key = str(item.get("context_key") or "").strip()
        if not key:
            continue
        merged[key] = {
            "context_key": key,
            "project_id": item.get("project_id"),
            "branch": item.get("branch"),
            "message_count": int(item.get("count") or 0),
            "last_ts": item.get("last_ts"),
            "llm_profile_id": None,
            "tool_policy": None,
        }
    for item in contexts_from_config:
        key = str(item.get("context_key") or "").strip()
        if not key:
            continue
        existing = merged.get(
            key,
            {
                "context_key": key,
                "project_id": item.get("project_id"),
                "branch": item.get("branch"),
                "message_count": 0,
                "last_ts": None,
            },
        )
        existing["project_id"] = existing.get("project_id") or item.get("project_id")
        existing["branch"] = existing.get("branch") or item.get("branch")
        existing["llm_profile_id"] = item.get("llm_profile_id")
        existing["tool_policy"] = item.get("tool_policy") if isinstance(item.get("tool_policy"), dict) else None
        merged[key] = existing
    contexts = sorted(
        merged.values(),
        key=lambda row: str(row.get("last_ts") or ""),
        reverse=True,
    )
    unread_notifications = await repos.notifications.count_unread_notifications(user_ids=[user_id])
    active_key = str(chat.get("active_context_key") or "").strip() or None
    if active_context_key:
        active_key = active_context_key
        await chat_repo.set_chat_active_context(
            chat_id=chat_id,
            active_context_key=active_context_key,
            now=datetime.utcnow(),
        )
    return {
        "chat_id": chat_id,
        "user": user_id,
        "active_context_key": active_key,
        "contexts": contexts,
        "unread_notifications": int(unread_notifications or 0),
        "feature_matrix": {
            "global_timeline": True,
            "compact_inactive_bubbles": True,
            "history_mode_default": "active_plus_pinned",
        },
    }


@router.get("/messages")
async def global_chat_messages(
    chat_id: str,
    project_id: str | None = None,
    branch: str | None = None,
    context_key: str | None = None,
    mode: str = "mixed",
    cursor: str | None = None,
    limit: int = 120,
):
    chat_repo = repository_factory().global_chat
    chat = await chat_repo.get_chat_envelope(chat_id=chat_id, projection={"_id": 0, "active_context_key": 1})
    if not isinstance(chat, dict):
        raise HTTPException(status_code=404, detail="Chat not found")
    explicit_context_key = str(context_key or "").strip()
    if not explicit_context_key and str(project_id or "").strip():
        explicit_context_key = build_context_key(str(project_id or "").strip(), str(branch or "main"))
    active_context_key = explicit_context_key or str(chat.get("active_context_key") or "").strip() or None
    rows = await list_global_messages(
        chat_id=chat_id,
        active_context_key=active_context_key,
        mode=mode,
        context_key=explicit_context_key or None,
        cursor=cursor,
        limit=limit,
    )
    return {
        "chat_id": chat_id,
        "active_context_key": active_context_key,
        **rows,
    }


@router.post("/context/select")
async def global_chat_select_context(req: SelectContextReq, x_dev_user: str | None = Header(default=None)):
    user = _resolve_user(req.user, x_dev_user)
    chat_id = str(req.chat_id or "").strip()
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required")
    project_id = str(req.project_id or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")
    branch = str(req.branch or "main").strip() or "main"
    context_key = build_context_key(project_id, branch)
    await ensure_global_chat_envelope(user=user, active_context_key=context_key)
    cfg = await upsert_context_config(
        chat_id=chat_id,
        user=user,
        context_key=context_key,
        project_id=project_id,
        branch=branch,
        patch={},
    )
    return {
        "chat_id": chat_id,
        "active_context_key": context_key,
        "project_id": project_id,
        "branch": branch,
        "runtime_config": {
            "llm_profile_id": cfg.get("llm_profile_id"),
            "tool_policy": cfg.get("tool_policy") if isinstance(cfg.get("tool_policy"), dict) else {},
        },
    }


@router.post("/pins/{message_id}")
async def global_chat_pin_message(message_id: str, req: PinReq, chat_id: str):
    try:
        row = await set_message_pin_state(
            chat_id=chat_id,
            message_id=message_id,
            pin=bool(req.pin),
            reason=req.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"chat_id": chat_id, "item": row}


@router.get("/context-config")
async def global_chat_get_context_config(
    chat_id: str,
    project_id: str | None = None,
    branch: str | None = None,
    context_key: str | None = None,
    user: str | None = Query(default=None),
    x_dev_user: str | None = Header(default=None),
):
    user_id = _resolve_user(user, x_dev_user)
    key = str(context_key or "").strip()
    if not key:
        key = build_context_key(str(project_id or "").strip(), str(branch or "main"))
    if not str(key or "").strip():
        raise HTTPException(status_code=400, detail="context_key or project_id is required")
    cfg = await get_context_config(chat_id=chat_id, user=user_id, context_key=key)
    if not cfg:
        parsed_project_id, parsed_branch = parse_context_key(key)
        cfg = await upsert_context_config(
            chat_id=chat_id,
            user=user_id,
            context_key=key,
            project_id=str(parsed_project_id or ""),
            branch=str(parsed_branch or "main"),
            patch={},
        )
    return {"chat_id": chat_id, "context_key": key, "config": cfg}


@router.put("/context-config")
async def global_chat_put_context_config(req: PutContextConfigReq, x_dev_user: str | None = Header(default=None)):
    user = _resolve_user(req.user, x_dev_user)
    chat_id = str(req.chat_id or "").strip()
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required")
    key = str(req.context_key or "").strip()
    project_id = str(req.project_id or "").strip()
    branch = str(req.branch or "main").strip() or "main"
    if not key and project_id:
        key = build_context_key(project_id, branch)
    if not key:
        raise HTTPException(status_code=400, detail="context_key or project_id is required")
    parsed_project_id, parsed_branch = parse_context_key(key)
    project_id = project_id or str(parsed_project_id or "")
    branch = branch or str(parsed_branch or "main")
    patch: dict[str, Any] = {}
    if req.llm_profile_id is not None:
        patch["llm_profile_id"] = str(req.llm_profile_id or "").strip() or None
    if req.tool_policy is not None:
        patch["tool_policy"] = req.tool_policy if isinstance(req.tool_policy, dict) else {}
    cfg = await upsert_context_config(
        chat_id=chat_id,
        user=user,
        context_key=key,
        project_id=project_id,
        branch=branch,
        patch=patch,
    )
    return {"chat_id": chat_id, "context_key": key, "config": cfg}


@router.post("/messages/append")
async def global_chat_append_message(
    chat_id: str,
    role: str,
    content: str,
    project_id: str,
    branch: str = "main",
    context_key: str | None = None,
    user: str | None = Query(default=None),
    x_dev_user: str | None = Header(default=None),
):
    user_id = _resolve_user(user, x_dev_user)
    key = str(context_key or "").strip() or build_context_key(project_id, branch)
    item = await append_global_message(
        chat_id=chat_id,
        user=user_id,
        role=role,
        content=content,
        context_key=key,
        project_id=project_id,
        branch=branch,
    )
    return {"chat_id": chat_id, "item": item}
