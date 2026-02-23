from __future__ import annotations

from typing import Any

from .ask_agent_clarification import as_text

_DEFAULT_FAST_INTENT_MARKERS = (
    "where",
    "which file",
    "what file",
    "show me",
    "find",
    "grep",
    "path",
    "line",
    "symbol",
    "quick",
    "list",
)
_DEFAULT_STRONG_INTENT_MARKERS = (
    "architecture",
    "design",
    "tradeoff",
    "refactor",
    "plan",
    "strategy",
    "migration",
    "document",
    "explain deeply",
)
_DEFAULT_CLARIFICATION_POLICY = {
    "enabled": True,
    "budget_per_goal": 3,
    "continue_forces_progress": True,
    "allow_repeat_on_conflict": True,
}


def project_extra(project: dict[str, Any]) -> dict[str, Any]:
    extra = project.get("extra") if isinstance(project, dict) else {}
    return extra if isinstance(extra, dict) else {}


def extract_grounding_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = project_extra(project)
    grounding = extra.get("grounding")
    if not isinstance(grounding, dict):
        grounding = {}
    return {
        "require_sources": bool(grounding.get("require_sources", True)),
        "min_sources": max(1, min(int(grounding.get("min_sources") or 1), 5)),
    }


def extract_security_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = project_extra(project)
    security = extra.get("security")
    if not isinstance(security, dict):
        security = {}
    return {
        "read_only_for_non_admin": bool(security.get("read_only_for_non_admin", True)),
        "allow_write_tools_for_members": bool(security.get("allow_write_tools_for_members", True)),
        "allow_git_write_tools_for_non_admin": bool(security.get("allow_git_write_tools_for_non_admin", True)),
    }


def extract_llm_routing(project: dict[str, Any]) -> dict[str, Any]:
    extra = project_extra(project)
    routing = extra.get("llm_routing")
    if not isinstance(routing, dict):
        routing = {}
    return {
        "enabled": bool(routing.get("enabled")),
        "fast_profile_id": str(routing.get("fast_profile_id") or "").strip() or None,
        "strong_profile_id": str(routing.get("strong_profile_id") or "").strip() or None,
        "fallback_profile_id": str(routing.get("fallback_profile_id") or "").strip() or None,
        "fast_intents": [str(x).strip().lower() for x in (routing.get("fast_intents") or []) if str(x).strip()],
        "strong_intents": [str(x).strip().lower() for x in (routing.get("strong_intents") or []) if str(x).strip()],
    }


def extract_memory_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = project_extra(project)
    mem = extra.get("memory")
    if not isinstance(mem, dict):
        mem = {}
    return {
        "max_recent_messages": max(8, min(int(mem.get("max_recent_messages") or 42), 120)),
        "max_recent_chars": max(6000, min(int(mem.get("max_recent_chars") or 24000), 100000)),
        "max_retrieved_items": max(6, min(int(mem.get("max_retrieved_items") or 28), 80)),
        "max_context_chars": max(4000, min(int(mem.get("max_context_chars") or 18000), 120000)),
    }


def extract_clarification_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = project_extra(project)
    raw = extra.get("clarification")
    if not isinstance(raw, dict):
        raw = {}
    enabled = bool(raw.get("enabled", _DEFAULT_CLARIFICATION_POLICY["enabled"]))
    budget_per_goal = max(
        1,
        min(int(raw.get("budget_per_goal") or _DEFAULT_CLARIFICATION_POLICY["budget_per_goal"]), 10),
    )
    continue_forces_progress = bool(
        raw.get("continue_forces_progress", _DEFAULT_CLARIFICATION_POLICY["continue_forces_progress"])
    )
    allow_repeat_on_conflict = bool(
        raw.get("allow_repeat_on_conflict", _DEFAULT_CLARIFICATION_POLICY["allow_repeat_on_conflict"])
    )
    return {
        "enabled": enabled,
        "budget_per_goal": budget_per_goal,
        "continue_forces_progress": continue_forces_progress,
        "allow_repeat_on_conflict": allow_repeat_on_conflict,
    }


def route_intent(question: str, routing_cfg: dict[str, Any]) -> str:
    q = as_text(question).lower()
    if not q:
        return "strong"
    fast_markers = tuple(routing_cfg.get("fast_intents") or _DEFAULT_FAST_INTENT_MARKERS)
    strong_markers = tuple(routing_cfg.get("strong_intents") or _DEFAULT_STRONG_INTENT_MARKERS)
    if any(m in q for m in strong_markers):
        return "strong"
    if any(m in q for m in fast_markers):
        return "fast"
    if len(q) <= 80:
        return "fast"
    return "strong"


def routed_profile_id(question: str, routing_cfg: dict[str, Any]) -> str | None:
    if not bool(routing_cfg.get("enabled")):
        return None
    intent = route_intent(question, routing_cfg)
    if intent == "fast":
        return routing_cfg.get("fast_profile_id")
    return routing_cfg.get("strong_profile_id") or routing_cfg.get("fast_profile_id")
