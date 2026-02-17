from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from bson import ObjectId

from ..db import get_db
from ..services.llm_profiles import resolve_project_llm_config
from ..settings import settings

logger = logging.getLogger(__name__)

DOC_ROOT = "documentation"
MAX_CONTEXT_FILES = 90
MAX_TOTAL_CONTEXT_CHARS = 140_000
MAX_FILE_CHARS = 8_000
MAX_LLM_CONTEXT_CHARS = 42_000
MAX_LLM_CONTEXT_CHARS_TIGHT = 22_000
MAX_LLM_FILE_CONTEXT_CHARS = 24_000
MAX_DOC_PLAN_FILES = 14
MAX_PLAN_BLOCKS = 42
MAX_PLAN_BLOCK_CHARS = 800
MAX_FILE_BLOCKS = 18
MAX_FILE_BLOCK_CHARS = 1400
MAX_DOC_TOOL_CALLS = 16
DOC_TOOL_USER_ID = "docs@system"

TEXT_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".java",
    ".kt",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".cs",
    ".swift",
    ".scala",
    ".sql",
    ".graphql",
    ".gql",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".md",
    ".txt",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".dockerfile",
    ".proto",
}

IMPORTANT_NAMES = {
    "readme.md",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "poetry.lock",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "cargo.toml",
    "next.config.js",
    "next.config.ts",
    "tsconfig.json",
}

IGNORE_PREFIXES = (
    ".git/",
    ".next/",
    "node_modules/",
    "dist/",
    "build/",
    ".venv/",
    "venv/",
    "__pycache__/",
    "documentation/",
)


class DocumentationError(RuntimeError):
    pass


_DOC_TOOL_RUNTIME: Any = None


def _run_git(repo_path: str, args: list[str], timeout: int = 40) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", repo_path, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _git_stdout(repo_path: str, args: list[str], timeout: int = 40, not_found_ok: bool = False) -> str:
    try:
        proc = _run_git(repo_path, args, timeout=timeout)
    except subprocess.TimeoutExpired as err:
        raise DocumentationError(f"git command timed out: {' '.join(args)}") from err

    if proc.returncode != 0:
        if not_found_ok:
            return ""
        detail = (proc.stderr or proc.stdout or "").strip() or f"git command failed: {' '.join(args)}"
        raise DocumentationError(detail)
    return proc.stdout


def _normalize_llm_base(base_url: str | None, provider: str) -> str:
    if provider == "openai":
        base = (base_url or "https://api.openai.com/v1").rstrip("/")
    else:
        base = (base_url or settings.LLM_BASE_URL or "http://ollama:11434/v1").rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    return base + "/"


def _llm_key(provider: str, project_key: str | None) -> str | None:
    key = (project_key or "").strip() or None
    if key and key.lower() == "ollama":
        key = None

    if provider == "openai":
        return key or settings.OPENAI_API_KEY or settings.LLM_API_KEY
    return key or settings.LLM_API_KEY or "ollama"


def _llm_model(provider: str, project_model: str | None) -> str:
    if project_model and project_model.strip():
        return project_model.strip()
    if provider == "openai":
        return "gpt-4o-mini"
    return settings.LLM_MODEL or "llama3.2:3b"


def _llm_chat(
    messages: list[dict[str, str]],
    *,
    base_url: str,
    api_key: str | None,
    model: str,
    timeout_sec: int = 90,
    max_attempts: int = 10,
    max_tokens: int = 2200,
) -> str:
    endpoint = urljoin(base_url, "chat/completions")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    attempts = max(1, max_attempts)
    total_chars = sum(len((m.get("content") or "")) for m in messages)
    logger.info(
        "docs.llm.request endpoint=%s model=%s attempts=%s timeout_sec=%s max_tokens=%s messages=%s chars=%s",
        endpoint,
        model,
        attempts,
        timeout_sec,
        max_tokens,
        len(messages),
        total_chars,
    )
    for idx in range(1, attempts + 1):
        try:
            res = requests.post(endpoint, json=payload, headers=headers, timeout=timeout_sec)
        except requests.RequestException as err:
            logger.warning("docs.llm.network_error attempt=%s/%s err=%s", idx, attempts, err)
            if idx < attempts:
                continue
            raise DocumentationError(f"Could not reach LLM provider: {err}") from err

        if res.status_code in (429, 500, 502, 503, 504) and idx < attempts:
            logger.warning(
                "docs.llm.retryable_status attempt=%s/%s status=%s body_preview=%s",
                idx,
                attempts,
                res.status_code,
                _preview(res.text or ""),
            )
            continue

        if res.status_code >= 400:
            detail = ""
            try:
                body = res.json() or {}
                err = body.get("error") or {}
                detail = err.get("message") or ""
                code = err.get("code") or err.get("type") or ""
                if code:
                    detail = f"{detail} (code={code})".strip()
            except Exception:
                detail = res.text[:500]
            logger.warning(
                "docs.llm.error_status attempt=%s/%s status=%s detail=%s",
                idx,
                attempts,
                res.status_code,
                detail,
            )
            raise DocumentationError(f"LLM request failed ({res.status_code}). {detail}".strip())

        data = res.json() or {}
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
        logger.info(
            "docs.llm.success attempt=%s/%s content_chars=%s preview=%s",
            idx,
            attempts,
            len(content),
            _preview(content),
        )
        return content

    raise DocumentationError("LLM request failed after retries.")


def _strip_fences(text: str) -> str:
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _preview(text: str, max_chars: int = 400) -> str:
    s = (text or "").replace("\n", "\\n")
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + "...(truncated)"


def _get_doc_tool_runtime() -> Any:
    global _DOC_TOOL_RUNTIME
    if _DOC_TOOL_RUNTIME is None:
        # Imported lazily to avoid import cycles at module load time.
        from ..rag.tool_runtime import build_default_tool_runtime

        _DOC_TOOL_RUNTIME = build_default_tool_runtime()
    return _DOC_TOOL_RUNTIME


