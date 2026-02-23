import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..db import get_db
from datetime import datetime
from bson import ObjectId
from ..rag.agent2 import LLMUpstreamError, answer_with_agent
from ..rag.tool_runtime import ToolContext
from ..services.llm_profiles import resolve_project_llm_config
from ..services.custom_tools import build_runtime_for_project
from ..services.hierarchical_memory import (
    build_hierarchical_context,
    derive_memory_summary,
    derive_task_state,
    persist_hierarchical_memory,
)
from .ask_agent_clarification import (
    as_text as _as_text,
    derive_goal_id as _derive_goal_id,
    goal_ref as _goal_ref,
    has_conflict_signal as _has_conflict_signal,
    iso_utc as _iso_utc,
    latest_answer_for_question as _latest_answer_for_question,
    looks_destructive_intent as _looks_destructive_intent,
    looks_like_continue_request as _looks_like_continue_request,
    normalize_clarification_state as _normalize_clarification_state,
    normalize_pending_user_question as _normalize_pending_user_question,
    normalize_question_key as _normalize_question_key,
    record_answered_pending_question as _record_answered_pending_question,
    record_open_question as _record_open_question,
    resolve_pending_user_answer as _resolve_pending_user_answer,
)
from .ask_agent_policy import (
    extract_clarification_policy as _extract_clarification_policy,
    extract_grounding_policy as _extract_grounding_policy,
    extract_llm_routing as _extract_llm_routing,
    extract_memory_policy as _extract_memory_policy,
    extract_security_policy as _extract_security_policy,
    routed_profile_id as _routed_profile_id,
)
from .ask_agent_sources import (
    collect_answer_sources as _collect_answer_sources,
    discover_sources_when_missing as _discover_sources_when_missing,
    enforce_grounded_answer as _enforce_grounded_answer,
)
from .ask_agent_tool_policy import (
    active_approved_tools as _active_approved_tools,
    apply_role_tool_policy as _apply_role_tool_policy,
    extract_max_tool_calls as _extract_max_tool_calls,
    extract_tool_policy as _extract_tool_policy,
    merge_tool_policies as _merge_tool_policies,
    resolve_user_role as _resolve_user_role,
)

router = APIRouter()
logger = logging.getLogger(__name__)

class AskReq(BaseModel):
    project_id: str
    question: str
    local_repo_context: str | None = None
    branch: str = "main"
    user: str = "dev"
    chat_id: str | None = None
    top_k: int = 8
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_profile_id: str | None = None
    pending_question_id: str | None = None
    pending_answer: str | None = None


