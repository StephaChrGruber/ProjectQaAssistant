import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from ..db import get_db
from datetime import datetime
from bson import ObjectId
from ..rag.agent2 import LLMUpstreamError, answer_with_agent
from ..services.llm_profiles import resolve_project_llm_config

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


async def _project_llm_defaults(project_id: str, *, override_profile_id: str | None = None) -> dict[str, Any]:
    db = get_db()
    q = {"key": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    project = await db["projects"].find_one(q) or {}
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


def _as_text(v: Any) -> str:
    return str(v or "").strip()


def _looks_like_url(v: str) -> bool:
    s = _as_text(v).lower()
    return s.startswith("http://") or s.startswith("https://")


def _source_kind(path: str | None, url: str | None) -> str:
    p = _as_text(path).replace("\\", "/")
    if _looks_like_url(_as_text(url)):
        return "url"
    if p.startswith("documentation/") and p.lower().endswith(".md"):
        return "documentation"
    return "file"


def _append_source(
    out: list[dict[str, Any]],
    seen: set[str],
    *,
    label: str,
    path: str | None = None,
    url: str | None = None,
    source_type: str | None = None,
    line: int | None = None,
) -> None:
    clean_label = _as_text(label) or "Source"
    clean_path = _as_text(path) or None
    clean_url = _as_text(url) or None
    clean_source = _as_text(source_type) or None
    clean_line = int(line) if isinstance(line, int) and line > 0 else None

    kind = _source_kind(clean_path, clean_url)
    key = f"{kind}|{clean_url or ''}|{clean_path or ''}|{clean_line or 0}|{clean_label}"
    if key in seen:
        return
    seen.add(key)

    item: dict[str, Any] = {
        "label": clean_label,
        "kind": kind,
    }
    if clean_source:
        item["source"] = clean_source
    if clean_url:
        item["url"] = clean_url
    if clean_path:
        item["path"] = clean_path
    if clean_line:
        item["line"] = clean_line
    out.append(item)


def _extract_sources_from_tool_event(ev: dict[str, Any], out: list[dict[str, Any]], seen: set[str]) -> None:
    if not bool(ev.get("ok")):
        return
    tool = _as_text(ev.get("tool"))
    result = ev.get("result")
    if not isinstance(result, dict):
        return

    if tool == "repo_grep":
        for m in (result.get("matches") or [])[:20]:
            if not isinstance(m, dict):
                continue
            path = _as_text(m.get("path"))
            line = m.get("line")
            _append_source(
                out,
                seen,
                label=f"{path}:{line}" if path and isinstance(line, int) else (path or "repo_grep"),
                path=path or None,
                source_type="repo_grep",
                line=line if isinstance(line, int) else None,
            )
        return

    if tool == "open_file":
        path = _as_text(result.get("path"))
        line = result.get("start_line")
        _append_source(
            out,
            seen,
            label=f"{path}:{line}" if path and isinstance(line, int) else (path or "open_file"),
            path=path or None,
            source_type="open_file",
            line=line if isinstance(line, int) else None,
        )
        return

    if tool == "keyword_search":
        for h in (result.get("hits") or [])[:20]:
            if not isinstance(h, dict):
                continue
            path = _as_text(h.get("path"))
            title = _as_text(h.get("title")) or path or "keyword hit"
            _append_source(
                out,
                seen,
                label=title,
                path=path or None,
                source_type=_as_text(h.get("source")) or "keyword",
            )
        return

    if tool == "chroma_search_chunks":
        for item in (result.get("items") or [])[:20]:
            if not isinstance(item, dict):
                continue
            _append_source(
                out,
                seen,
                label=_as_text(item.get("title")) or _as_text(item.get("url")) or "chroma chunk",
                path=_as_text(item.get("path")) or None,
                url=_as_text(item.get("url")) or None,
                source_type=_as_text(item.get("source")) or "chroma",
            )
        return

    if tool == "chroma_open_chunks":
        for item in (result.get("result") or [])[:20]:
            if not isinstance(item, dict):
                continue
            _append_source(
                out,
                seen,
                label=_as_text(item.get("title")) or _as_text(item.get("url")) or "chroma chunk",
                path=_as_text(item.get("path")) or None,
                url=_as_text(item.get("url")) or None,
                source_type=_as_text(item.get("source")) or "chroma",
            )
        return

    if tool == "read_docs_folder":
        for file_doc in (result.get("files") or [])[:20]:
            if not isinstance(file_doc, dict):
                continue
            path = _as_text(file_doc.get("path"))
            _append_source(out, seen, label=path or "documentation", path=path or None, source_type="documentation")
        return

    # Generic fallback for tool outputs that already include url/path/title.
    for key in ("items", "result", "hits", "files", "entries"):
        rows = result.get(key)
        if not isinstance(rows, list):
            continue
        for item in rows[:20]:
            if not isinstance(item, dict):
                continue
            url = _as_text(item.get("url"))
            path = _as_text(item.get("path"))
            title = _as_text(item.get("title")) or path or url or f"{tool} source"
            if not (url or path):
                continue
            _append_source(
                out,
                seen,
                label=title,
                path=path or None,
                url=url or None,
                source_type=_as_text(item.get("source")) or tool,
            )


def _collect_answer_sources(tool_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ev in tool_events or []:
        if not isinstance(ev, dict):
            continue
        _extract_sources_from_tool_event(ev, out, seen)
        if len(out) >= 24:
            break
    return out[:24]


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
            "llm_profile_id": None,
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )

    requested_profile_id = (req.llm_profile_id or "").strip() or None
    if requested_profile_id is not None:
        await get_db()["chats"].update_one(
            {"chat_id": chat_id},
            {"$set": {"llm_profile_id": requested_profile_id, "updated_at": now}},
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
    chat_doc = await get_db()["chats"].find_one({"chat_id": chat_id}, {"tool_policy": 1, "llm_profile_id": 1})
    chat_profile_id = None
    if isinstance(chat_doc, dict):
        chat_profile_id = (chat_doc.get("llm_profile_id") or "").strip() or None
    defaults = await _project_llm_defaults(
        req.project_id,
        override_profile_id=requested_profile_id or chat_profile_id,
    )
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
        answer_sources = _collect_answer_sources(tool_events)
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
        answer_sources = []
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
            "$push": {
                "messages": {
                    "role": "assistant",
                    "content": answer,
                    "ts": done,
                    "meta": {"tool_summary": tool_summary, "sources": answer_sources},
                }
            },
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

    return {"answer": answer, "chat_id": chat_id, "tool_events": tool_events, "sources": answer_sources}
