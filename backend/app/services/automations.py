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
    "chat_task_created",
    "chat_task_updated",
    "chat_message_appended",
    "user_input_requested",
    "ingestion_completed",
    "documentation_generated",
    "automation_run_succeeded",
    "automation_run_failed",
    "manual",
}

AUTOMATION_ACTION_TYPES = {
    "create_chat_task",
    "update_chat_task",
    "append_chat_message",
    "set_chat_title",
    "request_user_input",
    "run_incremental_ingestion",
    "generate_documentation",
    "dispatch_event",
    "run_automation",
    "set_automation_enabled",
    "upsert_state_value",
}

AUTOMATION_TRIGGER_TYPES = {
    "event",
    "schedule",
    "daily",
    "weekly",
    "once",
    "manual",
}
AUTOMATION_RUN_ACCESS_TYPES = {"member_runnable", "admin_only"}

VALID_STATUS_SET = {"open", "in_progress", "blocked", "done", "cancelled"}
VALID_WEEKDAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
_EVENT_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.:-]{1,63}$")

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
        "run_access": "member_runnable",
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
        "run_access": "admin_only",
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
        "run_access": "admin_only",
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
        "run_access": "member_runnable",
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
        "run_access": "member_runnable",
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
        "run_access": "member_runnable",
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
        "run_access": "member_runnable",
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
        "run_access": "member_runnable",
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
        "run_access": "admin_only",
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
        "run_access": "admin_only",
        "tags": ["manual", "documentation"],
    },
    {
        "key": "daily-open-task-rollup",
        "name": "Daily Open Task Rollup",
        "description": "Creates a daily reminder task with a rollup of current chat context.",
        "trigger": {"type": "daily", "hour": 9, "minute": 0},
        "conditions": {"match_mode": "all", "branch_in": ["main"]},
        "action": {
            "type": "create_chat_task",
            "params": {
                "chat_id": "{{chat_id}}",
                "title": "Daily project rollup",
                "details": "Review unresolved points from latest answer:\n\n{{answer}}",
                "status": "open",
            },
        },
        "cooldown_sec": 0,
        "run_access": "member_runnable",
        "tags": ["daily", "tasks"],
    },
    {
        "key": "weekly-release-note",
        "name": "Weekly Release Note Prompt",
        "description": "Posts a weekly reminder to collect release notes.",
        "trigger": {"type": "weekly", "weekdays": ["fri"], "hour": 15, "minute": 0},
        "conditions": {},
        "action": {
            "type": "append_chat_message",
            "params": {
                "chat_id": "{{chat_id}}",
                "role": "assistant",
                "content": "Weekly reminder: collect release notes and deployment risks.",
            },
        },
        "cooldown_sec": 0,
        "run_access": "member_runnable",
        "tags": ["weekly", "communication"],
    },
    {
        "key": "once-cutover-branch",
        "name": "One-Time Branch Cutover Prompt",
        "description": "Runs one time at the given timestamp and asks for branch cutover confirmation.",
        "trigger": {"type": "once", "run_at": "2030-01-01T09:00:00Z"},
        "conditions": {},
        "action": {
            "type": "request_user_input",
            "params": {
                "chat_id": "{{chat_id}}",
                "question": "One-time cutover check: should we proceed with branch cutover?",
                "answer_mode": "single_choice",
                "options": ["Proceed", "Delay 1 day", "Cancel"],
            },
        },
        "cooldown_sec": 0,
        "run_access": "admin_only",
        "tags": ["once", "release"],
    },
    {
        "key": "auto-close-task-on-grounded-answer",
        "name": "Close Matching Task On Grounded Answer",
        "description": "Updates a matching open task when grounded answers are generated.",
        "trigger": {"type": "event", "event_type": "ask_agent_completed"},
        "conditions": {"match_mode": "all", "grounded_is": True, "tool_errors_max": 0},
        "action": {
            "type": "update_chat_task",
            "params": {
                "chat_id": "{{chat_id}}",
                "task_title_contains": "Investigate",
                "status": "done",
                "append_details": True,
                "details": "Marked done by automation after grounded answer.",
            },
        },
        "cooldown_sec": 120,
        "run_access": "member_runnable",
        "tags": ["tasks", "quality"],
    },
    {
        "key": "escalate-on-connector-failure",
        "name": "Escalate Connector Failure Event",
        "description": "Dispatches a custom escalation event when connector checks fail repeatedly.",
        "trigger": {"type": "event", "event_type": "connector_health_checked"},
        "conditions": {"failed_connectors_min": 1},
        "action": {
            "type": "dispatch_event",
            "params": {
                "event_type": "ops.alert",
                "payload": {
                    "project_id": "{{project_id}}",
                    "chat_id": "{{chat_id}}",
                    "failed_connectors": "{{failed_connectors}}",
                    "total_connectors": "{{total_connectors}}",
                },
            },
        },
        "cooldown_sec": 300,
        "run_access": "admin_only",
        "tags": ["ops", "events"],
    },
    {
        "key": "store-last-answer-snapshot",
        "name": "Store Last Answer Snapshot",
        "description": "Persists the latest answer in automation state for reuse.",
        "trigger": {"type": "event", "event_type": "ask_agent_completed"},
        "conditions": {},
        "action": {
            "type": "upsert_state_value",
            "params": {
                "key": "last_answer_snapshot",
                "value": {
                    "chat_id": "{{chat_id}}",
                    "branch": "{{branch}}",
                    "question": "{{question}}",
                    "answer": "{{answer}}",
                },
            },
        },
        "cooldown_sec": 0,
        "run_access": "member_runnable",
        "tags": ["state", "memory"],
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


def _parse_iso_datetime(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is not None:
        try:
            return datetime.utcfromtimestamp(parsed.timestamp())
        except Exception:
            return parsed.replace(tzinfo=None)
    return parsed


def _normalize_str_list(raw: Any, *, max_items: int = 24) -> list[str]:
    if isinstance(raw, str):
        vals = [s.strip() for s in raw.split(",")]
    elif isinstance(raw, list):
        vals = [str(x).strip() for x in raw]
    else:
        vals = []
    out: list[str] = []
    seen: set[str] = set()
    for item in vals:
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
        if len(out) >= max_items:
            break
    return out


def _normalize_event_type(raw: str | None) -> str:
    event_type = str(raw or "").strip().lower()
    if not event_type:
        raise ValueError("trigger.event_type is required")
    if not _EVENT_NAME_RE.match(event_type):
        raise ValueError(f"Invalid event name: {event_type}")
    return event_type


def _normalize_weekdays(raw: Any) -> list[str]:
    tokens = _normalize_str_list(raw, max_items=7)
    out: list[str] = []
    for token in tokens:
        lower = token.lower()
        if lower in VALID_WEEKDAYS and lower not in out:
            out.append(lower)
    return out or ["mon", "tue", "wed", "thu", "fri"]


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
        "run_access": str(doc.get("run_access") or "member_runnable"),
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

    if trigger_type == "daily":
        hour = max(0, min(int(trigger.get("hour") or 9), 23))
        minute = max(0, min(int(trigger.get("minute") or 0), 59))
        return {
            "type": "daily",
            "hour": hour,
            "minute": minute,
        }

    if trigger_type == "weekly":
        hour = max(0, min(int(trigger.get("hour") or 9), 23))
        minute = max(0, min(int(trigger.get("minute") or 0), 59))
        weekdays = _normalize_weekdays(trigger.get("weekdays"))
        return {
            "type": "weekly",
            "hour": hour,
            "minute": minute,
            "weekdays": weekdays,
        }

    if trigger_type == "once":
        run_at_raw = str(trigger.get("run_at") or "").strip()
        run_at = _parse_iso_datetime(run_at_raw)
        if not run_at:
            raise ValueError("once trigger requires trigger.run_at as ISO datetime")
        return {
            "type": "once",
            "run_at": _iso(run_at),
        }

    if trigger_type == "event":
        event_type = _normalize_event_type(trigger.get("event_type"))
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

    match_mode = str(conditions.get("match_mode") or "all").strip().lower()
    out["match_mode"] = "any" if match_mode == "any" else "all"

    keyword_contains = _normalize_str_list(conditions.get("keyword_contains"), max_items=24)
    if keyword_contains:
        out["keyword_contains"] = keyword_contains

    keyword_excludes = _normalize_str_list(conditions.get("keyword_excludes"), max_items=24)
    if keyword_excludes:
        out["keyword_excludes"] = keyword_excludes

    answer_contains = _normalize_str_list(conditions.get("answer_contains"), max_items=24)
    if answer_contains:
        out["answer_contains"] = answer_contains

    branch_in = _normalize_str_list(conditions.get("branch_in"), max_items=24)
    if branch_in:
        out["branch_in"] = branch_in

    user_in = _normalize_str_list(conditions.get("user_in"), max_items=50)
    if user_in:
        out["user_in"] = user_in

    if conditions.get("tool_errors_min") is not None:
        out["tool_errors_min"] = max(0, min(int(conditions.get("tool_errors_min") or 0), 1000))
    if conditions.get("tool_errors_max") is not None:
        out["tool_errors_max"] = max(0, min(int(conditions.get("tool_errors_max") or 0), 1000))
    if conditions.get("tool_calls_min") is not None:
        out["tool_calls_min"] = max(0, min(int(conditions.get("tool_calls_min") or 0), 10_000))
    if conditions.get("tool_calls_max") is not None:
        out["tool_calls_max"] = max(0, min(int(conditions.get("tool_calls_max") or 0), 10_000))
    if conditions.get("sources_count_min") is not None:
        out["sources_count_min"] = max(0, min(int(conditions.get("sources_count_min") or 0), 10_000))
    if conditions.get("sources_count_max") is not None:
        out["sources_count_max"] = max(0, min(int(conditions.get("sources_count_max") or 0), 10_000))

    if conditions.get("failed_connectors_min") is not None:
        out["failed_connectors_min"] = max(0, min(int(conditions.get("failed_connectors_min") or 0), 1000))
    if conditions.get("failed_connectors_max") is not None:
        out["failed_connectors_max"] = max(0, min(int(conditions.get("failed_connectors_max") or 0), 1000))

    if conditions.get("pending_user_input_is") is not None:
        out["pending_user_input_is"] = bool(conditions.get("pending_user_input_is"))
    if conditions.get("grounded_is") is not None:
        out["grounded_is"] = bool(conditions.get("grounded_is"))

    llm_provider_in = _normalize_str_list(conditions.get("llm_provider_in"), max_items=16)
    if llm_provider_in:
        out["llm_provider_in"] = [x.lower() for x in llm_provider_in]
    llm_model_in = _normalize_str_list(conditions.get("llm_model_in"), max_items=24)
    if llm_model_in:
        out["llm_model_in"] = llm_model_in

    question_regex = str(conditions.get("question_regex") or "").strip()
    if question_regex:
        try:
            re.compile(question_regex)
        except re.error as err:
            raise ValueError(f"Invalid conditions.question_regex: {err}") from err
        out["question_regex"] = question_regex

    return out


def _normalize_run_access(raw: str | None) -> str:
    value = str(raw or "member_runnable").strip().lower() or "member_runnable"
    if value not in AUTOMATION_RUN_ACCESS_TYPES:
        raise ValueError(f"Invalid run_access: {value}")
    return value


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
    trigger_type = str(trigger.get("type") or "")
    now = base or _now()

    if trigger_type == "schedule":
        interval = max(1, min(int(trigger.get("interval_minutes") or 60), 24 * 30))
        return now + timedelta(minutes=interval)

    if trigger_type == "daily":
        hour = max(0, min(int(trigger.get("hour") or 9), 23))
        minute = max(0, min(int(trigger.get("minute") or 0), 59))
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate = candidate + timedelta(days=1)
        return candidate

    if trigger_type == "weekly":
        hour = max(0, min(int(trigger.get("hour") or 9), 23))
        minute = max(0, min(int(trigger.get("minute") or 0), 59))
        weekdays = _normalize_weekdays(trigger.get("weekdays"))
        day_to_idx = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
        target_idxs = {day_to_idx[item] for item in weekdays if item in day_to_idx}
        if not target_idxs:
            target_idxs = {0, 1, 2, 3, 4}
        for delta in range(0, 8):
            candidate_day = now + timedelta(days=delta)
            if candidate_day.weekday() not in target_idxs:
                continue
            candidate = candidate_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > now:
                return candidate
        return None

    if trigger_type == "once":
        run_at = _parse_iso_datetime(str(trigger.get("run_at") or ""))
        if not run_at:
            return None
        return run_at if run_at > now else None

    return None


async def _resolve_project_role(project_id: str, user_id: str) -> str:
    uid = str(user_id or "").strip()
    if not uid:
        return "viewer"

    db = get_db()
    project_ids: list[str] = []
    seen_project_ids: set[str] = set()
    for value in [project_id]:
        v = str(value or "").strip()
        if not v or v in seen_project_ids:
            continue
        seen_project_ids.add(v)
        project_ids.append(v)

    if project_id and not ObjectId.is_valid(project_id):
        by_key = await db["projects"].find_one({"key": project_id}, {"_id": 1})
        if isinstance(by_key, dict) and by_key.get("_id") is not None:
            resolved = str(by_key.get("_id"))
            if resolved not in seen_project_ids:
                seen_project_ids.add(resolved)
                project_ids.append(resolved)

    user_doc = await db["users"].find_one({"email": uid}, {"_id": 1, "isGlobalAdmin": 1})
    if not user_doc and ObjectId.is_valid(uid):
        user_doc = await db["users"].find_one({"_id": ObjectId(uid)}, {"_id": 1, "isGlobalAdmin": 1, "email": 1})
    if isinstance(user_doc, dict) and bool(user_doc.get("isGlobalAdmin")):
        return "admin"

    user_candidates: list[str] = [uid]
    if isinstance(user_doc, dict) and user_doc.get("_id") is not None:
        user_candidates.append(str(user_doc.get("_id")))

    membership = await db["memberships"].find_one(
        {"projectId": {"$in": project_ids}, "userId": {"$in": user_candidates}},
        {"role": 1},
    )
    if isinstance(membership, dict):
        role = str(membership.get("role") or "").strip().lower()
        if role in {"admin", "member", "viewer"}:
            return role
    return "viewer"


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
    checks: list[bool] = []

    keywords = conditions.get("keyword_contains")
    if isinstance(keywords, list) and keywords:
        checks.append(any(str(k).strip().lower() in text_blob for k in keywords))

    excluded = conditions.get("keyword_excludes")
    if isinstance(excluded, list) and excluded:
        checks.append(not any(str(k).strip().lower() in text_blob for k in excluded))

    answer_contains = conditions.get("answer_contains")
    if isinstance(answer_contains, list) and answer_contains:
        answer_text = str(payload.get("answer") or "").lower()
        checks.append(any(str(k).strip().lower() in answer_text for k in answer_contains))

    question_regex = str(conditions.get("question_regex") or "").strip()
    if question_regex:
        question = str(payload.get("question") or "")
        try:
            checks.append(bool(re.search(question_regex, question, flags=re.IGNORECASE)))
        except re.error:
            checks.append(False)

    branch_in = conditions.get("branch_in")
    if isinstance(branch_in, list) and branch_in:
        branch = str(payload.get("branch") or "").strip()
        checks.append(branch in {str(x).strip() for x in branch_in if str(x).strip()})

    user_in = conditions.get("user_in")
    if isinstance(user_in, list) and user_in:
        user = str(payload.get("user_id") or "").strip()
        checks.append(user in {str(x).strip() for x in user_in if str(x).strip()})

    tool_errors = int(payload.get("tool_errors") or 0)
    tool_errors_min = conditions.get("tool_errors_min")
    if tool_errors_min is not None:
        checks.append(tool_errors >= int(tool_errors_min))
    tool_errors_max = conditions.get("tool_errors_max")
    if tool_errors_max is not None:
        checks.append(tool_errors <= int(tool_errors_max))

    tool_calls = int(payload.get("tool_calls") or 0)
    tool_calls_min = conditions.get("tool_calls_min")
    if tool_calls_min is not None:
        checks.append(tool_calls >= int(tool_calls_min))
    tool_calls_max = conditions.get("tool_calls_max")
    if tool_calls_max is not None:
        checks.append(tool_calls <= int(tool_calls_max))

    sources_count = int(payload.get("sources_count") or 0)
    sources_count_min = conditions.get("sources_count_min")
    if sources_count_min is not None:
        checks.append(sources_count >= int(sources_count_min))
    sources_count_max = conditions.get("sources_count_max")
    if sources_count_max is not None:
        checks.append(sources_count <= int(sources_count_max))

    failed_connectors = int(payload.get("failed_connectors") or 0)
    failed_connectors_min = conditions.get("failed_connectors_min")
    if failed_connectors_min is not None:
        checks.append(failed_connectors >= int(failed_connectors_min))
    failed_connectors_max = conditions.get("failed_connectors_max")
    if failed_connectors_max is not None:
        checks.append(failed_connectors <= int(failed_connectors_max))

    if conditions.get("pending_user_input_is") is not None:
        checks.append(bool(payload.get("pending_user_input")) is bool(conditions.get("pending_user_input_is")))
    if conditions.get("grounded_is") is not None:
        checks.append(bool(payload.get("grounded")) is bool(conditions.get("grounded_is")))

    llm_provider_in = conditions.get("llm_provider_in")
    if isinstance(llm_provider_in, list) and llm_provider_in:
        provider = str(payload.get("llm_provider") or "").strip().lower()
        checks.append(provider in {str(x).strip().lower() for x in llm_provider_in if str(x).strip()})

    llm_model_in = conditions.get("llm_model_in")
    if isinstance(llm_model_in, list) and llm_model_in:
        model = str(payload.get("llm_model") or "").strip()
        checks.append(model in {str(x).strip() for x in llm_model_in if str(x).strip()})

    if not checks:
        return True

    match_mode = str(conditions.get("match_mode") or "all").strip().lower()
    if match_mode == "any":
        return any(checks)
    return all(checks)


def _trigger_matches(trigger: dict[str, Any], *, triggered_by: str, event_type: str) -> bool:
    trigger_type = str(trigger.get("type") or "")
    if trigger_type == "manual":
        return triggered_by == "manual"
    if trigger_type in {"schedule", "daily", "weekly", "once"}:
        return triggered_by == "schedule"
    if trigger_type == "event":
        expected = _normalize_event_type(trigger.get("event_type"))
        actual = _normalize_event_type(event_type)
        return triggered_by == "event" and actual == expected
    return False


async def list_automation_templates() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in AUTOMATION_TEMPLATES:
        row = dict(item)
        row["run_access"] = _normalize_run_access(str(row.get("run_access") or "member_runnable"))
        out.append(row)
    return out


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
    run_access: str = "member_runnable",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("name is required")
    normalized_trigger = _normalize_trigger(trigger)
    normalized_action = _normalize_action(action)
    normalized_conditions = _normalize_conditions(conditions)
    normalized_run_access = _normalize_run_access(run_access)
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
        "run_access": normalized_run_access,
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
    if "run_access" in patch:
        next_doc["run_access"] = _normalize_run_access(str(patch.get("run_access") or "member_runnable"))
    if "tags" in patch:
        next_doc["tags"] = _coerce_tags(patch.get("tags") if isinstance(patch.get("tags"), list) else [])

    now = _now()
    next_doc["updated_at"] = now
    next_doc["updated_by"] = str(user_id or "").strip()
    if not bool(next_doc.get("enabled")):
        next_doc["next_run_at"] = None
    elif str((next_doc.get("trigger") or {}).get("type") or "") in {"schedule", "daily", "weekly", "once"}:
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
    if doc["status"] not in VALID_STATUS_SET:
        doc["status"] = "open"
    res = await get_db()["chat_tasks"].insert_one(doc)
    task_id = str(res.inserted_id)
    try:
        await dispatch_automation_event(
            project_id,
            event_type="chat_task_created",
            payload={
                "project_id": project_id,
                "chat_id": chat_id,
                "task_id": task_id,
                "task_title": title,
                "task_status": doc.get("status"),
                "user_id": str(payload.get("user_id") or ""),
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception("automations.action.create_chat_task.dispatch_failed project=%s task_id=%s", project_id, task_id)
    return {"task_id": task_id, "title": title, "chat_id": chat_id}


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
    try:
        await dispatch_automation_event(
            project_id,
            event_type="chat_message_appended",
            payload={
                "project_id": project_id,
                "chat_id": chat_id,
                "branch": str(payload.get("branch") or ""),
                "user_id": str(payload.get("user_id") or ""),
                "message_role": role,
                "message_content": content,
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception(
            "automations.action.append_chat_message.dispatch_failed project=%s chat_id=%s",
            project_id,
            chat_id,
        )
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
    try:
        await dispatch_automation_event(
            project_id,
            event_type="user_input_requested",
            payload={
                "project_id": project_id,
                "chat_id": chat_id,
                "pending_question_id": pending_id,
                "question": question,
                "answer_mode": answer_mode,
                "options_count": len(options),
                "user_id": str(payload.get("user_id") or ""),
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception(
            "automations.action.request_user_input.dispatch_failed project=%s chat_id=%s",
            project_id,
            chat_id,
        )
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
    try:
        await dispatch_automation_event(
            project_id,
            event_type="ingestion_completed",
            payload={
                "project_id": project_id,
                "mode": "incremental",
                "requested_connectors": connectors_filter,
                "stats": stats,
                "user_id": str(payload.get("user_id") or ""),
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception("automations.action.run_incremental_ingestion.dispatch_failed project=%s", project_id)
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
    files_written = result.get("files_written") if isinstance(result.get("files_written"), list) else []
    try:
        await dispatch_automation_event(
            project_id,
            event_type="documentation_generated",
            payload={
                "project_id": project_id,
                "branch": str(result.get("branch") or ""),
                "mode": str(result.get("mode") or ""),
                "files_written_count": len(files_written),
                "summary": str(result.get("summary") or ""),
                "user_id": user_id,
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception("automations.action.generate_documentation.dispatch_failed project=%s", project_id)
    return {
        "branch": str(result.get("branch") or ""),
        "mode": str(result.get("mode") or ""),
        "files_written": files_written,
        "summary": str(result.get("summary") or ""),
    }


async def _action_update_chat_task(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    db = get_db()
    task_id = str(params.get("task_id") or "").strip()
    chat_id = str(params.get("chat_id") or payload.get("chat_id") or "").strip() or None
    row: dict[str, Any] | None = None
    if task_id:
        q: dict[str, Any] = {"project_id": project_id}
        if ObjectId.is_valid(task_id):
            q["_id"] = ObjectId(task_id)
        else:
            q["id"] = task_id
        found = await db["chat_tasks"].find_one(q)
        row = found if isinstance(found, dict) else None
    else:
        title_contains = str(params.get("task_title_contains") or "").strip()
        if not title_contains:
            raise RuntimeError("update_chat_task action requires params.task_id or params.task_title_contains")
        q = {"project_id": project_id, "title": {"$regex": re.escape(title_contains), "$options": "i"}}
        if chat_id:
            q["$or"] = [{"chat_id": chat_id}, {"chat_id": None}, {"chat_id": ""}, {"chat_id": {"$exists": False}}]
        found = await db["chat_tasks"].find_one(q, sort=[("updated_at", -1)])
        row = found if isinstance(found, dict) else None
    if not isinstance(row, dict):
        raise RuntimeError("Task not found for update_chat_task")

    updates: dict[str, Any] = {}
    if params.get("title") is not None:
        title = str(params.get("title") or "").strip()
        if not title:
            raise RuntimeError("update_chat_task params.title must not be empty")
        updates["title"] = title
    if params.get("details") is not None:
        details = str(params.get("details") or "").strip()
        if bool(params.get("append_details")) and details:
            current = str(row.get("details") or "").strip()
            if current:
                details = f"{current}\n\n{details}"
        updates["details"] = details
    if params.get("status") is not None:
        status = str(params.get("status") or "").strip().lower()
        if status not in VALID_STATUS_SET:
            raise RuntimeError("update_chat_task params.status must be a valid task status")
        updates["status"] = status
    if params.get("assignee") is not None:
        updates["assignee"] = str(params.get("assignee") or "").strip() or None
    if params.get("due_date") is not None:
        updates["due_date"] = str(params.get("due_date") or "").strip() or None
    if not updates:
        raise RuntimeError("update_chat_task requires at least one mutable field")

    updates["updated_at"] = _iso(started_at)
    await db["chat_tasks"].update_one({"_id": row["_id"]}, {"$set": updates})
    task_id_out = str(row.get("_id") or "")
    try:
        await dispatch_automation_event(
            project_id,
            event_type="chat_task_updated",
            payload={
                "project_id": project_id,
                "chat_id": str(row.get("chat_id") or chat_id or ""),
                "task_id": task_id_out,
                "task_status": str(updates.get("status") or row.get("status") or ""),
                "task_title": str(updates.get("title") or row.get("title") or ""),
                "user_id": str(payload.get("user_id") or ""),
            },
            skip_automation_id=str(payload.get("_automation_origin") or ""),
        )
    except Exception:
        logger.exception("automations.action.update_chat_task.dispatch_failed project=%s task_id=%s", project_id, task_id_out)
    return {"task_id": task_id_out, "updated_fields": sorted([k for k in updates if k != "updated_at"])}


async def _action_set_chat_title(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    title = str(params.get("title") or "").strip()
    if not title:
        raise RuntimeError("set_chat_title action requires params.title")
    chat_id = str(params.get("chat_id") or payload.get("chat_id") or "").strip()
    if not chat_id:
        fallback_chat_id = await _resolve_default_chat_id(project_id)
        chat_id = fallback_chat_id or ""
    if not chat_id:
        raise RuntimeError("set_chat_title action requires chat_id (or an existing chat)")
    res = await get_db()["chats"].update_one(
        {"chat_id": chat_id, "project_id": project_id},
        {"$set": {"title": title, "updated_at": started_at}},
    )
    if res.matched_count == 0:
        raise RuntimeError("Chat not found for set_chat_title")
    return {"chat_id": chat_id, "title": title}


async def _action_dispatch_event(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    _ = started_at
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    event_type = _normalize_event_type(params.get("event_type"))
    event_payload = params.get("payload") if isinstance(params.get("payload"), dict) else {}
    outgoing = {
        "project_id": project_id,
        "chat_id": str(payload.get("chat_id") or ""),
        "branch": str(payload.get("branch") or ""),
        "user_id": str(payload.get("user_id") or ""),
        "source": "automation_dispatch_event_action",
        **event_payload,
    }
    runs = await dispatch_automation_event(
        project_id,
        event_type=event_type,
        payload=outgoing,
        skip_automation_id=str(payload.get("_automation_origin") or ""),
    )
    return {"event_type": event_type, "runs": len(runs)}


async def _action_run_automation(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
    current_automation_id: str,
) -> dict[str, Any]:
    _ = started_at
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    target_id = str(params.get("automation_id") or "").strip()
    target_name = str(params.get("automation_name") or "").strip()
    if not target_id and not target_name:
        raise RuntimeError("run_automation action requires params.automation_id or params.automation_name")

    db = get_db()
    target_doc: dict[str, Any] | None = None
    if target_id and ObjectId.is_valid(target_id):
        row = await db["automations"].find_one({"_id": ObjectId(target_id), "project_id": project_id})
        target_doc = row if isinstance(row, dict) else None
    elif target_id:
        row = await db["automations"].find_one({"project_id": project_id, "name": target_id})
        target_doc = row if isinstance(row, dict) else None
    if not target_doc and target_name:
        row = await db["automations"].find_one({"project_id": project_id, "name": target_name})
        target_doc = row if isinstance(row, dict) else None
    if not isinstance(target_doc, dict):
        raise RuntimeError("run_automation target not found")

    target_automation_id = str(target_doc.get("_id") or "")
    if target_automation_id == current_automation_id:
        raise RuntimeError("run_automation action cannot target itself")

    depth = max(0, int(payload.get("_automation_depth") or 0))
    if depth >= 6:
        raise RuntimeError("run_automation nested depth limit reached")
    action_payload = params.get("payload") if isinstance(params.get("payload"), dict) else {}
    next_payload = {
        **payload,
        **action_payload,
        "_automation_depth": depth + 1,
        "_automation_origin": str(payload.get("_automation_origin") or current_automation_id),
    }
    out = await run_automation(
        project_id,
        target_automation_id,
        triggered_by="manual",
        event_type="manual",
        event_payload=next_payload,
        user_id=str(payload.get("user_id") or ""),
        dry_run=bool(params.get("dry_run")),
    )
    return {"automation_id": target_automation_id, "run_id": str(out.get("id") or ""), "status": str(out.get("status") or "")}


async def _action_set_automation_enabled(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
    current_automation_id: str,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    target_id = str(params.get("automation_id") or "").strip()
    target_name = str(params.get("automation_name") or "").strip()
    enabled = bool(params.get("enabled"))
    if not target_id and not target_name:
        raise RuntimeError("set_automation_enabled action requires params.automation_id or params.automation_name")
    q: dict[str, Any] = {"project_id": project_id}
    if target_id and ObjectId.is_valid(target_id):
        q["_id"] = ObjectId(target_id)
    elif target_id:
        q["name"] = target_id
    elif target_name:
        q["name"] = target_name

    row = await get_db()["automations"].find_one(q)
    if not isinstance(row, dict):
        raise RuntimeError("set_automation_enabled target not found")
    row_id = str(row.get("_id") or "")
    if row_id == current_automation_id:
        raise RuntimeError("set_automation_enabled cannot target itself")

    trigger = row.get("trigger") if isinstance(row.get("trigger"), dict) else {}
    next_run_at = _next_scheduled_run(trigger, base=started_at) if enabled else None
    await get_db()["automations"].update_one(
        {"_id": row["_id"]},
        {"$set": {"enabled": enabled, "next_run_at": next_run_at, "updated_at": started_at}},
    )
    return {"automation_id": row_id, "enabled": enabled}


async def _action_upsert_state_value(
    *,
    project_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    params = _render_template((action.get("params") if isinstance(action.get("params"), dict) else {}), payload)
    key = str(params.get("key") or "").strip()
    if not key:
        raise RuntimeError("upsert_state_value action requires params.key")
    value = params.get("value")
    await get_db()["automation_state"].update_one(
        {"project_id": project_id, "key": key},
        {
            "$set": {
                "value": value,
                "updated_at": started_at,
                "updated_by": str(payload.get("user_id") or ""),
            },
            "$setOnInsert": {"created_at": started_at},
        },
        upsert=True,
    )
    return {"key": key, "value": value}


async def _execute_action(
    *,
    project_id: str,
    automation_id: str,
    action: dict[str, Any],
    payload: dict[str, Any],
    started_at: datetime,
) -> dict[str, Any]:
    action_type = str(action.get("type") or "")
    if action_type == "create_chat_task":
        return await _action_create_chat_task(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "update_chat_task":
        return await _action_update_chat_task(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "append_chat_message":
        return await _action_append_chat_message(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "set_chat_title":
        return await _action_set_chat_title(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "request_user_input":
        return await _action_request_user_input(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "run_incremental_ingestion":
        return await _action_run_incremental_ingestion(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "generate_documentation":
        return await _action_generate_documentation(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "dispatch_event":
        return await _action_dispatch_event(project_id=project_id, action=action, payload=payload, started_at=started_at)
    if action_type == "run_automation":
        return await _action_run_automation(
            project_id=project_id,
            action=action,
            payload=payload,
            started_at=started_at,
            current_automation_id=automation_id,
        )
    if action_type == "set_automation_enabled":
        return await _action_set_automation_enabled(
            project_id=project_id,
            action=action,
            payload=payload,
            started_at=started_at,
            current_automation_id=automation_id,
        )
    if action_type == "upsert_state_value":
        return await _action_upsert_state_value(project_id=project_id, action=action, payload=payload, started_at=started_at)
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
    user_id: str | None = None,
    dry_run: bool = False,
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
    payload.setdefault("user_id", str(user_id or "").strip())
    payload.setdefault("_automation_depth", 0)
    payload.setdefault("_automation_origin", str(doc.get("_id") or ""))

    trigger = doc.get("trigger") if isinstance(doc.get("trigger"), dict) else {}
    force_manual = triggered_by == "manual"
    if not force_manual and not _trigger_matches(trigger, triggered_by=triggered_by, event_type=event_type):
        raise RuntimeError("Automation trigger does not match this execution mode")
    if not force_manual and not _conditions_match(doc.get("conditions") if isinstance(doc.get("conditions"), dict) else {}, payload):
        raise RuntimeError("Automation conditions did not match the event payload")

    run_access = _normalize_run_access(str(doc.get("run_access") or "member_runnable"))
    if force_manual:
        role = await _resolve_project_role(project_id, str(payload.get("user_id") or ""))
        if run_access == "admin_only" and role != "admin":
            raise PermissionError("Automation is admin-only and cannot be run by this user")
        if run_access == "member_runnable" and role not in {"admin", "member"}:
            raise PermissionError("Only project members can run this automation")

    cooldown_sec = max(0, int(doc.get("cooldown_sec") or 0))
    last_run_at = doc.get("last_run_at")
    now = _now()
    if not dry_run and cooldown_sec > 0 and isinstance(last_run_at, datetime):
        next_allowed = last_run_at + timedelta(seconds=cooldown_sec)
        if now < next_allowed:
            raise RuntimeError("Automation cooldown active")

    status = "dry_run" if dry_run else "succeeded"
    error = ""
    result: dict[str, Any] = {}
    started_at = now
    action_doc = doc.get("action") if isinstance(doc.get("action"), dict) else {}
    if dry_run:
        rendered_params = _render_template(
            action_doc.get("params") if isinstance(action_doc.get("params"), dict) else {},
            payload,
        )
        result = {
            "dry_run": True,
            "run_access": run_access,
            "action_type": str(action_doc.get("type") or ""),
            "rendered_action": {"type": str(action_doc.get("type") or ""), "params": rendered_params},
            "conditions_match": _conditions_match(
                doc.get("conditions") if isinstance(doc.get("conditions"), dict) else {},
                payload,
            ),
        }
    else:
        try:
            result = await _execute_action(
                project_id=project_id,
                automation_id=str(doc.get("_id") or ""),
                action=action_doc,
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
    if not dry_run:
        update_doc: dict[str, Any] = {
            "last_run_at": finished_at,
            "last_status": status,
            "last_error": error,
            "updated_at": finished_at,
            "run_count": int(doc.get("run_count") or 0) + 1,
        }
        trigger_type = str(trigger.get("type") or "")
        if trigger_type == "once":
            update_doc["next_run_at"] = None
            update_doc["enabled"] = False
        elif trigger_type in {"schedule", "daily", "weekly"} and bool(doc.get("enabled")):
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
    if not dry_run:
        emitted_event = "automation_run_failed" if status == "failed" else "automation_run_succeeded"
        try:
            await dispatch_automation_event(
                project_id,
                event_type=emitted_event,
                payload={
                    "project_id": project_id,
                    "automation_id": str(doc.get("_id") or ""),
                    "automation_name": str(doc.get("name") or ""),
                    "status": status,
                    "triggered_by": triggered_by,
                    "event_type": event_type,
                    "error": error,
                    "user_id": str(payload.get("user_id") or ""),
                    "branch": str(payload.get("branch") or ""),
                    "chat_id": str(payload.get("chat_id") or ""),
                },
                skip_automation_id=str(doc.get("_id") or ""),
            )
        except Exception:
            logger.exception(
                "automations.run.dispatch_failed project=%s automation_id=%s event=%s",
                project_id,
                str(doc.get("_id") or ""),
                emitted_event,
            )
    return run_row


async def dispatch_automation_event(
    project_id: str,
    *,
    event_type: str,
    payload: dict[str, Any] | None = None,
    skip_automation_id: str | None = None,
) -> list[dict[str, Any]]:
    try:
        normalized_event_type = _normalize_event_type(event_type)
    except ValueError:
        return []
    base_payload = dict(payload or {})
    base_payload.setdefault("project_id", project_id)
    rows = await get_db()["automations"].find(
        {
            "project_id": project_id,
            "enabled": True,
            "trigger.type": "event",
            "trigger.event_type": normalized_event_type,
        }
    ).to_list(length=500)
    out: list[dict[str, Any]] = []
    skip_id = str(skip_automation_id or "").strip()
    for row in rows:
        if not isinstance(row, dict):
            continue
        if skip_id and str(row.get("_id") or "") == skip_id:
            continue
        conditions = row.get("conditions") if isinstance(row.get("conditions"), dict) else {}
        if not _conditions_match(conditions, base_payload):
            continue
        try:
            run_row = await run_automation(
                project_id,
                str(row.get("_id") or ""),
                triggered_by="event",
                event_type=normalized_event_type,
                event_payload=base_payload,
            )
            out.append(run_row)
        except Exception:
            logger.exception(
                "automations.dispatch_event_failed project=%s automation_id=%s event=%s",
                project_id,
                str(row.get("_id") or ""),
                normalized_event_type,
            )
    return out


async def run_due_scheduled_automations(*, limit: int = 20) -> int:
    now = _now()
    rows = await get_db()["automations"].find(
        {
            "enabled": True,
            "trigger.type": {"$in": ["schedule", "daily", "weekly", "once"]},
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
                event_type="schedule",
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
