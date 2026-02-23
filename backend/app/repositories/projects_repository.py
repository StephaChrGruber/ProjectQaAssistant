from __future__ import annotations

from typing import Any

from bson import ObjectId

from ..db import get_db

PROJECT_LIST_PROJECTION: dict[str, int] = {
    "name": 1,
    "key": 1,
    "description": 1,
    "repo_path": 1,
    "default_branch": 1,
    "llm_provider": 1,
    "llm_base_url": 1,
    "llm_model": 1,
    "llm_profile_id": 1,
}


def parse_project_object_id(project_id: str) -> ObjectId:
    return ObjectId(str(project_id))


def serialize_project(doc: dict[str, Any]) -> dict[str, Any]:
    row = dict(doc)
    row["_id"] = str(row.get("_id"))
    key = str(row.get("llm_api_key") or "").strip()
    if key:
        row["llm_api_key"] = "***" + key[-4:] if len(key) > 4 else "***"
    return row


async def list_projects() -> list[dict[str, Any]]:
    cursor = get_db().projects.find({}, PROJECT_LIST_PROJECTION).sort("name", 1)
    rows = await cursor.to_list(length=500)
    return [serialize_project(row) for row in rows]


async def get_project(project_id: str) -> dict[str, Any] | None:
    return await get_db().projects.find_one({"_id": parse_project_object_id(project_id)})

