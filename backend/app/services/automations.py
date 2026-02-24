from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId

from ..db import get_db
from ..models.base_mongo_models import Project
from ..rag.ingest import ingest_project
from ..services.documentation import generate_project_documentation

logger = logging.getLogger(__name__)

AUTOMATION_EVENT_TYPES = {
    "ask_agent_completed",
    "connector_health_checked",
    "manual",
}

AUTOMATION_ACTION_TYPES = {
    "create_chat_task",
    "append_chat_message",
    "request_user_input",
    "run_incremental_ingestion",
    "generate_documentation",
}

AUTOMATION_TRIGGER_TYPES = {
    "event",
    "schedule",
    "manual",
}

AUTOMATION_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "task-on-tool-errors",
        "name": "Create Task On Tool Errors",
        "description": "Creates a follow-up chat task whenever an agent response includes tool errors.",
        "trigger": {"type": "event", "event_type": "ask_agent_completed"},
        "conditions": {"tool_errors_min": 1},
        "action": {
            "type": "create_chat_task",
            "params": {
                "title": "Investigate tool failures in {{chat_id}}",
                "details": "Agent answer had {{tool_errors}} tool errors.\n\nQuestion: {{question}}",
                "status": "open",
                "chat_id": "{{chat_id}}",
            },
        },
        "cooldown_sec": 120,
        "tags": ["reliability", "ops"],
    },
    {
        "key": "daily-doc-refresh",
        "name": "Daily Documentation Refresh",
        "description": "Regenerates documentation once per day.",
        "trigger": {"type": "schedule", "interval_minutes": 1440},
        "conditions": {},
        "action": {"type": "generate_documentation", "params": {"branch": "main"}},
        "cooldown_sec": 0,
        "tags": ["documentation"],
    },
    {
        "key": "hourly-ingest",
        "name": "Hourly Incremental Ingestion",
        "description": "Runs incremental ingestion every hour.",
        "trigger": {"type": "schedule", "interval_minutes": 60},
        "conditions": {},
        "action": {"type": "run_incremental_ingestion", "params": {}},
        "cooldown_sec": 0,
        "tags": ["ingestion"],
    },
    {
        "key": "connector-alert-task",
        "name": "Connector Health Alert Task",
        "description": "Creates a task when connector health checks report failures.",
        "trigger": {"type": "event", "event_type": "connector_health_checked"},
        "conditions": {"failed_connectors_min": 1},
        "action": {
            "type": "create_chat_task",
            "params": {
                "title": "Connector health degraded",
                "details": "Failed connectors: {{failed_connectors}} / {{total_connectors}}",
                "status": "open",
            },
        },
        "cooldown_sec": 300,
        "tags": ["connectors", "ops"],
    },
    {
        "key": "ask-clarification-on-errors",
        "name": "Ask Clarification On Repeated Failures",
        "description": "Requests user input when tool errors happen during an answer.",
        "trigger": {"type": "event", "event_type": "ask_agent_completed"},
        "conditions": {"tool_errors_min": 1},
        "action": {
            "type": "request_user_input",
            "params": {
                "chat_id": "{{chat_id}}",
                "question": "I saw tool errors while processing your request. Should I retry with a different approach?",
                "answer_mode": "single_choice",
                "options": ["Retry now", "Explain errors first", "Skip retries"],
            },
        },
        "cooldown_sec": 300,
        "tags": ["ux", "reliability"],
    },
    {
        "key": "notify-doc-refresh",
        "name": "Notify Chat On Doc Refresh",
        "description": "Posts a chat note after documentation generation runs.",
        "trigger": {"type": "schedule", "interval_minutes": 720},
        "conditions": {},
        "action": {
            "type": "append_chat_message",
            "params": {
                "chat_id": "{{chat_id}}",
                "role": "assistant",
                "content": "Automation ran: documentation refresh completed.",
            },
        },
        "cooldown_sec": 0,
        "tags": ["documentation", "communication"],
    },
    {
        "key": "keyword-hotword-task",
        "name": "Create Task On Hotword",
        "description": "Creates a task when a keyword appears in the user question.",
        "trigger": {"type": "event", "event_type": "ask_agent_completed"},
        "conditions": {"keyword_contains": ["urgent", "blocker"]},
        "action": {
            "type": "create_chat_task",
            "params": {
                "title": "Follow up on urgent request",
                "details": "Detected keyword in question: {{question}}",
                "chat_id": "{{chat_id}}",
            },
        },
        "cooldown_sec": 120,
        "tags": ["triage"],
    },
    {
        "key": "daily-summary-note",
        "name": "Daily Summary Reminder",
        "description": "Adds a reminder note once a day in the latest active chat.",
        "trigger": {"type": "schedule", "interval_minutes": 1440},
        "conditions": {},
        "action": {
            "type": "append_chat_message",
            "params": {
                "role": "assistant",
                "content": "Daily automation reminder: review open tasks and unresolved questions.",
            },
        },
        "cooldown_sec": 0,
        "tags": ["productivity"],
    },
    {
        "key": "ingest-on-connector-fail",
        "name": "Try Ingestion After Connector Issues",
        "description": "Runs incremental ingestion when connector checks fail.",
        "trigger": {"type": "event", "event_type": "connector_health_checked"},
        "conditions": {"failed_connectors_min": 1},
        "action": {"type": "run_incremental_ingestion", "params": {}},
        "cooldown_sec": 900,
        "tags": ["ingestion", "connectors"],
    },
    {
        "key": "manual-doc-run",
        "name": "Manual Documentation Workflow",
        "description": "A manual automation that can be run on demand by users or LLM.",
        "trigger": {"type": "manual"},
        "conditions": {},
        "action": {"type": "generate_documentation", "params": {"branch": "main"}},
        "cooldown_sec": 0,
        "tags": ["manual", "documentation"],
    },
]

