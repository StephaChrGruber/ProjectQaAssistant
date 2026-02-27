from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId

from ..repositories.factory import repository_factory


def normalize_user_id(user: str) -> str:
    return str(user or "").strip().lower()


def build_global_chat_id(user: str) -> str:
    return f"global::{normalize_user_id(user)}"


def build_context_key(project_id: str, branch: str) -> str:
    return f"{str(project_id or '').strip()}::{str(branch or 'main').strip() or 'main'}"


def parse_context_key(context_key: str | None) -> tuple[str | None, str | None]:
    raw = str(context_key or "").strip()
    if not raw:
        return None, None
    if "::" not in raw:
        return raw, "main"
    left, right = raw.split("::", 1)
    project_id = left.strip() or None
    branch = right.strip() or "main"
    return project_id, branch


def _to_iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    if value is None:
        return None
    return str(value)


def _serialize_message(row: dict[str, Any], active_context_key: str | None) -> dict[str, Any]:
    context_key = str(row.get("context_key") or "").strip()
    project_id = str(row.get("project_id") or "").strip() or None
    branch = str(row.get("branch") or "").strip() or None
    out = {
        "id": str(row.get("_id")) if row.get("_id") is not None else None,
        "chat_id": str(row.get("chat_id") or ""),
        "user": str(row.get("user") or ""),
        "role": str(row.get("role") or "assistant"),
        "content": str(row.get("content") or ""),
        "ts": _to_iso(row.get("ts")),
        "context_key": context_key or None,
        "project_id": project_id,
        "branch": branch,
        "is_pinned": bool(row.get("is_pinned")),
        "pin_source": str(row.get("pin_source") or "") or None,
        "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
        "is_active_context": bool(active_context_key and context_key and context_key == active_context_key),
        "compact_hint": bool(active_context_key and context_key and context_key != active_context_key),
    }
    return out


async def ensure_global_chat_envelope(
    db=None,
    *,
    user: str,
    title: str = "Global Chat",
    active_context_key: str | None = None,
) -> dict[str, Any]:
    chat_id = build_global_chat_id(user)
    now = datetime.utcnow()
    normalized_user = normalize_user_id(user)
    repo = repository_factory(db).global_chat
    row = await repo.ensure_chat_envelope(
        chat_id=chat_id,
        user=normalized_user,
        title=title,
        active_context_key=str(active_context_key or "").strip() or None,
        now=now,
    )
    return row or {}


async def append_global_message(
    db=None,
    *,
    chat_id: str,
    user: str,
    role: str,
    content: str,
    context_key: str,
    project_id: str,
    branch: str,
    ts: datetime | None = None,
    meta: dict[str, Any] | None = None,
    is_pinned: bool = False,
    pin_source: str | None = None,
) -> dict[str, Any]:
    repo = repository_factory(db).global_chat
    now = ts or datetime.utcnow()
    doc = {
        "chat_id": chat_id,
        "user": normalize_user_id(user),
        "role": str(role or "assistant"),
        "content": str(content or ""),
        "ts": now,
        "context_key": str(context_key or "").strip(),
        "project_id": str(project_id or "").strip(),
        "branch": str(branch or "main").strip() or "main",
        "is_pinned": bool(is_pinned),
        "pin_source": str(pin_source or "").strip() or None,
        "meta": meta if isinstance(meta, dict) else {},
    }
    row = await repo.append_message(doc=doc)
    await repo.touch_chat_after_message(chat_id=chat_id, now=now, content=str(content or ""))
    return row


