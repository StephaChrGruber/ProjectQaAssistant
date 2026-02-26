from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId


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
    db,
    *,
    user: str,
    title: str = "Global Chat",
    active_context_key: str | None = None,
) -> dict[str, Any]:
    chat_id = build_global_chat_id(user)
    now = datetime.utcnow()
    normalized_user = normalize_user_id(user)
    await db["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$setOnInsert": {
                "chat_id": chat_id,
                "user": normalized_user,
                "title": title,
                "created_at": now,
                "messages": [],
                "tool_policy": {},
                "llm_profile_id": None,
            },
            "$set": {
                "updated_at": now,
                "active_context_key": str(active_context_key or "").strip() or None,
            },
        },
        upsert=True,
    )
    return (
        await db["chats"].find_one(
            {"chat_id": chat_id},
            {"_id": 0, "chat_id": 1, "user": 1, "title": 1, "active_context_key": 1, "created_at": 1, "updated_at": 1},
        )
        or {}
    )


async def append_global_message(
    db,
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
    res = await db["chat_messages_v2"].insert_one(doc)
    row = await db["chat_messages_v2"].find_one({"_id": res.inserted_id})
    if not isinstance(row, dict):
        row = {**doc, "_id": res.inserted_id}
    await db["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$set": {
                "updated_at": now,
                "last_message_at": now,
                "last_message_preview": str(content or "")[:160],
            }
        },
    )
    return row


def _decode_cursor(cursor: str | None) -> ObjectId | None:
    value = str(cursor or "").strip()
    if not value or not ObjectId.is_valid(value):
        return None
    return ObjectId(value)


async def list_global_messages(
    db,
    *,
    chat_id: str,
    active_context_key: str | None,
    mode: str = "mixed",
    context_key: str | None = None,
    cursor: str | None = None,
    limit: int = 120,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 120), 300))
    q: dict[str, Any] = {"chat_id": chat_id}
    decoded_cursor = _decode_cursor(cursor)
    if decoded_cursor is not None:
        q["_id"] = {"$lt": decoded_cursor}
    normalized_mode = str(mode or "mixed").strip().lower()
    active_key = str(active_context_key or "").strip() or None
    effective_context_key = str(context_key or "").strip() or active_key
    if normalized_mode == "active" and effective_context_key:
        q["context_key"] = effective_context_key

    rows = (
        await db["chat_messages_v2"]
        .find(q)
        .sort([("_id", -1)])
        .limit(safe_limit + 1)
        .to_list(length=safe_limit + 1)
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
    db,
    *,
    chat_id: str,
    context_key: str,
    include_pinned_memory: bool = True,
    active_limit: int = 280,
    pinned_limit: int = 64,
) -> list[dict[str, Any]]:
    safe_active = max(1, min(int(active_limit or 280), 500))
    safe_pins = max(0, min(int(pinned_limit or 64), 200))

    active_rows = (
        await db["chat_messages_v2"]
        .find({"chat_id": chat_id, "context_key": context_key})
        .sort([("_id", -1)])
        .limit(safe_active)
        .to_list(length=safe_active)
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

    pinned_rows = (
        await db["chat_messages_v2"]
        .find({"chat_id": chat_id, "is_pinned": True})
        .sort([("_id", -1)])
        .limit(safe_pins)
        .to_list(length=safe_pins)
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
    db,
    *,
    chat_id: str,
    message_id: str,
    pin: bool,
    reason: str | None = None,
) -> dict[str, Any]:
    if not ObjectId.is_valid(message_id):
        raise ValueError("Invalid message_id")
    oid = ObjectId(message_id)
    patch = {
        "is_pinned": bool(pin),
        "pin_source": str(reason or "manual").strip() or "manual",
    }
    await db["chat_messages_v2"].update_one({"_id": oid, "chat_id": chat_id}, {"$set": patch})
    row = await db["chat_messages_v2"].find_one({"_id": oid, "chat_id": chat_id})
    if not isinstance(row, dict):
        raise ValueError("Message not found")
    return row


async def list_contexts_for_chat(db, *, chat_id: str, limit: int = 300) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 300), 1000))
    rows = (
        await db["chat_messages_v2"]
        .aggregate(
            [
                {"$match": {"chat_id": chat_id, "context_key": {"$exists": True, "$ne": ""}}},
                {
                    "$group": {
                        "_id": "$context_key",
                        "project_id": {"$last": "$project_id"},
                        "branch": {"$last": "$branch"},
                        "last_ts": {"$max": "$ts"},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"last_ts": -1}},
                {"$limit": safe_limit},
            ]
        )
        .to_list(length=safe_limit)
    )
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
    db,
    *,
    chat_id: str,
    user: str,
    context_key: str,
) -> dict[str, Any]:
    q = {
        "chat_id": chat_id,
        "user": normalize_user_id(user),
        "context_key": str(context_key or "").strip(),
    }
    row = await db["chat_context_config"].find_one(q, {"_id": 0})
    return row or {}


async def upsert_context_config(
    db,
    *,
    chat_id: str,
    user: str,
    context_key: str,
    project_id: str,
    branch: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.utcnow()
    q = {
        "chat_id": chat_id,
        "user": normalize_user_id(user),
        "context_key": str(context_key or "").strip(),
    }
    set_doc = {
        "updated_at": now,
        "project_id": str(project_id or "").strip(),
        "branch": str(branch or "main").strip() or "main",
    }
    for key, value in (patch or {}).items():
        set_doc[key] = value
    await db["chat_context_config"].update_one(
        q,
        {
            "$set": set_doc,
            "$setOnInsert": {
                "chat_id": chat_id,
                "user": normalize_user_id(user),
                "context_key": str(context_key or "").strip(),
                "created_at": now,
            },
        },
        upsert=True,
    )
    return await db["chat_context_config"].find_one(q, {"_id": 0}) or {}


async def list_context_configs(db, *, chat_id: str, user: str, limit: int = 300) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 300), 1000))
    rows = (
        await db["chat_context_config"]
        .find({"chat_id": chat_id, "user": normalize_user_id(user)}, {"_id": 0})
        .sort("updated_at", -1)
        .limit(safe_limit)
        .to_list(length=safe_limit)
    )
    return [row for row in rows if isinstance(row, dict)]