_WORKER_TASK: asyncio.Task[None] | None = None
_WORKER_STOP_EVENT: asyncio.Event | None = None


def _now() -> datetime:
    return datetime.utcnow()


def _iso(value: datetime | None) -> str | None:
    if not isinstance(value, datetime):
        return None
    return value.isoformat() + "Z"


def _serialize_automation(doc: dict[str, Any]) -> dict[str, Any]:
    out = {
        "id": str(doc.get("_id") or ""),
        "project_id": str(doc.get("project_id") or ""),
        "name": str(doc.get("name") or ""),
        "description": str(doc.get("description") or ""),
        "enabled": bool(doc.get("enabled", True)),
        "trigger": doc.get("trigger") if isinstance(doc.get("trigger"), dict) else {},
        "conditions": doc.get("conditions") if isinstance(doc.get("conditions"), dict) else {},
        "action": doc.get("action") if isinstance(doc.get("action"), dict) else {},
        "cooldown_sec": int(doc.get("cooldown_sec") or 0),
        "tags": [str(x).strip() for x in (doc.get("tags") or []) if str(x).strip()],
        "last_run_at": _iso(doc.get("last_run_at")) if isinstance(doc.get("last_run_at"), datetime) else doc.get("last_run_at"),
        "last_status": str(doc.get("last_status") or ""),
        "last_error": str(doc.get("last_error") or ""),
        "next_run_at": _iso(doc.get("next_run_at")) if isinstance(doc.get("next_run_at"), datetime) else doc.get("next_run_at"),
        "run_count": int(doc.get("run_count") or 0),
        "created_by": str(doc.get("created_by") or ""),
        "updated_by": str(doc.get("updated_by") or ""),
        "created_at": _iso(doc.get("created_at")) if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": _iso(doc.get("updated_at")) if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }
    return out


def _serialize_run(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc.get("_id") or ""),
        "automation_id": str(doc.get("automation_id") or ""),
        "project_id": str(doc.get("project_id") or ""),
        "triggered_by": str(doc.get("triggered_by") or ""),
        "event_type": str(doc.get("event_type") or ""),
        "status": str(doc.get("status") or ""),
        "error": str(doc.get("error") or ""),
        "result": doc.get("result"),
        "event_payload": doc.get("event_payload") if isinstance(doc.get("event_payload"), dict) else {},
        "started_at": _iso(doc.get("started_at")) if isinstance(doc.get("started_at"), datetime) else doc.get("started_at"),
        "finished_at": _iso(doc.get("finished_at")) if isinstance(doc.get("finished_at"), datetime) else doc.get("finished_at"),
        "duration_ms": int(doc.get("duration_ms") or 0),
    }


