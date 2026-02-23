from __future__ import annotations

import logging
import re
from typing import Any

from ..rag.tool_runtime import ToolContext
from ..services.custom_tools import build_runtime_for_project
from .ask_agent_clarification import as_text

logger = logging.getLogger(__name__)

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


def _confidence_for_source(source_type: str | None) -> float | None:
    t = as_text(source_type).lower()
    if not t:
        return None
    if t in _SOURCE_CONFIDENCE_BY_TOOL:
        return _SOURCE_CONFIDENCE_BY_TOOL[t]
    for key, score in _SOURCE_CONFIDENCE_BY_TOOL.items():
        if key in t:
            return score
    return None


def _compact_snippet(v: Any, *, max_chars: int = 280) -> str | None:
    s = as_text(v)
    if not s:
        return None
    one_line = re.sub(r"\s+", " ", s).strip()
    if not one_line:
        return None
    if len(one_line) <= max_chars:
        return one_line
    return one_line[: max_chars - 1].rstrip() + "…"


def _looks_like_url(v: str) -> bool:
    s = as_text(v).lower()
    return s.startswith("http://") or s.startswith("https://")


def _source_kind(path: str | None, url: str | None) -> str:
    p = as_text(path).replace("\\", "/")
    if _looks_like_url(as_text(url)):
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
    s = as_text(v).replace("\\", "/").replace("./", "", 1)
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
    text = as_text(v)
    if not text:
        return None, None

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
    clean_label = as_text(label) or "Source"
    clean_path = as_text(path) or None
    clean_url = as_text(url) or None
    clean_source = as_text(source_type) or None
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
    url = as_text(row.get("url")) or None
    path = _normalize_path_text(row.get("path"))
    title = as_text(row.get("title")) or as_text(row.get("name")) or default_label
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
    tool = as_text(ev.get("tool"))
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
            path = as_text(m.get("path"))
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
        path = _normalize_path_text(result.get("path")) or as_text(result.get("path"))
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
            path = as_text(h.get("path"))
            title = as_text(h.get("title")) or path or "keyword hit"
            _append_source(
                out,
                seen,
                label=title,
                path=path or None,
                source_type=as_text(h.get("source")) or "keyword",
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
                label=as_text(item.get("title")) or as_text(item.get("url")) or "chroma chunk",
                path=as_text(item.get("path")) or None,
                url=as_text(item.get("url")) or None,
                source_type=as_text(item.get("source")) or "chroma",
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
                label=as_text(item.get("title")) or as_text(item.get("url")) or "chroma chunk",
                path=as_text(item.get("path")) or None,
                url=as_text(item.get("url")) or None,
                source_type=as_text(item.get("source")) or "chroma",
                snippet=_compact_snippet(item.get("text") or item.get("snippet")),
            )
        return

    if tool == "read_docs_folder":
        for file_doc in (result.get("files") or [])[:20]:
            if not isinstance(file_doc, dict):
                continue
            path = as_text(file_doc.get("path"))
            _append_source(out, seen, label=path or "documentation", path=path or None, source_type="documentation")
        return

    if tool == "symbol_search":
        for item in (result.get("items") or [])[:20]:
            if not isinstance(item, dict):
                continue
            path = _normalize_path_text(item.get("path")) or as_text(item.get("path"))
            line = _as_line(item.get("line"))
            symbol = as_text(item.get("symbol")) or as_text(item.get("title"))
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
            path = _normalize_path_text(entry.get("path")) or as_text(entry.get("path"))
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
        base = as_text(result.get("base_branch"))
        target = as_text(result.get("target_branch"))
        summary = _compact_snippet(result.get("summary"))
        for row in (result.get("changed_files") or [])[:20]:
            if not isinstance(row, dict):
                continue
            path = _normalize_path_text(row.get("path")) or as_text(row.get("path"))
            status = as_text(row.get("status")) or "changed"
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
        key = as_text(result.get("key"))
        url = as_text(result.get("url"))
        summary = as_text(result.get("summary"))
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
        path = _normalize_path_text(result.get("path")) or as_text(result.get("path"))
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
        title = as_text(result.get("title")) or "chat task"
        _append_source(
            out,
            seen,
            label=title,
            source_type="create_chat_task",
            snippet=_compact_snippet(result.get("id")),
            confidence=0.97,
        )
        return

    for key in ("items", "result", "hits", "files", "entries"):
        rows = result.get(key)
        if not isinstance(rows, list):
            continue
        for item in rows[:20]:
            if not isinstance(item, dict):
                continue
            url = as_text(item.get("url"))
            path = as_text(item.get("path"))
            title = as_text(item.get("title")) or path or url or f"{tool} source"
            if not (url or path):
                continue
            _append_source(
                out,
                seen,
                label=title,
                path=path or None,
                url=url or None,
                source_type=as_text(item.get("source")) or tool,
                snippet=_compact_snippet(item.get("snippet") or item.get("preview") or item.get("text")),
            )

    _walk_tool_result_for_sources(result, out, seen, source_type=tool or "tool")


def extract_sources_from_local_repo_context(
    local_repo_context: str | None,
    out: list[dict[str, Any]],
    seen: set[str],
) -> None:
    raw = as_text(local_repo_context)
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


def collect_answer_sources(
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
        tool = as_text(ev.get("tool")) or "tool"
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
        extract_sources_from_local_repo_context(local_repo_context, out, seen)
    return out[:24]


async def discover_sources_when_missing(
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
        (
            "repo_tree",
            {"path": "", "max_depth": 2, "include_dirs": False, "include_files": True, "max_entries": 120},
        ),
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
            tool = as_text(ev.get("tool")) or name
            _append_source(
                out,
                seen,
                label=f"{tool}() result",
                source_type=tool,
            )
        if len(out) >= 12:
            break

    if len(out) < 24:
        extract_sources_from_local_repo_context(local_repo_context, out, seen)
    return events, out[:24]


def enforce_grounded_answer(
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
