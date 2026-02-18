import logging
import re
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

router = APIRouter()
logger = logging.getLogger(__name__)
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
_SOURCE_CONFIDENCE_BY_TOOL = {
    "open_file": 0.96,
    "git_show_file_at_ref": 0.95,
    "repo_grep": 0.92,
    "symbol_search": 0.9,
    "repo_tree": 0.86,
    "keyword": 0.82,
    "chroma": 0.8,
    "documentation": 0.9,
    "browser_local_repo": 0.88,
    "compare_branches": 0.9,
    "create_jira_issue": 0.99,
    "write_documentation_file": 0.98,
    "create_chat_task": 0.97,
}

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


def _project_extra(project: dict[str, Any]) -> dict[str, Any]:
    extra = project.get("extra") if isinstance(project, dict) else {}
    return extra if isinstance(extra, dict) else {}


def _extract_grounding_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = _project_extra(project)
    grounding = extra.get("grounding")
    if not isinstance(grounding, dict):
        grounding = {}
    return {
        "require_sources": bool(grounding.get("require_sources", True)),
        "min_sources": max(1, min(int(grounding.get("min_sources") or 1), 5)),
    }


def _extract_security_policy(project: dict[str, Any]) -> dict[str, Any]:
    extra = _project_extra(project)
    security = extra.get("security")
    if not isinstance(security, dict):
        security = {}
    return {
        "read_only_for_non_admin": bool(security.get("read_only_for_non_admin", True)),
        "allow_write_tools_for_members": bool(security.get("allow_write_tools_for_members", False)),
    }


def _extract_llm_routing(project: dict[str, Any]) -> dict[str, Any]:
    extra = _project_extra(project)
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


def _route_intent(question: str, routing_cfg: dict[str, Any]) -> str:
    q = _as_text(question).lower()
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


def _routed_profile_id(question: str, routing_cfg: dict[str, Any]) -> str | None:
    if not bool(routing_cfg.get("enabled")):
        return None
    intent = _route_intent(question, routing_cfg)
    if intent == "fast":
        return routing_cfg.get("fast_profile_id")
    return routing_cfg.get("strong_profile_id") or routing_cfg.get("fast_profile_id")


def _confidence_for_source(source_type: str | None) -> float | None:
    t = _as_text(source_type).lower()
    if not t:
        return None
    if t in _SOURCE_CONFIDENCE_BY_TOOL:
        return _SOURCE_CONFIDENCE_BY_TOOL[t]
    for key, score in _SOURCE_CONFIDENCE_BY_TOOL.items():
        if key in t:
            return score
    return 0.75


def _compact_snippet(v: Any, *, max_chars: int = 280) -> str | None:
    s = _as_text(v)
    if not s:
        return None
    one_line = re.sub(r"\s+", " ", s).strip()
    if not one_line:
        return None
    if len(one_line) > max_chars:
        return one_line[:max_chars].rstrip() + "..."
    return one_line


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
        "project": project,
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


async def _resolve_user_role(project_id: str, user_hint: str) -> str:
    email = _as_text(user_hint).lower()
    if not email:
        return "viewer"

    db = get_db()
    user = await db["users"].find_one({"email": email}, {"_id": 1, "isGlobalAdmin": 1})
    if not user:
        return "viewer"
    if bool(user.get("isGlobalAdmin")):
        return "admin"

    membership = await db["memberships"].find_one(
        {"userId": str(user.get("_id")), "projectId": project_id},
        {"role": 1},
    )
    role = _as_text((membership or {}).get("role")).lower()
    if role in {"admin", "member", "viewer"}:
        return role
    return "viewer"


def _apply_role_tool_policy(
    tool_policy: dict[str, Any],
    *,
    role: str,
    security_policy: dict[str, Any],
) -> dict[str, Any]:
    policy = dict(tool_policy or {})
    role_norm = _as_text(role).lower() or "viewer"
    if role_norm == "admin":
        return policy

    blocked = set(_as_tool_name_list(policy.get("blocked_tools") or policy.get("deny_tools")))
    blocked.update({"create_jira_issue", "write_documentation_file"})
    if role_norm != "member" or not bool(security_policy.get("allow_write_tools_for_members")):
        blocked.update({"run_tests", "generate_project_docs", "create_chat_task"})
    if blocked:
        policy["blocked_tools"] = sorted(blocked)

    if bool(security_policy.get("read_only_for_non_admin", True)):
        policy["read_only_only"] = True
    return policy


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


