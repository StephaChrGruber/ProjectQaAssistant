from __future__ import annotations

from typing import Any

from ..db import get_db


class MongoProjectTelemetryRepository:
    def __init__(self, db=None):
        self._db = db or get_db()

    async def list_tool_events(
        self,
        *,
        query: dict[str, Any],
        projection: dict[str, Any] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 100), 5000))
        rows = (
            await self._db["tool_events"]
            .find(query, projection)
            .sort("created_at", -1)
            .limit(safe_limit)
            .to_list(length=safe_limit)
        )
        return [row for row in rows if isinstance(row, dict)]

    async def aggregate_tool_events(self, *, pipeline: list[dict[str, Any]], limit: int = 500) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 500), 5000))
        rows = await self._db["tool_events"].aggregate(list(pipeline or [])).to_list(length=safe_limit)
        return [row for row in rows if isinstance(row, dict)]

    async def list_chats(
        self,
        *,
        query: dict[str, Any],
        projection: dict[str, Any] | None = None,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 5000), 10000))
        rows = await self._db["chats"].find(query, projection).limit(safe_limit).to_list(length=safe_limit)
        return [row for row in rows if isinstance(row, dict)]