def _try_parse_tool_call(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    s = _strip_fences(text.strip())
    if not (s.startswith("{") and s.endswith("}")):
        return None
    try:
        obj = json.loads(s)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    tool = obj.get("tool")
    args = obj.get("args", {})
    if not isinstance(tool, str):
        return None
    if not isinstance(args, dict):
        return None
    return {"tool": tool, "args": args}


def _doc_tool_system_prompt(tool_schema: str) -> str:
    return (
        "You can use tools while generating documentation.\n"
        "When you need a tool, reply with EXACTLY one JSON object and nothing else:\n"
        "{\n"
        '  "tool": "<tool_name>",\n'
        '  "args": { ... }\n'
        "}\n\n"
        "Rules:\n"
        "- Use only listed tools and valid arguments.\n"
        "- Prefer tools over guessing for repository facts.\n"
        "- Do not call generate_project_docs (recursion guard).\n"
        "- After TOOL_RESULT, continue reasoning.\n"
        "- When enough information is available, return the requested final output in normal text.\n\n"
        "AVAILABLE TOOLS\n"
        "────────────────────────────────\n"
        f"{tool_schema}"
    )


async def _llm_chat_with_tools(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    messages: list[dict[str, str]],
    base_url: str,
    api_key: str | None,
    model: str,
    timeout_sec: int,
    max_attempts: int,
    max_tokens: int,
    max_tool_calls: int = MAX_DOC_TOOL_CALLS,
) -> str:
    runtime = _get_doc_tool_runtime()
    tool_schema = runtime.schema_text()
    convo: list[dict[str, str]] = [{"role": "system", "content": _doc_tool_system_prompt(tool_schema)}]
    convo.extend(messages)
    tool_calls = 0

    while True:
        assistant_text = _llm_chat(
            convo,
            base_url=base_url,
            api_key=api_key,
            model=model,
            timeout_sec=timeout_sec,
            max_attempts=max_attempts,
            max_tokens=max_tokens,
        )
        tool_call = _try_parse_tool_call(assistant_text)
        if not tool_call:
            return assistant_text

        tool_calls += 1
        tool_name = tool_call["tool"]
        tool_args = dict(tool_call["args"] or {})

        if tool_calls > max(1, max_tool_calls):
            raise DocumentationError("Tool call limit reached during documentation generation.")

        if tool_name == "generate_project_docs":
            envelope = {
                "tool": tool_name,
                "ok": False,
                "duration_ms": 0,
                "error": {
                    "code": "validation_error",
                    "message": "Tool is disabled in documentation generation (recursion guard).",
                    "retryable": False,
                    "details": {},
                },
            }
            logger.warning("docs.tools.blocked tool=%s reason=recursion_guard", tool_name)
        else:
            from ..rag.tool_runtime import ToolContext

            ctx = ToolContext(project_id=project_id, branch=branch, user_id=user_id)
            envelope_model = await runtime.execute(tool_name, tool_args, ctx)
            envelope = envelope_model.model_dump()
            logger.info(
                "docs.tools.executed tool=%s ok=%s duration_ms=%s",
                tool_name,
                bool(envelope.get("ok")),
                envelope.get("duration_ms", 0),
            )

        convo.append({"role": "assistant", "content": assistant_text})
        convo.append(
            {
                "role": "user",
                "content": (
                    f"TOOL_RESULT {tool_name}:\n"
                    f"{json.dumps(envelope, ensure_ascii=False, indent=2)}\n"
                ),
            }
        )
        convo.append(
            {
                "role": "user",
                "content": (
                    "Continue. If enough information is available, return the requested final output now. "
                    "Otherwise call the next tool as JSON."
                ),
            }
        )


def _keyword_terms(text: str) -> set[str]:
    raw = re.findall(r"[a-zA-Z0-9_]{3,}", (text or "").lower())
    stop = {
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "file",
        "docs",
        "documentation",
        "project",
        "branch",
    }
    return {t for t in raw if t not in stop}


def _parse_context_blocks(context: str) -> list[tuple[str, str]]:
    lines = (context or "").splitlines()
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line.startswith("FILE: "):
            i += 1
            continue
        path = line[6:].strip()
        i += 1
        if i >= len(lines) or not lines[i].startswith("```"):
            continue
        i += 1
        body_lines: list[str] = []
        while i < len(lines):
            if lines[i].strip() == "```":
                i += 1
                break
            body_lines.append(lines[i])
            i += 1
        body = "\n".join(body_lines).strip()
        if path and body:
            out.append((path.replace("\\", "/"), body))
    return out


def _render_context_blocks(
    blocks: list[tuple[str, str]],
    *,
    max_total_chars: int,
    max_file_chars: int,
) -> str:
    chunks: list[str] = []
    total = 0
    for path, body in blocks:
        snippet_body = body if len(body) <= max_file_chars else body[:max_file_chars] + "\n... (truncated)\n"
        snippet = f"FILE: {path}\n```\n{snippet_body}\n```\n"
        if total + len(snippet) > max_total_chars:
            break
        chunks.append(snippet)
        total += len(snippet)
    return "\n".join(chunks).strip()


def _build_planning_context(context: str, max_chars: int) -> tuple[str, int]:
    blocks = _parse_context_blocks(context)
    if not blocks:
        return _bounded_context(context, max_chars), 0

    ranked = sorted(blocks, key=lambda item: _path_score(item[0]), reverse=True)
    selected = ranked[:MAX_PLAN_BLOCKS]
    rendered = _render_context_blocks(selected, max_total_chars=max_chars, max_file_chars=MAX_PLAN_BLOCK_CHARS)
    return rendered, len(selected)


def _build_targeted_file_context(
    context: str,
    *,
    target_path: str,
    purpose: str,
    planned_paths: list[str],
) -> tuple[str, int]:
    blocks = _parse_context_blocks(context)
    if not blocks:
        return _bounded_context(context, MAX_LLM_FILE_CONTEXT_CHARS), 0

    target_terms = _keyword_terms(target_path + " " + purpose + " " + " ".join(planned_paths))
    target_segments = {p for p in target_path.lower().split("/") if p}

    def score(item: tuple[str, str]) -> tuple[int, tuple[int, int]]:
        path, body = item
        low_path = path.lower()
        path_terms = _keyword_terms(low_path)
        body_terms = _keyword_terms(body[:1200])
        path_segments = {p for p in low_path.split("/") if p}
        overlap = len(target_terms.intersection(path_terms)) * 6
        overlap += len(target_terms.intersection(body_terms)) * 2
        overlap += len(target_segments.intersection(path_segments)) * 5
        if Path(low_path).name in IMPORTANT_NAMES:
            overlap += 15
        return overlap, _path_score(path)

    ranked = sorted(blocks, key=score, reverse=True)
    selected = ranked[:MAX_FILE_BLOCKS]
    rendered = _render_context_blocks(selected, max_total_chars=MAX_LLM_FILE_CONTEXT_CHARS, max_file_chars=MAX_FILE_BLOCK_CHARS)
    return rendered, len(selected)


def _extract_json_obj(text: str) -> dict[str, Any]:
    cleaned = _strip_fences(text)
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(cleaned[start : end + 1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass

    raise DocumentationError("LLM did not return valid JSON for documentation output.")


def _normalize_doc_path(path: str) -> str:
    p = (path or "").replace("\\", "/").lstrip("/")
    if not p:
        return ""
    if ".." in p.split("/"):
        return ""
    if not p.startswith(f"{DOC_ROOT}/"):
        p = f"{DOC_ROOT}/{p}"
    if not p.endswith(".md"):
        p = f"{p}.md"
    return p


def _sanitize_generated_files(files_raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(files_raw, list):
        return out

    seen: set[str] = set()
    for item in files_raw:
        if not isinstance(item, dict):
            continue
        path = _normalize_doc_path(str(item.get("path") or ""))
        content = str(item.get("content") or "").strip()
        if not path or not content:
            continue
        if path in seen:
            continue
        seen.add(path)
        out.append({"path": path, "content": content + "\n"})
        if len(out) >= 30:
            break
    return out


def _sanitize_doc_plan(files_raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(files_raw, list):
        return out

    seen: set[str] = set()
    for item in files_raw:
        path = ""
        purpose = ""
        if isinstance(item, str):
            path = item
        elif isinstance(item, dict):
            path = str(item.get("path") or "")
            purpose = str(item.get("purpose") or item.get("description") or "").strip()
        else:
            continue

        norm = _normalize_doc_path(path)
        if not norm or norm in seen:
            continue

        seen.add(norm)
        out.append({"path": norm, "purpose": purpose})
        if len(out) >= MAX_DOC_PLAN_FILES:
            break
    return out


def _extract_doc_paths_from_text(text: str) -> list[str]:
    raw = text or ""
    matches = re.findall(r"(documentation/[A-Za-z0-9._/\-]+\.md)", raw, flags=re.IGNORECASE)
    out: list[str] = []
    seen: set[str] = set()
    for m in matches:
        norm = _normalize_doc_path(m)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
        if len(out) >= MAX_DOC_PLAN_FILES:
            break
    return out


def _is_text_candidate(path: str) -> bool:
    norm = path.replace("\\", "/")
    low = norm.lower()
    if any(low.startswith(prefix) for prefix in IGNORE_PREFIXES):
        return False
    if "/." in low:
        return False

    name = Path(low).name
    ext = Path(low).suffix
    if name in IMPORTANT_NAMES:
        return True
    if ext in TEXT_EXTENSIONS:
        return True
    return False


def _path_score(path: str) -> tuple[int, int]:
    low = path.lower()
    name = Path(low).name
    score = 0
    if name in IMPORTANT_NAMES:
        score += 120
    if low.startswith("src/"):
        score += 50
    if low.startswith("app/"):
        score += 40
    if low.startswith("backend/") or low.startswith("web/"):
        score += 30
    if "/routes/" in low or "/api/" in low:
        score += 25
    if "/models/" in low:
        score += 25
    if "/config" in low:
        score += 20
    return score, -len(low)


def _select_context_files(all_paths: list[str]) -> list[str]:
    candidates = [p for p in all_paths if _is_text_candidate(p)]
    ranked = sorted(candidates, key=_path_score, reverse=True)

    selected: list[str] = []
    per_root: dict[str, int] = {}
    for path in ranked:
        root = path.split("/", 1)[0] if "/" in path else "(root)"
        used = per_root.get(root, 0)
        if used >= 18:
            continue
        per_root[root] = used + 1
        selected.append(path)
        if len(selected) >= MAX_CONTEXT_FILES:
            break
    return selected


def _read_file_at_branch(repo_path: str, branch: str, path: str, max_chars: int = MAX_FILE_CHARS) -> str:
    text = _git_stdout(repo_path, ["show", f"{branch}:{path}"], not_found_ok=True)
    if not text:
        return ""
    if len(text) > max_chars:
        return text[:max_chars] + "\n... (truncated)\n"
    return text


def _build_repo_context(repo_path: str, branch: str, selected_paths: list[str]) -> str:
    chunks: list[str] = []
    total = 0
    for path in selected_paths:
        body = _read_file_at_branch(repo_path, branch, path)
        if not body.strip():
            continue
        snippet = f"FILE: {path}\n```\n{body}\n```\n"
        if total + len(snippet) > MAX_TOTAL_CONTEXT_CHARS:
            break
        chunks.append(snippet)
        total += len(snippet)
    return "\n".join(chunks).strip()


def _infer_setup_guide(all_paths: list[str]) -> list[str]:
    low = {p.lower() for p in all_paths}
    steps: list[str] = []
    if "package.json" in low:
        steps.append("- Install frontend dependencies: `npm install` (or `pnpm install` if lockfile indicates pnpm).")
    if "requirements.txt" in low or "pyproject.toml" in low:
        steps.append("- Prepare Python environment: create venv and install requirements.")
    if "docker-compose.yml" in low or "docker-compose.yaml" in low or "compose.yml" in low or "compose.yaml" in low:
        steps.append("- Start infrastructure/services with Docker Compose.")
    if "go.mod" in low:
        steps.append("- Install Go dependencies with `go mod download`.")
    if "cargo.toml" in low:
        steps.append("- Install Rust toolchain and run `cargo build`.")
    if not steps:
        steps.append("- Read project scripts and dependency manifests, then install required runtimes and dependencies.")
    return steps


def _fallback_docs(project_name: str, branch: str, all_paths: list[str], selected_paths: list[str]) -> list[dict[str, str]]:
    root_counts: dict[str, int] = {}
    ext_counts: dict[str, int] = {}
    for p in all_paths:
        root = p.split("/", 1)[0] if "/" in p else "(root)"
        root_counts[root] = root_counts.get(root, 0) + 1
        ext = Path(p).suffix.lower() or "(none)"
        ext_counts[ext] = ext_counts.get(ext, 0) + 1

    top_roots = sorted(root_counts.items(), key=lambda kv: kv[1], reverse=True)[:8]
    top_exts = sorted(ext_counts.items(), key=lambda kv: kv[1], reverse=True)[:8]
    setup_lines = _infer_setup_guide(all_paths)

    index = [
        f"# {project_name} Documentation",
        "",
        f"Generated on {datetime.utcnow().isoformat()}Z for branch `{branch}`.",
        "",
        "## Contents",
        "",
        "- [Architecture Overview](architecture/overview.md)",
        "- [Technical Setup](setup/getting-started.md)",
        "- [Codebase Structure](structure/codebase.md)",
        "",
        "## Notes",
        "",
        "- This baseline documentation was generated from repository inspection.",
        "- Regenerate after major architecture or setup changes.",
        "",
    ]

    architecture = [
        "# Architecture Overview",
        "",
        f"Branch: `{branch}`",
        "",
        "## High-Level Components",
        "",
    ]
    for root, count in top_roots:
        architecture.append(f"- `{root}` ({count} files)")
    architecture.extend(
        [
            "",
            "## Technologies (by file extension)",
            "",
        ]
    )
    for ext, count in top_exts:
        architecture.append(f"- `{ext}`: {count} files")
    architecture.extend(
        [
            "",
            "## Representative Files Reviewed",
            "",
        ]
    )
    for p in selected_paths[:25]:
        architecture.append(f"- `{p}`")

    setup = [
        "# Getting Started",
        "",
        f"Branch: `{branch}`",
        "",
        "## Setup Checklist",
        "",
    ]
    setup.extend(setup_lines)
    setup.extend(
        [
            "",
            "## Recommended Workflow",
            "",
            "- Run tests and linters before creating pull requests.",
            "- Keep environment variables and secrets outside version control.",
            "- Re-run documentation generation after significant code changes.",
            "",
        ]
    )

    structure = [
        "# Codebase Structure",
        "",
        f"Branch: `{branch}`",
        "",
        "## Top-Level Areas",
        "",
    ]
    for root, count in top_roots:
        structure.append(f"- `{root}`: {count} files")

    return [
        {"path": "documentation/README.md", "content": "\n".join(index) + "\n"},
        {"path": "documentation/architecture/overview.md", "content": "\n".join(architecture) + "\n"},
        {"path": "documentation/setup/getting-started.md", "content": "\n".join(setup) + "\n"},
        {"path": "documentation/structure/codebase.md", "content": "\n".join(structure) + "\n"},
    ]


def _ensure_mandatory_docs(files: list[dict[str, str]], fallback: list[dict[str, str]]) -> list[dict[str, str]]:
    needed = {
        "documentation/README.md",
        "documentation/architecture/overview.md",
        "documentation/setup/getting-started.md",
    }
    present = {f["path"] for f in files}
    out = list(files)
    for item in fallback:
        if item["path"] in needed and item["path"] not in present:
            out.append(item)
    return out


def _bounded_context(context: str, max_chars: int) -> str:
    text = context.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... (truncated context)\n"


def _default_doc_purpose(path: str) -> str:
    low = path.lower()
    if low.endswith("/readme.md"):
        return "Project documentation index with links and scope."
    if "architecture" in low:
        return "High-level architecture, components, and request/data flows."
    if "setup" in low or "getting-started" in low:
        return "Developer setup guide with prerequisites and local run steps."
    if "structure" in low:
        return "Repository structure and responsibilities per area."
    return "Technical documentation for this area."


def _extract_markdown_from_llm_output(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""

    try:
        obj = _extract_json_obj(text)
        if isinstance(obj, dict):
            for key in ("content", "markdown", "body", "text"):
                value = obj.get(key)
                if isinstance(value, str) and value.strip():
                    return _strip_fences(value).strip()
            files = obj.get("files")
            if isinstance(files, list):
                for item in files:
                    if isinstance(item, dict):
                        value = item.get("content")
                        if isinstance(value, str) and value.strip():
                            return _strip_fences(value).strip()
    except DocumentationError:
        pass

    return _strip_fences(text).strip()


async def _generate_doc_plan_with_llm_from_context(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
    max_context_chars: int = MAX_LLM_CONTEXT_CHARS,
) -> tuple[list[dict[str, str]], str]:
    bounded_context, selected_blocks = _build_planning_context(context, max_context_chars)
    logger.info(
        "docs.plan.start project=%s branch=%s context_chars=%s selected_blocks=%s budget=%s",
        project_name,
        branch,
        len(bounded_context),
        selected_blocks,
        max_context_chars,
    )
    system = (
        "You are a senior software architect and technical writer. "
        "First create a documentation file plan and return JSON only."
    )
    user = (
        f"Project: {project_name}\n"
        f"Branch: {branch}\n\n"
        "Inspect the repository evidence and design a useful documentation folder structure.\n"
        "Requirements:\n"
        "- All files must be markdown and under 'documentation/'.\n"
        "- Group related topics in subfolders.\n"
        "- Include architecture and setup topics.\n"
        "- Prefer quality over quantity.\n\n"
        "Return EXACTLY one JSON object in this schema:\n"
        "{\n"
        '  "summary": "short summary of planned documentation",\n'
        '  "files": [\n'
        '    {"path":"documentation/README.md","purpose":"what this file covers"},\n'
        '    {"path":"documentation/architecture/overview.md","purpose":"..."},\n'
        '    {"path":"documentation/setup/getting-started.md","purpose":"..."}\n'
        "  ]\n"
        "}\n\n"
        "Repository evidence follows:\n\n"
        f"{bounded_context}"
    )
    raw = await _llm_chat_with_tools(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        base_url=llm_base,
        api_key=llm_key,
        model=llm_model,
        timeout_sec=150,
        max_attempts=2,
        max_tokens=700,
    )
    summary = ""
    plan_raw: Any = None
    try:
        obj = _extract_json_obj(raw)
        summary = str(obj.get("summary") or "").strip()
        plan_raw = obj.get("files")
        if plan_raw is None:
            plan_raw = obj.get("plan")
        if plan_raw is None:
            plan_raw = obj.get("documents")
        if plan_raw is None:
            plan_raw = obj.get("paths")
    except DocumentationError:
        plan_raw = None

    plan = _sanitize_doc_plan(plan_raw)
    if not plan:
        plan = [{"path": p, "purpose": ""} for p in _extract_doc_paths_from_text(raw)]
    if not plan:
        logger.warning("docs.plan.empty project=%s branch=%s raw_preview=%s", project_name, branch, _preview(raw))
        raise DocumentationError("LLM did not return a usable documentation plan.")
    if not summary:
        summary = f"Planned {len(plan)} documentation files."
    logger.info(
        "docs.plan.success project=%s branch=%s files=%s summary=%s",
        project_name,
        branch,
        len(plan),
        summary,
    )
    return plan, summary


async def _generate_single_doc_with_llm_from_context(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
    target_path: str,
    purpose: str,
    planned_paths: list[str],
) -> str:
    bounded_context, selected_blocks = _build_targeted_file_context(
        context,
        target_path=target_path,
        purpose=purpose,
        planned_paths=planned_paths,
    )
    logger.info(
        "docs.file.start project=%s branch=%s target=%s context_chars=%s selected_blocks=%s",
        project_name,
        branch,
        target_path,
        len(bounded_context),
        selected_blocks,
    )
    plan_lines = "\n".join(f"- {p}" for p in planned_paths[:MAX_DOC_PLAN_FILES])
    effective_purpose = purpose.strip() or _default_doc_purpose(target_path)
    system = (
        "You are a principal software engineer writing exactly one markdown documentation file. "
        "Return markdown only, no JSON."
    )
    user = (
        f"Project: {project_name}\n"
        f"Branch: {branch}\n"
        f"Target file path: {target_path}\n"
        f"Purpose: {effective_purpose}\n\n"
        "Planned documentation files:\n"
        f"{plan_lines}\n\n"
        "Requirements:\n"
        "- Write only the content for the target file.\n"
        "- Start with a top-level heading.\n"
        "- Be specific and practical for developers.\n"
        "- Use concrete module/file names from evidence where possible.\n"
        "- Include setup/operational details when relevant.\n"
        "- Do not wrap the whole response in code fences.\n\n"
        "Repository evidence follows:\n\n"
        f"{bounded_context}"
    )
    raw = await _llm_chat_with_tools(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        base_url=llm_base,
        api_key=llm_key,
        model=llm_model,
        timeout_sec=120,
        max_attempts=2,
        max_tokens=1300,
    )
    content = _extract_markdown_from_llm_output(raw)
    if not content:
        raise DocumentationError(f"LLM returned empty content for {target_path}")
    if not content.startswith("#"):
        title = Path(target_path).stem.replace("-", " ").replace("_", " ").title() or "Documentation"
        content = f"# {title}\n\n{content}"
    logger.info(
        "docs.file.success project=%s branch=%s target=%s chars=%s",
        project_name,
        branch,
        target_path,
        len(content),
    )
    return content + "\n"


async def _generate_docs_single_shot_with_llm_from_context(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
) -> tuple[list[dict[str, str]], str]:
    return await _generate_docs_single_shot_with_llm_from_context_budget(
        project_id=project_id,
        user_id=user_id,
        project_name=project_name,
        branch=branch,
        context=context,
        llm_base=llm_base,
        llm_key=llm_key,
        llm_model=llm_model,
        max_context_chars=MAX_LLM_CONTEXT_CHARS,
    )


async def _generate_docs_single_shot_with_llm_from_context_budget(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
    max_context_chars: int,
) -> tuple[list[dict[str, str]], str]:
    bounded_context, selected_blocks = _build_planning_context(context, max_context_chars)
    logger.info(
        "docs.single_shot.start project=%s branch=%s context_chars=%s selected_blocks=%s budget=%s",
        project_name,
        branch,
        len(bounded_context),
        selected_blocks,
        max_context_chars,
    )
    system = (
        "You are a senior software architect and technical writer. "
        "Generate repository documentation as JSON only."
    )
    user = (
        f"Project: {project_name}\n"
        f"Branch: {branch}\n\n"
        "Create high-quality markdown documentation files under the 'documentation/' folder.\n"
        "Requirements:\n"
        "- Create a useful structure (subfolders by related topics).\n"
        "- Explain overall architecture and major modules.\n"
        "- Provide practical technical setup guide for developers.\n"
        "- Use comments/annotations/docstrings from code where available.\n"
        "- Keep content concise but actionable.\n\n"
        "Return EXACTLY one JSON object in this schema:\n"
        "{\n"
        '  "summary": "short summary",\n'
        '  "files": [\n'
        '    {"path":"documentation/README.md","content":"# ..."},\n'
        '    {"path":"documentation/architecture/overview.md","content":"# ..."},\n'
        '    {"path":"documentation/setup/getting-started.md","content":"# ..."}\n'
        "  ]\n"
        "}\n\n"
        "Repository evidence follows:\n\n"
        f"{bounded_context}"
    )
    raw = await _llm_chat_with_tools(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        base_url=llm_base,
        api_key=llm_key,
        model=llm_model,
        timeout_sec=180,
        max_attempts=2,
        max_tokens=1800,
    )
    obj = _extract_json_obj(raw)
    files_raw = obj.get("files")
    if files_raw is None:
        files_raw = obj.get("documents")
    if files_raw is None:
        files_raw = obj.get("pages")
    files = _sanitize_generated_files(files_raw)

    if not files:
        by_path = obj.get("content_by_path")
        if isinstance(by_path, dict):
            items = [{"path": str(k), "content": str(v)} for k, v in by_path.items()]
            files = _sanitize_generated_files(items)

    summary = str(obj.get("summary") or "").strip()
    if not files:
        logger.warning(
            "docs.single_shot.empty project=%s branch=%s raw_preview=%s",
            project_name,
            branch,
            _preview(raw),
        )
        raise DocumentationError("LLM single-shot generation returned no usable files.")
    logger.info(
        "docs.single_shot.success project=%s branch=%s files=%s summary=%s",
        project_name,
        branch,
        len(files),
        summary or "(none)",
    )
    return files, summary


async def _generate_docs_with_llm_from_context(
    *,
    project_id: str,
    user_id: str,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
) -> tuple[list[dict[str, str]], str]:
    if not context.strip():
        return [], ""

    errors: list[str] = []
    summary = ""
    plan: list[dict[str, str]] = []

    try:
        plan, summary = await _generate_doc_plan_with_llm_from_context(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            branch=branch,
            context=context,
            llm_base=llm_base,
            llm_key=llm_key,
            llm_model=llm_model,
            max_context_chars=MAX_LLM_CONTEXT_CHARS,
        )
    except Exception as err:
        msg = f"planner failed: {err}"
        errors.append(msg)
        logger.warning("docs.generate.planner_failed project=%s branch=%s err=%s", project_name, branch, err)
        err_lc = str(err).lower()
        if "request too large" in err_lc or "tokens per min" in err_lc or "rate_limit_exceeded" in err_lc:
            try:
                logger.info(
                    "docs.generate.planner_retry_tight project=%s branch=%s context_budget=%s",
                    project_name,
                    branch,
                    MAX_LLM_CONTEXT_CHARS_TIGHT,
                )
                plan, summary = await _generate_doc_plan_with_llm_from_context(
                    project_id=project_id,
                    user_id=user_id,
                    project_name=project_name,
                    branch=branch,
                    context=context,
                    llm_base=llm_base,
                    llm_key=llm_key,
                    llm_model=llm_model,
                    max_context_chars=MAX_LLM_CONTEXT_CHARS_TIGHT,
                )
            except Exception as err2:
                msg2 = f"planner tight retry failed: {err2}"
                errors.append(msg2)
                logger.warning("docs.generate.planner_retry_tight_failed project=%s branch=%s err=%s", project_name, branch, err2)

    files: list[dict[str, str]] = []
    if plan:
        planned_paths = [item["path"] for item in plan]
        for item in plan:
            path = item["path"]
            purpose = item.get("purpose", "")
            try:
                content = await _generate_single_doc_with_llm_from_context(
                    project_id=project_id,
                    user_id=user_id,
                    project_name=project_name,
                    branch=branch,
                    context=context,
                    llm_base=llm_base,
                    llm_key=llm_key,
                    llm_model=llm_model,
                    target_path=path,
                    purpose=purpose,
                    planned_paths=planned_paths,
                )
            except Exception as err:
                logger.warning("docs.file.failed project=%s branch=%s target=%s err=%s", project_name, branch, path, err)
                continue
            files.append({"path": path, "content": content})
        logger.info(
            "docs.generate.planned_result project=%s branch=%s planned=%s generated=%s",
            project_name,
            branch,
            len(plan),
            len(files),
        )
        if not files:
            errors.append("planner produced files but all per-file generations failed")

    if files:
        return files, summary

    try:
        single_files, single_summary = await _generate_docs_single_shot_with_llm_from_context(
            project_id=project_id,
            user_id=user_id,
            project_name=project_name,
            branch=branch,
            context=context,
            llm_base=llm_base,
            llm_key=llm_key,
            llm_model=llm_model,
        )
        return single_files, single_summary or summary
    except Exception as err:
        msg = f"single-shot failed: {err}"
        errors.append(msg)
        logger.warning("docs.generate.single_shot_failed project=%s branch=%s err=%s", project_name, branch, err)
        err_lc = str(err).lower()
        if "request too large" in err_lc or "tokens per min" in err_lc or "rate_limit_exceeded" in err_lc:
            try:
                logger.info(
                    "docs.generate.single_shot_retry_tight project=%s branch=%s context_budget=%s",
                    project_name,
                    branch,
                    MAX_LLM_CONTEXT_CHARS_TIGHT,
                )
                single_files, single_summary = await _generate_docs_single_shot_with_llm_from_context_budget(
                    project_id=project_id,
                    user_id=user_id,
                    project_name=project_name,
                    branch=branch,
                    context=context,
                    llm_base=llm_base,
                    llm_key=llm_key,
                    llm_model=llm_model,
                    max_context_chars=MAX_LLM_CONTEXT_CHARS_TIGHT,
                )
                return single_files, single_summary or summary
            except Exception as err2:
                msg2 = f"single-shot tight retry failed: {err2}"
                errors.append(msg2)
                logger.warning("docs.generate.single_shot_retry_tight_failed project=%s branch=%s err=%s", project_name, branch, err2)

    combined = "; ".join(errors) if errors else "unknown generation error"
    raise DocumentationError(combined)


def _safe_target(repo_path: str, rel_path: str) -> Path:
    root = Path(repo_path).resolve()
    target = (root / rel_path).resolve()
    doc_root = (root / DOC_ROOT).resolve()
    if doc_root not in target.parents and target != doc_root:
        raise DocumentationError("Invalid documentation path")
    return target


def _write_docs(repo_path: str, files: list[dict[str, str]]) -> list[str]:
    written: list[str] = []
    for item in files:
        target = _safe_target(repo_path, item["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(item["content"], encoding="utf-8")
        written.append(item["path"])
    return written


def _clear_docs(repo_path: str) -> None:
    repo_root = Path(repo_path).resolve()
    doc_root = (repo_root / DOC_ROOT).resolve()
    if repo_root not in doc_root.parents:
        raise DocumentationError("Invalid documentation root path.")
    if not doc_root.exists():
        return
    if not doc_root.is_dir():
        doc_root.unlink(missing_ok=True)
        doc_root.mkdir(parents=True, exist_ok=True)
        return

    for child in doc_root.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


async def _load_project(project_id: str) -> dict[str, Any]:
    db = get_db()
    query: dict[str, Any]
    if ObjectId.is_valid(project_id):
        query = {"_id": ObjectId(project_id)}
    else:
        query = {"key": project_id}
    project = await db["projects"].find_one(query)
    if not project:
        raise DocumentationError(f"Project not found: {project_id}")
    return project


def _active_branch(repo_path: str) -> str:
    out = _git_stdout(repo_path, ["rev-parse", "--abbrev-ref", "HEAD"], not_found_ok=True).strip()
    return out or "main"


def _branch_exists(repo_path: str, branch: str) -> bool:
    proc = _run_git(repo_path, ["rev-parse", "--verify", branch], timeout=15)
    return proc.returncode == 0


async def generate_project_documentation(project_id: str, branch: Optional[str] = None) -> dict[str, Any]:
    project = await _load_project(project_id)
    repo_path = (project.get("repo_path") or "").strip()
    if not repo_path:
        raise DocumentationError("Project has no local repo_path configured.")
    if repo_path.lower().startswith("browser-local://"):
        raise DocumentationError(
            "This project uses browser-local repository mode. Server-side documentation generation is unavailable for that mode."
        )
    if not Path(repo_path).exists():
        raise DocumentationError(f"Repo path does not exist on backend: {repo_path}")

    chosen_branch = (branch or project.get("default_branch") or "main").strip() or "main"
    if not _branch_exists(repo_path, chosen_branch):
        raise DocumentationError(f"Branch does not exist in repo: {chosen_branch}")

    current_branch = _active_branch(repo_path)
    if current_branch != chosen_branch:
        raise DocumentationError(
            f"Selected branch '{chosen_branch}' is not checked out locally (current: '{current_branch}'). "
            "Switch the repo checkout branch on the backend host first."
        )

    _clear_docs(repo_path)
    logger.info(
        "docs.generate.start project_id=%s branch=%s current_branch=%s repo_path=%s",
        project_id,
        chosen_branch,
        current_branch,
        repo_path,
    )

    files_out = _git_stdout(repo_path, ["ls-tree", "-r", "--name-only", chosen_branch], timeout=30)
    all_paths = [line.strip() for line in files_out.splitlines() if line.strip()]
    if not all_paths:
        raise DocumentationError("Repository appears empty for selected branch.")

    source_paths = [p for p in all_paths if not p.replace("\\", "/").startswith(f"{DOC_ROOT}/")]
    if not source_paths:
        source_paths = all_paths

    selected_paths = _select_context_files(source_paths)
    context = _build_repo_context(repo_path, chosen_branch, selected_paths)
    logger.info(
        "docs.generate.context project_id=%s branch=%s all_files=%s source_files=%s selected_files=%s context_chars=%s",
        project_id,
        chosen_branch,
        len(all_paths),
        len(source_paths),
        len(selected_paths),
        len(context),
    )

    project_name = str(project.get("name") or project.get("key") or project_id)
    fallback = _fallback_docs(project_name, chosen_branch, source_paths, selected_paths)

    llm = await resolve_project_llm_config(project)
    provider = str(llm.get("provider") or "ollama")
    llm_base = _normalize_llm_base(llm.get("llm_base_url"), provider)
    llm_key = _llm_key(provider, llm.get("llm_api_key"))
    llm_model = _llm_model(provider, llm.get("llm_model"))
    logger.info(
        "docs.generate.llm project_id=%s provider=%s model=%s base=%s has_api_key=%s",
        project_id,
        provider,
        llm_model,
        llm_base,
        bool(llm_key),
    )

    generated_files: list[dict[str, str]] = []
    summary = ""
    mode = "fallback"
    llm_error: str | None = None
    if context:
        try:
            generated_files, summary = await _generate_docs_with_llm_from_context(
                project_id=project_id,
                user_id=DOC_TOOL_USER_ID,
                project_name=project_name,
                branch=chosen_branch,
                context=context,
                llm_base=llm_base,
                llm_key=llm_key,
                llm_model=llm_model,
            )
            if generated_files:
                mode = "llm"
        except Exception as err:
            llm_error = str(err)
            logger.warning("docs.generate.llm_failed project_id=%s branch=%s err=%s", project_id, chosen_branch, err)
            generated_files = []

    if not generated_files:
        generated_files = fallback
        if not summary:
            summary = "Generated baseline documentation from repository structure."
        if llm_error:
            summary = f"{summary} LLM generation failed: {llm_error}"

    generated_files = _ensure_mandatory_docs(generated_files, fallback)
    written_paths = _write_docs(repo_path, generated_files)
    logger.info(
        "docs.generate.done project_id=%s branch=%s mode=%s files_written=%s llm_error=%s",
        project_id,
        chosen_branch,
        mode,
        len(written_paths),
        llm_error or "",
    )

    return {
        "project_id": str(project.get("_id") or project_id),
        "project_key": str(project.get("key") or ""),
        "branch": chosen_branch,
        "current_branch": current_branch,
        "mode": mode,
        "summary": summary or "Documentation generated.",
        "files_written": written_paths,
        "context_files_used": len(selected_paths),
        "llm_error": llm_error,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


async def generate_project_documentation_from_local_context(
    *,
    project_id: str,
    branch: Optional[str],
    local_repo_root: str,
    local_repo_file_paths: list[str],
    local_repo_context: str,
) -> dict[str, Any]:
    project = await _load_project(project_id)
    chosen_branch = (branch or project.get("default_branch") or "main").strip() or "main"
    logger.info(
        "docs.generate_local.start project_id=%s branch=%s local_repo_root=%s local_paths=%s",
        project_id,
        chosen_branch,
        local_repo_root,
        len(local_repo_file_paths or []),
    )

    all_paths = [p.strip().replace("\\", "/") for p in (local_repo_file_paths or []) if str(p).strip()]
    if not all_paths:
        all_paths = ["README.md"]
    selected_paths = all_paths[:MAX_CONTEXT_FILES]
    logger.info(
        "docs.generate_local.context project_id=%s branch=%s selected_paths=%s context_chars=%s",
        project_id,
        chosen_branch,
        len(selected_paths),
        len((local_repo_context or "").strip()),
    )

    project_name = str(project.get("name") or project.get("key") or project_id)
    fallback = _fallback_docs(project_name, chosen_branch, all_paths, selected_paths)

    llm = await resolve_project_llm_config(project)
    provider = str(llm.get("provider") or "ollama")
    llm_base = _normalize_llm_base(llm.get("llm_base_url"), provider)
    llm_key = _llm_key(provider, llm.get("llm_api_key"))
    llm_model = _llm_model(provider, llm.get("llm_model"))
    logger.info(
        "docs.generate_local.llm project_id=%s provider=%s model=%s base=%s has_api_key=%s",
        project_id,
        provider,
        llm_model,
        llm_base,
        bool(llm_key),
    )

    generated_files: list[dict[str, str]] = []
    summary = ""
    mode = "fallback"
    llm_error: str | None = None

    if local_repo_context and local_repo_context.strip():
        try:
            generated_files, summary = await _generate_docs_with_llm_from_context(
                project_id=project_id,
                user_id=DOC_TOOL_USER_ID,
                project_name=project_name,
                branch=chosen_branch,
                context=local_repo_context.strip(),
                llm_base=llm_base,
                llm_key=llm_key,
                llm_model=llm_model,
            )
            if generated_files:
                mode = "llm"
        except Exception as err:
            llm_error = str(err)
            logger.warning("docs.generate_local.llm_failed project_id=%s branch=%s err=%s", project_id, chosen_branch, err)
            generated_files = []

    if not generated_files:
        generated_files = fallback
        if not summary:
            summary = "Generated baseline documentation from local repository context."
        if llm_error:
            summary = f"{summary} LLM generation failed: {llm_error}"

    generated_files = _ensure_mandatory_docs(generated_files, fallback)
    logger.info(
        "docs.generate_local.done project_id=%s branch=%s mode=%s files=%s llm_error=%s",
        project_id,
        chosen_branch,
        mode,
        len(generated_files),
        llm_error or "",
    )

    return {
        "project_id": str(project.get("_id") or project_id),
        "project_key": str(project.get("key") or ""),
        "branch": chosen_branch,
        "mode": mode,
        "summary": summary or "Documentation generated from local context.",
        "files": generated_files,
        "context_files_used": len(selected_paths),
        "local_repo_root": local_repo_root or "",
        "llm_error": llm_error,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


def _collect_worktree_docs(repo_path: str) -> list[dict[str, Any]]:
    root = Path(repo_path) / DOC_ROOT
    if not root.exists() or not root.is_dir():
        return []

    out: list[dict[str, Any]] = []
    for p in sorted(root.rglob("*.md")):
        rel = str(p.relative_to(repo_path)).replace("\\", "/")
        stat = p.stat()
        out.append(
            {
                "path": rel,
                "size": int(stat.st_size),
                "updated_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
            }
        )
    return out


def _collect_branch_docs(repo_path: str, branch: str) -> list[dict[str, Any]]:
    stdout = _git_stdout(repo_path, ["ls-tree", "-r", "--name-only", branch, DOC_ROOT], not_found_ok=True)
    out: list[dict[str, Any]] = []
    for line in stdout.splitlines():
        rel = line.strip().replace("\\", "/")
        if not rel or not rel.endswith(".md"):
            continue
        out.append({"path": rel, "size": None, "updated_at": None})
    return out


async def list_project_documentation(project_id: str, branch: Optional[str] = None) -> dict[str, Any]:
    project = await _load_project(project_id)
    repo_path = (project.get("repo_path") or "").strip()
    if not repo_path:
        raise DocumentationError("Project has no local repo_path configured.")
    if repo_path.lower().startswith("browser-local://"):
        raise DocumentationError(
            "This project uses browser-local repository mode. Documentation browser is unavailable on backend."
        )
    if not Path(repo_path).exists():
        raise DocumentationError(f"Repo path does not exist on backend: {repo_path}")

    chosen_branch = (branch or project.get("default_branch") or "main").strip() or "main"
    current_branch = _active_branch(repo_path)
    files = _collect_worktree_docs(repo_path) if chosen_branch == current_branch else _collect_branch_docs(repo_path, chosen_branch)
    return {
        "branch": chosen_branch,
        "current_branch": current_branch,
        "files": files,
    }


async def read_project_documentation_file(project_id: str, path: str, branch: Optional[str] = None) -> dict[str, Any]:
    project = await _load_project(project_id)
    repo_path = (project.get("repo_path") or "").strip()
    if not repo_path:
        raise DocumentationError("Project has no local repo_path configured.")
    if repo_path.lower().startswith("browser-local://"):
        raise DocumentationError(
            "This project uses browser-local repository mode. Documentation reader is unavailable on backend."
        )

    rel = _normalize_doc_path(path)
    if not rel.startswith(f"{DOC_ROOT}/") or ".." in rel.split("/"):
        raise DocumentationError("Invalid documentation file path.")

    chosen_branch = (branch or project.get("default_branch") or "main").strip() or "main"
    current_branch = _active_branch(repo_path)

    if chosen_branch == current_branch:
        full = (Path(repo_path) / rel).resolve()
        root = Path(repo_path).resolve()
        if root not in full.parents:
            raise DocumentationError("Invalid documentation file path.")
        if not full.exists() or not full.is_file():
            raise DocumentationError(f"Documentation file not found: {rel}")
        content = full.read_text(encoding="utf-8", errors="replace")
    else:
        content = _git_stdout(repo_path, ["show", f"{chosen_branch}:{rel}"], not_found_ok=True)
        if not content:
            raise DocumentationError(f"Documentation file not found in branch '{chosen_branch}': {rel}")

    return {
        "branch": chosen_branch,
        "path": rel,
        "content": content,
    }