def _normalize_trigger(raw: dict[str, Any] | None) -> dict[str, Any]:
    trigger = raw if isinstance(raw, dict) else {}
    trigger_type = str(trigger.get("type") or "").strip().lower() or "manual"
    if trigger_type not in AUTOMATION_TRIGGER_TYPES:
        raise ValueError(f"Invalid trigger.type: {trigger_type}")

    if trigger_type == "schedule":
        interval = max(1, min(int(trigger.get("interval_minutes") or 60), 24 * 30))
        return {
            "type": "schedule",
            "interval_minutes": interval,
        }

    if trigger_type == "event":
        event_type = str(trigger.get("event_type") or "").strip()
        if event_type not in AUTOMATION_EVENT_TYPES:
            raise ValueError(f"Invalid trigger.event_type: {event_type}")
        return {
            "type": "event",
            "event_type": event_type,
        }

    return {"type": "manual"}


def _normalize_action(raw: dict[str, Any] | None) -> dict[str, Any]:
    action = raw if isinstance(raw, dict) else {}
    action_type = str(action.get("type") or "").strip().lower()
    if action_type not in AUTOMATION_ACTION_TYPES:
        raise ValueError(f"Invalid action.type: {action_type}")
    params = action.get("params") if isinstance(action.get("params"), dict) else {}
    return {"type": action_type, "params": dict(params)}


def _normalize_conditions(raw: dict[str, Any] | None) -> dict[str, Any]:
    conditions = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}

    keyword_contains = conditions.get("keyword_contains")
    if isinstance(keyword_contains, str) and keyword_contains.strip():
        out["keyword_contains"] = [keyword_contains.strip()]
    elif isinstance(keyword_contains, list):
        vals = [str(x).strip() for x in keyword_contains if str(x).strip()]
        if vals:
            out["keyword_contains"] = vals[:24]

    if conditions.get("tool_errors_min") is not None:
        out["tool_errors_min"] = max(0, min(int(conditions.get("tool_errors_min") or 0), 1000))

    if conditions.get("failed_connectors_min") is not None:
        out["failed_connectors_min"] = max(0, min(int(conditions.get("failed_connectors_min") or 0), 1000))

    return out


