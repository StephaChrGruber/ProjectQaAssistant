from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId

from ..core.request_context import get_request_id
from ..db import get_db
from ..utils.mongo import to_jsonable

_INDEXES_READY = False


def _trim(value: Any, max_chars: int = 2000) -> Any:
    if isinstance(value, str):
        if len(value) <= max_chars:
            return value
        return value[:max_chars] + "...(truncated)"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 120:
                out["__truncated__"] = True
                break
            out[str(k)] = _trim(v, max_chars=max_chars)
        return out
    if isinstance(value, list):
        out_list: list[Any] = []
        for idx, item in enumerate(value):
            if idx >= 120:
                out_list.append("...(truncated)")
                break
            out_list.append(_trim(item, max_chars=max_chars))
        return out_list
    return value


async def ensure_audit_event_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    coll = get_db()["audit_events"]
    await coll.create_index([("project_id", 1), ("created_at", -1)], name="audit_project_recent")
    await coll.create_index([("chat_id", 1), ("created_at", -1)], name="audit_chat_recent")
    await coll.create_index([("event", 1), ("created_at", -1)], name="audit_event_recent")
    await coll.create_index([("request_id", 1), ("created_at", -1)], name="audit_request_recent")
    _INDEXES_READY = True


async def record_audit_event(
    *,
    event: str,
    project_id: str,
    user: str | None = None,
    branch: str | None = None,
    chat_id: str | None = None,
    level: str = "info",
    details: dict[str, Any] | None = None,
) -> None:
    try:
        await ensure_audit_event_indexes()
        payload = {
            "event": str(event or "").strip() or "unknown",
            "project_id": str(project_id or "").strip(),
            "user": str(user or "").strip() or None,
            "branch": str(branch or "").strip() or None,
            "chat_id": str(chat_id or "").strip() or None,
            "level": str(level or "info").strip().lower() or "info",
            "request_id": get_request_id(),
            "details": _trim(details if isinstance(details, dict) else {}),
            "created_at": datetime.utcnow(),
        }
        await get_db()["audit_events"].insert_one(payload)
    except Exception:
        # Audit stream must never break user-facing workflows.
        return


def _jsonify(row: dict[str, Any]) -> dict[str, Any]:
    out = to_jsonable(dict(row))
    created = row.get("created_at")
    if isinstance(created, datetime):
        out["created_at"] = created.isoformat() + "Z"
    if isinstance(row.get("_id"), ObjectId):
        out["id"] = str(row.get("_id"))
    return out


async def list_audit_events(
    *,
    project_id: str,
    branch: str | None = None,
    chat_id: str | None = None,
    event: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    await ensure_audit_event_indexes()
    q: dict[str, Any] = {"project_id": project_id}
    if branch:
        q["branch"] = branch
    if chat_id:
        q["chat_id"] = chat_id
    if event:
        q["event"] = event
    safe_limit = max(1, min(int(limit or 200), 1000))
    rows = await get_db()["audit_events"].find(q).sort("created_at", -1).limit(safe_limit).to_list(length=safe_limit)
    return [_jsonify(r) for r in rows if isinstance(r, dict)]
