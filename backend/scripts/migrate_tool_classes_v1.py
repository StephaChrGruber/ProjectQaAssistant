from __future__ import annotations

import asyncio
import os
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient


def _mongo_uri() -> str:
    return os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "mongodb://localhost:27017"


def _mongo_db() -> str:
    return os.getenv("MONGO_DB") or os.getenv("MONGODB_DB") or "project_qa"


KNOWN_CLASS_KEYS: set[str] = {
    "system",
    "system.discovery",
    "system.context",
    "util",
    "repository",
    "repository.read",
    "git",
    "git.branches",
    "git.sync",
    "git.changes",
    "git.commit",
    "documentation",
    "documentation.read",
    "documentation.write",
    "quality",
    "quality.testing",
    "issues",
    "issues.jira",
    "tasks",
    "tasks.chat",
    "automation",
    "knowledge",
    "knowledge.vector",
    "custom",
}


def _normalize_class_key(raw: object) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    key = text.replace("/", ".").strip(".")
    while ".." in key:
        key = key.replace("..", ".")
    return key or None


def _class_from_tags(tags: object) -> str | None:
    if not isinstance(tags, list):
        return None
    for item in tags:
        key = _normalize_class_key(item)
        if key and key in KNOWN_CLASS_KEYS:
            return key
    return None


async def migrate() -> None:
    client = AsyncIOMotorClient(_mongo_uri())
    db = client[_mongo_db()]
    now = datetime.utcnow()

    await db["tool_classes"].create_index([("key", 1)], unique=True, name="tool_classes_key_unique")
    await db["tool_classes"].create_index([("parentKey", 1)], name="tool_classes_parent")
    await db["tool_classes"].create_index([("scope", 1), ("origin", 1), ("isEnabled", 1)], name="tool_classes_scope")
    await db["custom_tools"].create_index([("classKey", 1)], name="custom_tools_class_key")

    cursor = db["custom_tools"].find({}, {"_id": 1, "classKey": 1, "tags": 1, "updatedAt": 1})
    scanned = 0
    updated = 0
    inferred = 0
    untouched = 0
    async for row in cursor:
        scanned += 1
        current = _normalize_class_key(row.get("classKey"))
        if current:
            if current != row.get("classKey"):
                await db["custom_tools"].update_one(
                    {"_id": row["_id"]},
                    {"$set": {"classKey": current, "updatedAt": now}},
                )
                updated += 1
            else:
                untouched += 1
            continue

        inferred_key = _class_from_tags(row.get("tags"))
        if inferred_key:
            await db["custom_tools"].update_one(
                {"_id": row["_id"]},
                {"$set": {"classKey": inferred_key, "updatedAt": now}},
            )
            updated += 1
            inferred += 1
            continue

        # Keep explicit null so downstream reads are stable and idempotent.
        await db["custom_tools"].update_one(
            {"_id": row["_id"]},
            {"$set": {"classKey": None, "updatedAt": now}},
        )
        updated += 1

    print(
        "migrate_tool_classes_v1 completed: "
        f"scanned={scanned} updated={updated} inferred={inferred} untouched={untouched}"
    )
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