def _coerce_tags(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        val = str(item or "").strip()
        if not val or val in seen:
            continue
        seen.add(val)
        out.append(val)
        if len(out) >= 32:
            break
    return out


def _next_scheduled_run(trigger: dict[str, Any], *, base: datetime | None = None) -> datetime | None:
    if str(trigger.get("type") or "") != "schedule":
        return None
    interval = max(1, min(int(trigger.get("interval_minutes") or 60), 24 * 30))
    return (base or _now()) + timedelta(minutes=interval)


def _pick_payload_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("question", "answer", "content", "message"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return "\n".join(parts).lower()


def _extract_path(data: dict[str, Any], path: str) -> str:
    cur: Any = data
    for token in [p for p in path.split(".") if p]:
        if not isinstance(cur, dict):
            return ""
        cur = cur.get(token)
    if cur is None:
        return ""
    return str(cur)


def _render_template(value: Any, payload: dict[str, Any]) -> Any:
    if isinstance(value, str):
        pattern = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")

        def repl(match: re.Match[str]) -> str:
            key = match.group(1)
            return _extract_path(payload, key)

        return pattern.sub(repl, value)
    if isinstance(value, list):
        return [_render_template(item, payload) for item in value]
    if isinstance(value, dict):
        return {str(k): _render_template(v, payload) for k, v in value.items()}
    return value


def _conditions_match(conditions: dict[str, Any], payload: dict[str, Any]) -> bool:
    if not conditions:
        return True

    text_blob = _pick_payload_text(payload)
    keywords = conditions.get("keyword_contains")
    if isinstance(keywords, list) and keywords:
        if not any(str(k).strip().lower() in text_blob for k in keywords):
            return False

    tool_errors_min = conditions.get("tool_errors_min")
    if tool_errors_min is not None:
        errors = int(payload.get("tool_errors") or 0)
        if errors < int(tool_errors_min):
            return False

    failed_connectors_min = conditions.get("failed_connectors_min")
    if failed_connectors_min is not None:
        failed = int(payload.get("failed_connectors") or 0)
        if failed < int(failed_connectors_min):
            return False

    return True


def _trigger_matches(trigger: dict[str, Any], *, triggered_by: str, event_type: str) -> bool:
    trigger_type = str(trigger.get("type") or "")
    if trigger_type == "manual":
        return triggered_by == "manual"
    if trigger_type == "schedule":
        return triggered_by == "schedule"
    if trigger_type == "event":
        expected = str(trigger.get("event_type") or "")
        return triggered_by == "event" and event_type == expected
    return False


async def list_automation_templates() -> list[dict[str, Any]]:
    return [dict(item) for item in AUTOMATION_TEMPLATES]


async def list_automations(
    project_id: str,
    *,
    include_disabled: bool = True,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"project_id": project_id}
    if not include_disabled:
        query["enabled"] = True
    safe_limit = max(1, min(int(limit or 200), 1000))
    rows = await get_db()["automations"].find(query).sort("updated_at", -1).limit(safe_limit).to_list(length=safe_limit)
    return [_serialize_automation(row) for row in rows if isinstance(row, dict)]


async def get_automation(project_id: str, automation_id: str) -> dict[str, Any] | None:
    query: dict[str, Any] = {"project_id": project_id}
    if ObjectId.is_valid(automation_id):
        query["_id"] = ObjectId(automation_id)
    else:
        return None
    row = await get_db()["automations"].find_one(query)
    if not isinstance(row, dict):
        return None
    return _serialize_automation(row)


async def create_automation(
    project_id: str,
    *,
    user_id: str,
    name: str,
    description: str = "",
    enabled: bool = True,
    trigger: dict[str, Any] | None = None,
    conditions: dict[str, Any] | None = None,
    action: dict[str, Any] | None = None,
    cooldown_sec: int = 0,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("name is required")
    normalized_trigger = _normalize_trigger(trigger)
    normalized_action = _normalize_action(action)
    normalized_conditions = _normalize_conditions(conditions)
    safe_cooldown = max(0, min(int(cooldown_sec or 0), 24 * 3600))
    safe_tags = _coerce_tags(tags or [])
    now = _now()
    doc = {
        "project_id": project_id,
        "name": clean_name,
        "description": str(description or "").strip(),
        "enabled": bool(enabled),
        "trigger": normalized_trigger,
        "conditions": normalized_conditions,
        "action": normalized_action,
        "cooldown_sec": safe_cooldown,
        "tags": safe_tags,
        "run_count": 0,
        "last_status": "",
        "last_error": "",
        "last_run_at": None,
        "next_run_at": _next_scheduled_run(normalized_trigger, base=now) if enabled else None,
        "created_by": str(user_id or "").strip(),
        "updated_by": str(user_id or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    res = await get_db()["automations"].insert_one(doc)
    row = await get_db()["automations"].find_one({"_id": res.inserted_id})
    if not isinstance(row, dict):
        raise RuntimeError("Failed to create automation")
    logger.info(
        "automations.create project=%s automation_id=%s trigger=%s action=%s enabled=%s",
        project_id,
        str(res.inserted_id),
        str(normalized_trigger.get("type") or ""),
        str(normalized_action.get("type") or ""),
        bool(enabled),
    )
    return _serialize_automation(row)


async def update_automation(
    project_id: str,
    automation_id: str,
    *,
    user_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    query: dict[str, Any] = {"project_id": project_id}
    if ObjectId.is_valid(automation_id):
        query["_id"] = ObjectId(automation_id)
    else:
        raise ValueError("Invalid automation_id")

    existing = await get_db()["automations"].find_one(query)
    if not isinstance(existing, dict):
        raise KeyError("Automation not found")

    next_doc = dict(existing)
    if "name" in patch:
        clean_name = str(patch.get("name") or "").strip()
        if not clean_name:
            raise ValueError("name must not be empty")
        next_doc["name"] = clean_name
    if "description" in patch:
        next_doc["description"] = str(patch.get("description") or "").strip()
    if "enabled" in patch:
        next_doc["enabled"] = bool(patch.get("enabled"))
    if "trigger" in patch:
        next_doc["trigger"] = _normalize_trigger(patch.get("trigger") if isinstance(patch.get("trigger"), dict) else None)
    if "conditions" in patch:
        next_doc["conditions"] = _normalize_conditions(
            patch.get("conditions") if isinstance(patch.get("conditions"), dict) else None
        )
    if "action" in patch:
        next_doc["action"] = _normalize_action(patch.get("action") if isinstance(patch.get("action"), dict) else None)
    if "cooldown_sec" in patch:
        next_doc["cooldown_sec"] = max(0, min(int(patch.get("cooldown_sec") or 0), 24 * 3600))
    if "tags" in patch:
        next_doc["tags"] = _coerce_tags(patch.get("tags") if isinstance(patch.get("tags"), list) else [])

    now = _now()
    next_doc["updated_at"] = now
    next_doc["updated_by"] = str(user_id or "").strip()
    if not bool(next_doc.get("enabled")):
        next_doc["next_run_at"] = None
    elif str((next_doc.get("trigger") or {}).get("type") or "") == "schedule":
        next_doc["next_run_at"] = _next_scheduled_run(next_doc.get("trigger") or {}, base=now)

    await get_db()["automations"].update_one({"_id": existing["_id"]}, {"$set": next_doc})
    row = await get_db()["automations"].find_one({"_id": existing["_id"]})
    if not isinstance(row, dict):
        raise RuntimeError("Automation update failed")
    logger.info("automations.update project=%s automation_id=%s", project_id, automation_id)
    return _serialize_automation(row)


async def delete_automation(project_id: str, automation_id: str) -> bool:
    query: dict[str, Any] = {"project_id": project_id}
    if ObjectId.is_valid(automation_id):
        query["_id"] = ObjectId(automation_id)
    else:
        raise ValueError("Invalid automation_id")

    row = await get_db()["automations"].find_one(query, {"_id": 1})
    if not isinstance(row, dict):
        return False
    await get_db()["automations"].delete_one({"_id": row["_id"]})
    await get_db()["automation_runs"].delete_many({"project_id": project_id, "automation_id": str(row["_id"])})
    logger.info("automations.delete project=%s automation_id=%s", project_id, str(row["_id"]))
    return True


async def list_automation_runs(
    project_id: str,
    *,
    automation_id: str | None = None,
    limit: int = 120,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"project_id": project_id}
    if automation_id:
        query["automation_id"] = str(automation_id).strip()
    safe_limit = max(1, min(int(limit or 120), 1000))
    rows = await get_db()["automation_runs"].find(query).sort("started_at", -1).limit(safe_limit).to_list(length=safe_limit)
    return [_serialize_run(row) for row in rows if isinstance(row, dict)]


async def _resolve_default_chat_id(project_id: str) -> str | None:
    row = await get_db()["chats"].find_one(
        {"project_id": project_id},
        {"chat_id": 1},
        sort=[("updated_at", -1)],
    )
    if not isinstance(row, dict):
        return None
    chat_id = str(row.get("chat_id") or "").strip()
    return chat_id or None


async def _action_create_chat_task(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    title = str(params.get("title") or "").strip()
    if not title:
        raise RuntimeError("create_chat_task action requires params.title")
    chat_id = str(params.get("chat_id") or payload.get("chat_id") or "").strip() or None
    now_iso = _iso(started_at) or ""
    doc: dict[str, Any] = {
        "project_id": project_id,
        "chat_id": chat_id,
        "title": title,
        "details": str(params.get("details") or "").strip(),
        "assignee": str(params.get("assignee") or "").strip() or None,
        "due_date": str(params.get("due_date") or "").strip() or None,
        "status": str(params.get("status") or "open").strip().lower() or "open",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    if doc["status"] not in {"open", "in_progress", "blocked", "done", "cancelled"}:
        doc["status"] = "open"
    res = await get_db()["chat_tasks"].insert_one(doc)
    return {"task_id": str(res.inserted_id), "title": title, "chat_id": chat_id}


async def _action_append_chat_message(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    chat_id = str(params.get("chat_id") or payload.get("chat_id") or "").strip()
    if not chat_id:
        fallback_chat_id = await _resolve_default_chat_id(project_id)
        chat_id = fallback_chat_id or ""
    if not chat_id:
        raise RuntimeError("append_chat_message action requires chat_id (or an existing chat)")
    content = str(params.get("content") or "").strip()
    if not content:
        raise RuntimeError("append_chat_message action requires params.content")
    role = str(params.get("role") or "assistant").strip().lower() or "assistant"
    if role not in {"assistant", "system", "tool"}:
        role = "assistant"
    msg = {
        "role": role,
        "content": content,
        "ts": started_at,
        "meta": {"automation": {"generated": True}},
    }
    res = await get_db()["chats"].update_one(
        {"chat_id": chat_id, "project_id": project_id},
        {
            "$push": {"messages": msg},
            "$set": {
                "updated_at": started_at,
                "last_message_at": started_at,
                "last_message_preview": content[:160],
            },
        },
    )
    if res.matched_count == 0:
        raise RuntimeError("Chat not found for append_chat_message")
    return {"chat_id": chat_id, "role": role, "content_preview": content[:160]}


async def _action_request_user_input(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    chat_id = str(params.get("chat_id") or payload.get("chat_id") or "").strip()
    if not chat_id:
        raise RuntimeError("request_user_input action requires chat_id")
    question = str(params.get("question") or "").strip()
    if not question:
        raise RuntimeError("request_user_input action requires params.question")
    answer_mode = str(params.get("answer_mode") or "open_text").strip()
    if answer_mode not in {"open_text", "single_choice"}:
        answer_mode = "open_text"
    raw_options = params.get("options") if isinstance(params.get("options"), list) else []
    options = [str(x).strip() for x in raw_options if str(x).strip()]
    if answer_mode == "single_choice" and len(options) < 2:
        raise RuntimeError("request_user_input single_choice requires at least two options")
    pending_id = f"autoq_{int(started_at.timestamp() * 1000)}"
    payload_doc = {
        "id": pending_id,
        "question": question,
        "answer_mode": answer_mode,
        "options": options,
        "created_at": _iso(started_at),
        "source": "automation",
    }
    res = await get_db()["chats"].update_one(
        {"chat_id": chat_id, "project_id": project_id},
        {"$set": {"pending_user_question": payload_doc, "updated_at": started_at}},
    )
    if res.matched_count == 0:
        raise RuntimeError("Chat not found for request_user_input action")
    return {"chat_id": chat_id, "pending_question_id": pending_id}


async def _action_run_incremental_ingestion(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    _ = payload
    params = action.get("params") if isinstance(action.get("params"), dict) else {}
    project = await Project.get(project_id)
    if not project:
        raise RuntimeError("Project not found for run_incremental_ingestion")
    connectors = params.get("connectors") if isinstance(params.get("connectors"), list) else []
    connectors_filter = [str(x).strip() for x in connectors if str(x).strip()]
    stats = await ingest_project(project, connectors_filter=connectors_filter or None)
    await get_db()["ingestion_runs"].insert_one(
        {
            "project_id": project_id,
            "mode": "incremental",
            "reason": "automation",
            "requested_connectors": connectors_filter,
            "stats": stats,
            "created_at": started_at,
        }
    )
    return {"mode": "incremental", "requested_connectors": connectors_filter, "stats": stats}


async def _action_generate_documentation(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    branch = str(params.get("branch") or payload.get("branch") or "").strip() or None
    user_id = str(params.get("user_id") or payload.get("user_id") or "automation@system").strip()
    result = await generate_project_documentation(project_id=project_id, branch=branch, user_id=user_id)
    return {
        "branch": str(result.get("branch") or ""),
        "mode": str(result.get("mode") or ""),
        "files_written": result.get("files_written") if isinstance(result.get("files_written"), list) else [],
        "summary": str(result.get("summary") or ""),
    }


async def _execute_action(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    action_type = str(action.get("type") or "")
    if action_type == "create_chat_task":
        return await _action_create_chat_task(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "append_chat_message":
        return await _action_append_chat_message(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "request_user_input":
        return await _action_request_user_input(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "run_incremental_ingestion":
        return await _action_run_incremental_ingestion(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "generate_documentation":
        return await _action_generate_documentation(project_id=project_id, action=action, payload=payload, started_at=started_at)
    raise RuntimeError(f"Unsupported action type: {action_type}")


async def _store_run(
    *,
    project_id: str,
    automation_id: str,
    triggered_by: str,
    event_type: str,
    status: str,
    error: str,
    result: dict[str, Any],
    event_payload: dict[str, Any],
    started_at: datetime,
    finished_at: datetime,
) -> dict[str, Any]:
    duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1000))
    doc = {
        "project_id": project_id,
        "automation_id": automation_id,
        "triggered_by": triggered_by,
        "event_type": event_type,
        "status": status,
        "error": error,
        "result": result,
        "event_payload": event_payload,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
    }
    res = await get_db()["automation_runs"].insert_one(doc)
    row = await get_db()["automation_runs"].find_one({"_id": res.inserted_id})
    return _serialize_run(row if isinstance(row, dict) else {**doc, "_id": res.inserted_id})


async def run_automation(
    project_id: str,
    automation_id: str,
    *,
    triggered_by: str,
    event_type: str = "manual",
    event_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {"project_id": project_id}
    if ObjectId.is_valid(automation_id):
        query["_id"] = ObjectId(automation_id)
    else:
        raise ValueError("Invalid automation_id")
    doc = await get_db()["automations"].find_one(query)
    if not isinstance(doc, dict):
        raise KeyError("Automation not found")

    payload = dict(event_payload or {})
    payload.setdefault("project_id", project_id)

    trigger = doc.get("trigger") if isinstance(doc.get("trigger"), dict) else {}
    force_manual = triggered_by == "manual"
    if not force_manual and not _trigger_matches(trigger, triggered_by=triggered_by, event_type=event_type):
        raise RuntimeError("Automation trigger does not match this execution mode")
    if not force_manual and not _conditions_match(doc.get("conditions") if isinstance(doc.get("conditions"), dict) else {}, payload):
        raise RuntimeError("Automation conditions did not match the event payload")

    cooldown_sec = max(0, int(doc.get("cooldown_sec") or 0))
    last_run_at = doc.get("last_run_at")
    now = _now()
    if cooldown_sec > 0 and isinstance(last_run_at, datetime):
        next_allowed = last_run_at + timedelta(seconds=cooldown_sec)
        if now < next_allowed:
            raise RuntimeError("Automation cooldown active")

    status = "succeeded"
    error = ""
    result: dict[str, Any] = {}
    started_at = now
    try:
        result = await _execute_action(
            project_id=project_id,
            action=doc.get("action") if isinstance(doc.get("action"), dict) else {},
            payload=payload,
            started_at=started_at,
        )
    except Exception as err:
        status = "failed"
        error = str(err)
        result = {}

    finished_at = _now()
    run_row = await _store_run(
        project_id=project_id,
        automation_id=str(doc.get("_id") or ""),
        triggered_by=triggered_by,
        event_type=event_type,
        status=status,
        error=error,
        result=result,
        event_payload=payload,
        started_at=started_at,
        finished_at=finished_at,
    )
    update_doc: dict[str, Any] = {
        "last_run_at": finished_at,
        "last_status": status,
        "last_error": error,
        "updated_at": finished_at,
        "run_count": int(doc.get("run_count") or 0) + 1,
    }
    if str(trigger.get("type") or "") == "schedule" and bool(doc.get("enabled")):
        update_doc["next_run_at"] = _next_scheduled_run(trigger, base=finished_at)
    await get_db()["automations"].update_one({"_id": doc["_id"]}, {"$set": update_doc})
    logger.info(
        "automations.run project=%s automation_id=%s status=%s event=%s triggered_by=%s",
        project_id,
        str(doc.get("_id") or ""),
        status,
        event_type,
        triggered_by,
    )
    return run_row


async def dispatch_automation_event(
    project_id: str,
    *,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if event_type not in AUTOMATION_EVENT_TYPES:
        return []
    base_payload = dict(payload or {})
    base_payload.setdefault("project_id", project_id)
    rows = await get_db()["automations"].find(
        {
            "project_id": project_id,
            "enabled": True,
            "trigger.type": "event",
            "trigger.event_type": event_type,
        }
    ).to_list(length=500)
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        conditions = row.get("conditions") if isinstance(row.get("conditions"), dict) else {}
        if not _conditions_match(conditions, base_payload):
            continue
        try:
            run_row = await run_automation(
                project_id,
                str(row.get("_id") or ""),
                triggered_by="event",
                event_type=event_type,
                event_payload=base_payload,
            )
            out.append(run_row)
        except Exception:
            logger.exception(
                "automations.dispatch_event_failed project=%s automation_id=%s event=%s",
                project_id,
                str(row.get("_id") or ""),
                event_type,
            )
    return out


async def run_due_scheduled_automations(*, limit: int = 20) -> int:
    now = _now()
    rows = await get_db()["automations"].find(
        {
            "enabled": True,
            "trigger.type": "schedule",
            "next_run_at": {"$lte": now},
        }
    ).sort("next_run_at", 1).limit(max(1, min(int(limit or 20), 200))).to_list(length=max(1, min(int(limit or 20), 200)))
    ran = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        project_id = str(row.get("project_id") or "").strip()
        automation_id = str(row.get("_id") or "").strip()
        if not project_id or not automation_id:
            continue
        try:
            await run_automation(
                project_id,
                automation_id,
                triggered_by="schedule",
                event_type="manual",
                event_payload={"project_id": project_id},
            )
            ran += 1
        except Exception:
            logger.exception("automations.schedule_run_failed project=%s automation_id=%s", project_id, automation_id)
            # Move next_run_at forward to avoid hot-looping on permanently failing automations.
            trigger = row.get("trigger") if isinstance(row.get("trigger"), dict) else {}
            next_run = _next_scheduled_run(trigger, base=now)
            await get_db()["automations"].update_one(
                {"_id": row.get("_id")},
                {"$set": {"next_run_at": next_run, "updated_at": _now(), "last_status": "failed"}},
            )
    return ran


async def _automation_worker_loop(poll_interval_sec: float = 10.0) -> None:
    global _WORKER_STOP_EVENT
    if _WORKER_STOP_EVENT is None:
        _WORKER_STOP_EVENT = asyncio.Event()
    logger.info("automation.worker.start poll_interval_sec=%s", poll_interval_sec)
    while True:
        if _WORKER_STOP_EVENT.is_set():
            break
        try:
            await run_due_scheduled_automations(limit=30)
        except Exception:
            logger.exception("automation.worker.tick_failed")
        try:
            await asyncio.wait_for(_WORKER_STOP_EVENT.wait(), timeout=max(1.0, float(poll_interval_sec)))
        except asyncio.TimeoutError:
            continue
    logger.info("automation.worker.stop")


def start_automation_worker() -> None:
    global _WORKER_TASK, _WORKER_STOP_EVENT
    if _WORKER_TASK and not _WORKER_TASK.done():
        return
    _WORKER_STOP_EVENT = asyncio.Event()
    _WORKER_TASK = asyncio.create_task(_automation_worker_loop(), name="automation-worker")


async def stop_automation_worker() -> None:
    global _WORKER_TASK, _WORKER_STOP_EVENT
    if _WORKER_STOP_EVENT is not None:
        _WORKER_STOP_EVENT.set()
    if _WORKER_TASK is None:
        return
    try:
        await asyncio.wait_for(_WORKER_TASK, timeout=5)
    except Exception:
        _WORKER_TASK.cancel()
    finally:
        _WORKER_TASK = None
        _WORKER_STOP_EVENT = None
