from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests
from bson import ObjectId

from ..db import get_db
from ..settings import settings

DOC_ROOT = "documentation"
MAX_CONTEXT_FILES = 90
MAX_TOTAL_CONTEXT_CHARS = 140_000
MAX_FILE_CHARS = 8_000
MAX_LLM_CONTEXT_CHARS = 120_000

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
    max_attempts: int = 1,
) -> str:
    endpoint = urljoin(base_url, "chat/completions")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 2200,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    attempts = max(1, max_attempts)
    for idx in range(1, attempts + 1):
        try:
            res = requests.post(endpoint, json=payload, headers=headers, timeout=timeout_sec)
        except requests.RequestException as err:
            if idx < attempts:
                continue
            raise DocumentationError(f"Could not reach LLM provider: {err}") from err

        if res.status_code in (429, 500, 502, 503, 504) and idx < attempts:
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
            raise DocumentationError(f"LLM request failed ({res.status_code}). {detail}".strip())

        data = res.json() or {}
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""

    raise DocumentationError("LLM request failed after retries.")


def _strip_fences(text: str) -> str:
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


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


def _generate_docs_with_llm_from_context(
    *,
    project_name: str,
    branch: str,
    context: str,
    llm_base: str,
    llm_key: str | None,
    llm_model: str,
) -> tuple[list[dict[str, str]], str]:
    if not context.strip():
        return [], ""
    bounded_context = context.strip()
    if len(bounded_context) > MAX_LLM_CONTEXT_CHARS:
        bounded_context = bounded_context[:MAX_LLM_CONTEXT_CHARS] + "\n... (truncated context)\n"

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

    raw = _llm_chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        base_url=llm_base,
        api_key=llm_key,
        model=llm_model,
        timeout_sec=75,
        max_attempts=1,
    )
    obj = _extract_json_obj(raw)
    files = _sanitize_generated_files(obj.get("files"))
    summary = str(obj.get("summary") or "").strip()
    return files, summary


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

    files_out = _git_stdout(repo_path, ["ls-tree", "-r", "--name-only", chosen_branch], timeout=30)
    all_paths = [line.strip() for line in files_out.splitlines() if line.strip()]
    if not all_paths:
        raise DocumentationError("Repository appears empty for selected branch.")

    selected_paths = _select_context_files(all_paths)
    context = _build_repo_context(repo_path, chosen_branch, selected_paths)

    project_name = str(project.get("name") or project.get("key") or project_id)
    fallback = _fallback_docs(project_name, chosen_branch, all_paths, selected_paths)

    provider = (project.get("llm_provider") or "").strip().lower() or "ollama"
    llm_base = _normalize_llm_base(project.get("llm_base_url"), provider)
    llm_key = _llm_key(provider, project.get("llm_api_key"))
    llm_model = _llm_model(provider, project.get("llm_model"))

    generated_files: list[dict[str, str]] = []
    summary = ""
    mode = "fallback"
    if context:
        try:
            generated_files, summary = _generate_docs_with_llm_from_context(
                project_name=project_name,
                branch=chosen_branch,
                context=context,
                llm_base=llm_base,
                llm_key=llm_key,
                llm_model=llm_model,
            )
            if generated_files:
                mode = "llm"
        except Exception:
            generated_files = []

    if not generated_files:
        generated_files = fallback
        if not summary:
            summary = "Generated baseline documentation from repository structure."

    generated_files = _ensure_mandatory_docs(generated_files, fallback)
    written_paths = _write_docs(repo_path, generated_files)

    return {
        "project_id": str(project.get("_id") or project_id),
        "project_key": str(project.get("key") or ""),
        "branch": chosen_branch,
        "current_branch": current_branch,
        "mode": mode,
        "summary": summary or "Documentation generated.",
        "files_written": written_paths,
        "context_files_used": len(selected_paths),
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

    all_paths = [p.strip().replace("\\", "/") for p in (local_repo_file_paths or []) if str(p).strip()]
    if not all_paths:
        all_paths = ["README.md"]
    selected_paths = all_paths[:MAX_CONTEXT_FILES]

    project_name = str(project.get("name") or project.get("key") or project_id)
    fallback = _fallback_docs(project_name, chosen_branch, all_paths, selected_paths)

    provider = (project.get("llm_provider") or "").strip().lower() or "ollama"
    llm_base = _normalize_llm_base(project.get("llm_base_url"), provider)
    llm_key = _llm_key(provider, project.get("llm_api_key"))
    llm_model = _llm_model(provider, project.get("llm_model"))

    generated_files: list[dict[str, str]] = []
    summary = ""
    mode = "fallback"

    if local_repo_context and local_repo_context.strip():
        try:
            generated_files, summary = _generate_docs_with_llm_from_context(
                project_name=project_name,
                branch=chosen_branch,
                context=local_repo_context.strip(),
                llm_base=llm_base,
                llm_key=llm_key,
                llm_model=llm_model,
            )
            if generated_files:
                mode = "llm"
        except Exception:
            generated_files = []

    if not generated_files:
        generated_files = fallback
        if not summary:
            summary = "Generated baseline documentation from local repository context."

    generated_files = _ensure_mandatory_docs(generated_files, fallback)

    return {
        "project_id": str(project.get("_id") or project_id),
        "project_key": str(project.get("key") or ""),
        "branch": chosen_branch,
        "mode": mode,
        "summary": summary or "Documentation generated from local context.",
        "files": generated_files,
        "context_files_used": len(selected_paths),
        "local_repo_root": local_repo_root or "",
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
