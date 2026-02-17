import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from ..db import get_db
from datetime import datetime
from bson import ObjectId
from ..settings import settings

from ..rag.agent2 import LLMUpstreamError, answer_with_agent

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


async def _project_llm_defaults(project_id: str) -> dict[str, Any]:
    db = get_db()
    q = {"key": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    project = await db["projects"].find_one(q) or {}

    provider = (project.get("llm_provider") or "").strip().lower()
    base_url = (project.get("llm_base_url") or "").strip() or None
    api_key = (project.get("llm_api_key") or "").strip() or None
    model = (project.get("llm_model") or "").strip() or None

    # Legacy placeholder should never be used as OpenAI key.
    if api_key and api_key.lower() == "ollama":
        api_key = None

    # Provider-aware defaults for OpenAI-compatible clients.
    if provider == "ollama":
        base_url = base_url or "http://ollama:11434/v1"
        api_key = api_key or "ollama"
        model = model or settings.LLM_MODEL or "llama3.2:3b"
    elif provider in ("openai", "chatgpt"):
        base_url = base_url or "https://api.openai.com/v1"
        api_key = api_key or settings.OPENAI_API_KEY or settings.LLM_API_KEY
        model = model or "gpt-4o-mini"
    else:
        # Legacy/global fallback.
        base_url = base_url or settings.LLM_BASE_URL or "http://ollama:11434/v1"
        api_key = api_key or settings.LLM_API_KEY
        model = model or settings.LLM_MODEL or "llama3.2:3b"

    return {
        "llm_base_url": base_url,
        "llm_api_key": api_key,
        "llm_model": model,
        "tool_policy": _extract_tool_policy(project),
        "max_tool_calls": _extract_max_tool_calls(project),
    }


def _as_tool_name_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s:
            out.append(s)
    return out


def _extract_tool_policy(project: dict) -> dict:
    extra = project.get("extra") if isinstance(project, dict) else {}
    if not isinstance(extra, dict):
        extra = {}
    tooling = extra.get("tooling")
    if not isinstance(tooling, dict):
        tooling = {}

    raw = tooling.get("tool_policy")
    if not isinstance(raw, dict):
        raw = tooling

    policy: dict[str, object] = {}
    allowed = _as_tool_name_list(raw.get("allowed_tools") or raw.get("allow_tools"))
    blocked = _as_tool_name_list(raw.get("blocked_tools") or raw.get("deny_tools"))
    if allowed:
        policy["allowed_tools"] = allowed
    if blocked:
        policy["blocked_tools"] = blocked
    if bool(raw.get("read_only_only")):
        policy["read_only_only"] = True

    for key in ("timeout_overrides", "rate_limit_overrides", "retry_overrides", "cache_ttl_overrides"):
        value = raw.get(key)
        if isinstance(value, dict):
            cleaned: dict[str, int] = {}
            for k, v in value.items():
                try:
                    cleaned[str(k)] = int(v)
                except Exception:
                    continue
            if cleaned:
                policy[key] = cleaned

    return policy


def _extract_max_tool_calls(project: dict) -> int:
    extra = project.get("extra") if isinstance(project, dict) else {}
    if not isinstance(extra, dict):
        extra = {}
    tooling = extra.get("tooling")
    if not isinstance(tooling, dict):
        tooling = {}
    raw = tooling.get("max_tool_calls")
    try:
        value = int(raw)
    except Exception:
        return 12
    return max(1, min(value, 80))


def _merge_tool_policies(base_policy: dict, chat_policy: dict) -> dict:
    base = base_policy if isinstance(base_policy, dict) else {}
    chat = chat_policy if isinstance(chat_policy, dict) else {}
    merged: dict[str, Any] = {}

    base_allowed = _as_tool_name_list(base.get("allowed_tools") or base.get("allow_tools"))
    chat_allowed = _as_tool_name_list(chat.get("allowed_tools") or chat.get("allow_tools"))
    if chat_allowed:
        if base_allowed:
            allowed_set = set(base_allowed)
            merged["allowed_tools"] = [t for t in chat_allowed if t in allowed_set]
        else:
            merged["allowed_tools"] = chat_allowed
    elif base_allowed:
        merged["allowed_tools"] = base_allowed

    base_blocked = set(_as_tool_name_list(base.get("blocked_tools") or base.get("deny_tools")))
    chat_blocked = set(_as_tool_name_list(chat.get("blocked_tools") or chat.get("deny_tools")))
    blocked = sorted(base_blocked.union(chat_blocked))
    if blocked:
        merged["blocked_tools"] = blocked

    merged["read_only_only"] = bool(base.get("read_only_only")) or bool(chat.get("read_only_only"))

    for key in ("timeout_overrides", "rate_limit_overrides", "retry_overrides", "cache_ttl_overrides"):
        out: dict[str, int] = {}
        for source in (base.get(key), chat.get(key)):
            if not isinstance(source, dict):
                continue
            for k, v in source.items():
                try:
                    out[str(k)] = int(v)
                except Exception:
                    continue
        if out:
            merged[key] = out

    return merged


@router.post("/ask_agent")
async def ask_agent(req: AskReq):
    chat_id = req.chat_id or f"{req.project_id}::{req.branch}::{req.user}"
    now = datetime.utcnow()

    # ensure chat
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$setOnInsert": {
            "chat_id": chat_id,
            "project_id": req.project_id,
            "branch": req.branch,
            "user": req.user,
            "title": "New chat",
            "messages": [],
            "tool_policy": {},
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )

    # append user message
    user_msg = {"role": "user", "content": req.question, "ts": now}
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$push": {"messages": user_msg},
            "$set": {
                "updated_at": now,
                "last_message_at": now,
                "last_message_preview": req.question[:160],
            },
            "$setOnInsert": {"title": req.question[:60] or "New chat"},
        },
    )

    # run retrieval + llm
    defaults = await _project_llm_defaults(req.project_id)
    chat_doc = await get_db()["chats"].find_one({"chat_id": chat_id}, {"tool_policy": 1})
    chat_policy = (chat_doc or {}).get("tool_policy") if isinstance(chat_doc, dict) else {}
    effective_tool_policy = _merge_tool_policies(defaults.get("tool_policy") or {}, chat_policy if isinstance(chat_policy, dict) else {})
    effective_question = req.question
    if req.local_repo_context and req.local_repo_context.strip():
        effective_question = (
            f"{req.question}\n\n"
            "The frontend executed local repository tools on the developer machine. "
            "Use this evidence directly when relevant:\n\n"
            f"{req.local_repo_context.strip()}"
        )

    try:
        agent_out = await answer_with_agent(
            project_id=req.project_id,
            branch=req.branch,
            user_id=req.user,
            question=effective_question,
            llm_base_url=req.llm_base_url or defaults["llm_base_url"],
            llm_api_key=req.llm_api_key or defaults["llm_api_key"],
            llm_model=req.llm_model or defaults["llm_model"],
            chat_id=chat_id,
            tool_policy=effective_tool_policy,
            max_tool_calls=int(defaults.get("max_tool_calls") or 12),
            include_tool_events=True,
        )
        answer = str((agent_out or {}).get("answer") or "")
        tool_events = (agent_out or {}).get("tool_events") or []
    except LLMUpstreamError as err:
        detail = str(err)
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

    # append assistant message
    done = datetime.utcnow()
    tool_summary = {
        "calls": len(tool_events),
        "errors": sum(1 for ev in tool_events if not bool((ev or {}).get("ok"))),
        "cached_hits": sum(1 for ev in tool_events if bool((ev or {}).get("cached"))),
    }
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$push": {"messages": {"role": "assistant", "content": answer, "ts": done, "meta": {"tool_summary": tool_summary}}},
            "$set": {
                "updated_at": done,
                "last_message_at": done,
                "last_message_preview": answer[:160],
            },
        },
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
                await get_db()["tool_events"].insert_many(docs, ordered=False)
        except Exception:
            logger.exception("Failed to persist tool events for chat_id=%s", chat_id)

    return {"answer": answer, "chat_id": chat_id, "tool_events": tool_events}