async def _load_project_doc(project_id: str) -> dict[str, Any]:
    db = get_db()
    q = {"key": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    return await db["projects"].find_one(q) or {}



async def _project_llm_defaults(
    project_id: str,
    *,
    override_profile_id: str | None = None,
    project_doc: dict[str, Any] | None = None,
) -> dict[str, Any]:
    project = project_doc if isinstance(project_doc, dict) else await _load_project_doc(project_id)
    llm = await resolve_project_llm_config(project, override_profile_id=override_profile_id)

    return {
        "provider": llm.get("provider"),
        "llm_base_url": llm.get("llm_base_url"),
        "llm_api_key": llm.get("llm_api_key"),
        "llm_model": llm.get("llm_model"),
        "llm_profile_id": llm.get("llm_profile_id"),
        "llm_profile_name": llm.get("llm_profile_name"),
        "tool_policy": _extract_tool_policy(project),
        "max_tool_calls": _extract_max_tool_calls(project),
        "grounding_policy": _extract_grounding_policy(project),
        "security_policy": _extract_security_policy(project),
        "routing": _extract_llm_routing(project),
        "memory_policy": _extract_memory_policy(project),
        "clarification_policy": _extract_clarification_policy(project),
        "project": project,
    }



def _derive_chat_memory(messages: list[dict[str, Any]]) -> dict[str, Any]:
    return derive_memory_summary(messages)


async def _update_chat_memory_summary(chat_id: str) -> dict[str, Any] | None:
    db = get_db()
    doc = await db["chats"].find_one({"chat_id": chat_id}, {"messages": {"$slice": -220}, "task_state": 1})
    if not isinstance(doc, dict):
        return None
    messages = (doc.get("messages") or [])
    summary = _derive_chat_memory(messages)
    task_state = derive_task_state(messages, doc.get("task_state") if isinstance(doc.get("task_state"), dict) else None)
    await db["chats"].update_one(
        {"chat_id": chat_id},
        {"$set": {"memory_summary": summary, "task_state": task_state}},
    )
    return {"memory_summary": summary, "task_state": task_state}


@router.post("/ask_agent")
async def ask_agent(req: AskReq):
    chat_id = req.chat_id or f"{req.project_id}::{req.branch}::{req.user}"
    now = datetime.utcnow()
    db = get_db()

    # ensure chat
    await db["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$set": {
                "project_id": req.project_id,
                "branch": req.branch,
                "user": req.user,
                "updated_at": now,
            },
            "$setOnInsert": {
                "chat_id": chat_id,
                "title": "New chat",
                "messages": [],
                "tool_policy": {},
                "llm_profile_id": None,
                "created_at": now,
            },
        },
        upsert=True,
    )

    requested_profile_id = (req.llm_profile_id or "").strip() or None
    if requested_profile_id is not None:
        await db["chats"].update_one(
            {"chat_id": chat_id},
            {"$set": {"llm_profile_id": requested_profile_id, "updated_at": now}},
        )

    chat_doc = await db["chats"].find_one(
        {"chat_id": chat_id},
        {
            "tool_policy": 1,
            "llm_profile_id": 1,
            "pending_user_question": 1,
            "memory_summary": 1,
            "task_state": 1,
            "clarification_state": 1,
        },
    )
    active_pending_question = _normalize_pending_user_question((chat_doc or {}).get("pending_user_question"))
    clarification_state = _normalize_clarification_state((chat_doc or {}).get("clarification_state"))

    raw_user_text = _as_text(req.question)
    user_text = raw_user_text
    user_meta: dict[str, Any] | None = None
    if active_pending_question:
        resolved_answer = _resolve_pending_user_answer(req, active_pending_question)
        user_text = resolved_answer
        user_meta = {
            "pending_response": {
                "id": active_pending_question.get("id"),
                "question": active_pending_question.get("question"),
                "answer_mode": active_pending_question.get("answer_mode"),
                "options": active_pending_question.get("options") or [],
                "goal_id": active_pending_question.get("goal_id"),
                "question_key": active_pending_question.get("question_key"),
            }
        }
    if not user_text:
        raise HTTPException(status_code=400, detail="question is required")

    continue_intent = bool(not active_pending_question and _looks_like_continue_request(raw_user_text))
    conflict_signal = _has_conflict_signal(raw_user_text)
    pending_goal_id = _as_text((active_pending_question or {}).get("goal_id"))
    derived_goal_id = _derive_goal_id(
        user_text=_as_text((active_pending_question or {}).get("question")) or user_text,
        active_goal_id=_as_text(clarification_state.get("active_goal_id")),
        pending_goal_id=pending_goal_id,
        continue_intent=continue_intent,
    )
    goal = _goal_ref(clarification_state, derived_goal_id, goal_text=user_text)
    clarification_state["active_goal_id"] = derived_goal_id
    clarification_state["updated_at"] = _iso_utc(now)

    if active_pending_question:
        _record_answered_pending_question(
            clarification_state,
            goal_id=derived_goal_id,
            pending_question=active_pending_question,
            answer=user_text,
        )
    clarification_meta = {
        "goal_id": derived_goal_id,
        "continue_mode": continue_intent,
        "conflict_signal": conflict_signal,
    }
    if user_meta:
        user_meta["clarification"] = clarification_meta
    else:
        user_meta = {"clarification": clarification_meta}

    # append user message
    user_msg = {"role": "user", "content": user_text, "ts": now}
    if user_meta:
        user_msg["meta"] = user_meta
    update_doc: dict[str, Any] = {
        "$push": {"messages": user_msg},
        "$set": {
            "updated_at": now,
            "last_message_at": now,
            "last_message_preview": user_text[:160],
            "clarification_state": clarification_state,
        },
        "$setOnInsert": {"title": user_text[:60] or "New chat"},
    }
    if active_pending_question:
        update_doc["$unset"] = {"pending_user_question": ""}
    await db["chats"].update_one(
        {"chat_id": chat_id},
        update_doc,
    )

    # run retrieval + llm
    project_doc = await _load_project_doc(req.project_id)
    chat_profile_id = None
    if isinstance(chat_doc, dict):
        chat_profile_id = (chat_doc.get("llm_profile_id") or "").strip() or None

    routing_cfg = _extract_llm_routing(project_doc)
    routed_profile_id = None
    explicit_llm_override = bool(req.llm_base_url or req.llm_api_key or req.llm_model or requested_profile_id)
    if not explicit_llm_override and not chat_profile_id:
        routed_profile_id = _routed_profile_id(user_text, routing_cfg)
    selected_profile_id = requested_profile_id or chat_profile_id or routed_profile_id

    defaults = await _project_llm_defaults(
        req.project_id,
        override_profile_id=selected_profile_id,
        project_doc=project_doc,
    )
    user_role = await _resolve_user_role(req.project_id, req.user)
    chat_policy = (chat_doc or {}).get("tool_policy") if isinstance(chat_doc, dict) else {}
    effective_tool_policy = _merge_tool_policies(
        defaults.get("tool_policy") or {},
        chat_policy if isinstance(chat_policy, dict) else {},
    )
    effective_tool_policy = _apply_role_tool_policy(
        effective_tool_policy,
        role=user_role,
        security_policy=defaults.get("security_policy") or {},
    )
    approval_rows = await db["chat_tool_approvals"].find(
        {"chatId": chat_id, "expiresAt": {"$gt": datetime.utcnow()}},
        {"toolName": 1, "userId": 1, "expiresAt": 1},
    ).to_list(length=400)
    approved_tools = _active_approved_tools(approval_rows, user=req.user)
    if approved_tools:
        effective_tool_policy["approved_tools"] = approved_tools
    grounding_policy = defaults.get("grounding_policy") or {"require_sources": True, "min_sources": 1}
    memory_policy = defaults.get("memory_policy") or {}
    clarification_policy = defaults.get("clarification_policy") or dict(_DEFAULT_CLARIFICATION_POLICY)
    budget_per_goal = max(1, int(clarification_policy.get("budget_per_goal") or 3))
    goal = _goal_ref(clarification_state, derived_goal_id, goal_text=user_text)
    goal_asked_count = max(0, int(goal.get("asked_count") or 0))
    remaining_budget = max(0, budget_per_goal - goal_asked_count)
    destructive_intent = _looks_destructive_intent(raw_user_text or user_text)
    disable_request_user_input_reason = ""
    if bool(clarification_policy.get("enabled", True)):
        if (
            continue_intent
            and bool(clarification_policy.get("continue_forces_progress", True))
            and not destructive_intent
        ):
            disable_request_user_input_reason = "continue_forces_progress"
        elif remaining_budget <= 0:
            disable_request_user_input_reason = "clarification_budget_exhausted"

    answered_questions: list[dict[str, str]] = []
    for row in (goal.get("answered_questions") or []):
        if not isinstance(row, dict):
            continue
        q_key = _as_text(row.get("question_key"))
        q_answer = _as_text(row.get("answer"))
        if not q_key or not q_answer:
            continue
        answered_questions.append(
            {
                "question_key": q_key,
                "answer": q_answer,
                "question": _as_text(row.get("question")),
            }
        )
        if len(answered_questions) >= 64:
            break

    interaction_policy = {
        "goal_id": derived_goal_id,
        "clarification_enabled": bool(clarification_policy.get("enabled", True)),
        "clarification_budget_per_goal": budget_per_goal,
        "clarification_asked_count": goal_asked_count,
        "clarification_budget_remaining": remaining_budget,
        "continue_mode": continue_intent,
        "continue_forces_progress": bool(clarification_policy.get("continue_forces_progress", True)),
        "destructive_intent": destructive_intent,
        "disable_request_user_input": bool(disable_request_user_input_reason),
        "disable_reason": disable_request_user_input_reason,
        "allow_repeat_on_conflict": bool(clarification_policy.get("allow_repeat_on_conflict", True)),
        "conflict_signal": conflict_signal,
        "answered_questions": answered_questions,
    }
    if disable_request_user_input_reason:
        effective_tool_policy["disable_request_user_input"] = True

    conversation_messages_for_agent: list[dict[str, str]] = []
    hierarchical_context_for_agent = ""
    hierarchical_snapshot: dict[str, Any] = {}
    memory_summary_seed = (chat_doc or {}).get("memory_summary") if isinstance(chat_doc, dict) else None
    task_state_seed = (chat_doc or {}).get("task_state") if isinstance(chat_doc, dict) else None
    try:
        chat_state_doc = await db["chats"].find_one(
            {"chat_id": chat_id},
            {"messages": {"$slice": -320}, "memory_summary": 1, "task_state": 1},
        )
        chat_messages_for_context = (chat_state_doc or {}).get("messages") or []
        memory_summary_base = (
            (chat_state_doc or {}).get("memory_summary")
            if isinstance((chat_state_doc or {}).get("memory_summary"), dict)
            else memory_summary_seed
        )
        task_state_base = (
            (chat_state_doc or {}).get("task_state")
            if isinstance((chat_state_doc or {}).get("task_state"), dict)
            else task_state_seed
        )
        memory_bundle = await build_hierarchical_context(
            project_id=req.project_id,
            branch=req.branch,
            user_id=req.user,
            chat_id=chat_id,
            question=user_text,
            messages=chat_messages_for_context,
            memory_summary=memory_summary_base if isinstance(memory_summary_base, dict) else derive_memory_summary(chat_messages_for_context),
            task_state=task_state_base if isinstance(task_state_base, dict) else derive_task_state(chat_messages_for_context, None),
            max_recent_messages=int(memory_policy.get("max_recent_messages") or 42),
            max_recent_chars=int(memory_policy.get("max_recent_chars") or 24000),
            max_retrieved_items=int(memory_policy.get("max_retrieved_items") or 28),
            max_context_chars=int(memory_policy.get("max_context_chars") or 18000),
        )
        conversation_messages_for_agent = [
            row for row in (memory_bundle.get("conversation_messages") or []) if isinstance(row, dict)
        ]
        hierarchical_context_for_agent = _as_text(memory_bundle.get("context_text"))
        hierarchical_snapshot = memory_bundle.get("snapshot") if isinstance(memory_bundle.get("snapshot"), dict) else {}
        memory_summary_seed = (
            memory_bundle.get("memory_summary")
            if isinstance(memory_bundle.get("memory_summary"), dict)
            else memory_summary_seed
        )
        task_state_seed = (
            memory_bundle.get("task_state")
            if isinstance(memory_bundle.get("task_state"), dict)
            else task_state_seed
        )
    except Exception:
        logger.exception(
            "ask_agent.memory_context_failed project=%s branch=%s user=%s chat_id=%s",
            req.project_id,
            req.branch,
            req.user,
            chat_id,
        )
        hierarchical_snapshot = {}

    logger.info(
        "ask_agent.start project=%s branch=%s user=%s chat_id=%s role=%s profile_id=%s provider=%s model=%s pending=%s policy={read_only_only:%s allowed:%s blocked:%s approved:%s} clar={goal:%s asked:%s remaining:%s continue:%s destructive:%s disable:%s reason:%s}",
        req.project_id,
        req.branch,
        req.user,
        chat_id,
        user_role,
        selected_profile_id or defaults.get("llm_profile_id"),
        defaults.get("provider"),
        defaults.get("llm_model"),
        bool(active_pending_question),
        bool(effective_tool_policy.get("read_only_only")),
        len(_as_tool_name_list(effective_tool_policy.get("allowed_tools"))),
        len(_as_tool_name_list(effective_tool_policy.get("blocked_tools"))),
        len(_as_tool_name_list(effective_tool_policy.get("approved_tools"))),
        derived_goal_id,
        goal_asked_count,
        remaining_budget,
        continue_intent,
        destructive_intent,
        bool(disable_request_user_input_reason),
        disable_request_user_input_reason,
    )
    logger.info(
        "ask_agent.memory_context project=%s chat_id=%s recent_messages=%s retrieved=%s conflicts=%s context_chars=%s",
        req.project_id,
        chat_id,
        int(hierarchical_snapshot.get("recent_messages") or 0),
        int(hierarchical_snapshot.get("retrieved_items") or 0),
        int(hierarchical_snapshot.get("retrieval_conflicts") or 0),
        len(hierarchical_context_for_agent),
    )

    effective_question = user_text
    if active_pending_question:
        effective_question = (
            "The user has answered your follow-up question.\n\n"
            f"Follow-up question: {active_pending_question.get('question')}\n"
            f"User answer: {user_text}\n\n"
            "Continue with the task using this answer."
        )
    if req.local_repo_context and req.local_repo_context.strip():
        effective_question = (
            f"{effective_question}\n\n"
            "The frontend executed local repository tools on the developer machine. "
            "Use this evidence directly when relevant:\n\n"
            f"{req.local_repo_context.strip()}"
        )

    active_llm = {
        "base_url": req.llm_base_url or defaults["llm_base_url"],
        "api_key": req.llm_api_key or defaults["llm_api_key"],
        "model": req.llm_model or defaults["llm_model"],
        "profile_id": selected_profile_id or defaults.get("llm_profile_id"),
        "provider": defaults.get("provider"),
    }
    runtime = await build_runtime_for_project(req.project_id)
    routing_mode = None
    if routed_profile_id:
        routing_mode = _route_intent(user_text, routing_cfg)

    async def _run_agent_with_current_llm() -> dict[str, Any]:
        logger.info(
            "ask_agent.agent_call project=%s chat_id=%s provider=%s model=%s profile_id=%s max_tool_calls=%s",
            req.project_id,
            chat_id,
            active_llm.get("provider"),
            active_llm.get("model"),
            active_llm.get("profile_id"),
            int(defaults.get("max_tool_calls") or 12),
        )
        return await answer_with_agent(
            project_id=req.project_id,
            branch=req.branch,
            user_id=req.user,
            question=effective_question,
            llm_base_url=active_llm["base_url"],
            llm_api_key=active_llm["api_key"],
            llm_model=active_llm["model"],
            chat_id=chat_id,
            tool_policy=effective_tool_policy,
            prior_messages=conversation_messages_for_agent,
            system_context=hierarchical_context_for_agent,
            interaction_policy=interaction_policy,
            max_tool_calls=int(defaults.get("max_tool_calls") or 12),
            include_tool_events=True,
            runtime=runtime,
        )

    failover_used = False
    skip_grounding_enforcement = False
    pending_user_question: dict[str, Any] | None = None
    awaiting_user_input = False
    try:
        agent_out = await _run_agent_with_current_llm()
        answer = str((agent_out or {}).get("answer") or "")
        tool_events = (agent_out or {}).get("tool_events") or []
        pending_user_question = _normalize_pending_user_question((agent_out or {}).get("pending_user_question"))
        if pending_user_question:
            pending_user_question["goal_id"] = pending_user_question.get("goal_id") or derived_goal_id
            pending_user_question["question_key"] = _as_text(pending_user_question.get("question_key")) or _normalize_question_key(
                _as_text(pending_user_question.get("question"))
            )
            repeat_answer = _latest_answer_for_question(goal, _as_text(pending_user_question.get("question_key")))
            repeat_allowed = bool(clarification_policy.get("allow_repeat_on_conflict", True)) and conflict_signal
            if repeat_answer and not repeat_allowed:
                logger.info(
                    "ask_agent.clarification_repeat_suppressed project=%s chat_id=%s goal=%s question_key=%s",
                    req.project_id,
                    chat_id,
                    derived_goal_id,
                    _as_text(pending_user_question.get("question_key")),
                )
                pending_user_question = None
                if not _as_text(answer):
                    answer = "Proceeding with the existing answer already provided for that clarification."
            else:
                accepted, state_reason = _record_open_question(
                    clarification_state,
                    goal_id=derived_goal_id,
                    pending_question=pending_user_question,
                    budget_per_goal=budget_per_goal,
                )
                if not accepted:
                    logger.info(
                        "ask_agent.clarification_rejected project=%s chat_id=%s goal=%s reason=%s",
                        req.project_id,
                        chat_id,
                        derived_goal_id,
                        state_reason,
                    )
                    pending_user_question = None
                    if state_reason == "clarification_budget_exhausted":
                        answer = (
                            (answer or "").strip()
                            + "\n\nClarification budget for this goal is exhausted. Continuing with available context."
                        ).strip()
        awaiting_user_input = pending_user_question is not None
        logger.info(
            "ask_agent.agent_done project=%s chat_id=%s tools=%s errors=%s awaiting_user_input=%s",
            req.project_id,
            chat_id,
            len(tool_events),
            sum(1 for ev in tool_events if not bool((ev or {}).get("ok"))),
            awaiting_user_input,
        )
        answer_sources = _collect_answer_sources(tool_events, local_repo_context=req.local_repo_context)
        if awaiting_user_input:
            answer_sources = []
        if not awaiting_user_input and not answer_sources:
            fallback_events, fallback_sources = await _discover_sources_when_missing(
                project_id=req.project_id,
                branch=req.branch,
                user=req.user,
                chat_id=chat_id,
                question=user_text,
                tool_policy=effective_tool_policy,
                local_repo_context=req.local_repo_context,
            )
            if fallback_events:
                tool_events = [*tool_events, *[ev for ev in fallback_events if bool((ev or {}).get("ok"))]]
            if fallback_sources:
                answer_sources = fallback_sources
    except LLMUpstreamError as err:
        detail = str(err)
        fallback_profile_id = str(routing_cfg.get("fallback_profile_id") or "").strip() or None
        can_failover = (
            not explicit_llm_override
            and bool(fallback_profile_id)
            and fallback_profile_id != _as_text(active_llm.get("profile_id"))
        )

        if can_failover:
            try:
                failover_defaults = await _project_llm_defaults(
                    req.project_id,
                    override_profile_id=fallback_profile_id,
                    project_doc=project_doc,
                )
                active_llm.update(
                    {
                        "base_url": failover_defaults.get("llm_base_url"),
                        "api_key": failover_defaults.get("llm_api_key"),
                        "model": failover_defaults.get("llm_model"),
                        "profile_id": failover_defaults.get("llm_profile_id") or fallback_profile_id,
                        "provider": failover_defaults.get("provider"),
                    }
                )
                agent_out = await _run_agent_with_current_llm()
                answer = str((agent_out or {}).get("answer") or "")
                tool_events = (agent_out or {}).get("tool_events") or []
                pending_user_question = _normalize_pending_user_question((agent_out or {}).get("pending_user_question"))
                if pending_user_question:
                    pending_user_question["goal_id"] = pending_user_question.get("goal_id") or derived_goal_id
                    pending_user_question["question_key"] = _as_text(
                        pending_user_question.get("question_key")
                    ) or _normalize_question_key(_as_text(pending_user_question.get("question")))
                    repeat_answer = _latest_answer_for_question(goal, _as_text(pending_user_question.get("question_key")))
                    repeat_allowed = bool(clarification_policy.get("allow_repeat_on_conflict", True)) and conflict_signal
                    if repeat_answer and not repeat_allowed:
                        pending_user_question = None
                        if not _as_text(answer):
                            answer = "Proceeding with the existing answer already provided for that clarification."
                    else:
                        accepted, state_reason = _record_open_question(
                            clarification_state,
                            goal_id=derived_goal_id,
                            pending_question=pending_user_question,
                            budget_per_goal=budget_per_goal,
                        )
                        if not accepted:
                            pending_user_question = None
                            if state_reason == "clarification_budget_exhausted":
                                answer = (
                                    (answer or "").strip()
                                    + "\n\nClarification budget for this goal is exhausted. Continuing with available context."
                                ).strip()
                awaiting_user_input = pending_user_question is not None
                logger.info(
                    "ask_agent.failover_done project=%s chat_id=%s tools=%s errors=%s awaiting_user_input=%s",
                    req.project_id,
                    chat_id,
                    len(tool_events),
                    sum(1 for ev in tool_events if not bool((ev or {}).get("ok"))),
                    awaiting_user_input,
                )
                answer_sources = _collect_answer_sources(tool_events, local_repo_context=req.local_repo_context)
                if awaiting_user_input:
                    answer_sources = []
                failover_used = True
            except Exception:
                logger.exception(
                    "LLM failover failed project=%s branch=%s user=%s fallback_profile=%s",
                    req.project_id,
                    req.branch,
                    req.user,
                    fallback_profile_id,
                )
                detail_lc = detail.lower()
                logger.warning(
                    "LLM upstream error for project=%s branch=%s user=%s: %s",
                    req.project_id,
                    req.branch,
                    req.user,
                    err,
                )
                if "quota" in detail_lc or "insufficient_quota" in detail_lc:
                    answer = (
                        "The configured OpenAI API key has no remaining quota or billing is not active. "
                        "Update billing/quota for that key, use another OpenAI key, or switch provider/model in Project Settings.\n\n"
                        f"Details: {detail}"
                    )
                else:
                    answer = (
                        "The configured LLM provider is temporarily unavailable or rate limited. "
                        "Please try again shortly, or switch model/provider in Project Settings.\n\n"
                        f"Details: {detail}"
                    )
                tool_events = []
                answer_sources = []
                pending_user_question = None
                awaiting_user_input = False
                skip_grounding_enforcement = True
        else:
            detail_lc = detail.lower()
            logger.warning(
                "LLM upstream error for project=%s branch=%s user=%s: %s",
                req.project_id,
                req.branch,
                req.user,
                err,
            )
            if "quota" in detail_lc or "insufficient_quota" in detail_lc:
                answer = (
                    "The configured OpenAI API key has no remaining quota or billing is not active. "
                    "Update billing/quota for that key, use another OpenAI key, or switch provider/model in Project Settings.\n\n"
                    f"Details: {detail}"
                )
            else:
                answer = (
                    "The configured LLM provider is temporarily unavailable or rate limited. "
                    "Please try again shortly, or switch model/provider in Project Settings.\n\n"
                    f"Details: {detail}"
                )
            tool_events = []
            answer_sources = []
            pending_user_question = None
            awaiting_user_input = False
            skip_grounding_enforcement = True
    except Exception:
        logger.exception(
            "Unexpected ask_agent failure for project=%s branch=%s user=%s",
            req.project_id,
            req.branch,
            req.user,
        )
        answer = (
            "I hit an internal error while generating the answer. "
            "Please try again in a moment."
        )
        tool_events = []
        answer_sources = []
        pending_user_question = None
        awaiting_user_input = False
        skip_grounding_enforcement = True

    if not awaiting_user_input and not answer_sources:
        _, discovered_sources = await _discover_sources_when_missing(
            project_id=req.project_id,
            branch=req.branch,
            user=req.user,
            chat_id=chat_id,
            question=user_text,
            tool_policy=effective_tool_policy,
            local_repo_context=req.local_repo_context,
        )
        if discovered_sources:
            answer_sources = discovered_sources

    if awaiting_user_input:
        grounded_ok = True
    elif skip_grounding_enforcement:
        grounded_ok = bool(answer_sources)
    else:
        answer, grounded_ok = _enforce_grounded_answer(answer, answer_sources, grounding_policy)

    # append assistant message
    done = datetime.utcnow()
    tool_summary = {
        "calls": len(tool_events),
        "errors": sum(1 for ev in tool_events if not bool((ev or {}).get("ok"))),
        "cached_hits": sum(1 for ev in tool_events if bool((ev or {}).get("cached"))),
    }
    tool_error_details: list[str] = []
    for ev in tool_events:
        if not isinstance(ev, dict) or bool(ev.get("ok")):
            continue
        tool_name = _as_text(ev.get("tool")) or "tool"
        err = ev.get("error") if isinstance(ev.get("error"), dict) else {}
        code = _as_text(err.get("code")) or "error"
        msg = _as_text(err.get("message"))
        tool_error_details.append(f"{tool_name}:{code}:{msg[:120]}")
        if len(tool_error_details) >= 8:
            break
    clarification_state["active_goal_id"] = derived_goal_id
    clarification_state["updated_at"] = _iso_utc(done)
    goal_state_current = _goal_ref(clarification_state, derived_goal_id)
    assistant_meta = {
        "tool_summary": tool_summary,
        "sources": answer_sources,
        "grounded": grounded_ok,
        "pending_user_question": pending_user_question,
        "clarification": {
            "goal_id": derived_goal_id,
            "policy": interaction_policy,
            "state": {
                "asked_count": int((goal_state_current.get("asked_count") or 0)),
                "answered_count": int((goal_state_current.get("answered_count") or 0)),
                "open_questions": len(goal_state_current.get("open_questions") or []),
            },
        },
        "memory": {
            "hierarchical_snapshot": hierarchical_snapshot,
        },
        "llm": {
            "provider": active_llm.get("provider"),
            "model": active_llm.get("model"),
            "profile_id": active_llm.get("profile_id"),
            "routed_mode": routing_mode,
            "failover_used": failover_used,
        },
    }
    await db["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$push": {
                "messages": {
                    "role": "assistant",
                    "content": answer,
                    "ts": done,
                    "meta": assistant_meta,
                }
            },
            "$set": {
                "updated_at": done,
                "last_message_at": done,
                "last_message_preview": answer[:160],
                "pending_user_question": pending_user_question,
                "clarification_state": clarification_state,
                "hierarchical_memory": {
                    "snapshot": hierarchical_snapshot,
                    "updated_at": done.isoformat() + "Z",
                },
            },
        },
    )
    memory_state = await _update_chat_memory_summary(chat_id)
    memory_summary = (memory_state or {}).get("memory_summary") if isinstance(memory_state, dict) else None
    task_state = (memory_state or {}).get("task_state") if isinstance(memory_state, dict) else None
    if not isinstance(memory_summary, dict):
        memory_summary = memory_summary_seed if isinstance(memory_summary_seed, dict) else {}
    if not isinstance(task_state, dict):
        task_state = task_state_seed if isinstance(task_state_seed, dict) else {}
    try:
        await persist_hierarchical_memory(
            project_id=req.project_id,
            branch=req.branch,
            user_id=req.user,
            chat_id=chat_id,
            memory_summary=memory_summary if isinstance(memory_summary, dict) else {},
            task_state=task_state if isinstance(task_state, dict) else {},
            answer_sources=answer_sources if isinstance(answer_sources, list) else [],
            tool_events=tool_events if isinstance(tool_events, list) else [],
            user_message_text=user_text,
            assistant_message_text=answer,
        )
    except Exception:
        logger.exception(
            "ask_agent.persist_hierarchical_memory_failed project=%s branch=%s chat_id=%s",
            req.project_id,
            req.branch,
            chat_id,
        )
    logger.info(
        "ask_agent.finish project=%s branch=%s user=%s chat_id=%s grounded=%s sources=%s tools=%s tool_errors=%s pending_user_input=%s tool_error_details=%s",
        req.project_id,
        req.branch,
        req.user,
        chat_id,
        grounded_ok,
        len(answer_sources),
        len(tool_events),
        sum(1 for ev in tool_events if not bool((ev or {}).get("ok"))),
        awaiting_user_input,
        tool_error_details,
    )

    if tool_events:
        try:
            docs = []
            for ev in tool_events:
                row = ev or {}
                err = row.get("error") or {}
                docs.append(
                    {
                        "project_id": req.project_id,
                        "chat_id": chat_id,
                        "branch": req.branch,
                        "user": req.user,
                        "tool": str(row.get("tool") or ""),
                        "ok": bool(row.get("ok")),
                        "duration_ms": int(row.get("duration_ms") or 0),
                        "attempts": int(row.get("attempts") or 1),
                        "cached": bool(row.get("cached")),
                        "input_bytes": int(row.get("input_bytes") or 0),
                        "result_bytes": int(row.get("result_bytes") or 0),
                        "error_code": str(err.get("code") or "") or None,
                        "error_message": str(err.get("message") or "") or None,
                        "created_at": done,
                    }
                )
            if docs:
                await db["tool_events"].insert_many(docs, ordered=False)
        except Exception:
            logger.exception("Failed to persist tool events for chat_id=%s", chat_id)

    return {
        "answer": answer,
        "chat_id": chat_id,
        "tool_events": tool_events,
        "sources": answer_sources,
        "grounded": grounded_ok,
        "memory_summary": memory_summary,
        "task_state": task_state,
        "hierarchical_memory": {"snapshot": hierarchical_snapshot},
        "pending_user_question": pending_user_question,
        "clarification_state": clarification_state,
    }