async def list_global_messages(
    db=None,
    *,
    chat_id: str,
    active_context_key: str | None,
    mode: str = "mixed",
    context_key: str | None = None,
    cursor: str | None = None,
    limit: int = 120,
) -> dict[str, Any]:
    repo = repository_factory(db).global_chat
    safe_limit = max(1, min(int(limit or 120), 300))
    normalized_mode = str(mode or "mixed").strip().lower()
    active_key = str(active_context_key or "").strip() or None
    effective_context_key = str(context_key or "").strip() or active_key
    rows = await repo.list_messages(
        chat_id=chat_id,
        context_key=effective_context_key if normalized_mode == "active" and effective_context_key else None,
        before_id=cursor,
        limit=safe_limit + 1,
        descending=True,
    )
    has_more = len(rows) > safe_limit
    rows = rows[:safe_limit]
    next_cursor = str(rows[-1]["_id"]) if has_more and rows else None
    rows.reverse()
    items = [_serialize_message(row, effective_context_key if normalized_mode == "active" else active_key) for row in rows]
    return {
        "items": items,
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


async def list_llm_history_messages(
    db=None,
    *,
    chat_id: str,
    context_key: str,
    include_pinned_memory: bool = True,
    active_limit: int = 280,
    pinned_limit: int = 64,
) -> list[dict[str, Any]]:
    repo = repository_factory(db).global_chat
    safe_active = max(1, min(int(active_limit or 280), 500))
    safe_pins = max(0, min(int(pinned_limit or 64), 200))

    active_rows = await repo.list_messages(
        chat_id=chat_id,
        context_key=context_key,
        limit=safe_active,
        descending=True,
    )
    active_rows.reverse()
    active_messages: list[dict[str, Any]] = []
    for row in active_rows:
        role = str(row.get("role") or "").strip()
        if role not in {"user", "assistant", "system", "tool"}:
            continue
        active_messages.append(
            {
                "role": role,
                "content": str(row.get("content") or ""),
                "ts": row.get("ts"),
                "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
            }
        )

    if not include_pinned_memory or safe_pins <= 0:
        return active_messages

    pinned_rows = await repo.list_messages(
        chat_id=chat_id,
        is_pinned=True,
        limit=safe_pins,
        descending=True,
    )
    pinned_rows.reverse()
    pinned_messages: list[dict[str, Any]] = []
    for row in pinned_rows:
        role = str(row.get("role") or "").strip() or "system"
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        pinned_messages.append(
            {
                "role": "system" if role == "assistant" else role,
                "content": f"[Pinned memory from {row.get('context_key')}] {content}",
                "ts": row.get("ts"),
                "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
            }
        )

    return [*pinned_messages, *active_messages]


async def set_message_pin_state(
    db=None,
    *,
    chat_id: str,
    message_id: str,
    pin: bool,
    reason: str | None = None,
) -> dict[str, Any]:
    repo = repository_factory(db).global_chat
    if not ObjectId.is_valid(message_id):
        raise ValueError("Invalid message_id")
    await repo.set_message_pin_state(
        chat_id=chat_id,
        message_id=message_id,
        is_pinned=bool(pin),
        pin_source=str(reason or "manual").strip() or "manual",
    )
    row = await repo.get_message(chat_id=chat_id, message_id=message_id)
    if not isinstance(row, dict):
        raise ValueError("Message not found")
    return row


async def list_contexts_for_chat(db=None, *, chat_id: str, limit: int = 300) -> list[dict[str, Any]]:
    repo = repository_factory(db).global_chat
    rows = await repo.list_context_summaries(chat_id=chat_id, limit=limit)
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "context_key": str(row.get("_id") or ""),
                "project_id": str(row.get("project_id") or "") or None,
                "branch": str(row.get("branch") or "") or None,
                "last_ts": _to_iso(row.get("last_ts")),
                "count": int(row.get("count") or 0),
            }
        )
    return out


async def get_context_config(
    db=None,
    *,
    chat_id: str,
    user: str,
    context_key: str,
) -> dict[str, Any]:
    repo = repository_factory(db).global_chat
    row = await repo.get_context_config(
        chat_id=chat_id,
        user=normalize_user_id(user),
        context_key=str(context_key or "").strip(),
    )
    return row or {}


async def upsert_context_config(
    db=None,
    *,
    chat_id: str,
    user: str,
    context_key: str,
    project_id: str,
    branch: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    repo = repository_factory(db).global_chat
    now = datetime.utcnow()
    row = await repo.upsert_context_config(
        chat_id=chat_id,
        user=normalize_user_id(user),
        context_key=str(context_key or "").strip(),
        project_id=str(project_id or "").strip(),
        branch=str(branch or "main").strip() or "main",
        patch=patch or {},
        now=now,
    )
    return row or {}


async def list_context_configs(db=None, *, chat_id: str, user: str, limit: int = 300) -> list[dict[str, Any]]:
    repo = repository_factory(db).global_chat
    rows = await repo.list_context_configs(
        chat_id=chat_id,
        user=normalize_user_id(user),
        limit=limit,
    )
    return [row for row in rows if isinstance(row, dict)]
