from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timedelta
from typing import Any

from ..db import get_db

MEMORY_COLL = "memory_entries"
MAX_MESSAGE_ITEM_CHARS = 1800
DEFAULT_RECENT_MAX_MESSAGES = 42
DEFAULT_RECENT_MAX_CHARS = 24_000
DEFAULT_RETRIEVED_ITEMS = 28
DEFAULT_CONTEXT_MAX_CHARS = 18_000

_INDEXES_READY = False

_STOP_WORDS = {
    "the",
    "and",
    "for",
    "that",
    "with",
    "this",
    "from",
    "what",
    "when",
    "where",
    "which",
    "please",
    "project",
    "repo",
    "code",
    "chat",
    "tool",
    "tools",
    "have",
    "will",
    "would",
    "could",
    "should",
    "about",
    "into",
}

_SCOPE_WEIGHTS = {
    "chat": 1.0,
    "branch": 0.92,
    "project": 0.86,
    "user": 0.8,
}

_KIND_WEIGHTS = {
    "decision": 1.0,
    "constraint": 0.95,
    "task_goal": 0.96,
    "next_step": 0.9,
    "open_question": 0.88,
    "blocker": 0.9,
    "assumption": 0.75,
    "tool_evidence": 0.84,
    "fact": 0.8,
}


def _as_text(v: Any) -> str:
    return str(v or "").strip()


def _utc_now() -> datetime:
    return datetime.utcnow()


def _utc_iso(v: datetime | None) -> str | None:
    if not isinstance(v, datetime):
        return None
    return v.isoformat() + "Z"


def _clean_line(raw: str) -> str:
    line = _as_text(raw)
    if not line:
        return ""
    line = re.sub(r"^[-*0-9.\)\s]+", "", line).strip()
    line = re.sub(r"\s+", " ", line).strip()
    return line


def _tokenize(text: str) -> list[str]:
    parts = re.split(r"[^a-zA-Z0-9_./:-]+", _as_text(text).lower())
    out: list[str] = []
    for token in parts:
        tok = token.strip()
        if len(tok) < 3:
            continue
        if tok in _STOP_WORDS:
            continue
        out.append(tok)
    seen: set[str] = set()
    unique: list[str] = []
    for tok in out:
        if tok in seen:
            continue
        seen.add(tok)
        unique.append(tok)
    return unique[:80]


