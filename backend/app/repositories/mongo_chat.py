from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId

from ..db import get_db


class MongoGlobalChatRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def ensure_chat_envelope(
        self,
        *,
        chat_id: str,
        user: str,
        title: str,
        active_context_key: str | None,
        now: datetime,
    ) -> dict[str, Any] | None:
        await self._db["chats"].update_one(
            {"chat_id": chat_id},
            {
                "$setOnInsert": {
                    "chat_id": chat_id,
                    "user": user,
                    "title": title,
                    "created_at": now,
                    "messages": [],
                    "tool_policy": {},
                    "llm_profile_id": None,
                },
                "$set": {
                    "updated_at": now,
                    "active_context_key": active_context_key,
                },
            },
            upsert=True,
        )
        return await self.get_chat_envelope(
            chat_id=chat_id,
            projection={
                "_id": 0,
                "chat_id": 1,
                "user": 1,
                "title": 1,
                "active_context_key": 1,
                "created_at": 1,
                "updated_at": 1,
            },
        )

    async def get_chat_envelope(self, *, chat_id: str, projection: dict[str, int] | None = None) -> dict[str, Any] | None:
        return await self._db["chats"].find_one({"chat_id": chat_id}, projection)

    async def set_chat_active_context(self, *, chat_id: str, active_context_key: str | None, now: datetime) -> None:
        await self._db["chats"].update_one(
            {"chat_id": chat_id},
            {"$set": {"active_context_key": active_context_key, "updated_at": now}},
        )

    async def append_message(self, *, doc: dict[str, Any]) -> dict[str, Any]:
        out = await self._db["chat_messages_v2"].insert_one(doc)
        row = await self._db["chat_messages_v2"].find_one({"_id": out.inserted_id})
        if isinstance(row, dict):
            return row
        return {**doc, "_id": out.inserted_id}

    async def touch_chat_after_message(self, *, chat_id: str, now: datetime, content: str) -> None:
        await self._db["chats"].update_one(
            {"chat_id": chat_id},
            {
                "$set": {
                    "updated_at": now,
                    "last_message_at": now,
                    "last_message_preview": str(content or "")[:160],
                }
            },
        )

    async def list_messages(
        self,
        *,
        chat_id: str,
        context_key: str | None = None,
        is_pinned: bool | None = None,
        before_id: str | None = None,
        limit: int = 120,
        descending: bool = True,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"chat_id": chat_id}
        if context_key:
            query["context_key"] = str(context_key or "").strip()
        if is_pinned is not None:
            query["is_pinned"] = bool(is_pinned)
        if ObjectId.is_valid(str(before_id or "")):
            query["_id"] = {"$lt": ObjectId(str(before_id))}
        sort_dir = -1 if descending else 1
        safe_limit = max(1, min(int(limit or 120), 500))
        rows = (
            await self._db["chat_messages_v2"]
            .find(query)
            .sort([("_id", sort_dir)])
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def get_message(self, *, chat_id: str, message_id: str) -> dict[str, Any] | None:
        if not ObjectId.is_valid(message_id):
            return None
        return await self._db["chat_messages_v2"].find_one(
            {"_id": ObjectId(message_id), "chat_id": chat_id},
        )

    async def set_message_pin_state(
        self,
        *,
        chat_id: str,
        message_id: str,
        is_pinned: bool,
        pin_source: str,
    ) -> None:
        if not ObjectId.is_valid(message_id):
            return
        await self._db["chat_messages_v2"].update_one(
            {"_id": ObjectId(message_id), "chat_id": chat_id},
            {"$set": {"is_pinned": bool(is_pinned), "pin_source": str(pin_source or "manual")}},
        )

    async def list_context_summaries(self, *, chat_id: str, limit: int = 300) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 300), 1000))
        rows = (
            await self._db["chat_messages_v2"]
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
        return [row for row in rows if isinstance(row, dict)]

    async def get_context_config(
        self,
        *,
        chat_id: str,
        user: str,
        context_key: str,
    ) -> dict[str, Any] | None:
        return await self._db["chat_context_config"].find_one(
            {"chat_id": chat_id, "user": user, "context_key": context_key},
            {"_id": 0},
        )

    async def upsert_context_config(
        self,
        *,
        chat_id: str,
        user: str,
        context_key: str,
        project_id: str,
        branch: str,
        patch: dict[str, Any],
        now: datetime,
    ) -> dict[str, Any] | None:
        query = {"chat_id": chat_id, "user": user, "context_key": context_key}
        set_doc = {
            "updated_at": now,
            "project_id": project_id,
            "branch": branch,
        }
        for key, value in (patch or {}).items():
            set_doc[key] = value
        await self._db["chat_context_config"].update_one(
            query,
            {
                "$set": set_doc,
                "$setOnInsert": {
                    "chat_id": chat_id,
                    "user": user,
                    "context_key": context_key,
                    "created_at": now,
                },
            },
            upsert=True,
        )
        return await self._db["chat_context_config"].find_one(query, {"_id": 0})

    async def list_context_configs(
        self,
        *,
        chat_id: str,
        user: str,
        limit: int = 300,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 300), 1000))
        rows = (
            await self._db["chat_context_config"]
            .find({"chat_id": chat_id, "user": user}, {"_id": 0})
            .sort("updated_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def find_legacy_chat(
        self,
        *,
        chat_id: str,
        project_id: str | None = None,
        branch: str | None = None,
        user: str | None = None,
        projection: dict[str, Any] | None = None,
        fallback_to_chat_id: bool = False,
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {"chat_id": str(chat_id or "").strip()}
        project = str(project_id or "").strip()
        if project:
            query["project_id"] = project
        branch_value = str(branch or "").strip()
        if branch_value:
            query["branch"] = branch_value
        user_value = str(user or "").strip()
        if user_value:
            query["user"] = user_value
        row = await self._db["chats"].find_one(query, projection)
        if isinstance(row, dict):
            return row
        if not fallback_to_chat_id:
            return None
        row = await self._db["chats"].find_one({"chat_id": str(chat_id or "").strip()}, projection)
        return row if isinstance(row, dict) else None

    async def set_legacy_pending_user_question(
        self,
        *,
        chat_id: str,
        project_id: str,
        payload: dict[str, Any],
        now: datetime,
    ) -> bool:
        patch = {
            "$set": {
                "pending_user_question": dict(payload or {}),
                "updated_at": now,
            }
        }
        res = await self._db["chats"].update_one(
            {"chat_id": str(chat_id or "").strip(), "project_id": str(project_id or "").strip()},
            patch,
            upsert=False,
        )
        if int(res.matched_count or 0) > 0:
            return True
        fallback = await self._db["chats"].update_one(
            {"chat_id": str(chat_id or "").strip()},
            patch,
            upsert=False,
        )
        return int(fallback.matched_count or 0) > 0
