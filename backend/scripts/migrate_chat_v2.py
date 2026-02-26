from __future__ import annotations

import asyncio
import hashlib
import os
from datetime import datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient


def _mongo_uri() -> str:
    return os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "mongodb://localhost:27017"


def _mongo_db() -> str:
    return os.getenv("MONGO_DB") or os.getenv("MONGODB_DB") or "project_qa"


def _to_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            pass
    return datetime.utcnow()


def _normalize_user(user: Any) -> str:
    return str(user or "").strip().lower() or "dev@local"


def _global_chat_id(user: str) -> str:
    return f"global::{_normalize_user(user)}"


def _context_key(project_id: Any, branch: Any) -> str:
    return f"{str(project_id or '').strip()}::{str(branch or 'main').strip() or 'main'}"


def _fingerprint(source_chat_id: str, idx: int, role: str, content: str, ts: datetime) -> str:
    raw = f"{source_chat_id}|{idx}|{role}|{content}|{ts.isoformat()}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


async def migrate() -> None:
    client = AsyncIOMotorClient(_mongo_uri())
    db = client[_mongo_db()]

    await db["chat_messages_v2"].create_index([("migration_fp", 1)], unique=True, sparse=True, name="chat_messages_v2_migration_fp")
    await db["chat_messages_v2"].create_index([("chat_id", 1), ("ts", 1)], name="chat_messages_v2_chat_ts")
    await db["chat_context_config"].create_index([("chat_id", 1), ("context_key", 1)], unique=True, name="chat_ctx_cfg_unique")

    cursor = db["chats"].find(
        {"messages": {"$exists": True, "$type": "array", "$ne": []}},
        {"chat_id": 1, "project_id": 1, "branch": 1, "user": 1, "messages": 1, "migration_v2": 1},
    )
    total_chats = 0
    total_messages = 0
    inserted_messages = 0

    async for chat in cursor:
        total_chats += 1
        source_chat_id = str(chat.get("chat_id") or "")
        user = _normalize_user(chat.get("user"))
        project_id = str(chat.get("project_id") or "").strip()
        branch = str(chat.get("branch") or "main").strip() or "main"
        context_key = _context_key(project_id, branch)
        global_chat_id = _global_chat_id(user)
        now = datetime.utcnow()

        await db["chats"].update_one(
            {"chat_id": global_chat_id},
            {
                "$setOnInsert": {
                    "chat_id": global_chat_id,
                    "user": user,
                    "title": "Global Chat",
                    "created_at": now,
                    "messages": [],
                    "tool_policy": {},
                    "llm_profile_id": None,
                },
                "$set": {"updated_at": now, "active_context_key": context_key},
            },
            upsert=True,
        )

        await db["chat_context_config"].update_one(
            {"chat_id": global_chat_id, "user": user, "context_key": context_key},
            {
                "$setOnInsert": {
                    "chat_id": global_chat_id,
                    "user": user,
                    "context_key": context_key,
                    "project_id": project_id,
                    "branch": branch,
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )

        messages = chat.get("messages") if isinstance(chat.get("messages"), list) else []
        chat_inserted = 0
        for idx, msg in enumerate(messages):
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "").strip()
            content = str(msg.get("content") or "")
            if role not in {"user", "assistant", "system", "tool"}:
                continue
            ts = _to_dt(msg.get("ts"))
            fp = _fingerprint(source_chat_id, idx, role, content, ts)
            total_messages += 1
            doc = {
                "chat_id": global_chat_id,
                "user": user,
                "role": role,
                "content": content,
                "ts": ts,
                "context_key": context_key,
                "project_id": project_id,
                "branch": branch,
                "is_pinned": False,
                "pin_source": None,
                "meta": msg.get("meta") if isinstance(msg.get("meta"), dict) else {},
                "migration_fp": fp,
                "migration_v2": {
                    "source_chat_id": source_chat_id,
                    "source_index": idx,
                    "migrated_at": now.isoformat() + "Z",
                },
            }
            try:
                await db["chat_messages_v2"].insert_one(doc)
                inserted_messages += 1
                chat_inserted += 1
            except Exception:
                # duplicate fingerprint or transient insert error -> keep migration idempotent
                continue

        await db["chats"].update_one(
            {"chat_id": source_chat_id},
            {
                "$set": {
                    "migration_v2": {
                        "completed_at": datetime.utcnow().isoformat() + "Z",
                        "global_chat_id": global_chat_id,
                        "context_key": context_key,
                        "source_messages": len(messages),
                        "inserted_messages": chat_inserted,
                    }
                }
            },
        )

    print(
        f"migration_v2 completed: chats={total_chats} source_messages={total_messages} inserted={inserted_messages}"
    )
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
