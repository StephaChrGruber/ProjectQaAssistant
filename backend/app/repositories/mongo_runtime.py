from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument

from ..db import get_db


class MongoNotificationRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def insert_notification(self, doc: dict[str, Any]) -> str:
        res = await self._db["notifications"].insert_one(doc)
        return str(res.inserted_id)

    async def get_notification_by_id(self, notification_id: str) -> dict[str, Any] | None:
        if not ObjectId.is_valid(notification_id):
            return None
        return await self._db["notifications"].find_one({"_id": ObjectId(notification_id)})

    async def get_notification_for_user(self, notification_id: str, user_ids: list[str]) -> dict[str, Any] | None:
        if not ObjectId.is_valid(notification_id):
            return None
        return await self._db["notifications"].find_one(
            {"_id": ObjectId(notification_id), "user_id": {"$in": user_ids}},
        )

    async def list_notifications(
        self,
        *,
        user_ids: list[str],
        project_id: str | None,
        include_dismissed: bool,
        limit: int,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"user_id": {"$in": user_ids}}
        project = str(project_id or "").strip()
        if project:
            query["project_id"] = project
        if not include_dismissed:
            query["dismissed"] = {"$ne": True}
        safe_limit = max(1, min(int(limit or 200), 1000))
        return (
            await self._db["notifications"]
            .find(query)
            .sort("created_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )

    async def count_unread_notifications(self, *, user_ids: list[str], project_id: str | None = None) -> int:
        query: dict[str, Any] = {"user_id": {"$in": list(user_ids or [])}, "dismissed": {"$ne": True}}
        project = str(project_id or "").strip()
        if project:
            query["project_id"] = project
        count = await self._db["notifications"].count_documents(query)
        return int(count or 0)

    async def update_notification_by_id(self, notification_id: str, update_doc: dict[str, Any]) -> None:
        if not ObjectId.is_valid(notification_id):
            return
        await self._db["notifications"].update_one({"_id": ObjectId(notification_id)}, update_doc)

    async def update_notifications_many(self, query: dict[str, Any], update_doc: dict[str, Any]) -> int:
        out = await self._db["notifications"].update_many(query, update_doc)
        return int(out.modified_count or 0)


class MongoLocalToolJobRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def claim_next_local_job(
        self,
        *,
        user_id: str,
        now: datetime,
        claim_token: str,
        project_id: str | None,
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {
            "status": "queued",
            "runtime": "local_typescript",
            "userId": user_id,
            "$or": [{"expiresAt": {"$exists": False}}, {"expiresAt": None}, {"expiresAt": {"$gt": now}}],
        }
        if project_id:
            query["projectId"] = project_id
        row = await self._db["local_tool_jobs"].find_one_and_update(
            query,
            {"$set": {"status": "running", "claimedBy": claim_token, "updatedAt": now}},
            sort=[("createdAt", 1)],
            return_document=ReturnDocument.AFTER,
        )
        return row if isinstance(row, dict) else None

    async def get_local_job_for_user(
        self,
        *,
        job_id: str,
        user_id: str,
        claim_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not ObjectId.is_valid(job_id):
            return None
        query: dict[str, Any] = {"_id": ObjectId(job_id), "userId": user_id}
        if claim_id:
            query["claimedBy"] = claim_id
        row = await self._db["local_tool_jobs"].find_one(query)
        return row if isinstance(row, dict) else None

    async def mark_local_job_completed(
        self,
        *,
        job_id: str,
        result: Any,
        now: datetime,
    ) -> None:
        if not ObjectId.is_valid(job_id):
            return
        await self._db["local_tool_jobs"].update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "completed",
                    "result": result,
                    "updatedAt": now,
                    "completedAt": now,
                    "error": None,
                }
            },
        )

    async def mark_local_job_failed(
        self,
        *,
        job_id: str,
        error: str,
        now: datetime,
    ) -> None:
        if not ObjectId.is_valid(job_id):
            return
        await self._db["local_tool_jobs"].update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "failed",
                    "error": error,
                    "updatedAt": now,
                    "completedAt": now,
                }
            },
        )


class MongoAccessPolicyRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def find_project_doc(
        self,
        project_id_or_key: str,
        projection: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        raw = str(project_id_or_key or "").strip()
        if not raw:
            return None
        query: dict[str, Any]
        if ObjectId.is_valid(raw):
            query = {"_id": ObjectId(raw)}
        else:
            query = {"key": raw}
        row = await self._db["projects"].find_one(query, projection)
        return row if isinstance(row, dict) else None

    async def find_user_by_email(self, email: str) -> dict[str, Any] | None:
        row = await self._db["users"].find_one(
            {"email": str(email or "").strip().lower()},
            {"_id": 1, "isGlobalAdmin": 1},
        )
        return row if isinstance(row, dict) else None

    async def find_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        if not ObjectId.is_valid(str(user_id or "")):
            return None
        row = await self._db["users"].find_one(
            {"_id": ObjectId(str(user_id))},
            {"_id": 1, "isGlobalAdmin": 1, "email": 1},
        )
        return row if isinstance(row, dict) else None

    async def find_membership_role(self, *, user_id: str, project_id: str) -> str | None:
        row = await self._db["memberships"].find_one(
            {"userId": str(user_id or "").strip(), "projectId": str(project_id or "").strip()},
            {"role": 1},
        )
        if not isinstance(row, dict):
            return None
        role = str(row.get("role") or "").strip().lower()
        return role or None

    async def list_enabled_connectors(
        self,
        *,
        project_id: str,
        types: list[str] | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"projectId": str(project_id or "").strip(), "isEnabled": True}
        safe_types = [str(t or "").strip() for t in list(types or []) if str(t or "").strip()]
        if safe_types:
            query["type"] = {"$in": safe_types}
        safe_limit = max(1, min(int(limit or 200), 2000))
        rows = await self._db["connectors"].find(query).to_list(length=safe_limit)
        return [row for row in rows if isinstance(row, dict)]

    async def find_enabled_connector(
        self,
        *,
        project_id: str,
        connector_type: str,
    ) -> dict[str, Any] | None:
        row = await self._db["connectors"].find_one(
            {
                "projectId": str(project_id or "").strip(),
                "type": str(connector_type or "").strip(),
                "isEnabled": True,
            }
        )
        return row if isinstance(row, dict) else None

    async def update_project_fields(
        self,
        *,
        project_id_or_key: str,
        patch: dict[str, Any],
    ) -> int:
        raw = str(project_id_or_key or "").strip()
        if not raw:
            return 0
        query: dict[str, Any]
        if ObjectId.is_valid(raw):
            query = {"_id": ObjectId(raw)}
        else:
            query = {"key": raw}
        out = await self._db["projects"].update_one(query, {"$set": dict(patch or {})})
        return int(out.modified_count or 0)

    async def update_project_fields_by_id(self, *, project_id: str, patch: dict[str, Any]) -> int:
        if not ObjectId.is_valid(str(project_id or "")):
            return 0
        out = await self._db["projects"].update_one(
            {"_id": ObjectId(str(project_id))},
            {"$set": dict(patch or {})},
        )
        return int(out.modified_count or 0)

    async def update_connector_fields(
        self,
        *,
        project_id: str,
        connector_type: str,
        patch: dict[str, Any],
    ) -> int:
        out = await self._db["connectors"].update_one(
            {
                "projectId": str(project_id or "").strip(),
                "type": str(connector_type or "").strip(),
            },
            {"$set": dict(patch or {})},
        )
        return int(out.modified_count or 0)

    async def list_active_tool_approvals(
        self,
        *,
        chat_id: str,
        now: datetime,
        context_key: str | None = None,
        include_legacy_when_context_set: bool = True,
        limit: int = 400,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {
            "chatId": str(chat_id or "").strip(),
            "expiresAt": {"$gt": now},
        }
        key = str(context_key or "").strip()
        if key:
            if include_legacy_when_context_set:
                query["$or"] = [
                    {"contextKey": key},
                    {"contextKey": {"$exists": False}},
                    {"contextKey": ""},
                    {"contextKey": None},
                ]
            else:
                query["contextKey"] = key
        safe_limit = max(1, min(int(limit or 400), 2000))
        rows = (
            await self._db["chat_tool_approvals"]
            .find(query, {"toolName": 1, "userId": 1, "expiresAt": 1, "approved": 1})
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def upsert_tool_approval(
        self,
        *,
        chat_id: str,
        tool_name: str,
        user_id: str,
        approved_by: str,
        created_at: datetime,
        expires_at: datetime,
        context_key: str | None = None,
    ) -> None:
        query: dict[str, Any] = {
            "chatId": str(chat_id or "").strip(),
            "toolName": str(tool_name or "").strip(),
            "userId": str(user_id or "").strip(),
        }
        key = str(context_key or "").strip()
        if key:
            query["contextKey"] = key
        await self._db["chat_tool_approvals"].update_one(
            query,
            {
                "$set": {
                    "approved": True,
                    "approvedBy": str(approved_by or "").strip(),
                    "createdAt": created_at,
                    "expiresAt": expires_at,
                    "contextKey": key or None,
                }
            },
            upsert=True,
        )

    async def revoke_tool_approval(
        self,
        *,
        chat_id: str,
        tool_name: str,
        user_id: str,
        context_key: str | None = None,
    ) -> None:
        query: dict[str, Any] = {
            "chatId": str(chat_id or "").strip(),
            "toolName": str(tool_name or "").strip(),
            "userId": str(user_id or "").strip(),
        }
        key = str(context_key or "").strip()
        if key:
            query["contextKey"] = key
        await self._db["chat_tool_approvals"].delete_many(query)


class MongoChatTaskRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def list_chat_tasks(self, *, query: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 120), 500))
        rows = (
            await self._db["chat_tasks"]
            .find(query)
            .sort("updated_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def create_chat_task(self, *, doc: dict[str, Any]) -> dict[str, Any] | None:
        res = await self._db["chat_tasks"].insert_one(dict(doc))
        row = await self._db["chat_tasks"].find_one({"_id": res.inserted_id})
        return row if isinstance(row, dict) else None

    async def find_chat_task(
        self,
        *,
        query: dict[str, Any],
        sort: list[tuple[str, int]] | None = None,
    ) -> dict[str, Any] | None:
        row = await self._db["chat_tasks"].find_one(query, sort=sort)
        return row if isinstance(row, dict) else None

    async def update_chat_task_by_id(self, *, task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not ObjectId.is_valid(task_id):
            return None
        oid = ObjectId(task_id)
        await self._db["chat_tasks"].update_one({"_id": oid}, {"$set": dict(patch)})
        row = await self._db["chat_tasks"].find_one({"_id": oid})
        return row if isinstance(row, dict) else None
