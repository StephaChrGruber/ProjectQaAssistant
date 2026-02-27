from __future__ import annotations

from typing import Any

from bson import ObjectId

from ..db import get_db


def _safe_limit(value: int, *, default: int, max_value: int) -> int:
    return max(1, min(int(value or default), max_value))


def _oid(raw: str) -> ObjectId | None:
    value = str(raw or "").strip()
    if not value or not ObjectId.is_valid(value):
        return None
    return ObjectId(value)


class MongoAutomationRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def list_presets(self, *, project_id: str, limit: int = 200) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=200, max_value=1000)
        rows = (
            await self._db["automation_presets"]
            .find({"project_id": project_id})
            .sort("updated_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def insert_preset(self, *, doc: dict[str, Any]) -> dict[str, Any] | None:
        res = await self._db["automation_presets"].insert_one(dict(doc))
        row = await self._db["automation_presets"].find_one({"_id": res.inserted_id})
        return row if isinstance(row, dict) else None

    async def find_preset(self, *, project_id: str, preset_id: str) -> dict[str, Any] | None:
        oid = _oid(preset_id)
        if oid is None:
            return None
        row = await self._db["automation_presets"].find_one({"project_id": project_id, "_id": oid})
        return row if isinstance(row, dict) else None

    async def update_preset_by_id(self, *, preset_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        oid = _oid(preset_id)
        if oid is None:
            return None
        await self._db["automation_presets"].update_one({"_id": oid}, {"$set": dict(patch or {})})
        row = await self._db["automation_presets"].find_one({"_id": oid})
        return row if isinstance(row, dict) else None

    async def delete_preset_by_id(self, *, preset_id: str) -> int:
        oid = _oid(preset_id)
        if oid is None:
            return 0
        out = await self._db["automation_presets"].delete_one({"_id": oid})
        return int(out.deleted_count or 0)

    async def insert_preset_version(self, *, doc: dict[str, Any]) -> dict[str, Any] | None:
        res = await self._db["automation_preset_versions"].insert_one(dict(doc))
        row = await self._db["automation_preset_versions"].find_one({"_id": res.inserted_id})
        return row if isinstance(row, dict) else None

    async def list_preset_versions(self, *, project_id: str, preset_id: str, limit: int = 100) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=100, max_value=1000)
        rows = (
            await self._db["automation_preset_versions"]
            .find({"project_id": project_id, "preset_id": str(preset_id)})
            .sort("created_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def find_preset_version(
        self,
        *,
        project_id: str,
        preset_id: str,
        version_id: str,
    ) -> dict[str, Any] | None:
        vid = _oid(version_id)
        if vid is None:
            return None
        row = await self._db["automation_preset_versions"].find_one(
            {"project_id": project_id, "preset_id": str(preset_id), "_id": vid}
        )
        return row if isinstance(row, dict) else None

    async def list_automations(
        self,
        *,
        project_id: str,
        include_disabled: bool,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=200, max_value=1000)
        query: dict[str, Any] = {"project_id": project_id}
        if not include_disabled:
            query["enabled"] = True
        rows = (
            await self._db["automations"]
            .find(query)
            .sort("updated_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def find_automation(self, *, project_id: str, automation_id: str) -> dict[str, Any] | None:
        oid = _oid(automation_id)
        if oid is None:
            return None
        row = await self._db["automations"].find_one({"project_id": project_id, "_id": oid})
        return row if isinstance(row, dict) else None

    async def insert_automation(self, *, doc: dict[str, Any]) -> dict[str, Any] | None:
        res = await self._db["automations"].insert_one(dict(doc))
        row = await self._db["automations"].find_one({"_id": res.inserted_id})
        return row if isinstance(row, dict) else None

    async def update_automation_by_id(
        self,
        *,
        automation_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None:
        oid = _oid(automation_id)
        if oid is None:
            return None
        await self._db["automations"].update_one({"_id": oid}, {"$set": dict(patch or {})})
        row = await self._db["automations"].find_one({"_id": oid})
        return row if isinstance(row, dict) else None

    async def delete_automation_by_id(self, *, automation_id: str) -> int:
        oid = _oid(automation_id)
        if oid is None:
            return 0
        out = await self._db["automations"].delete_one({"_id": oid})
        return int(out.deleted_count or 0)

    async def delete_automation_runs(self, *, project_id: str, automation_id: str) -> int:
        out = await self._db["automation_runs"].delete_many({"project_id": project_id, "automation_id": str(automation_id)})
        return int(out.deleted_count or 0)

    async def list_automation_runs(
        self,
        *,
        project_id: str,
        automation_id: str | None,
        limit: int = 120,
    ) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=120, max_value=1000)
        query: dict[str, Any] = {"project_id": project_id}
        if str(automation_id or "").strip():
            query["automation_id"] = str(automation_id).strip()
        rows = (
            await self._db["automation_runs"]
            .find(query)
            .sort("started_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def find_latest_chat_for_project(self, *, project_id: str) -> dict[str, Any] | None:
        row = await self._db["chats"].find_one(
            {"project_id": project_id},
            {"chat_id": 1},
            sort=[("updated_at", -1)],
        )
        return row if isinstance(row, dict) else None

    async def append_chat_message(
        self,
        *,
        project_id: str,
        chat_id: str,
        msg: dict[str, Any],
        updated_at,
        preview: str,
    ) -> int:
        out = await self._db["chats"].update_one(
            {"chat_id": str(chat_id or "").strip(), "project_id": str(project_id or "").strip()},
            {
                "$push": {"messages": dict(msg or {})},
                "$set": {
                    "updated_at": updated_at,
                    "last_message_at": updated_at,
                    "last_message_preview": str(preview or "")[:160],
                },
            },
        )
        return int(out.matched_count or 0)

    async def set_pending_user_question(
        self,
        *,
        project_id: str,
        chat_id: str,
        payload: dict[str, Any],
        updated_at,
    ) -> int:
        out = await self._db["chats"].update_one(
            {"chat_id": str(chat_id or "").strip(), "project_id": str(project_id or "").strip()},
            {"$set": {"pending_user_question": dict(payload or {}), "updated_at": updated_at}},
        )
        return int(out.matched_count or 0)

    async def set_chat_title(
        self,
        *,
        project_id: str,
        chat_id: str,
        title: str,
        updated_at,
    ) -> int:
        out = await self._db["chats"].update_one(
            {"chat_id": str(chat_id or "").strip(), "project_id": str(project_id or "").strip()},
            {"$set": {"title": str(title or "").strip(), "updated_at": updated_at}},
        )
        return int(out.matched_count or 0)

    async def insert_ingestion_run(self, *, doc: dict[str, Any]) -> None:
        await self._db["ingestion_runs"].insert_one(dict(doc or {}))

    async def upsert_state_value(
        self,
        *,
        project_id: str,
        key: str,
        value: Any,
        updated_at,
        updated_by: str,
    ) -> None:
        await self._db["automation_state"].update_one(
            {"project_id": str(project_id or "").strip(), "key": str(key or "").strip()},
            {
                "$set": {
                    "value": value,
                    "updated_at": updated_at,
                    "updated_by": str(updated_by or "").strip(),
                },
                "$setOnInsert": {"created_at": updated_at},
            },
            upsert=True,
        )

    async def find_automation_by_name(self, *, project_id: str, name: str) -> dict[str, Any] | None:
        row = await self._db["automations"].find_one(
            {"project_id": str(project_id or "").strip(), "name": str(name or "").strip()}
        )
        return row if isinstance(row, dict) else None

    async def insert_automation_run(self, *, doc: dict[str, Any]) -> dict[str, Any] | None:
        res = await self._db["automation_runs"].insert_one(dict(doc or {}))
        row = await self._db["automation_runs"].find_one({"_id": res.inserted_id})
        return row if isinstance(row, dict) else None

    async def list_enabled_event_automations(
        self,
        *,
        project_id: str,
        event_type: str,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=500, max_value=2000)
        rows = await self._db["automations"].find(
            {
                "project_id": str(project_id or "").strip(),
                "enabled": True,
                "trigger.type": "event",
                "trigger.event_type": str(event_type or "").strip(),
            }
        ).to_list(length=safe_limit)
        return [row for row in rows if isinstance(row, dict)]

    async def list_due_scheduled_automations(self, *, now, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = _safe_limit(limit, default=20, max_value=200)
        rows = (
            await self._db["automations"]
            .find(
                {
                    "enabled": True,
                    "trigger.type": {"$in": ["schedule", "daily", "weekly", "once"]},
                    "next_run_at": {"$lte": now},
                }
            )
            .sort("next_run_at", 1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]
