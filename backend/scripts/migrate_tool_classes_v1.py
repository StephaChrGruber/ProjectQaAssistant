from __future__ import annotations

import asyncio
import os
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure


def _mongo_uri() -> str:
    return os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "mongodb://localhost:27017"


def _mongo_db() -> str:
    return os.getenv("MONGO_DB") or os.getenv("MONGODB_DB") or "project_qa"


def _normalize_index_keys(keys: object) -> tuple[tuple[str, int], ...]:
    if not isinstance(keys, list):
        return tuple()
    out: list[tuple[str, int]] = []
    for pair in keys:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        out.append((str(pair[0]), int(pair[1])))
    return tuple(out)


async def _ensure_index(collection, keys: list[tuple[str, int]], *, unique: bool = False, name: str | None = None) -> str:
    wanted = _normalize_index_keys(keys)
    existing = await collection.index_information()
    for idx_name, spec in existing.items():
        if _normalize_index_keys(spec.get("key")) != wanted:
            continue
        if unique and not bool(spec.get("unique", False)):
            continue
        return str(idx_name)

    kwargs: dict[str, object] = {}
    if unique:
        kwargs["unique"] = True
    if name:
        kwargs["name"] = name
    try:
        return str(await collection.create_index(keys, **kwargs))
    except OperationFailure as exc:
        if int(getattr(exc, "code", 0) or 0) != 85:
            raise
        existing = await collection.index_information()
        for idx_name, spec in existing.items():
            if _normalize_index_keys(spec.get("key")) != wanted:
                continue
            if unique and not bool(spec.get("unique", False)):
                continue
            return str(idx_name)
        raise


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

    await _ensure_index(db["tool_classes"], [("key", 1)], name="tool_classes_key_unique")
    await _ensure_index(db["tool_classes"], [("parentKey", 1)], name="tool_classes_parent")
    await _ensure_index(
        db["tool_classes"],
        [("scope", 1), ("origin", 1), ("isEnabled", 1)],
        name="tool_classes_scope",
    )
    await _ensure_index(db["custom_tools"], [("classKey", 1)], name="custom_tools_class_key")

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
