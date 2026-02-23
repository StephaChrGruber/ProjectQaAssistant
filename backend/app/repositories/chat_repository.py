from __future__ import annotations

from datetime import datetime
from typing import Any

from ..db import get_db

CHATS_COLLECTION = "chats"


async def get_chat_owner(chat_id: str) -> dict[str, Any] | None:
    return await get_db()[CHATS_COLLECTION].find_one({"chat_id": chat_id}, {"_id": 0, "chat_id": 1, "user": 1})


async def get_is_global_admin(user_email: str) -> bool:
    doc = await get_db()["users"].find_one({"email": user_email}, {"isGlobalAdmin": 1})
    return bool((doc or {}).get("isGlobalAdmin"))


async def get_chat(chat_id: str, projection: dict[str, int] | None = None) -> dict[str, Any] | None:
    return await get_db()[CHATS_COLLECTION].find_one({"chat_id": chat_id}, projection or {"_id": 0})


async def ensure_chat(payload: dict[str, Any]) -> dict[str, Any] | None:
    await get_db()[CHATS_COLLECTION].update_one(
        {"chat_id": payload["chat_id"]},
        {"$setOnInsert": {**payload, "tool_policy": {}, "llm_profile_id": None}},
        upsert=True,
    )
    return await get_chat(payload["chat_id"], {"_id": 0})


async def list_project_chats(
    project_id: str,
    user: str,
    branch: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"project_id": project_id, "user": user}
    if branch:
        q["branch"] = branch
    safe_limit = max(1, min(limit, 300))
    cursor = (
        get_db()[CHATS_COLLECTION]
        .find(q, {"_id": 0, "messages": 0})
        .sort("updated_at", -1)
        .limit(safe_limit)
    )
    return await cursor.to_list(length=safe_limit)


async def append_chat_message(chat_id: str, msg: dict[str, Any], now: datetime) -> int:
    res = await get_db()[CHATS_COLLECTION].update_one(
        {"chat_id": chat_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now}},
        upsert=False,
    )
    return int(res.matched_count or 0)


async def clear_chat_messages(chat_id: str, now: datetime) -> int:
    res = await get_db()[CHATS_COLLECTION].update_one(
        {"chat_id": chat_id},
        {
            "$set": {
                "messages": [],
                "pending_user_question": None,
                "clarification_state": {"active_goal_id": "", "goals": [], "updated_at": now.isoformat() + "Z"},
                "updated_at": now,
            }
        },
        upsert=False,
    )
    return int(res.matched_count or 0)


async def update_chat_tool_policy(chat_id: str, policy: dict[str, Any], now: datetime) -> int:
    res = await get_db()[CHATS_COLLECTION].update_one(
        {"chat_id": chat_id},
        {"$set": {"tool_policy": policy, "updated_at": now}},
        upsert=False,
    )
    return int(res.matched_count or 0)


async def update_chat_llm_profile(chat_id: str, profile_id: str | None, now: datetime) -> int:
    update_doc: dict[str, Any] = {"updated_at": now, "llm_profile_id": profile_id}
    res = await get_db()[CHATS_COLLECTION].update_one(
        {"chat_id": chat_id},
        {"$set": update_doc},
        upsert=False,
    )
    return int(res.matched_count or 0)


async def list_active_tool_approvals(chat_id: str, now: datetime, limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    cursor = (
        get_db()["chat_tool_approvals"]
        .find({"chatId": chat_id, "expiresAt": {"$gt": now}}, {"_id": 0})
        .sort("createdAt", -1)
        .limit(safe_limit)
    )
    return await cursor.to_list(length=safe_limit)


async def upsert_tool_approval(
    chat_id: str,
    tool_name: str,
    user_id: str,
    approved_by: str,
    created_at: datetime,
    expires_at: datetime,
) -> None:
    await get_db()["chat_tool_approvals"].update_one(
        {"chatId": chat_id, "toolName": tool_name, "userId": user_id},
        {"$set": {"approvedBy": approved_by, "createdAt": created_at, "expiresAt": expires_at}},
        upsert=True,
    )


async def revoke_tool_approval(chat_id: str, tool_name: str, user_id: str) -> None:
    await get_db()["chat_tool_approvals"].delete_many({"chatId": chat_id, "toolName": tool_name, "userId": user_id})

