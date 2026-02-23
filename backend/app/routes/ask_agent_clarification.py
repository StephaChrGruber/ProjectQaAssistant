from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from fastapi import HTTPException

_CONTINUE_INTENT_MARKERS = (
    "continue",
    "go on",
    "proceed",
    "carry on",
    "next",
    "use assumptions",
)
_CONFLICT_SIGNAL_MARKERS = (
    "actually",
    "correction",
    "updated",
    "update",
    "changed",
    "instead",
    "not anymore",
    "different",
    "clarification",
)
_DESTRUCTIVE_INTENT_MARKERS = (
    "commit",
    "push",
    "pull",
    "checkout",
    "switch branch",
    "create branch",
    "delete",
    "remove",
    "overwrite",
    "write",
    "update docs",
    "create issue",
)


def as_text(v: Any) -> str:
    return str(v or "").strip()


def iso_utc(dt: datetime | None = None) -> str:
    value = dt or datetime.utcnow()
    return value.isoformat() + "Z"


def normalize_question_key(question: str) -> str:
    text = as_text(question).lower()
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[^a-z0-9 _:/?.,()-]", "", text)
    return text[:220]


def looks_like_continue_request(text: str) -> bool:
    q = as_text(text).lower()
    if not q:
        return False
    if q in {"ok", "continue", "go on", "proceed", "next"}:
        return True
    return any(marker in q for marker in _CONTINUE_INTENT_MARKERS)


def has_conflict_signal(text: str) -> bool:
    q = as_text(text).lower()
    if not q:
        return False
    return any(marker in q for marker in _CONFLICT_SIGNAL_MARKERS)


def looks_destructive_intent(text: str) -> bool:
    q = as_text(text).lower()
    if not q:
        return False
    return any(marker in q for marker in _DESTRUCTIVE_INTENT_MARKERS)


def _goal_id_from_text(text: str) -> str:
    norm = normalize_question_key(text) or as_text(text).lower()
    if not norm:
        norm = "goal"
    digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]
    return f"goal_{digest}"


def derive_goal_id(
    *,
    user_text: str,
    active_goal_id: str | None = None,
    pending_goal_id: str | None = None,
    continue_intent: bool = False,
) -> str:
    pending = as_text(pending_goal_id)
    if pending:
        return pending
    active = as_text(active_goal_id)
    if continue_intent and active:
        return active
    q = as_text(user_text)
    if not q and active:
        return active
    if active and len(q) <= 40 and not any(token in q.lower() for token in ("create", "delete", "change", "switch", "new")):
        return active
    return _goal_id_from_text(q)


def normalize_clarification_state(raw: Any) -> dict[str, Any]:
    state = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {
        "active_goal_id": as_text(state.get("active_goal_id")),
        "goals": [],
        "updated_at": as_text(state.get("updated_at")) or iso_utc(),
    }

    goals_raw = state.get("goals")
    seen: set[str] = set()
    if isinstance(goals_raw, list):
        for item in goals_raw:
            if not isinstance(item, dict):
                continue
            goal_id = as_text(item.get("goal_id"))
            if not goal_id or goal_id in seen:
                continue
            seen.add(goal_id)

            open_rows: list[dict[str, Any]] = []
            for row in item.get("open_questions") or []:
                if not isinstance(row, dict):
                    continue
                row_id = as_text(row.get("id"))
                if not row_id:
                    continue
                open_rows.append(
                    {
                        "id": row_id,
                        "question": as_text(row.get("question")),
                        "question_key": as_text(row.get("question_key"))
                        or normalize_question_key(as_text(row.get("question"))),
                        "created_at": as_text(row.get("created_at")) or iso_utc(),
                    }
                )
                if len(open_rows) >= 24:
                    break

            answered_rows: list[dict[str, Any]] = []
            for row in item.get("answered_questions") or []:
                if not isinstance(row, dict):
                    continue
                answered_rows.append(
                    {
                        "id": as_text(row.get("id")),
                        "question": as_text(row.get("question")),
                        "question_key": as_text(row.get("question_key"))
                        or normalize_question_key(as_text(row.get("question"))),
                        "answer": as_text(row.get("answer")),
                        "answered_at": as_text(row.get("answered_at")) or iso_utc(),
                    }
                )
                if len(answered_rows) >= 64:
                    break

            try:
                asked_count = int(item.get("asked_count") or 0)
            except Exception:
                asked_count = 0
            try:
                answered_count = int(item.get("answered_count") or 0)
            except Exception:
                answered_count = 0

            out["goals"].append(
                {
                    "goal_id": goal_id,
                    "goal_text": as_text(item.get("goal_text")),
                    "created_at": as_text(item.get("created_at")) or iso_utc(),
                    "updated_at": as_text(item.get("updated_at")) or iso_utc(),
                    "asked_count": max(0, asked_count),
                    "answered_count": max(0, answered_count),
                    "open_questions": open_rows,
                    "answered_questions": answered_rows,
                    "blocked_reason": as_text(item.get("blocked_reason")) or None,
                }
            )
            if len(out["goals"]) >= 24:
                break
    return out


