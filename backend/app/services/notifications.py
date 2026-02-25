from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from bson import ObjectId

from ..db import get_db

logger = logging.getLogger(__name__)

VALID_NOTIFICATION_SEVERITIES = {"info", "success", "warning", "error"}
GLOBAL_NOTIFICATION_USER = "*"


def _now() -> datetime:
    return datetime.utcnow()


def _iso(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"


def _normalize_user(user_id: str | None) -> str:
    value = str(user_id or "").strip()
    return value or GLOBAL_NOTIFICATION_USER


def _normalize_severity(severity: str | None) -> str:
    value = str(severity or "info").strip().lower() or "info"
    if value not in VALID_NOTIFICATION_SEVERITIES:
        return "info"
    return value


def _serialize_notification(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc.get("_id") or ""),
        "project_id": str(doc.get("project_id") or ""),
        "user_id": str(doc.get("user_id") or GLOBAL_NOTIFICATION_USER),
        "title": str(doc.get("title") or ""),
        "message": str(doc.get("message") or ""),
        "severity": _normalize_severity(str(doc.get("severity") or "info")),
        "source": str(doc.get("source") or ""),
        "event_type": str(doc.get("event_type") or ""),
        "data": doc.get("data") if isinstance(doc.get("data"), dict) else {},
        "dismissed": bool(doc.get("dismissed")),
        "dismissed_at": _iso(doc.get("dismissed_at")) if isinstance(doc.get("dismissed_at"), datetime) else doc.get("dismissed_at"),
        "created_at": _iso(doc.get("created_at")) if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": _iso(doc.get("updated_at")) if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


async def create_notification(
    *,
    title: str,
    message: str = "",
    severity: str = "info",
    user_id: str | None = None,
    project_id: str | None = None,
    source: str = "system",
    event_type: str = "",
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ValueError("Notification title is required")
    now = _now()
    doc = {
        "project_id": str(project_id or "").strip(),
        "user_id": _normalize_user(user_id),
        "title": clean_title,
        "message": str(message or "").strip(),
        "severity": _normalize_severity(severity),
        "source": str(source or "").strip() or "system",
        "event_type": str(event_type or "").strip(),
        "data": dict(data or {}),
        "dismissed": False,
        "dismissed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    res = await get_db()["notifications"].insert_one(doc)
    row = await get_db()["notifications"].find_one({"_id": res.inserted_id})
    if not isinstance(row, dict):
        raise RuntimeError("Failed to create notification")
    logger.info(
        "notifications.create project=%s user=%s severity=%s source=%s notification_id=%s",
        doc["project_id"],
        doc["user_id"],
        doc["severity"],
        doc["source"],
        str(res.inserted_id),
    )
    return _serialize_notification(row)


async def list_notifications(
    *,
    user_id: str,
    project_id: str | None = None,
    include_dismissed: bool = False,
    limit: int = 200,
) -> list[dict[str, Any]]:
    user = _normalize_user(user_id)
    query: dict[str, Any] = {"user_id": {"$in": [user, GLOBAL_NOTIFICATION_USER]}}
    project = str(project_id or "").strip()
    if project:
        query["project_id"] = project
    if not include_dismissed:
        query["dismissed"] = {"$ne": True}
    safe_limit = max(1, min(int(limit or 200), 1000))
    rows = (
        await get_db()["notifications"]
        .find(query)
        .sort("created_at", -1)
        .limit(safe_limit)
        .to_list(length=safe_limit)
    )
    return [_serialize_notification(row) for row in rows if isinstance(row, dict)]


async def set_notification_dismissed(
    *,
    notification_id: str,
    user_id: str,
    dismissed: bool,
) -> dict[str, Any] | None:
    query: dict[str, Any] = {"user_id": {"$in": [_normalize_user(user_id), GLOBAL_NOTIFICATION_USER]}}
    if not ObjectId.is_valid(notification_id):
        raise ValueError("Invalid notification_id")
    query["_id"] = ObjectId(notification_id)
    row = await get_db()["notifications"].find_one(query)
    if not isinstance(row, dict):
        return None
    now = _now()
    if dismissed:
        update = {
            "$set": {
                "dismissed": True,
                "dismissed_at": now,
                "updated_at": now,
            }
        }
    else:
        update = {
            "$set": {
                "dismissed": False,
                "updated_at": now,
            },
            "$unset": {"dismissed_at": ""},
        }
    await get_db()["notifications"].update_one({"_id": row["_id"]}, update)
    next_row = await get_db()["notifications"].find_one({"_id": row["_id"]})
    if not isinstance(next_row, dict):
        return None
    return _serialize_notification(next_row)


async def dismiss_all_notifications(
    *,
    user_id: str,
    project_id: str | None = None,
) -> int:
    query: dict[str, Any] = {
        "user_id": {"$in": [_normalize_user(user_id), GLOBAL_NOTIFICATION_USER]},
        "dismissed": {"$ne": True},
    }
    project = str(project_id or "").strip()
    if project:
        query["project_id"] = project
    now = _now()
    res = await get_db()["notifications"].update_many(
        query,
        {
            "$set": {
                "dismissed": True,
                "dismissed_at": now,
                "updated_at": now,
            }
        },
    )
    count = int(res.modified_count or 0)
    logger.info(
        "notifications.dismiss_all user=%s project=%s modified=%s",
        _normalize_user(user_id),
        project,
        count,
    )
    return count