def _active_approved_tools(rows: list[dict[str, Any]], *, user: str) -> list[str]:
    now = datetime.utcnow()
    user_norm = _as_text(user).lower()
    out: list[str] = []
    seen: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        row_user = _as_text(row.get("userId")).lower()
        if row_user and user_norm and row_user != user_norm:
            continue
        exp = row.get("expiresAt")
        if isinstance(exp, datetime) and exp <= now:
            continue
        name = _as_text(row.get("toolName"))
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def _as_text(v: Any) -> str:
    return str(v or "").strip()


def _normalize_pending_user_question(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pending_id = _as_text(raw.get("id"))
    question = _as_text(raw.get("question"))
    if not pending_id or not question:
        return None

    mode = _as_text(raw.get("answer_mode")).lower()
    answer_mode = "single_choice" if mode == "single_choice" else "open_text"

    options: list[str] = []
    seen: set[str] = set()
    for item in raw.get("options") or []:
        s = _as_text(item)
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
    created = raw.get("created_at")
    if isinstance(created, datetime):
        out["created_at"] = created.isoformat() + "Z"
    else:
        created_text = _as_text(created)
        if created_text:
            out["created_at"] = created_text
    return out


def _resolve_pending_user_answer(req: AskReq, pending: dict[str, Any]) -> str:
    requested_pending_id = _as_text(req.pending_question_id)
    active_pending_id = _as_text(pending.get("id"))
    if requested_pending_id and requested_pending_id != active_pending_id:
        raise HTTPException(
            status_code=409,
            detail="The pending question changed. Reload chat and answer the latest prompt.",
        )

    raw_answer = _as_text(req.pending_answer or req.question)
    mode = _as_text(pending.get("answer_mode")).lower()
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


def _as_line(v: Any) -> int | None:
    if isinstance(v, int):
        return v if v > 0 else None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            n = int(s)
            return n if n > 0 else None
        except Exception:
            return None
    return None


def _normalize_path_text(v: Any) -> str | None:
    s = _as_text(v).replace("\\", "/").replace("./", "", 1)
    if not s:
        return None
    if s.startswith("/"):
        return None
    if "://" in s:
        return None
    if ".." in s:
        return None
    if re.search(r"\s", s):
        return None
    base = s.rsplit("/", 1)[-1].lower()
    if "/" not in s and "." not in s and base not in {"dockerfile", "makefile", "readme", "license"}:
        return None
    return s


def _extract_path_and_line_from_text(v: Any) -> tuple[str | None, int | None]:
    text = _as_text(v)
    if not text:
        return None, None

    # Examples:
    # - src/app/main.ts:42
    # - src/app/main.ts:42:7
    # - documentation/setup.md
    m = re.search(r"(?P<path>[A-Za-z0-9_./-]+(?:\.[A-Za-z0-9_-]+)?)(?::(?P<line>\d+))?(?::\d+)?", text)
    if not m:
        return None, None

    path = _normalize_path_text(m.group("path"))
    line = _as_line(m.group("line"))
    return path, line


def _append_source(
    out: list[dict[str, Any]],
    seen: set[str],
    *,
    label: str,
    path: str | None = None,
    url: str | None = None,
    source_type: str | None = None,
    line: int | None = None,
    snippet: str | None = None,
    confidence: float | None = None,
) -> None:
    clean_label = _as_text(label) or "Source"
    clean_path = _as_text(path) or None
    clean_url = _as_text(url) or None
    clean_source = _as_text(source_type) or None
    clean_line = int(line) if isinstance(line, int) and line > 0 else None
    clean_snippet = _compact_snippet(snippet)
    conf = None
    if isinstance(confidence, (float, int)):
        conf = round(max(0.0, min(float(confidence), 1.0)), 2)
    if conf is None:
        conf = _confidence_for_source(clean_source)

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
    if clean_snippet:
        item["snippet"] = clean_snippet
    if conf is not None:
        item["confidence"] = conf
    out.append(item)


def _append_source_from_row(
    out: list[dict[str, Any]],
    seen: set[str],
    *,
    row: dict[str, Any],
    default_label: str,
    source_type: str,
) -> None:
    url = _as_text(row.get("url")) or None
    path = _normalize_path_text(row.get("path"))
    title = _as_text(row.get("title")) or _as_text(row.get("name")) or default_label
    line = _as_line(row.get("line") or row.get("start_line"))
    snippet = _compact_snippet(row.get("snippet") or row.get("preview") or row.get("text") or row.get("content"))

    if not path and not url:
        inferred_path, inferred_line = _extract_path_and_line_from_text(
            row.get("path")
            or row.get("file")
            or row.get("filename")
            or row.get("source")
            or row.get("id")
            or row.get("ref")
            or row.get("title")
            or row.get("label")
        )
        path = inferred_path
        line = line or inferred_line

    if not path and not url and _looks_like_url(title):
        url = title

    if not path and not url and title == default_label:
        return

    _append_source(
        out,
        seen,
        label=title if title else (path or url or default_label),
        path=path,
        url=url,
        source_type=source_type,
        line=line,
        snippet=snippet,
    )


def _walk_tool_result_for_sources(
    value: Any,
    out: list[dict[str, Any]],
    seen: set[str],
    *,
    source_type: str,
    depth: int = 0,
) -> None:
    if depth > 4 or len(out) >= 24:
        return
    if isinstance(value, dict):
        _append_source_from_row(
            out,
            seen,
            row=value,
            default_label=f"{source_type} source",
            source_type=source_type,
        )
        for k, v in value.items():
            if k in {"content", "snippet", "diff", "output", "messages"}:
                continue
            _walk_tool_result_for_sources(v, out, seen, source_type=source_type, depth=depth + 1)
        return
    if isinstance(value, list):
        for item in value[:40]:
            _walk_tool_result_for_sources(item, out, seen, source_type=source_type, depth=depth + 1)
            if len(out) >= 24:
                break
        return
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return
        if _looks_like_url(s):
            _append_source(out, seen, label=s, url=s, source_type=source_type, snippet=s)
            return
        path, line = _extract_path_and_line_from_text(s)
        if path:
            _append_source(
                out,
                seen,
                label=f"{path}:{line}" if line else path,
                path=path,
                source_type=source_type,
                line=line,
                snippet=s,
            )


def _extract_sources_from_tool_event(ev: dict[str, Any], out: list[dict[str, Any]], seen: set[str]) -> None:
    if not bool(ev.get("ok")):
        return
    tool = _as_text(ev.get("tool"))
    if tool == "request_user_input":
        return
    result = ev.get("result")
    if not isinstance(result, dict):
        _walk_tool_result_for_sources(result, out, seen, source_type=tool or "tool")
        return

    if tool == "repo_grep":
        for m in (result.get("matches") or [])[:20]:
            if not isinstance(m, dict):
                continue
            path = _as_text(m.get("path"))
            line = _as_line(m.get("line"))
            _append_source(
                out,
                seen,
                label=f"{path}:{line}" if path and line else (path or "repo_grep"),
                path=path or None,
                source_type="repo_grep",
                line=line,
                snippet=_compact_snippet(m.get("snippet")),
            )
        return

    if tool in {"open_file", "git_show_file_at_ref"}:
        path = _normalize_path_text(result.get("path")) or _as_text(result.get("path"))
        line = _as_line(result.get("start_line"))
        _append_source(
            out,
            seen,
            label=f"{path}:{line}" if path and line else (path or tool),
            path=path or None,
            source_type=tool,
            line=line,
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
                snippet=_compact_snippet(h.get("preview")),
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
                snippet=_compact_snippet(item.get("text") or item.get("snippet")),
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
                snippet=_compact_snippet(item.get("text") or item.get("snippet")),
            )
        return

    if tool == "read_docs_folder":
        for file_doc in (result.get("files") or [])[:20]:
            if not isinstance(file_doc, dict):
                continue
            path = _as_text(file_doc.get("path"))
            _append_source(out, seen, label=path or "documentation", path=path or None, source_type="documentation")
        return

    if tool == "symbol_search":
        for item in (result.get("items") or [])[:20]:
            if not isinstance(item, dict):
                continue
            path = _normalize_path_text(item.get("path")) or _as_text(item.get("path"))
            line = _as_line(item.get("line"))
            symbol = _as_text(item.get("symbol")) or _as_text(item.get("title"))
            label = symbol or (f"{path}:{line}" if path and line else path or "symbol")
            _append_source(
                out,
                seen,
                label=label,
                path=path or None,
                source_type="symbol_search",
                line=line,
                snippet=_compact_snippet(item.get("snippet")),
            )
        return

    if tool == "repo_tree":
        for entry in (result.get("entries") or [])[:20]:
            if not isinstance(entry, dict):
                continue
            path = _normalize_path_text(entry.get("path")) or _as_text(entry.get("path"))
            if not path:
                continue
            _append_source(out, seen, label=path, path=path, source_type="repo_tree")
        return

    if tool == "generate_project_docs":
        for p in (result.get("files_written") or [])[:20]:
            path = _normalize_path_text(p)
            if not path:
                continue
            _append_source(out, seen, label=path, path=path, source_type="generate_project_docs")
        files = result.get("files")
        if isinstance(files, list):
            for row in files[:20]:
                if not isinstance(row, dict):
                    continue
                path = _normalize_path_text(row.get("path"))
                if not path:
                    continue
                _append_source(out, seen, label=path, path=path, source_type="generate_project_docs")
        return

    if tool == "compare_branches":
        base = _as_text(result.get("base_branch"))
        target = _as_text(result.get("target_branch"))
        summary = _compact_snippet(result.get("summary"))
        for row in (result.get("changed_files") or [])[:20]:
            if not isinstance(row, dict):
                continue
            path = _normalize_path_text(row.get("path")) or _as_text(row.get("path"))
            status = _as_text(row.get("status")) or "changed"
            if not path:
                continue
            _append_source(
                out,
                seen,
                label=f"{path} ({status})",
                path=path,
                source_type="compare_branches",
                snippet=summary or f"{base}...{target}",
            )
        return

    if tool == "create_jira_issue":
        key = _as_text(result.get("key"))
        url = _as_text(result.get("url"))
        summary = _as_text(result.get("summary"))
        _append_source(
            out,
            seen,
            label=key or summary or "jira issue",
            url=url or None,
            source_type="create_jira_issue",
            snippet=summary or None,
            confidence=0.99,
        )
        return

    if tool == "write_documentation_file":
        path = _normalize_path_text(result.get("path")) or _as_text(result.get("path"))
        _append_source(
            out,
            seen,
            label=path or "documentation file",
            path=path or None,
            source_type="write_documentation_file",
            snippet=_compact_snippet(result.get("branch")),
            confidence=0.98,
        )
        return

    if tool == "create_chat_task":
        title = _as_text(result.get("title")) or "chat task"
        _append_source(
            out,
            seen,
            label=title,
            source_type="create_chat_task",
            snippet=_compact_snippet(result.get("id")),
            confidence=0.97,
        )
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
                snippet=_compact_snippet(item.get("snippet") or item.get("preview") or item.get("text")),
            )

    _walk_tool_result_for_sources(result, out, seen, source_type=tool or "tool")