def goal_ref(state: dict[str, Any], goal_id: str, *, goal_text: str = "") -> dict[str, Any]:
    goals = state.get("goals")
    if not isinstance(goals, list):
        goals = []
        state["goals"] = goals
    for item in goals:
        if isinstance(item, dict) and as_text(item.get("goal_id")) == goal_id:
            item["updated_at"] = iso_utc()
            if goal_text and not as_text(item.get("goal_text")):
                item["goal_text"] = goal_text[:240]
            return item
    row = {
        "goal_id": goal_id,
        "goal_text": as_text(goal_text)[:240],
        "created_at": iso_utc(),
        "updated_at": iso_utc(),
        "asked_count": 0,
        "answered_count": 0,
        "open_questions": [],
        "answered_questions": [],
        "blocked_reason": None,
    }
    goals.insert(0, row)
    del goals[24:]
    return row


def latest_answer_for_question(goal: dict[str, Any], question_key: str) -> str | None:
    key = as_text(question_key)
    if not key:
        return None
    rows = goal.get("answered_questions")
    if not isinstance(rows, list):
        return None
    for row in reversed(rows):
        if not isinstance(row, dict):
            continue
        if as_text(row.get("question_key")) != key:
            continue
        answer = as_text(row.get("answer"))
        if answer:
            return answer
    return None


def record_answered_pending_question(
    state: dict[str, Any],
    *,
    goal_id: str,
    pending_question: dict[str, Any],
    answer: str,
) -> None:
    goal = goal_ref(state, goal_id, goal_text=as_text(pending_question.get("question")))
    pending_id = as_text(pending_question.get("id"))
    question = as_text(pending_question.get("question"))
    question_key = as_text(pending_question.get("question_key")) or normalize_question_key(question)

    open_rows = goal.get("open_questions")
    if not isinstance(open_rows, list):
        open_rows = []
        goal["open_questions"] = open_rows
    goal["open_questions"] = [
        row
        for row in open_rows
        if isinstance(row, dict)
        and as_text(row.get("id")) != pending_id
        and as_text(row.get("question_key")) != question_key
    ]

    answered_rows = goal.get("answered_questions")
    if not isinstance(answered_rows, list):
        answered_rows = []
        goal["answered_questions"] = answered_rows
    answered_rows.append(
        {
            "id": pending_id,
            "question": question,
            "question_key": question_key,
            "answer": as_text(answer),
            "answered_at": iso_utc(),
        }
    )
    del answered_rows[:-64]
    goal["answered_count"] = max(0, int(goal.get("answered_count") or 0) + 1)
    goal["blocked_reason"] = None
    goal["updated_at"] = iso_utc()
    state["active_goal_id"] = goal_id
    state["updated_at"] = iso_utc()