def _dedupe_keep_order(items: list[str], max_items: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in items:
        s = _clean_line(raw)
        if not s:
            continue
        key = s.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_items:
            break
    return out


def _truncate(text: str, max_chars: int) -> str:
    s = _as_text(text)
    if len(s) <= max_chars:
        return s
    return s[:max_chars].rstrip() + "..."


def _extract_memory_lines(
    text: str,
    *,
    role: str,
    decisions: list[str],
    open_questions: list[str],
    next_steps: list[str],
    goals: list[str],
    constraints: list[str],
    blockers: list[str],
    assumptions: list[str],
    knowledge: list[str],
) -> None:
    for raw in (_as_text(text)).splitlines():
        line = _clean_line(raw)
        if not line:
            continue
        if len(line) > 420:
            # Avoid flooding memory with stack traces / log dumps.
            continue
        low = line.lower()
        if re.match(r"^\d{4}-\d{2}-\d{2}", line) or low.startswith(("info:", "warning:", "error:", "traceback")):
            continue
        if low.startswith(("file \"", "line ", "at ", "chunk id:", "process exited")):
            continue

        if (
            "decision" in low
            or low.startswith("we will")
            or low.startswith("we should")
            or low.startswith("decided")
            or low.startswith("implemented")
            or low.startswith("updated")
            or low.startswith("fixed")
            or low.startswith("resolved")
            or low.startswith("created")
            or low.startswith("added")
            or low.startswith("changed")
        ):
            decisions.append(line)
        if "?" in line or "open question" in low:
            open_questions.append(line)
        if (
            low.startswith("next step")
            or low.startswith("todo")
            or low.startswith("action")
            or low.startswith("follow-up")
            or low.startswith("next:")
        ):
            next_steps.append(line)
        if (
            low.startswith("goal:")
            or low.startswith("objective:")
            or low.startswith("target:")
            or "i want" in low
            or "we need" in low
            or "must be able to" in low
            or "let's " in low
            or low.startswith("please ")
        ):
            goals.append(line)
        if "must" in low or "cannot" in low or "can't" in low or "should not" in low:
            constraints.append(line)
        if "error" in low or "failed" in low or "not available" in low or "blocked" in low:
            blockers.append(line)
        if "assume" in low or low.startswith("assumption") or "probably" in low:
            assumptions.append(line)
        if role == "assistant":
            if (
                re.search(r"[A-Za-z0-9_./-]+\.[A-Za-z0-9]+(?::\d+)?", line)
                or "http://" in low
                or "https://" in low
                or " is " in low
                or " are " in low
                or "uses " in low
                or "located" in low
            ):
                knowledge.append(line)
        elif role == "user":
            if "need to" in low or "want to" in low or "please" in low:
                next_steps.append(line)


def derive_memory_summary(messages: list[dict[str, Any]]) -> dict[str, Any]:
    decisions: list[str] = []
    open_questions: list[str] = []
    next_steps: list[str] = []
    goals: list[str] = []
    constraints: list[str] = []
    blockers: list[str] = []
    assumptions: list[str] = []
    knowledge: list[str] = []

    for msg in messages[-120:]:
        if not isinstance(msg, dict):
            continue
        role = _as_text(msg.get("role")).lower()
        if role not in {"assistant", "user"}:
            continue
        content = _as_text(msg.get("content"))
        if not content:
            continue
        _extract_memory_lines(
            content,
            role=role,
            decisions=decisions,
            open_questions=open_questions,
            next_steps=next_steps,
            goals=goals,
            constraints=constraints,
            blockers=blockers,
            assumptions=assumptions,
            knowledge=knowledge,
        )

    return {
        "decisions": _dedupe_keep_order(decisions, 10),
        "open_questions": _dedupe_keep_order(open_questions, 10),
        "next_steps": _dedupe_keep_order(next_steps, 10),
        "goals": _dedupe_keep_order(goals, 10),
        "constraints": _dedupe_keep_order(constraints, 10),
        "blockers": _dedupe_keep_order(blockers, 10),
        "assumptions": _dedupe_keep_order(assumptions, 10),
        "knowledge": _dedupe_keep_order(knowledge, 14),
        "updated_at": _utc_iso(_utc_now()),
    }


def _normalize_task_state(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    return {
        "goals": _dedupe_keep_order([_as_text(x) for x in (raw.get("goals") or [])], 20),
        "constraints": _dedupe_keep_order([_as_text(x) for x in (raw.get("constraints") or [])], 20),
        "decisions": _dedupe_keep_order([_as_text(x) for x in (raw.get("decisions") or [])], 20),
        "open_questions": _dedupe_keep_order([_as_text(x) for x in (raw.get("open_questions") or [])], 20),
        "next_steps": _dedupe_keep_order([_as_text(x) for x in (raw.get("next_steps") or [])], 20),
        "blockers": _dedupe_keep_order([_as_text(x) for x in (raw.get("blockers") or [])], 20),
        "assumptions": _dedupe_keep_order([_as_text(x) for x in (raw.get("assumptions") or [])], 20),
        "knowledge": _dedupe_keep_order([_as_text(x) for x in (raw.get("knowledge") or [])], 24),
        "updated_at": _as_text(raw.get("updated_at")) or _utc_iso(_utc_now()),
    }


def derive_task_state(messages: list[dict[str, Any]], previous_state: dict[str, Any] | None = None) -> dict[str, Any]:
    base = _normalize_task_state(previous_state or {})
    summary = derive_memory_summary(messages)
    for key in ("goals", "constraints", "decisions", "open_questions", "next_steps", "blockers", "assumptions", "knowledge"):
        merged = [*_as_list(base.get(key)), *_as_list(summary.get(key))]
        base[key] = _dedupe_keep_order([_as_text(x) for x in merged], 24)
    base["updated_at"] = _utc_iso(_utc_now())
    return base


def _as_list(raw: Any) -> list[Any]:
    return raw if isinstance(raw, list) else []


def select_recent_conversation_messages(
    messages: list[dict[str, Any]],
    *,
    max_messages: int = DEFAULT_RECENT_MAX_MESSAGES,
    max_chars: int = DEFAULT_RECENT_MAX_CHARS,
) -> list[dict[str, str]]:
    filtered: list[dict[str, str]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = _as_text(msg.get("role")).lower()
        if role not in {"user", "assistant"}:
            continue
        content = _as_text(msg.get("content"))
        if not content:
            continue
        filtered.append({"role": role, "content": content})

    # avoid duplicating the current user message (ask_agent appends it before calling the model)
    if filtered and filtered[-1]["role"] == "user":
        filtered = filtered[:-1]

    out_rev: list[dict[str, str]] = []
    total_chars = 0
    for msg in reversed(filtered):
        content = msg["content"]
        if len(content) > MAX_MESSAGE_ITEM_CHARS:
            content = content[:MAX_MESSAGE_ITEM_CHARS] + "\n... (truncated)"
        item_len = len(content) + len(msg["role"]) + 8
        if out_rev and (len(out_rev) >= max_messages or total_chars + item_len > max_chars):
            break
        out_rev.append({"role": msg["role"], "content": content})
        total_chars += item_len
    out_rev.reverse()
    return out_rev


def _memory_scope_key(scope: str, *, project_id: str, branch: str, user_id: str, chat_id: str) -> str:
    if scope == "chat":
        return chat_id
    if scope == "branch":
        return f"{project_id}::{branch}"
    if scope == "project":
        return project_id
    if scope == "user":
        return f"{project_id}::{user_id}"
    return f"{project_id}::{branch}"


def _fingerprint(scope: str, scope_key: str, kind: str, text: str) -> str:
    raw = f"{scope}|{scope_key}|{kind}|{_clean_line(text).casefold()}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _conflict_bucket(kind: str, text: str) -> str:
    tokens = _tokenize(text)[:8]
    return f"{kind}:{' '.join(tokens)}"


def _ttl_for_kind(kind: str) -> timedelta:
    if kind == "tool_evidence":
        return timedelta(days=21)
    if kind in {"next_step", "blocker", "open_question"}:
        return timedelta(days=45)
    if kind in {"decision", "constraint", "task_goal"}:
        return timedelta(days=180)
    return timedelta(days=90)


def _decay_for_kind(kind: str) -> tuple[int, float]:
    if kind in {"decision", "constraint"}:
        return (90, 0.55)
    if kind in {"next_step", "blocker", "open_question"}:
        return (30, 0.35)
    if kind == "tool_evidence":
        return (14, 0.25)
    return (45, 0.4)


def _extract_source_refs(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for src in sources or []:
        if not isinstance(src, dict):
            continue
        label = _as_text(src.get("label"))
        path = _as_text(src.get("path"))
        url = _as_text(src.get("url"))
        kind = _as_text(src.get("source_type"))
        key = f"{label}|{path}|{url}|{kind}"
        if not key.strip("|") or key in seen:
            continue
        seen.add(key)
        confidence_raw = src.get("confidence")
        try:
            confidence = float(confidence_raw) if confidence_raw is not None else None
        except Exception:
            confidence = None
        out.append(
            {
                "label": label or None,
                "path": path or None,
                "url": url or None,
                "source_type": kind or None,
                "confidence": confidence,
            }
        )
        if len(out) >= 16:
            break
    return out


async def ensure_memory_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    db = get_db()
    coll = db[MEMORY_COLL]
    try:
        await coll.create_index([("project_id", 1), ("scope", 1), ("scope_key", 1), ("updated_at", -1)], name="memory_scope_recent")
    except Exception:
        pass
    try:
        await coll.create_index([("project_id", 1), ("expires_at", 1)], name="memory_expiry")
    except Exception:
        pass
    try:
        await coll.create_index([("scope", 1), ("scope_key", 1), ("fingerprint", 1)], name="memory_fingerprint")
    except Exception:
        pass
    _INDEXES_READY = True


async def _upsert_memory_entry(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str,
    scope: str,
    kind: str,
    text: str,
    tags: list[str],
    confidence: float,
    source_refs: list[dict[str, Any]] | None = None,
) -> None:
    clean_text = _clean_line(text)
    if not clean_text:
        return
    scope_key = _memory_scope_key(scope, project_id=project_id, branch=branch, user_id=user_id, chat_id=chat_id)
    fp = _fingerprint(scope, scope_key, kind, clean_text)
    now = _utc_now()
    ttl = _ttl_for_kind(kind)
    half_life_days, floor = _decay_for_kind(kind)
    query = {"project_id": project_id, "scope": scope, "scope_key": scope_key, "fingerprint": fp}
    update = {
        "$set": {
            "project_id": project_id,
            "branch": branch,
            "user_id": user_id,
            "chat_id": chat_id,
            "scope": scope,
            "scope_key": scope_key,
            "kind": kind,
            "text": clean_text,
            "tags": _dedupe_keep_order(tags, 20),
            "confidence": max(0.0, min(float(confidence or 0.0), 1.0)),
            "source_refs": source_refs or [],
            "updated_at": now,
            "last_seen_at": now,
            "expires_at": now + ttl,
            "decay_half_life_days": int(half_life_days),
            "decay_floor": float(floor),
            "conflict_key": _conflict_bucket(kind, clean_text),
        },
        "$setOnInsert": {
            "created_at": now,
        },
    }
    await get_db()[MEMORY_COLL].update_one(query, update, upsert=True)


def _candidate_terms(question: str, branch: str, task_state: dict[str, Any]) -> list[str]:
    base = [question, branch]
    for key in ("goals", "constraints", "decisions", "open_questions", "next_steps", "blockers", "knowledge"):
        for item in _as_list(task_state.get(key))[:8]:
            base.append(_as_text(item))
    return _tokenize("\n".join(base))


def _age_days(value: Any, now: datetime) -> float:
    if not isinstance(value, datetime):
        return 9999.0
    delta = now - value
    return max(0.0, float(delta.total_seconds()) / 86400.0)


def _decay_multiplier(doc: dict[str, Any], now: datetime) -> float:
    half_life = float(doc.get("decay_half_life_days") or 45.0)
    floor = float(doc.get("decay_floor") or 0.35)
    if half_life <= 0:
        return max(0.0, min(1.0, floor))
    age = _age_days(doc.get("updated_at"), now)
    raw = math.pow(0.5, age / half_life)
    return max(floor, min(1.0, raw))


def _score_memory_doc(doc: dict[str, Any], query_terms: list[str], now: datetime) -> float:
    text = _as_text(doc.get("text"))
    tags = " ".join([_as_text(x) for x in (_as_list(doc.get("tags")))])
    token_set = set(_tokenize(f"{text}\n{tags}"))
    if not query_terms:
        lexical = 0.0
    else:
        overlap = len(token_set.intersection(set(query_terms)))
        lexical = float(overlap) / float(max(1, min(len(query_terms), 10)))
    age = _age_days(doc.get("updated_at"), now)
    recency = math.exp(-age / 45.0)
    confidence = max(0.0, min(float(doc.get("confidence") or 0.0), 1.0))
    scope_w = _SCOPE_WEIGHTS.get(_as_text(doc.get("scope")), 0.75)
    kind_w = _KIND_WEIGHTS.get(_as_text(doc.get("kind")), 0.72)
    decay = _decay_multiplier(doc, now)
    score = (
        lexical * 0.52
        + recency * 0.16
        + confidence * 0.2
        + scope_w * 0.08
        + kind_w * 0.04
    )
    return score * decay


def _resolve_conflicts(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    by_bucket: dict[str, list[dict[str, Any]]] = {}
    for doc in candidates:
        bucket = _as_text(doc.get("conflict_key")) or _conflict_bucket(_as_text(doc.get("kind")), _as_text(doc.get("text")))
        by_bucket.setdefault(bucket, []).append(doc)

    out: list[dict[str, Any]] = []
    notes: list[str] = []
    for bucket, docs in by_bucket.items():
        ranked = sorted(
            docs,
            key=lambda d: (
                float(d.get("_score") or 0.0),
                d.get("updated_at") if isinstance(d.get("updated_at"), datetime) else datetime.min,
            ),
            reverse=True,
        )
        chosen = ranked[0]
        out.append(chosen)
        if len(ranked) > 1:
            chosen_text = _as_text(chosen.get("text"))
            alternatives = [_as_text(d.get("text")) for d in ranked[1:] if _as_text(d.get("text")) and _as_text(d.get("text")) != chosen_text]
            if alternatives:
                notes.append(
                    f"Conflict in {bucket}: kept newest/highest-confidence memory '{chosen_text[:140]}' over {len(alternatives)} alternative(s)."
                )
    return out, notes


async def retrieve_hierarchical_memories(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str,
    question: str,
    task_state: dict[str, Any],
    max_items: int = DEFAULT_RETRIEVED_ITEMS,
) -> dict[str, Any]:
    await ensure_memory_indexes()
    now = _utc_now()
    scopes = [
        {"scope": "chat", "scope_key": _memory_scope_key("chat", project_id=project_id, branch=branch, user_id=user_id, chat_id=chat_id)},
        {"scope": "branch", "scope_key": _memory_scope_key("branch", project_id=project_id, branch=branch, user_id=user_id, chat_id=chat_id)},
        {"scope": "project", "scope_key": _memory_scope_key("project", project_id=project_id, branch=branch, user_id=user_id, chat_id=chat_id)},
        {"scope": "user", "scope_key": _memory_scope_key("user", project_id=project_id, branch=branch, user_id=user_id, chat_id=chat_id)},
    ]
    q = {
        "project_id": project_id,
        "$and": [
            {"$or": scopes},
            {"$or": [{"expires_at": {"$exists": False}}, {"expires_at": None}, {"expires_at": {"$gt": now}}]},
        ],
    }
    rows = await get_db()[MEMORY_COLL].find(q).sort("updated_at", -1).limit(500).to_list(length=500)
    terms = _candidate_terms(question, branch, task_state)
    scored: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = _as_text(row.get("text"))
        if not text:
            continue
        score = _score_memory_doc(row, terms, now)
        row["_score"] = score
        scored.append(row)
    scored.sort(key=lambda d: float(d.get("_score") or 0.0), reverse=True)
    resolved, conflict_notes = _resolve_conflicts(scored[: max(40, max_items * 2)])
    resolved.sort(key=lambda d: float(d.get("_score") or 0.0), reverse=True)
    selected = resolved[: max_items]
    selected_out: list[dict[str, Any]] = []
    for doc in selected:
        selected_out.append(
            {
                "id": _as_text(doc.get("_id")),
                "scope": _as_text(doc.get("scope")),
                "kind": _as_text(doc.get("kind")),
                "text": _as_text(doc.get("text")),
                "tags": [_as_text(x) for x in _as_list(doc.get("tags")) if _as_text(x)],
                "confidence": float(doc.get("confidence") or 0.0),
                "score": float(doc.get("_score") or 0.0),
                "updated_at": _utc_iso(doc.get("updated_at")) if isinstance(doc.get("updated_at"), datetime) else None,
                "source_refs": doc.get("source_refs") if isinstance(doc.get("source_refs"), list) else [],
            }
        )
    return {"items": selected_out, "conflicts": conflict_notes, "query_terms": terms}


def _render_hierarchical_context(
    *,
    memory_summary: dict[str, Any],
    task_state: dict[str, Any],
    retrieved: dict[str, Any],
    max_chars: int,
) -> str:
    lines: list[str] = [
        "HIERARCHICAL_MEMORY_CONTEXT",
        "Use this context to maintain continuity. Prioritize latest updates and cited evidence memories.",
        "",
        "TASK_STATE:",
    ]
    for key, label in (
        ("goals", "Goals"),
        ("constraints", "Constraints"),
        ("decisions", "Decisions"),
        ("open_questions", "Open Questions"),
        ("next_steps", "Next Steps"),
        ("blockers", "Blockers"),
        ("assumptions", "Assumptions"),
        ("knowledge", "Knowledge"),
    ):
        vals = [_as_text(x) for x in _as_list(task_state.get(key))][:8]
        if not vals:
            continue
        lines.append(f"- {label}:")
        for item in vals:
            lines.append(f"  - {item}")

    lines.append("")
    lines.append("ROLLING_SUMMARY:")
    for key in ("decisions", "open_questions", "next_steps", "knowledge"):
        vals = [_as_text(x) for x in _as_list(memory_summary.get(key))][:8]
        if not vals:
            continue
        lines.append(f"- {key}:")
        for item in vals:
            lines.append(f"  - {item}")

    items = retrieved.get("items") if isinstance(retrieved, dict) else []
    conflicts = retrieved.get("conflicts") if isinstance(retrieved, dict) else []
    if isinstance(items, list) and items:
        lines.append("")
        lines.append("RETRIEVED_LONG_TERM_MEMORY:")
        for item in items[:28]:
            if not isinstance(item, dict):
                continue
            scope = _as_text(item.get("scope")) or "memory"
            kind = _as_text(item.get("kind")) or "note"
            text = _as_text(item.get("text"))
            if not text:
                continue
            conf = float(item.get("confidence") or 0.0)
            score = float(item.get("score") or 0.0)
            lines.append(f"- [{scope}/{kind}] {text} (confidence={conf:.2f}, score={score:.2f})")

    if isinstance(conflicts, list) and conflicts:
        lines.append("")
        lines.append("CONFLICT_RESOLUTION_NOTES:")
        for note in conflicts[:10]:
            s = _as_text(note)
            if s:
                lines.append(f"- {s}")

    raw = "\n".join(lines).strip()
    if len(raw) > max_chars:
        return raw[:max_chars] + "\n... (truncated hierarchical memory context)"
    return raw


async def build_hierarchical_context(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str,
    question: str,
    messages: list[dict[str, Any]],
    memory_summary: dict[str, Any] | None,
    task_state: dict[str, Any] | None,
    max_recent_messages: int = DEFAULT_RECENT_MAX_MESSAGES,
    max_recent_chars: int = DEFAULT_RECENT_MAX_CHARS,
    max_retrieved_items: int = DEFAULT_RETRIEVED_ITEMS,
    max_context_chars: int = DEFAULT_CONTEXT_MAX_CHARS,
) -> dict[str, Any]:
    summary = memory_summary if isinstance(memory_summary, dict) else derive_memory_summary(messages)
    state = task_state if isinstance(task_state, dict) else derive_task_state(messages, None)
    recent_messages = select_recent_conversation_messages(
        messages,
        max_messages=max_recent_messages,
        max_chars=max_recent_chars,
    )
    retrieved = await retrieve_hierarchical_memories(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        chat_id=chat_id,
        question=question,
        task_state=state,
        max_items=max_retrieved_items,
    )
    context_text = _render_hierarchical_context(
        memory_summary=summary,
        task_state=state,
        retrieved=retrieved,
        max_chars=max_context_chars,
    )
    snapshot = {
        "recent_messages": len(recent_messages),
        "summary_decisions": len(_as_list(summary.get("decisions"))),
        "summary_open_questions": len(_as_list(summary.get("open_questions"))),
        "summary_next_steps": len(_as_list(summary.get("next_steps"))),
        "summary_knowledge": len(_as_list(summary.get("knowledge"))),
        "task_goals": len(_as_list(state.get("goals"))),
        "task_constraints": len(_as_list(state.get("constraints"))),
        "task_blockers": len(_as_list(state.get("blockers"))),
        "task_knowledge": len(_as_list(state.get("knowledge"))),
        "retrieved_items": len(_as_list(retrieved.get("items") if isinstance(retrieved, dict) else [])),
        "retrieval_conflicts": len(_as_list(retrieved.get("conflicts") if isinstance(retrieved, dict) else [])),
        "query_terms": _as_list(retrieved.get("query_terms") if isinstance(retrieved, dict) else []),
        "updated_at": _utc_iso(_utc_now()),
    }
    return {
        "memory_summary": summary,
        "task_state": state,
        "conversation_messages": recent_messages,
        "context_text": context_text,
        "retrieved_memory": retrieved.get("items") if isinstance(retrieved, dict) else [],
        "retrieval_conflicts": retrieved.get("conflicts") if isinstance(retrieved, dict) else [],
        "snapshot": snapshot,
    }


async def persist_hierarchical_memory(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str,
    memory_summary: dict[str, Any],
    task_state: dict[str, Any],
    answer_sources: list[dict[str, Any]] | None,
    tool_events: list[dict[str, Any]] | None,
    user_message_text: str | None = None,
    assistant_message_text: str | None = None,
) -> None:
    await ensure_memory_indexes()
    source_refs = _extract_source_refs(answer_sources or [])
    scopes_by_kind: dict[str, list[str]] = {
        "task_goal": ["chat", "branch", "project"],
        "constraint": ["chat", "branch", "project"],
        "decision": ["chat", "branch", "project"],
        "open_question": ["chat", "branch"],
        "next_step": ["chat", "branch"],
        "blocker": ["chat", "branch"],
        "assumption": ["chat", "branch", "user"],
        "fact": ["chat", "branch", "project"],
    }

    entries: list[tuple[str, str, str, list[str], float]] = []
    for text in _as_list(task_state.get("goals"))[:12]:
        entries.append(("task_goal", _as_text(text), "goals", ["goal", "task_state"], 0.82))
    for text in _as_list(task_state.get("constraints"))[:12]:
        entries.append(("constraint", _as_text(text), "constraints", ["constraint", "task_state"], 0.88))
    for text in _as_list(task_state.get("decisions"))[:12]:
        entries.append(("decision", _as_text(text), "decisions", ["decision", "task_state"], 0.9))
    for text in _as_list(task_state.get("open_questions"))[:12]:
        entries.append(("open_question", _as_text(text), "open_questions", ["question", "task_state"], 0.78))
    for text in _as_list(task_state.get("next_steps"))[:12]:
        entries.append(("next_step", _as_text(text), "next_steps", ["next_step", "task_state"], 0.8))
    for text in _as_list(task_state.get("blockers"))[:12]:
        entries.append(("blocker", _as_text(text), "blockers", ["blocker", "task_state"], 0.82))
    for text in _as_list(task_state.get("assumptions"))[:8]:
        entries.append(("assumption", _as_text(text), "assumptions", ["assumption", "task_state"], 0.6))
    for text in _as_list(task_state.get("knowledge"))[:16]:
        entries.append(("fact", _as_text(text), "knowledge", ["knowledge", "task_state"], 0.74))

    for kind, text, _, tags, confidence in entries:
        if not text:
            continue
        for scope in scopes_by_kind.get(kind, ["chat"]):
            await _upsert_memory_entry(
                project_id=project_id,
                branch=branch,
                user_id=user_id,
                chat_id=chat_id,
                scope=scope,
                kind=kind,
                text=text,
                tags=tags,
                confidence=confidence,
                source_refs=source_refs if kind in {"decision", "constraint"} else [],
            )

    if source_refs:
        labels = []
        for src in source_refs[:16]:
            label = _as_text(src.get("label")) or _as_text(src.get("path")) or _as_text(src.get("url"))
            if label:
                labels.append(label)
        evidence_text = " | ".join(labels[:8])
        if evidence_text:
            for scope in ("chat", "branch"):
                await _upsert_memory_entry(
                    project_id=project_id,
                    branch=branch,
                    user_id=user_id,
                    chat_id=chat_id,
                    scope=scope,
                    kind="tool_evidence",
                    text=f"Evidence sources used in answer: {evidence_text}",
                    tags=["evidence", "sources"],
                    confidence=0.86,
                    source_refs=source_refs,
                )

    user_text = _truncate(user_message_text or "", 520)
    if user_text:
        await _upsert_memory_entry(
            project_id=project_id,
            branch=branch,
            user_id=user_id,
            chat_id=chat_id,
            scope="chat",
            kind="fact",
            text=f"User asked: {user_text}",
            tags=["conversation", "user_turn"],
            confidence=0.72,
            source_refs=[],
        )

    assistant_text = _truncate(assistant_message_text or "", 520)
    if assistant_text:
        await _upsert_memory_entry(
            project_id=project_id,
            branch=branch,
            user_id=user_id,
            chat_id=chat_id,
            scope="chat",
            kind="fact",
            text=f"Assistant replied: {assistant_text}",
            tags=["conversation", "assistant_turn"],
            confidence=0.68,
            source_refs=source_refs[:6] if source_refs else [],
        )

    # Persist a compact telemetry memory row for tool failures/successes.
    if isinstance(tool_events, list) and tool_events:
        ok = sum(1 for ev in tool_events if bool((ev or {}).get("ok")))
        err = sum(1 for ev in tool_events if not bool((ev or {}).get("ok")))
        tools = []
        for ev in tool_events:
            name = _as_text((ev or {}).get("tool"))
            if name and name not in tools:
                tools.append(name)
            if len(tools) >= 12:
                break
        if tools:
            summary_line = f"Tool cycle: {ok} ok / {err} errors. Tools: {', '.join(tools)}."
            await _upsert_memory_entry(
                project_id=project_id,
                branch=branch,
                user_id=user_id,
                chat_id=chat_id,
                scope="chat",
                kind="fact",
                text=summary_line,
                tags=["tool_cycle", "telemetry"],
                confidence=0.7,
                source_refs=[],
            )

    # Keep memory summary data discoverable as branch/project memory hints.
    for key in ("decisions", "open_questions", "next_steps", "knowledge"):
        for item in _as_list(memory_summary.get(key))[:8]:
            text = _as_text(item)
            if not text:
                continue
            kind = (
                "decision"
                if key == "decisions"
                else ("open_question" if key == "open_questions" else ("next_step" if key == "next_steps" else "fact"))
            )
            for scope in ("branch", "project"):
                await _upsert_memory_entry(
                    project_id=project_id,
                    branch=branch,
                    user_id=user_id,
                    chat_id=chat_id,
                    scope=scope,
                    kind=kind,
                    text=text,
                    tags=["rolling_summary", key],
                    confidence=0.74,
                    source_refs=[],
                )