def _extract_sources_from_local_repo_context(
    local_repo_context: str | None,
    out: list[dict[str, Any]],
    seen: set[str],
) -> None:
    raw = _as_text(local_repo_context)
    if not raw:
        return

    for line in raw.splitlines()[:400]:
        path, ln = _extract_path_and_line_from_text(line)
        if not path:
            continue
        _append_source(
            out,
            seen,
            label=f"{path}:{ln}" if ln else path,
            path=path,
            source_type="browser_local_repo",
            line=ln,
            snippet=_compact_snippet(line),
        )
        if len(out) >= 24:
            return


def _collect_answer_sources(
    tool_events: list[dict[str, Any]],
    *,
    local_repo_context: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ev in tool_events or []:
        if not isinstance(ev, dict):
            continue
        before = len(out)
        _extract_sources_from_tool_event(ev, out, seen)
        tool = _as_text(ev.get("tool")) or "tool"
        if tool == "request_user_input":
            continue
        if len(out) == before and bool(ev.get("ok")):
            _append_source(
                out,
                seen,
                label=f"{tool}() result",
                source_type=tool,
            )
        if len(out) >= 24:
            break
    if len(out) < 24:
        _extract_sources_from_local_repo_context(local_repo_context, out, seen)
    return out[:24]


async def _discover_sources_when_missing(
    *,
    project_id: str,
    branch: str,
    user: str,
    chat_id: str,
    question: str,
    tool_policy: dict[str, Any],
    local_repo_context: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    runtime = await build_runtime_for_project(project_id)

    discovery_policy = dict(tool_policy or {})
    timeout_overrides = discovery_policy.get("timeout_overrides")
    if not isinstance(timeout_overrides, dict):
        timeout_overrides = {}
    timeout_overrides = dict(timeout_overrides)
    timeout_overrides.setdefault("keyword_search", 10)
    timeout_overrides.setdefault("repo_tree", 15)
    discovery_policy["timeout_overrides"] = timeout_overrides

    retry_overrides = discovery_policy.get("retry_overrides")
    if not isinstance(retry_overrides, dict):
        retry_overrides = {}
    retry_overrides = dict(retry_overrides)
    retry_overrides.setdefault("keyword_search", 0)
    retry_overrides.setdefault("repo_tree", 0)
    discovery_policy["retry_overrides"] = retry_overrides

    ctx = ToolContext(
        project_id=project_id,
        branch=branch,
        user_id=user,
        chat_id=chat_id,
        policy=discovery_policy,
    )

    calls: list[tuple[str, dict[str, Any]]] = [
        ("keyword_search", {"query": question, "top_k": 8}),
        ("repo_tree", {"path": "", "max_depth": 2, "include_dirs": False, "include_files": True, "max_entries": 120}),
    ]

    for name, args in calls:
        try:
            envelope = await runtime.execute(name, args, ctx)
            ev = envelope.model_dump()
        except Exception:
            logger.exception(
                "source_discovery tool failed project=%s branch=%s tool=%s",
                project_id,
                branch,
                name,
            )
            continue
        events.append(ev)
        before = len(out)
        _extract_sources_from_tool_event(ev, out, seen)
        if len(out) == before and bool(ev.get("ok")):
            tool = _as_text(ev.get("tool")) or name
            _append_source(
                out,
                seen,
                label=f"{tool}() result",
                source_type=tool,
            )
        if len(out) >= 12:
            break

    if len(out) < 24:
        _extract_sources_from_local_repo_context(local_repo_context, out, seen)
    return events, out[:24]


def _enforce_grounded_answer(
    answer: str,
    sources: list[dict[str, Any]],
    grounding_policy: dict[str, Any],
) -> tuple[str, bool]:
    require_sources = bool((grounding_policy or {}).get("require_sources", True))
    min_sources = max(1, min(int((grounding_policy or {}).get("min_sources") or 1), 5))
    if not require_sources:
        return answer, True
    if len(sources) >= min_sources:
        return answer, True
    return (
        "I couldn't produce a grounded answer with verifiable sources for this request. "
        "Please refine the question or enable the relevant tools/connectors, then try again.",
        False,
    )


def _extract_memory_lines(
    text: str,
    *,
    decisions: list[str],
    open_questions: list[str],
    next_steps: list[str],
) -> None:
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        clean = re.sub(r"^[-*0-9.\)\s]+", "", line).strip()
        if not clean:
            continue
        if ("decision" in low or low.startswith("we will") or low.startswith("we should")) and clean not in decisions:
            decisions.append(clean)
        if ("?" in clean or "open question" in low) and clean not in open_questions:
            open_questions.append(clean)
        if (low.startswith("next step") or low.startswith("todo") or low.startswith("action")) and clean not in next_steps:
            next_steps.append(clean)


def _derive_chat_memory(messages: list[dict[str, Any]]) -> dict[str, Any]:
    decisions: list[str] = []
    open_questions: list[str] = []
    next_steps: list[str] = []
    for msg in messages[-60:]:
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
            decisions=decisions,
            open_questions=open_questions,
            next_steps=next_steps,
        )

    return {
        "decisions": decisions[:6],
        "open_questions": open_questions[:6],
        "next_steps": next_steps[:6],
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }


async def _update_chat_memory_summary(chat_id: str) -> dict[str, Any] | None:
    db = get_db()
    doc = await db["chats"].find_one({"chat_id": chat_id}, {"messages": {"$slice": -80}})
    if not isinstance(doc, dict):
        return None
    summary = _derive_chat_memory((doc.get("messages") or []))
    await db["chats"].update_one({"chat_id": chat_id}, {"$set": {"memory_summary": summary}})
    return summary


@router.post("/ask_agent")
async def ask_agent(req: AskReq):
    chat_id = req.chat_id or f"{req.project_id}::{req.branch}::{req.user}"
    now = datetime.utcnow()
    db = get_db()

    # ensure chat
    await db["chats"].update_one(
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
        await db["chats"].update_one(
            {"chat_id": chat_id},
            {"$set": {"llm_profile_id": requested_profile_id, "updated_at": now}},
        )

    chat_doc = await db["chats"].find_one(
        {"chat_id": chat_id},
        {"tool_policy": 1, "llm_profile_id": 1, "pending_user_question": 1},
    )
    active_pending_question = _normalize_pending_user_question((chat_doc or {}).get("pending_user_question"))

    user_text = _as_text(req.question)
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
            }
        }
    if not user_text:
        raise HTTPException(status_code=400, detail="question is required")

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
        awaiting_user_input = pending_user_question is not None
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
                awaiting_user_input = pending_user_question is not None
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
    assistant_meta = {
        "tool_summary": tool_summary,
        "sources": answer_sources,
        "grounded": grounded_ok,
        "pending_user_question": pending_user_question,
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
            },
        },
    )
    memory_summary = await _update_chat_memory_summary(chat_id)

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
        "pending_user_question": pending_user_question,
    }