def record_open_question(
    state: dict[str, Any],
    *,
    goal_id: str,
    pending_question: dict[str, Any],
    budget_per_goal: int,
) -> tuple[bool, str]:
    goal = goal_ref(state, goal_id, goal_text=as_text(pending_question.get("question")))
    question = as_text(pending_question.get("question"))
    question_key = as_text(pending_question.get("question_key")) or normalize_question_key(question)
    pending_id = as_text(pending_question.get("id"))

    if latest_answer_for_question(goal, question_key):
        goal["blocked_reason"] = "repeat_question_already_answered"
        goal["updated_at"] = iso_utc()
        state["updated_at"] = iso_utc()
        return False, "repeat_question_already_answered"

    open_rows = goal.get("open_questions")
    if not isinstance(open_rows, list):
        open_rows = []
        goal["open_questions"] = open_rows
    for row in open_rows:
        if not isinstance(row, dict):
            continue
        if as_text(row.get("question_key")) == question_key:
            row["id"] = pending_id
            row["question"] = question
            row["created_at"] = as_text(row.get("created_at")) or iso_utc()
            goal["updated_at"] = iso_utc()
            goal["blocked_reason"] = None
            state["updated_at"] = iso_utc()
            return True, "already_open"

    asked_count = max(0, int(goal.get("asked_count") or 0))
    if asked_count >= max(1, budget_per_goal):
        goal["blocked_reason"] = "clarification_budget_exhausted"
        goal["updated_at"] = iso_utc()
        state["updated_at"] = iso_utc()
        return False, "clarification_budget_exhausted"

    open_rows.append(
        {
            "id": pending_id,
            "question": question,
            "question_key": question_key,
            "created_at": iso_utc(),
        }
    )
    del open_rows[:-24]
    goal["asked_count"] = asked_count + 1
    goal["blocked_reason"] = None
    goal["updated_at"] = iso_utc()
    state["active_goal_id"] = goal_id
    state["updated_at"] = iso_utc()
    return True, "recorded"


def normalize_pending_user_question(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pending_id = as_text(raw.get("id"))
    question = as_text(raw.get("question"))
    if not pending_id or not question:
        return None

    mode = as_text(raw.get("answer_mode")).lower()
    answer_mode = "single_choice" if mode == "single_choice" else "open_text"

    options: list[str] = []
    seen: set[str] = set()
    for item in raw.get("options") or []:
        s = as_text(item)
        if not s:
            continue
        key = s.casefold()
        if key in seen:
            continue
        seen.add(key)
        options.append(s)
        if len(options) >= 12:
            break
    if answer_mode == "single_choice" and len(options) < 2:
        answer_mode = "open_text"
        options = []

    out: dict[str, Any] = {
        "id": pending_id,
        "question": question,
        "answer_mode": answer_mode,
        "options": options,
    }
    goal_id = as_text(raw.get("goal_id"))
    if goal_id:
        out["goal_id"] = goal_id
    question_key = as_text(raw.get("question_key")) or normalize_question_key(question)
    if question_key:
        out["question_key"] = question_key
    repeat_of = as_text(raw.get("repeat_of"))
    if repeat_of:
        out["repeat_of"] = repeat_of
    created = raw.get("created_at")
    if isinstance(created, datetime):
        out["created_at"] = created.isoformat() + "Z"
    else:
        created_text = as_text(created)
        if created_text:
            out["created_at"] = created_text
    return out


def resolve_pending_user_answer(req: Any, pending: dict[str, Any]) -> str:
    requested_pending_id = as_text(getattr(req, "pending_question_id", None))
    active_pending_id = as_text(pending.get("id"))
    if requested_pending_id and requested_pending_id != active_pending_id:
        raise HTTPException(
            status_code=409,
            detail="The pending question changed. Reload chat and answer the latest prompt.",
        )

    raw_answer = as_text(getattr(req, "pending_answer", None) or getattr(req, "question", None))
    mode = as_text(pending.get("answer_mode")).lower()
    if mode == "single_choice":
        options = [str(x).strip() for x in (pending.get("options") or []) if str(x).strip()]
        if not options:
            raise HTTPException(status_code=500, detail="Pending choice question has no options")
        if not raw_answer:
            raise HTTPException(status_code=400, detail="Select one of the provided options")
        match = next((opt for opt in options if opt.casefold() == raw_answer.casefold()), None)
        if not match:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid option. Allowed options: {', '.join(options)}",
            )
        return match

    if not raw_answer:
        raise HTTPException(status_code=400, detail="Please provide an answer to continue")
    return raw_answer
