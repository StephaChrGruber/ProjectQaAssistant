from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from bson import ObjectId

from ..repositories.factory import repository_factory

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
    repo = repository_factory().notifications
    notification_id = await repo.insert_notification(doc)
    row = await repo.get_notification_by_id(notification_id)
    if not isinstance(row, dict):
        raise RuntimeError("Failed to create notification")
    logger.info(
        "notifications.create project=%s user=%s severity=%s source=%s notification_id=%s",
        doc["project_id"],
        doc["user_id"],
        doc["severity"],
        doc["source"],
        notification_id,
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
    repo = repository_factory().notifications
    project = str(project_id or "").strip()
    rows = await repo.list_notifications(
        user_ids=[user, GLOBAL_NOTIFICATION_USER],
        project_id=project or None,
        include_dismissed=include_dismissed,
        limit=limit,
    )
    return [_serialize_notification(row) for row in rows if isinstance(row, dict)]


async def set_notification_dismissed(
    *,
    notification_id: str,
    user_id: str,
    dismissed: bool,
) -> dict[str, Any] | None:
    if not ObjectId.is_valid(notification_id):
        raise ValueError("Invalid notification_id")
    repo = repository_factory().notifications
    row = await repo.get_notification_for_user(
        notification_id=notification_id,
        user_ids=[_normalize_user(user_id), GLOBAL_NOTIFICATION_USER],
    )
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
    await repo.update_notification_by_id(str(row["_id"]), update)
    next_row = await repo.get_notification_by_id(str(row["_id"]))
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
    repo = repository_factory().notifications
    count = await repo.update_notifications_many(
        query,
        {
            "$set": {
                "dismissed": True,
                "dismissed_at": now,
                "updated_at": now,
            }
        },
    )
    logger.info(
        "notifications.dismiss_all user=%s project=%s modified=%s",
        _normalize_user(user_id),
        project,
        count,
    )
    return count
