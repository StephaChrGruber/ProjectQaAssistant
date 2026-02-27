from __future__ import annotations

import asyncio
import base64
import fnmatch
import logging
import os
import re
import shlex
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import chromadb
import httpx
from bson import ObjectId

from ..db import get_db
from ..repositories.factory import repository_factory
from ..models.base_mongo_models import LocalToolJob
from ..models.tools import (
    ChromaCountRequest,
    ChromaCountResponse,
    ChromaOpenChunksRequest,
    ChromaOpenChunksResponse,
    ChromaSearchChunkResponse,
    ChromaSearchChunksRequest,
    CompareBranchesRequest,
    CompareBranchesResponse,
    BranchDiffFile,
    CreateChatTaskRequest,
    CreateChatTaskResponse,
    CreateAutomationRequest,
    CreateAutomationResponse,
    CreateJiraIssueRequest,
    CreateJiraIssueResponse,
    DeleteAutomationRequest,
    DeleteAutomationResponse,
    GitBranchItem,
    GitCheckoutBranchRequest,
    GitCheckoutBranchResponse,
    GitCommitRequest,
    GitCommitResponse,
    GitCreateBranchRequest,
    GitCreateBranchResponse,
    GitDiffRequest,
    GitDiffResponse,
    GitFetchRequest,
    GitFetchResponse,
    GitListBranchesRequest,
    GitListBranchesResponse,
    GitLogItem,
    GitLogRequest,
    GitLogResponse,
    GitPullRequest,
    GitPullResponse,
    GitPushRequest,
    GitPushResponse,
    GitStageFilesRequest,
    GitStageFilesResponse,
    GitStatusRequest,
    GitStatusResponse,
    GitUnstageFilesRequest,
    GitUnstageFilesResponse,
    GrepMatch,
    KeywordHit,
    KeywordSearchRequest,
    KeywordSearchResponse,
    OpenFileRequest,
    OpenFileResponse,
    ProjectMetadataResponse,
    RequestUserInputRequest,
    RequestUserInputResponse,
    ReadChatMessagesRequest,
    ReadChatMessagesResponse,
    WorkspaceGetContextRequest,
    WorkspaceGetContextResponse,
    ReadDocsFile,
    ReadDocsFolderRequest,
    ReadDocsFolderResponse,
    RepoGrepRequest,
    RepoGrepResponse,
    RepoTreeNode,
    RepoTreeRequest,
    RepoTreeResponse,
    RunTestsRequest,
    RunTestsResponse,
    ListChatTasksRequest,
    ListChatTasksResponse,
    ListAutomationsRequest,
    ListAutomationsResponse,
    ListAutomationTemplatesRequest,
    ListAutomationTemplatesResponse,
    ChatTaskItem,
    SymbolSearchHit,
    SymbolSearchRequest,
    SymbolSearchResponse,
    UpdateChatTaskRequest,
    UpdateChatTaskResponse,
    UpdateAutomationRequest,
    UpdateAutomationResponse,
    RunAutomationRequest,
    RunAutomationResponse,
    WriteDocumentationFileRequest,
    WriteDocumentationFileResponse,
)
from ..services.documentation import (
    DocumentationError,
    generate_project_documentation,
    generate_project_documentation_from_local_context,
)
from ..services.workspace import assemble_workspace_context, workspace_context_to_text
from ..services.automations import (
    create_automation as create_automation_service,
    delete_automation as delete_automation_service,
    get_automation as get_automation_service,
    list_automations as list_automations_service,
    list_automation_templates as list_automation_templates_service,
    run_automation as run_automation_service,
    update_automation as update_automation_service,
)
from ..settings import settings

logger = logging.getLogger(__name__)

COLLECTION_NAME = "docs"
IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"}
BROWSER_LOCAL_REPO_PREFIX = "browser-local://"
LOCAL_TOOL_JOB_POLL_INTERVAL_SEC = 0.35
_BROWSER_LOCAL_GIT_TOOL_CODE: dict[str, str] = {
    "git_list_branches": """
async function run(args, context, helpers) {
  const maxBranches = Math.max(1, Math.min(Number(args.max_branches || 200), 1000))
  const out = await helpers.localRepo.git.listBranches({ maxBranches })
  const branches = Array.isArray(out?.branches) ? out.branches.map((name) => ({ name: String(name || "").trim() })).filter((x) => x.name) : []
  return {
    active_branch: String(out?.activeBranch || "main"),
    default_branch: String(out?.activeBranch || "main"),
    remote_mode: false,
    branches,
  }
}
""".strip(),
    "git_checkout_branch": """
async function run(args, context, helpers) {
  const out = await helpers.localRepo.git.checkoutBranch({
    branch: String(args.branch || ""),
    createIfMissing: Boolean(args.create_if_missing),
    startPoint: args.start_point ? String(args.start_point) : null,
  })
  const branch = String(out?.branch || args.branch || "").trim()
  return {
    branch,
    previous_branch: out?.previousBranch || null,
    created: Boolean(out?.created),
    remote_mode: false,
    message: `Checked out local browser branch '${branch}'.`,
  }
}
""".strip(),
    "git_create_branch": """
async function run(args, context, helpers) {
  const out = await helpers.localRepo.git.createBranch({
    branch: String(args.branch || ""),
    sourceRef: args.source_ref ? String(args.source_ref) : null,
    checkout: args.checkout !== false,
  })
  const branch = String(out?.branch || args.branch || "").trim()
  const source = String(out?.sourceRef || args.source_ref || "").trim()
  return {
    branch,
    source_ref: source,
    created: true,
    checked_out: Boolean(out?.checkedOut),
    remote_mode: false,
    message: `Created local browser branch '${branch}'${source ? ` from '${source}'` : ""}.`,
  }
}
""".strip(),
    "repo_grep": """
async function run(args, context, helpers) {
  const pattern = String(args.pattern || "").trim()
  if (!pattern) {
    throw new Error("repo_grep requires args.pattern")
  }
  const includePatterns = Array.isArray(args.include_file_patterns)
    ? args.include_file_patterns.map((x) => String(x || "").trim()).filter(Boolean)
    : []
  const excludePatterns = Array.isArray(args.exclude_file_patterns)
    ? args.exclude_file_patterns.map((x) => String(x || "").trim()).filter(Boolean)
    : []

  function matchesGlob(path, pattern) {
    if (!pattern) return true
    const escaped = pattern.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, ".*").replace(/\\?/g, ".")
    try {
      return new RegExp(`^${escaped}$`).test(path)
    } catch {
      return true
    }
  }

  function pathAllowed(path) {
    const rel = String(path || "")
    if (includePatterns.length > 0 && !includePatterns.some((pat) => matchesGlob(rel, pat))) return false
    if (excludePatterns.length > 0 && excludePatterns.some((pat) => matchesGlob(rel, pat))) return false
    return true
  }

  const matches = helpers.localRepo.grep(pattern, {
    regex: args.regex !== false,
    caseSensitive: Boolean(args.case_sensitive),
    maxResults: Number(args.max_results || 50),
    contextLines: Number(args.context_lines || 2),
    glob: args.glob ? String(args.glob) : undefined,
  })
  const filtered = Array.isArray(matches) ? matches.filter((m) => pathAllowed(m?.path)) : []
  return { matches: filtered }
}
""".strip(),
    "open_file": """
async function run(args, context, helpers) {
  const path = String(args.path || "").trim().replace(/^\\.\\//, "").replace(/^\\//, "")
  if (!path) {
    throw new Error("open_file requires args.path")
  }
  const maxChars = Math.max(1000, Math.min(Number(args.max_chars || 200000), 400000))
  const text = String(helpers.localRepo.readFile(path, maxChars) || "")
  const lines = text.split(/\\r?\\n/)
  const total = Math.max(1, lines.length)
  let start = Number(args.start_line || 1)
  let end = Number(args.end_line || total)
  if (!Number.isFinite(start) || start < 1) start = 1
  if (!Number.isFinite(end) || end < start) end = total
  start = Math.min(start, total)
  end = Math.min(Math.max(end, start), total)
  const content = lines.slice(start - 1, end).join("\\n")
  return {
    path,
    ref: args.ref ? String(args.ref) : (args.branch ? String(args.branch) : null),
    start_line: start,
    end_line: end,
    content,
  }
}
""".strip(),
    "repo_tree": """
async function run(args, context, helpers) {
  const maxDepth = Math.max(1, Math.min(Number(args.max_depth || 4), 12))
  const maxEntries = Math.max(1, Math.min(Number(args.max_entries || 800), 3000))
  const includeFiles = args.include_files !== false
  const includeDirs = args.include_dirs !== false
  const base = String(args.path || "").trim().replace(/^\\/+|\\/+$/g, "")
  const glob = String(args.glob || "").trim()

  function matchesGlob(path, pattern) {
    if (!pattern) return true
    const escaped = pattern.replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, ".*").replace(/\\?/g, ".")
    try {
      return new RegExp(`^${escaped}$`).test(path)
    } catch {
      return true
    }
  }

  const files = helpers.localRepo.listFiles(5000)
  const entries = []
  const dirSet = new Set()

  for (const rawPath of files) {
    const rel = String(rawPath || "").replaceAll("\\\\", "/").replace(/^\\.\\//, "").replace(/^\\//, "")
    if (!rel) continue
    if (base && !(rel === base || rel.startsWith(base + "/"))) continue
    if (glob && !matchesGlob(rel, glob)) continue

    const relFromBase = base && rel.startsWith(base + "/") ? rel.slice(base.length + 1) : (rel === base ? "" : rel)
    const depth = relFromBase ? relFromBase.split("/").length : 1
    if (depth > maxDepth) continue

    if (includeFiles) {
      entries.push({ path: rel, type: "file", depth, size: null })
    }

    const parts = rel.split("/")
    while (parts.length > 1) {
      parts.pop()
      const d = parts.join("/")
      if (!d) break
      if (base && !(d === base || d.startsWith(base + "/"))) continue
      const dRel = base && d.startsWith(base + "/") ? d.slice(base.length + 1) : (d === base ? "" : d)
      const dDepth = dRel ? dRel.split("/").length : 1
      if (dDepth <= maxDepth) {
        dirSet.add(d)
      }
    }
  }

  if (includeDirs) {
    for (const d of Array.from(dirSet.values())) {
      const dRel = base && d.startsWith(base + "/") ? d.slice(base.length + 1) : (d === base ? "" : d)
      const dDepth = dRel ? dRel.split("/").length : 1
      if (dDepth <= maxDepth) {
        entries.push({ path: d, type: "dir", depth: dDepth, size: null })
      }
    }
  }

  entries.sort((a, b) => {
    const da = String(a.path || "").split("/").length
    const db = String(b.path || "").split("/").length
    if (da !== db) return da - db
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    if (a.type === b.type) return 0
    return a.type === "dir" ? -1 : 1
  })

  return {
    root: base || ".",
    branch: String(args.branch || "main"),
    entries: entries.slice(0, maxEntries),
  }
}
""".strip(),
    "read_docs_folder": """
async function run(args, context, helpers) {
  const docsRoot = String(args.path || "documentation").trim().replace(/^\\/+|\\/+$/g, "") || "documentation"
  const branch = String(args.branch || "main")
  const maxFiles = Math.max(1, Math.min(Number(args.max_files || 200), 500))
  const maxChars = Math.max(100, Math.min(Number(args.max_chars_per_file || 12000), 30000))
  const files = helpers.localRepo
    .listFiles(10000)
    .filter((path) => path.startsWith(docsRoot + "/") && path.toLowerCase().endsWith(".md"))
    .slice(0, maxFiles)
    .map((path) => ({ path, content: helpers.localRepo.readFile(path, maxChars) }))
  return { branch, files }
}
""".strip(),
    "collect_repo_context": """
async function run(args, context, helpers) {
  const maxFiles = Math.max(20, Math.min(Number(args.max_files || 500), 2000))
  const maxCharsPerFile = Math.max(300, Math.min(Number(args.max_chars_per_file || 3500), 12000))
  const maxContextChars = Math.max(12000, Math.min(Number(args.max_context_chars || 220000), 450000))
  const includeDocs = Boolean(args.include_docs === true)
  const info = helpers.localRepo.info()
  const allFiles = helpers.localRepo.listFiles(12000)
  const textExt = [
    ".md",".txt",".rst",".py",".js",".ts",".tsx",".json",".yml",".yaml",".java",".kt",".cs",".sql",".html",
    ".css",".go",".rs",".toml",".ini",".cfg",".env",".sh"
  ]
  const ignoreParts = new Set([".git","node_modules",".next","dist","build",".venv","venv","__pycache__"])
  function isText(path) {
    const lower = String(path || "").toLowerCase()
    return textExt.some((ext) => lower.endsWith(ext))
  }
  function isIgnored(path) {
    const parts = String(path || "").split("/").filter(Boolean)
    return parts.some((part) => ignoreParts.has(part))
  }
  const filtered = allFiles
    .filter((path) => isText(path))
    .filter((path) => !isIgnored(path))
    .filter((path) => includeDocs || !path.startsWith("documentation/"))
    .slice(0, maxFiles)

  const selectedPaths = []
  let contextText = ""
  for (const path of filtered) {
    const content = String(helpers.localRepo.readFile(path, maxCharsPerFile) || "")
    if (!content.trim()) continue
    const block = `### FILE: ${path}\\n${content}\\n\\n`
    if ((contextText.length + block.length) > maxContextChars) break
    contextText += block
    selectedPaths.push(path)
  }
  return {
    root_name: String(info?.rootName || ""),
    file_paths: allFiles,
    selected_paths: selectedPaths,
    context: contextText,
    indexed_at: String(info?.indexedAt || ""),
  }
}
""".strip(),
    "write_docs_bundle": """
async function run(args, context, helpers) {
  const docsRoot = String(args.docs_root || "documentation").trim().replace(/^\\/+|\\/+$/g, "") || "documentation"
  const clearFirst = args.clear_first !== false
  const rows = Array.isArray(args.files) ? args.files : []
  const written = []
  let deleted = 0

  function normalizePath(path) {
    let p = String(path || "").trim().replaceAll("\\\\", "/").replace(/^\\.\\//, "").replace(/^\\/+/, "")
    if (!p) return ""
    if (!p.startsWith(docsRoot + "/")) p = `${docsRoot}/${p}`
    return p
  }

  if (clearFirst) {
    const existing = helpers.localRepo.listFiles(12000).filter((p) => p.startsWith(docsRoot + "/"))
    for (const path of existing) {
      const out = await helpers.localRepo.deleteFile(path)
      if (out?.deleted) deleted += 1
    }
  }

  for (const row of rows) {
    const rawPath = normalizePath(row?.path)
    const content = String(row?.content || "")
    if (!rawPath || !rawPath.toLowerCase().endsWith(".md") || !content.trim()) continue
    await helpers.localRepo.writeFile(rawPath, content.endsWith("\\n") ? content : `${content}\\n`)
    written.push(rawPath)
  }
  return { docs_root: docsRoot, written_paths: written, deleted_count: deleted }
}
""".strip(),
}


def _oid_str(x: Any) -> str:
    if isinstance(x, ObjectId):
        return str(x)
    return str(x)


def _safe_join_repo(repo_path: str, rel_path: str) -> Path:
    root = Path(repo_path).resolve()
    p = (root / rel_path).resolve()
    if root not in p.parents and root != p:
        raise ValueError("Path escapes repo root")
    return p


def _line_slice(text: str, start_line: Optional[int], end_line: Optional[int]) -> tuple[int, int, str]:
    lines = text.splitlines()
    total = len(lines)
    s = max(1, start_line or 1)
    e = min(total, end_line or total)
    if e < s:
        e = s
    sliced = "\n".join(lines[s - 1 : e])
    return s, e, sliced


def _read_text_file(p: Path, max_chars: int) -> str:
    data = p.read_text(encoding="utf-8", errors="replace")
    if len(data) > max_chars:
        data = data[:max_chars] + "\n... (truncated)\n"
    return data


def _run(cmd: list[str], cwd: str, timeout: int = 40) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_git(repo_path: str, args: list[str], timeout: int = 40) -> subprocess.CompletedProcess:
    return _run(["git", "-C", repo_path, *args], cwd=repo_path, timeout=timeout)


def _git_stdout(repo_path: str, args: list[str], timeout: int = 40, not_found_ok: bool = False) -> str:
    proc = _run_git(repo_path, args, timeout=timeout)
    if proc.returncode != 0:
        if not_found_ok:
            return ""
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(detail or f"git command failed: {' '.join(args)}")
    return proc.stdout


def _branch_exists(repo_path: str, branch: str) -> bool:
    proc = _run_git(repo_path, ["rev-parse", "--verify", branch], timeout=15)
    return proc.returncode == 0


def _current_branch(repo_path: str) -> str:
    return _git_stdout(repo_path, ["rev-parse", "--abbrev-ref", "HEAD"], timeout=15, not_found_ok=True).strip() or "main"


def _is_ignored_path(path: str) -> bool:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return any(p in IGNORE_PARTS for p in parts)


def _glob_match(path: str, glob_pat: Optional[str]) -> bool:
    if not glob_pat:
        return True
    return fnmatch.fnmatch(path, glob_pat)


def _normalize_glob_patterns(raw_patterns: Optional[list[str]]) -> list[str]:
    out: list[str] = []
    for raw in raw_patterns or []:
        pat = str(raw or "").strip()
        if not pat or pat in out:
            continue
        out.append(pat)
    return out[:64]


def _path_matches_patterns(path: str, include_patterns: list[str], exclude_patterns: list[str]) -> bool:
    if include_patterns and not any(_glob_match(path, pat) for pat in include_patterns):
        return False
    if exclude_patterns and any(_glob_match(path, pat) for pat in exclude_patterns):
        return False
    return True


def _open_file_path_candidates(raw_path: str) -> list[str]:
    seed = str(raw_path or "").strip()
    if not seed:
        return []
    cleaned = seed.strip().strip("`'\"")
    candidates: list[str] = [seed]
    if cleaned and cleaned not in candidates:
        candidates.append(cleaned)
    if cleaned.startswith("./"):
        alt = cleaned[2:]
        if alt and alt not in candidates:
            candidates.append(alt)

    # Common LLM path artifact: punctuation appended to markdown file paths (e.g. "foo.md.").
    trail = cleaned
    while trail and trail[-1] in ".,;:!?)]}":
        trail = trail[:-1].strip()
        if trail and trail not in candidates:
            candidates.append(trail)
    return candidates


def _is_browser_local_snapshot_not_found(err: Exception) -> bool:
    msg = str(err or "").lower()
    return "file not found in browser-local snapshot" in msg or "file not found:" in msg


def _limit_text(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars] + "\n... (truncated)\n", True


def _proc_output(proc: subprocess.CompletedProcess, max_chars: int = 50_000) -> str:
    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    out, _ = _limit_text(combined, max_chars)
    return out


async def _project_doc(project_id: str) -> dict[str, Any]:
    doc = await repository_factory().access_policy.find_project_doc(project_id)
    if not doc:
        raise KeyError(f"Project not found: {project_id}")
    return doc


async def _find_enabled_connector(project_id: str, connector_type: str) -> dict[str, Any] | None:
    return await repository_factory().access_policy.find_enabled_connector(
        project_id=project_id,
        connector_type=connector_type,
    )


def _utc_iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _iso_value(raw: Any) -> str:
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc).isoformat()
        return raw.astimezone(timezone.utc).isoformat()
    s = str(raw or "").strip()
    return s or _utc_iso_now()


def _task_item_from_doc(doc: dict[str, Any]) -> ChatTaskItem:
    return ChatTaskItem(
        id=str(doc.get("_id") or doc.get("id") or ""),
        project_id=str(doc.get("project_id") or ""),
        chat_id=(str(doc.get("chat_id") or "").strip() or None),
        title=str(doc.get("title") or ""),
        details=str(doc.get("details") or ""),
        status=str(doc.get("status") or "open"),
        assignee=(str(doc.get("assignee") or "").strip() or None),
        due_date=(str(doc.get("due_date") or "").strip() or None),
        created_at=_iso_value(doc.get("created_at")),
        updated_at=_iso_value(doc.get("updated_at")),
    )


def _is_browser_local_repo_path(repo_path: str | None) -> bool:
    return str(repo_path or "").strip().lower().startswith(BROWSER_LOCAL_REPO_PREFIX)


def _ctx_field(ctx: Any, field: str) -> str:
    return str(getattr(ctx, field, "") or "").strip()


async def _create_browser_local_tool_job(
    *,
    tool_name: str,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    args: dict[str, Any],
    timeout_sec: int = 45,
) -> str:
    code = _BROWSER_LOCAL_GIT_TOOL_CODE.get(tool_name)
    if not code:
        raise RuntimeError(f"No browser-local code registered for tool: {tool_name}")
    now = datetime.utcnow()
    expires = now + timedelta(seconds=max(30, timeout_sec + 20))
    job = LocalToolJob(
        toolId=f"builtin:{tool_name}",
        toolName=tool_name,
        projectId=project_id,
        branch=branch,
        userId=user_id,
        chatId=chat_id,
        runtime="local_typescript",
        version=None,
        code=code,
        args=args if isinstance(args, dict) else {},
        context={
            "project_id": project_id,
            "branch": branch,
            "chat_id": chat_id,
            "user_id": user_id,
            "tool_name": tool_name,
            "runtime": "local_typescript",
            "source": "builtin_browser_local",
        },
        status="queued",
        createdAt=now,
        updatedAt=now,
        expiresAt=expires,
    )
    await job.insert()
    logger.info(
        "browser_local_git.job_queued tool=%s project=%s branch=%s chat=%s job=%s",
        tool_name,
        project_id,
        branch,
        chat_id or "",
        str(job.id),
    )
    return str(job.id)


async def _wait_browser_local_tool_job(job_id: str, timeout_sec: int) -> Any:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + max(1, timeout_sec)
    while True:
        current = await LocalToolJob.get(job_id)
        if not current:
            raise RuntimeError("Browser-local tool job not found")
        status = str(current.status or "")
        if status == "completed":
            return current.result
        if status in {"failed", "timeout", "cancelled"}:
            raise RuntimeError(str(current.error or f"Browser-local tool job failed ({status})"))
        if loop.time() >= deadline:
            current.status = "timeout"
            current.error = "Browser-local tool job timed out waiting for browser execution."
            current.updatedAt = datetime.utcnow()
            current.completedAt = datetime.utcnow()
            await current.save()
            raise RuntimeError("Browser-local tool job timed out waiting for browser execution")
        await asyncio.sleep(LOCAL_TOOL_JOB_POLL_INTERVAL_SEC)


async def _run_browser_local_git_tool(
    *,
    tool_name: str,
    project_id: str,
    ctx: Any,
    args: dict[str, Any],
    timeout_sec: int = 45,
) -> dict[str, Any]:
    user_id = _ctx_field(ctx, "user_id")
    if not user_id:
        raise RuntimeError("Browser-local git tool execution requires an authenticated user context")
    chat_id = _ctx_field(ctx, "chat_id") or None
    branch = _ctx_field(ctx, "branch") or "main"
    job_id = await _create_browser_local_tool_job(
        tool_name=tool_name,
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        chat_id=chat_id,
        args=args,
        timeout_sec=timeout_sec,
    )
    out = await _wait_browser_local_tool_job(job_id, timeout_sec=timeout_sec)
    if not isinstance(out, dict):
        raise RuntimeError(f"Browser-local tool returned invalid result for {tool_name}")
    logger.info(
        "browser_local_git.job_done tool=%s project=%s branch=%s chat=%s job=%s",
        tool_name,
        project_id,
        branch,
        chat_id or "",
        job_id,
    )
    return out


def _normalize_branch_list(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items:
        branch = str(raw or "").strip()
        if not branch or branch in seen:
            continue
        seen.add(branch)
        out.append(branch)
    return out


async def _store_browser_local_branch_state(
    *,
    project_id: str,
    active_branch: str | None = None,
    branches: list[str] | None = None,
    set_default_branch: bool = False,
) -> None:
    try:
        project = await _project_doc(project_id)
    except Exception:
        return
    extra = project.get("extra")
    if not isinstance(extra, dict):
        extra = {}
    browser_local = extra.get("browser_local")
    if not isinstance(browser_local, dict):
        browser_local = {}

    known: list[str] = []
    if isinstance(browser_local.get("branches"), list):
        known.extend([str(x or "").strip() for x in browser_local.get("branches") or []])
    if branches:
        known.extend([str(x or "").strip() for x in branches])
    if active_branch:
        known.insert(0, str(active_branch))
    known = _normalize_branch_list(known)

    update_extra = dict(extra)
    update_browser_local = dict(browser_local)
    update_browser_local["branches"] = known
    if active_branch:
        update_browser_local["active_branch"] = str(active_branch)
    update_extra["browser_local"] = update_browser_local

    update_doc: dict[str, Any] = {"extra": update_extra}
    if set_default_branch and active_branch:
        update_doc["default_branch"] = str(active_branch)

    await repository_factory().access_policy.update_project_fields_by_id(
        project_id=str(project.get("_id") or ""),
        patch=update_doc,
    )


def _extract_jira_project_key(config: dict[str, Any]) -> str | None:
    explicit = str(config.get("projectKey") or config.get("project_key") or "").strip()
    if explicit:
        return explicit
    jql = str(config.get("jql") or "").strip()
    if not jql:
        return None
    m = re.search(r"\bproject\s*=\s*([A-Z][A-Z0-9_]+)", jql, flags=re.IGNORECASE)
    if not m:
        return None
    return m.group(1).upper()


def _assert_branch_checked_out(req_branch: str | None, repo_path: str) -> str:
    current = _current_branch(repo_path)
    want = (req_branch or "").strip()
    if want and want != current:
        raise RuntimeError(
            f"Requested branch '{want}' is not checked out locally (current: '{current}'). "
            "Switch local branch first or omit branch."
        )
    return current


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _github_open_file_content(config: dict, path: str, ref: Optional[str] = None) -> tuple[str, str]:
    owner = str(config.get("owner", "")).strip()
    repo = str(config.get("repo", "")).strip()
    token = str(config.get("token", "")).strip()
    branch = (ref or str(config.get("branch", "")).strip() or "main")
    headers = _github_headers(token)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            params={"ref": branch},
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("encoding") != "base64" or "content" not in payload:
            raise ValueError(f"GitHub returned non-base64 content for {path}")
        raw = base64.b64decode(payload["content"]).decode("utf-8", errors="replace")
        html_url = payload.get("html_url") or f"https://github.com/{owner}/{repo}/blob/{branch}/{path}"
        return raw, html_url


async def _github_list_tree(config: dict, ref: str) -> list[str]:
    owner = str(config.get("owner", "")).strip()
    repo = str(config.get("repo", "")).strip()
    token = str(config.get("token", "")).strip()
    headers = _github_headers(token)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}",
            headers=headers,
            params={"recursive": "1"},
        )
        resp.raise_for_status()
        tree = (resp.json() or {}).get("tree") or []
        out: list[str] = []
        for item in tree:
            if item.get("type") != "blob":
                continue
            p = str(item.get("path") or "")
            if p:
                out.append(p)
        return out


def _bitbucket_headers(config: dict) -> dict[str, str]:
    token = str(config.get("token") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}
    username = str(config.get("username") or "").strip()
    app_password = str(config.get("app_password") or config.get("appPassword") or "").strip()
    if username and app_password:
        raw = f"{username}:{app_password}".encode("utf-8")
        return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}
    return {}


def _bitbucket_base_url(config: dict) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://api.bitbucket.org/2.0").rstrip("/")


async def _bitbucket_list_tree(config: dict, ref: str) -> list[str]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return []

    url = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src/{quote(ref, safe='')}"
    headers = _bitbucket_headers(config)

    out: list[str] = []
    async with httpx.AsyncClient(timeout=30) as client:
        next_url: Optional[str] = url
        params: Optional[dict[str, Any]] = {"pagelen": 100}
        while next_url:
            resp = await client.get(next_url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json() or {}
            for item in data.get("values") or []:
                if str(item.get("type") or "") != "commit_file":
                    continue
                p = str(item.get("path") or "").strip()
                if p:
                    out.append(p)
            next_url = data.get("next")
            params = None
    return out


async def _bitbucket_open_file_content(config: dict, path: str, ref: Optional[str] = None) -> tuple[str, str]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        raise ValueError("Bitbucket connector missing workspace/repo")

    branch = (ref or str(config.get("branch") or "").strip() or "main")
    url = (
        f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src/"
        f"{quote(branch, safe='')}/{quote(path, safe='/')}"
    )
    headers = _bitbucket_headers(config)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        web_url = f"https://bitbucket.org/{workspace}/{repo_slug}/src/{branch}/{path}"
        return resp.text, web_url


def _azure_headers(config: dict) -> dict[str, str]:
    pat = str(config.get("pat") or config.get("token") or "").strip()
    if not pat:
        return {}
    raw = f":{pat}".encode("utf-8")
    return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}


def _azure_base_url(config: dict) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://dev.azure.com").rstrip("/")


def _azure_parts(config: dict) -> tuple[str, str, str]:
    org = str(config.get("organization") or config.get("org") or "").strip()
    project = str(config.get("project") or "").strip()
    repo = str(config.get("repository") or config.get("repo") or "").strip()
    return org, project, repo


async def _azure_list_tree(config: dict, ref: str) -> list[str]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        return []
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    params = {
        "scopePath": "/",
        "recursionLevel": "Full",
        "includeContentMetadata": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": ref,
        "api-version": api_version,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(endpoint, headers=_azure_headers(config), params=params)
        resp.raise_for_status()
        data = resp.json() or {}
    out: list[str] = []
    for item in data.get("value") or []:
        if bool(item.get("isFolder")):
            continue
        p = str(item.get("path") or "").lstrip("/").strip()
        if p:
            out.append(p)
    return out


async def _azure_open_file_content(config: dict, path: str, ref: Optional[str] = None) -> tuple[str, str]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise ValueError("Azure DevOps connector missing organization/project/repository")

    branch = (ref or str(config.get("branch") or "").strip() or "main")
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    headers = _azure_headers(config)
    params = {
        "path": f"/{path.lstrip('/')}",
        "includeContent": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": branch,
        "api-version": api_version,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(endpoint, headers=headers, params=params)
        resp.raise_for_status()
        ctype = str(resp.headers.get("content-type") or "").lower()
        if "application/json" in ctype:
            data = resp.json() or {}
            content = data.get("content")
            if isinstance(content, str):
                web_url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{branch}"
                return content, web_url
        raw_resp = await client.get(
            endpoint,
            headers=headers,
            params={
                "path": f"/{path.lstrip('/')}",
                "download": "true",
                "versionDescriptor.versionType": "branch",
                "versionDescriptor.version": branch,
                "api-version": api_version,
            },
        )
        raw_resp.raise_for_status()
        web_url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{branch}"
        return raw_resp.text, web_url


async def _remote_repo_connector(project_id: str) -> Optional[dict[str, Any]]:
    rows = await repository_factory().access_policy.list_enabled_connectors(
        project_id=project_id,
        types=["github", "git", "bitbucket", "azure_devops"],
        limit=20,
    )
    by_type = {str(r.get("type") or ""): r for r in rows}
    for t in ("github", "git", "bitbucket", "azure_devops"):
        row = by_type.get(t)
        if not row:
            continue
        normalized_type = "github" if t == "git" else t
        return {"type": normalized_type, "connector_type": t, "config": row.get("config") or {}}
    return None


def _remote_ref(remote: dict[str, Any], requested_ref: Optional[str]) -> str:
    if requested_ref and requested_ref.strip():
        return requested_ref.strip()
    config = remote.get("config") or {}
    return str(config.get("branch") or "main").strip() or "main"


def _remote_ref_candidates(remote: dict[str, Any], requested_ref: Optional[str]) -> list[str]:
    config = remote.get("config") or {}
    base = str(config.get("branch") or "").strip()
    default = str(config.get("default_branch") or "").strip()
    requested = (requested_ref or "").strip()

    candidates: list[str] = []
    for ref in (requested, base, default, "main", "master"):
        r = str(ref or "").strip()
        if not r:
            continue
        if r not in candidates:
            candidates.append(r)

    # Also try GitHub-style refs when branch aliases are used.
    for ref in list(candidates):
        if ref.startswith("heads/"):
            alt = ref.removeprefix("heads/")
            if alt and alt not in candidates:
                candidates.append(alt)
        else:
            alt = f"heads/{ref}"
            if alt not in candidates:
                candidates.append(alt)

    return candidates or ["main", "master"]


def _is_ref_retryable_status(err: Exception) -> bool:
    if isinstance(err, httpx.HTTPStatusError):
        try:
            status = int(err.response.status_code)
        except Exception:
            return False
        return status in {400, 404, 422}
    return False


async def _remote_list_tree(remote: dict[str, Any], requested_ref: Optional[str]) -> list[str]:
    rtype = remote.get("type")
    config = remote.get("config") or {}
    refs = _remote_ref_candidates(remote, requested_ref)
    last_err: Exception | None = None

    for idx, ref in enumerate(refs):
        try:
            if rtype == "github":
                return await _github_list_tree(config, ref)
            if rtype == "bitbucket":
                return await _bitbucket_list_tree(config, ref)
            if rtype == "azure_devops":
                return await _azure_list_tree(config, ref)
            return []
        except Exception as err:
            last_err = err
            if idx < len(refs) - 1 and _is_ref_retryable_status(err):
                continue
            raise

    if last_err:
        raise last_err
    return []


async def _remote_open_file(remote: dict[str, Any], path: str, requested_ref: Optional[str]) -> tuple[str, str]:
    rtype = remote.get("type")
    config = remote.get("config") or {}
    refs = _remote_ref_candidates(remote, requested_ref)
    last_err: Exception | None = None

    for idx, ref in enumerate(refs):
        try:
            if rtype == "github":
                return await _github_open_file_content(config, path, ref=ref)
            if rtype == "bitbucket":
                return await _bitbucket_open_file_content(config, path, ref=ref)
            if rtype == "azure_devops":
                return await _azure_open_file_content(config, path, ref=ref)
            break
        except Exception as err:
            last_err = err
            if idx < len(refs) - 1 and _is_ref_retryable_status(err):
                continue
            raise

    if last_err:
        raise last_err
    raise ValueError("Unsupported remote connector")


def _sanitize_branch_name(raw: str) -> str:
    branch = (raw or "").strip()
    if not branch:
        raise RuntimeError("branch is required")
    if branch.startswith("-"):
        raise RuntimeError("Invalid branch name")
    if ".." in branch or branch.endswith("/") or branch.startswith("/") or " " in branch:
        raise RuntimeError("Invalid branch name")
    if not re.fullmatch(r"[A-Za-z0-9._/\-]+", branch):
        raise RuntimeError("Invalid branch name")
    return branch


def _sanitize_rel_paths(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in items:
        p = str(raw or "").strip().replace("\\", "/")
        if not p or p == ".":
            continue
        if p.startswith("/") or ".." in p.split("/"):
            continue
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def _merge_branch_items(
    raw_items: list[GitBranchItem],
    *,
    default_branch: str,
    active_branch: str,
    max_branches: int,
) -> list[GitBranchItem]:
    by_name: dict[str, GitBranchItem] = {}
    for item in raw_items:
        name = str(item.name or "").strip()
        if not name:
            continue
        existing = by_name.get(name)
        if not existing:
            by_name[name] = GitBranchItem(name=name, commit=item.commit)
            continue
        if not existing.commit and item.commit:
            existing.commit = item.commit

    if default_branch and default_branch not in by_name:
        by_name[default_branch] = GitBranchItem(name=default_branch)
    if active_branch and active_branch not in by_name:
        by_name[active_branch] = GitBranchItem(name=active_branch)

    ordered_names: list[str] = []
    for name in (active_branch, default_branch):
        if name and name in by_name and name not in ordered_names:
            ordered_names.append(name)
    for name in sorted(by_name.keys()):
        if name not in ordered_names:
            ordered_names.append(name)

    out: list[GitBranchItem] = []
    for name in ordered_names[: max(1, min(max_branches, 1000))]:
        item = by_name[name]
        item.is_default = bool(default_branch and name == default_branch)
        out.append(item)
    return out


def _local_branch_items(repo_path: str) -> list[GitBranchItem]:
    stdout = _git_stdout(
        repo_path,
        ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads", "refs/remotes/origin"],
        timeout=25,
        not_found_ok=True,
    )
    out: list[GitBranchItem] = []
    seen: set[str] = set()
    for line in stdout.splitlines():
        raw = line.strip()
        if not raw:
            continue
        parts = raw.split("\t")
        name = (parts[0] or "").strip()
        sha = (parts[1] or "").strip() if len(parts) > 1 else None
        if not name or name == "origin/HEAD":
            continue
        if name.startswith("origin/"):
            name = name[7:]
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(GitBranchItem(name=name, commit=sha or None))
    return out


async def _github_list_branches(config: dict[str, Any], max_branches: int) -> list[GitBranchItem]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    if not owner or not repo:
        return []
    headers = _github_headers(str(config.get("token") or "").strip())
    out: list[GitBranchItem] = []
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while len(out) < max_branches:
            resp = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/branches",
                headers=headers,
                params={"per_page": min(100, max_branches), "page": page},
            )
            resp.raise_for_status()
            data = resp.json() or []
            if not isinstance(data, list) or not data:
                break
            for row in data:
                name = str((row or {}).get("name") or "").strip()
                sha = str(((row or {}).get("commit") or {}).get("sha") or "").strip() or None
                if not name:
                    continue
                out.append(GitBranchItem(name=name, commit=sha))
                if len(out) >= max_branches:
                    break
            if len(data) < 100:
                break
            page += 1
    return out


async def _bitbucket_list_branches(config: dict[str, Any], max_branches: int) -> list[GitBranchItem]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return []

    endpoint = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/refs/branches"
    headers = _bitbucket_headers(config)
    out: list[GitBranchItem] = []
    async with httpx.AsyncClient(timeout=30) as client:
        next_url: Optional[str] = endpoint
        params: Optional[dict[str, Any]] = {"pagelen": min(100, max_branches)}
        while next_url and len(out) < max_branches:
            resp = await client.get(next_url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json() or {}
            values = data.get("values") or []
            if not isinstance(values, list):
                values = []
            for row in values:
                name = str((row or {}).get("name") or "").strip()
                sha = str(((row or {}).get("target") or {}).get("hash") or "").strip() or None
                if not name:
                    continue
                out.append(GitBranchItem(name=name, commit=sha))
                if len(out) >= max_branches:
                    break
            next_url = data.get("next")
            params = None
    return out


async def _azure_list_branches(config: dict[str, Any], max_branches: int) -> list[GitBranchItem]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        return []
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/refs"
    headers = _azure_headers(config)
    out: list[GitBranchItem] = []
    continuation: Optional[str] = None
    async with httpx.AsyncClient(timeout=30) as client:
        while len(out) < max_branches:
            params: dict[str, Any] = {
                "filter": "heads/",
                "$top": min(1000, max_branches),
                "api-version": api_version,
            }
            if continuation:
                params["continuationToken"] = continuation
            resp = await client.get(endpoint, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json() or {}
            values = data.get("value") or []
            if not isinstance(values, list):
                values = []
            for row in values:
                raw_name = str((row or {}).get("name") or "").strip()
                name = raw_name.removeprefix("refs/heads/") if raw_name.startswith("refs/heads/") else raw_name
                sha = str((row or {}).get("objectId") or "").strip() or None
                if not name:
                    continue
                out.append(GitBranchItem(name=name, commit=sha))
                if len(out) >= max_branches:
                    break
            continuation = str(resp.headers.get("x-ms-continuationtoken") or "").strip() or None
            if not continuation:
                break
    return out


async def _remote_branch_items(remote: dict[str, Any], max_branches: int) -> list[GitBranchItem]:
    rtype = str(remote.get("type") or "")
    config = remote.get("config") or {}
    if rtype == "github":
        return await _github_list_branches(config, max_branches)
    if rtype == "bitbucket":
        return await _bitbucket_list_branches(config, max_branches)
    if rtype == "azure_devops":
        return await _azure_list_branches(config, max_branches)
    return []


async def _github_branch_commit_sha(config: dict[str, Any], branch: str) -> str:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    if not owner or not repo:
        raise RuntimeError("GitHub connector missing owner/repo")
    headers = _github_headers(str(config.get("token") or "").strip())
    safe_branch = quote(branch, safe="")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{safe_branch}",
            headers=headers,
        )
        resp.raise_for_status()
    payload = resp.json() or {}
    sha = str(((payload.get("object") or {}).get("sha")) or "").strip()
    if not sha:
        raise RuntimeError(f"Could not resolve source branch SHA for {branch}")
    return sha


async def _bitbucket_branch_commit_sha(config: dict[str, Any], branch: str) -> str:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        raise RuntimeError("Bitbucket connector missing workspace/repo")
    headers = _bitbucket_headers(config)
    endpoint = (
        f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/refs/branches/"
        f"{quote(branch, safe='')}"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(endpoint, headers=headers)
        resp.raise_for_status()
    body = resp.json() or {}
    sha = str(((body.get("target") or {}).get("hash")) or "").strip()
    if not sha:
        raise RuntimeError(f"Could not resolve source branch SHA for {branch}")
    return sha


async def _azure_branch_commit_sha(config: dict[str, Any], branch: str) -> str:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise RuntimeError("Azure DevOps connector missing organization/project/repository")
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/refs"
    params = {
        "filter": f"heads/{branch}",
        "$top": 1,
        "api-version": api_version,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(endpoint, headers=_azure_headers(config), params=params)
        resp.raise_for_status()
    rows = (resp.json() or {}).get("value") or []
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"Source branch not found on Azure DevOps: {branch}")
    sha = str((rows[0] or {}).get("objectId") or "").strip()
    if not sha:
        raise RuntimeError(f"Could not resolve source branch SHA for {branch}")
    return sha


async def _create_remote_branch(remote: dict[str, Any], branch: str, source_ref: str) -> None:
    rtype = str(remote.get("type") or "")
    config = remote.get("config") or {}
    if rtype == "github":
        owner = str(config.get("owner") or "").strip()
        repo = str(config.get("repo") or "").strip()
        if not owner or not repo:
            raise RuntimeError("GitHub connector missing owner/repo")
        sha = await _github_branch_commit_sha(config, source_ref)
        payload = {"ref": f"refs/heads/{branch}", "sha": sha}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.github.com/repos/{owner}/{repo}/git/refs",
                headers=_github_headers(str(config.get("token") or "").strip()),
                json=payload,
            )
            resp.raise_for_status()
        return

    if rtype == "bitbucket":
        workspace = str(config.get("workspace") or "").strip()
        repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
        if not workspace or not repo_slug:
            raise RuntimeError("Bitbucket connector missing workspace/repo")
        sha = await _bitbucket_branch_commit_sha(config, source_ref)
        endpoint = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/refs/branches"
        payload = {"name": branch, "target": {"hash": sha}}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(endpoint, headers=_bitbucket_headers(config), json=payload)
            resp.raise_for_status()
        return

    if rtype == "azure_devops":
        org, project, repo = _azure_parts(config)
        if not org or not project or not repo:
            raise RuntimeError("Azure DevOps connector missing organization/project/repository")
        sha = await _azure_branch_commit_sha(config, source_ref)
        api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
        endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/refs"
        payload = [
            {
                "name": f"refs/heads/{branch}",
                "oldObjectId": "0000000000000000000000000000000000000000",
                "newObjectId": sha,
            }
        ]
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                endpoint,
                headers=_azure_headers(config),
                params={"api-version": api_version},
                json=payload,
            )
            resp.raise_for_status()
        return

    raise RuntimeError("No supported remote git connector available")


async def _set_project_default_branch(project_id: str, branch: str) -> None:
    project = await _project_doc(project_id)
    await repository_factory().access_policy.update_project_fields_by_id(
        project_id=str(project.get("_id") or ""),
        patch={"default_branch": branch},
    )


async def _set_remote_branch_config(project_id: str, remote: dict[str, Any], branch: str, *, set_default_branch: bool) -> None:
    remote_type = str(remote.get("connector_type") or remote.get("type") or "")
    if remote_type == "github":
        # Backward compatibility: prefer updating legacy "git" connector rows if present.
        legacy = await repository_factory().access_policy.find_enabled_connector(
            project_id=project_id,
            connector_type="git",
        )
        if legacy:
            remote_type = "git"
    if not remote_type:
        return
    await repository_factory().access_policy.update_connector_fields(
        project_id=project_id,
        connector_type=remote_type,
        patch={
            "config.branch": branch,
            "updatedAt": datetime.utcnow(),
        },
    )
    if set_default_branch:
        await _set_project_default_branch(project_id, branch)


def _require_local_repo_path(meta: ProjectMetadataResponse, tool_name: str) -> str:
    repo_path = str((meta.repo_path or "")).strip()
    if not repo_path or not Path(repo_path).exists():
        raise RuntimeError(f"Local repository not available for {tool_name}")
    return repo_path


def _iter_local_worktree_files(repo_path: str, glob_pat: Optional[str]) -> list[str]:
    out: list[str] = []
    root = Path(repo_path)
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        if _is_ignored_path(rel):
            continue
        if not _glob_match(rel, glob_pat):
            continue
        out.append(rel)
    return out


def _iter_branch_files(repo_path: str, branch: str, glob_pat: Optional[str]) -> list[str]:
    names = _git_stdout(repo_path, ["ls-tree", "-r", "--name-only", branch], timeout=40, not_found_ok=True)
    out: list[str] = []
    for line in names.splitlines():
        rel = line.strip().replace("\\", "/")
        if not rel:
            continue
        if _is_ignored_path(rel):
            continue
        if not _glob_match(rel, glob_pat):
            continue
        out.append(rel)
    return out


def _read_file_from_branch(repo_path: str, branch: str, rel_path: str, max_chars: int = 300_000) -> str:
    text = _git_stdout(repo_path, ["show", f"{branch}:{rel_path}"], timeout=35, not_found_ok=True)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n... (truncated)\n"
    return text


def _compile_search_pattern(req: RepoGrepRequest) -> re.Pattern:
    flags = 0 if req.case_sensitive else re.IGNORECASE
    pat = req.pattern if req.regex else re.escape(req.pattern)
    return re.compile(pat, flags=flags)


async def get_project_metadata(project_id: str) -> ProjectMetadataResponse:
    doc = await _project_doc(project_id)
    return ProjectMetadataResponse(
        id=_oid_str(doc.get("_id")),
        key=doc.get("key"),
        name=doc.get("name"),
        repo_path=(doc.get("repo_path") or "").strip(),
        default_branch=str(doc.get("default_branch") or "main"),
        extra=doc.get("extra", {}) or {},
    )


async def generate_project_docs(project_id: str, branch: Optional[str] = None, ctx: Any = None) -> dict:
    meta = await get_project_metadata(project_id)
    repo_path_raw = str(meta.repo_path or "").strip()
    chosen_branch = (branch or meta.default_branch or "main").strip() or "main"
    can_browser_local = bool(_ctx_field(ctx, "user_id"))
    use_browser_local = _is_browser_local_repo_path(repo_path_raw)
    if not use_browser_local and can_browser_local:
        if not repo_path_raw or not Path(repo_path_raw).exists():
            remote = await _remote_repo_connector(project_id)
            use_browser_local = remote is None

    if use_browser_local:
        try:
            async def _collect_context(include_docs: bool) -> dict[str, Any]:
                result = await _run_browser_local_git_tool(
                    tool_name="collect_repo_context",
                    project_id=project_id,
                    ctx=ctx,
                    args={
                        "branch": chosen_branch,
                        "max_files": 1200,
                        "max_chars_per_file": 4200,
                        "max_context_chars": 260000,
                        "include_docs": include_docs,
                    },
                    timeout_sec=150,
                )
                return result if isinstance(result, dict) else {}

            context_payload = await _collect_context(False)
            local_context = str(context_payload.get("context") or "").strip()
            local_paths_raw = context_payload.get("file_paths")
            local_paths = [str(p).strip() for p in (local_paths_raw if isinstance(local_paths_raw, list) else []) if str(p).strip()]
            selected_paths_raw = context_payload.get("selected_paths")
            selected_paths = [
                str(p).strip() for p in (selected_paths_raw if isinstance(selected_paths_raw, list) else []) if str(p).strip()
            ]
            if not local_paths:
                local_paths = selected_paths
            local_root = str(context_payload.get("root_name") or "")

            if not local_context:
                logger.warning(
                    "generate_project_docs.browser_local.empty_context_retry project=%s branch=%s include_docs=true",
                    project_id,
                    chosen_branch,
                )
                retry_payload = await _collect_context(True)
                retry_context = str(retry_payload.get("context") or "").strip()
                retry_paths_raw = retry_payload.get("file_paths")
                retry_paths = [str(p).strip() for p in (retry_paths_raw if isinstance(retry_paths_raw, list) else []) if str(p).strip()]
                retry_selected_raw = retry_payload.get("selected_paths")
                retry_selected = [
                    str(p).strip() for p in (retry_selected_raw if isinstance(retry_selected_raw, list) else []) if str(p).strip()
                ]
                if retry_context:
                    local_context = retry_context
                if retry_paths:
                    local_paths = retry_paths
                elif retry_selected:
                    local_paths = retry_selected
                if not local_root:
                    local_root = str(retry_payload.get("root_name") or "")

            if not local_context:
                logger.warning(
                    "generate_project_docs.browser_local.empty_context_fallback project=%s branch=%s paths=%s",
                    project_id,
                    chosen_branch,
                    len(local_paths),
                )

            docs_out = await generate_project_documentation_from_local_context(
                project_id=project_id,
                branch=chosen_branch,
                local_repo_root=local_root,
                local_repo_file_paths=local_paths,
                local_repo_context=local_context,
                user_id=_ctx_field(ctx, "user_id") or None,
            )

            generated_files_raw = docs_out.get("files")
            generated_files = generated_files_raw if isinstance(generated_files_raw, list) else []
            write_out = await _run_browser_local_git_tool(
                tool_name="write_docs_bundle",
                project_id=project_id,
                ctx=ctx,
                args={
                    "docs_root": "documentation",
                    "clear_first": True,
                    "files": generated_files,
                },
                timeout_sec=120,
            )
            written_paths_raw = write_out.get("written_paths")
            written_paths = [str(p).strip() for p in (written_paths_raw if isinstance(written_paths_raw, list) else []) if str(p).strip()]
            return {
                "project_id": str(docs_out.get("project_id") or project_id),
                "project_key": str(docs_out.get("project_key") or ""),
                "branch": str(docs_out.get("branch") or chosen_branch),
                "current_branch": chosen_branch,
                "mode": str(docs_out.get("mode") or "fallback"),
                "summary": str(docs_out.get("summary") or "Documentation generated."),
                "files_written": written_paths,
                "context_files_used": int(docs_out.get("context_files_used") or 0),
                "llm_error": docs_out.get("llm_error"),
                "generated_at": str(docs_out.get("generated_at") or _utc_iso_now()),
                "local_repo_root": local_root,
                "browser_local": True,
            }
        except DocumentationError as err:
            raise RuntimeError(str(err)) from err

    try:
        return await generate_project_documentation(
            project_id=project_id,
            branch=chosen_branch,
            user_id=_ctx_field(ctx, "user_id") or None,
        )
    except DocumentationError as err:
        raise RuntimeError(str(err)) from err


async def repo_grep(req: RepoGrepRequest, ctx: Any = None) -> RepoGrepResponse:
    req.max_results = max(1, min(req.max_results, 500))
    req.context_lines = max(0, min(req.context_lines, 12))
    req.include_file_patterns = _normalize_glob_patterns(req.include_file_patterns)
    req.exclude_file_patterns = _normalize_glob_patterns(req.exclude_file_patterns)
    pat = _compile_search_pattern(req)

    meta = await get_project_metadata(req.project_id)
    repo_path_raw = str(meta.repo_path or "").strip()
    root = Path(repo_path_raw) if repo_path_raw else None

    async def _run_browser_local() -> RepoGrepResponse:
        result = await _run_browser_local_git_tool(
            tool_name="repo_grep",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "pattern": req.pattern,
                "glob": req.glob,
                "include_file_patterns": req.include_file_patterns,
                "exclude_file_patterns": req.exclude_file_patterns,
                "case_sensitive": req.case_sensitive,
                "regex": req.regex,
                "max_results": req.max_results,
                "context_lines": req.context_lines,
                "branch": req.branch or meta.default_branch or "main",
            },
            timeout_sec=60,
        )
        raw = result.get("matches")
        if not isinstance(raw, list):
            return RepoGrepResponse(matches=[])

        def _to_int(value: Any, fallback: int) -> int:
            try:
                return int(value)
            except Exception:
                return fallback

        matches: list[GrepMatch] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            before_raw = item.get("before")
            after_raw = item.get("after")
            matches.append(
                GrepMatch(
                    path=str(item.get("path") or ""),
                    line=max(1, _to_int(item.get("line"), 1)),
                    column=max(1, _to_int(item.get("column"), 1)),
                    snippet=str(item.get("snippet") or "")[:500],
                    before=[str(x) for x in (before_raw if isinstance(before_raw, list) else [])],
                    after=[str(x) for x in (after_raw if isinstance(after_raw, list) else [])],
                )
            )
            if len(matches) >= req.max_results:
                break
        return RepoGrepResponse(matches=matches)

    if _is_browser_local_repo_path(repo_path_raw):
        return await _run_browser_local()

    if not (root and root.exists()):
        remote = await _remote_repo_connector(req.project_id)
        if not remote and _ctx_field(ctx, "user_id"):
            logger.info(
                "repo_grep.browser_local_fallback project=%s branch=%s reason=no_local_repo_no_remote_connector",
                req.project_id,
                req.branch or meta.default_branch or "main",
            )
            try:
                return await _run_browser_local()
            except Exception as err:
                logger.warning(
                    "repo_grep.browser_local_fallback_failed project=%s err=%s",
                    req.project_id,
                    err,
                )
        if not remote:
            return RepoGrepResponse(matches=[])
        files = await _remote_list_tree(remote, req.branch)
        matches: list[GrepMatch] = []
        for rel in files:
            if not _glob_match(rel, req.glob):
                continue
            if not _path_matches_patterns(rel, req.include_file_patterns, req.exclude_file_patterns):
                continue
            try:
                text, _ = await _remote_open_file(remote, rel, req.branch)
            except Exception:
                continue
            lines = text.splitlines()
            for idx, line in enumerate(lines, start=1):
                m = pat.search(line)
                if not m:
                    continue
                context_lines = req.context_lines
                before = lines[max(0, idx - 1 - context_lines) : idx - 1]
                after = lines[idx : min(len(lines), idx + context_lines)]
                matches.append(
                    GrepMatch(
                        path=rel,
                        line=idx,
                        column=m.start() + 1,
                        snippet=line[:500],
                        before=before,
                        after=after,
                    )
                )
                if len(matches) >= req.max_results:
                    return RepoGrepResponse(matches=matches)
        return RepoGrepResponse(matches=matches)

    repo_path = str(root)
    current = _current_branch(repo_path)
    target_branch = (req.branch or "").strip() or current

    files: list[str]
    from_branch = False
    if target_branch != current and _branch_exists(repo_path, target_branch):
        files = _iter_branch_files(repo_path, target_branch, req.glob)
        from_branch = True
    else:
        files = _iter_local_worktree_files(repo_path, req.glob)

    matches: list[GrepMatch] = []
    scanned = 0
    for rel in files:
        if scanned >= 1800:
            break
        if not _path_matches_patterns(rel, req.include_file_patterns, req.exclude_file_patterns):
            continue
        scanned += 1

        try:
            if from_branch:
                text = _read_file_from_branch(repo_path, target_branch, rel)
            else:
                full = _safe_join_repo(repo_path, rel)
                text = full.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        lines = text.splitlines()
        for idx, line in enumerate(lines, start=1):
            m = pat.search(line)
            if not m:
                continue
            context_lines = req.context_lines
            before = lines[max(0, idx - 1 - context_lines) : idx - 1]
            after = lines[idx : min(len(lines), idx + context_lines)]
            matches.append(
                GrepMatch(
                    path=rel,
                    line=idx,
                    column=m.start() + 1,
                    snippet=line[:500],
                    before=before,
                    after=after,
                )
            )
            if len(matches) >= req.max_results:
                return RepoGrepResponse(matches=matches)

    return RepoGrepResponse(matches=matches)


async def open_file(req: OpenFileRequest, ctx: Any = None) -> OpenFileResponse:
    req.max_chars = max(1000, min(req.max_chars, 400_000))
    meta = await get_project_metadata(req.project_id)
    path_candidates = _open_file_path_candidates(req.path) or [str(req.path or "").strip()]

    repo_path_raw = str(meta.repo_path or "").strip()
    async def _run_browser_local(path_value: str) -> OpenFileResponse:
        result = await _run_browser_local_git_tool(
            tool_name="open_file",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "path": path_value,
                "branch": req.branch or meta.default_branch or "main",
                "ref": req.ref,
                "start_line": req.start_line,
                "end_line": req.end_line,
                "max_chars": req.max_chars,
            },
            timeout_sec=45,
        )
        content = str(result.get("content") or "")
        ref_raw = result.get("ref")
        ref = None if ref_raw is None else str(ref_raw)
        try:
            start = int(result.get("start_line") or 1)
        except Exception:
            start = 1
        try:
            end = int(result.get("end_line") or start)
        except Exception:
            end = start
        start = max(1, start)
        end = max(start, end)
        return OpenFileResponse(
            path=str(result.get("path") or path_value),
            ref=ref,
            start_line=start,
            end_line=end,
            content=content,
        )

    if _is_browser_local_repo_path(repo_path_raw):
        last_err: Exception | None = None
        for candidate in path_candidates:
            try:
                return await _run_browser_local(candidate)
            except Exception as err:
                last_err = err
                if not _is_browser_local_snapshot_not_found(err):
                    raise
        if last_err is not None:
            raise last_err
        raise FileNotFoundError(f"File not found: {req.path}")

    root = Path(repo_path_raw) if repo_path_raw else None
    if root and root.exists():
        repo_path = str(root)
        current = _current_branch(repo_path)
        branch = (req.branch or "").strip()

        if req.ref:
            text = ""
            found_path = req.path
            for candidate in path_candidates:
                text = _read_file_from_branch(repo_path, req.ref, candidate, max_chars=req.max_chars)
                if text:
                    found_path = candidate
                    break
            if not text:
                raise FileNotFoundError(f"File not found at ref: {req.ref}:{req.path}")
            s, e, sliced = _line_slice(text, req.start_line, req.end_line)
            return OpenFileResponse(path=found_path, ref=req.ref, start_line=s, end_line=e, content=sliced)

        if branch and branch != current and _branch_exists(repo_path, branch):
            text = ""
            found_path = req.path
            for candidate in path_candidates:
                text = _read_file_from_branch(repo_path, branch, candidate, max_chars=req.max_chars)
                if text:
                    found_path = candidate
                    break
            if not text:
                raise FileNotFoundError(f"File not found at branch: {branch}:{req.path}")
            s, e, sliced = _line_slice(text, req.start_line, req.end_line)
            return OpenFileResponse(path=found_path, ref=branch, start_line=s, end_line=e, content=sliced)

        full: Path | None = None
        chosen_path = req.path
        for candidate in path_candidates:
            maybe_full = _safe_join_repo(repo_path, candidate)
            if maybe_full.exists() and maybe_full.is_file():
                full = maybe_full
                chosen_path = candidate
                break
        if full is None:
            raise FileNotFoundError(f"File not found: {req.path}")
        text = _read_text_file(full, req.max_chars)
        s, e, sliced = _line_slice(text, req.start_line, req.end_line)
        return OpenFileResponse(path=chosen_path, ref=None, start_line=s, end_line=e, content=sliced)

    remote = await _remote_repo_connector(req.project_id)
    if remote:
        text = ""
        chosen_path = req.path
        last_remote_err: Exception | None = None
        for candidate in path_candidates:
            try:
                text, _ = await _remote_open_file(remote, candidate, req.ref or req.branch)
                chosen_path = candidate
                break
            except Exception as err:
                last_remote_err = err
        if not text:
            if last_remote_err is not None:
                raise last_remote_err
            raise FileNotFoundError(f"File not found: {req.path}")
        text, _ = _limit_text(text, req.max_chars)
        s, e, sliced = _line_slice(text, req.start_line, req.end_line)
        return OpenFileResponse(path=chosen_path, ref=req.ref or req.branch, start_line=s, end_line=e, content=sliced)

    if _ctx_field(ctx, "user_id"):
        logger.info(
            "open_file.browser_local_fallback project=%s path=%s reason=no_local_repo_no_remote_connector",
            req.project_id,
            req.path,
        )
        try:
            for candidate in path_candidates:
                try:
                    return await _run_browser_local(candidate)
                except Exception as inner:
                    if not _is_browser_local_snapshot_not_found(inner):
                        raise
            return await _run_browser_local(req.path)
        except Exception as err:
            logger.warning(
                "open_file.browser_local_fallback_failed project=%s path=%s err=%s",
                req.project_id,
                req.path,
                err,
            )

    raise FileNotFoundError(f"File not found and no remote repository connector available: {req.path}")


async def keyword_search(req: KeywordSearchRequest) -> KeywordSearchResponse:
    req.top_k = max(1, min(req.top_k, 50))
    db = get_db()
    chunks = db["chunks"]

    q: Dict[str, Any] = {"project_id": req.project_id}
    if req.branch:
        q["branch"] = req.branch
    if req.source and req.source != "any":
        q["source"] = req.source

    hits: List[KeywordHit] = []
    try:
        cursor = chunks.find(
            {**q, "$text": {"$search": req.query}},
            {"score": {"$meta": "textScore"}, "text": 1, "title": 1, "path": 1, "source": 1, "branch": 1},
        ).sort([("score", {"$meta": "textScore"})]).limit(req.top_k)

        async for d in cursor:
            hits.append(
                KeywordHit(
                    id=_oid_str(d.get("_id")),
                    score=float(d.get("score") or 0.0),
                    path=d.get("path"),
                    title=d.get("title"),
                    source=d.get("source"),
                    branch=d.get("branch"),
                    preview=(d.get("text") or "")[:500],
                )
            )
    except Exception:
        cursor = chunks.find(
            {
                **q,
                "$or": [
                    {"text": {"$regex": req.query, "$options": "i"}},
                    {"title": {"$regex": req.query, "$options": "i"}},
                    {"path": {"$regex": req.query, "$options": "i"}},
                ],
            },
            {"text": 1, "title": 1, "path": 1, "source": 1, "branch": 1},
        ).limit(req.top_k)
        async for d in cursor:
            hits.append(
                KeywordHit(
                    id=_oid_str(d.get("_id")),
                    score=None,
                    path=d.get("path"),
                    title=d.get("title"),
                    source=d.get("source"),
                    branch=d.get("branch"),
                    preview=(d.get("text") or "")[:500],
                )
            )

    return KeywordSearchResponse(hits=hits)


def _client_for(project_id: str) -> chromadb.PersistentClient:
    path = os.path.join(settings.CHROMA_ROOT, project_id)
    return chromadb.PersistentClient(path=path)


async def chroma_count(req: ChromaCountRequest) -> ChromaCountResponse:
    client = _client_for(req.project_id)
    col = client.get_or_create_collection(name=COLLECTION_NAME)
    return ChromaCountResponse(count=col.count())


async def chroma_search_chunks(req: ChromaSearchChunksRequest) -> ChromaSearchChunkResponse:
    req.top_k = max(1, min(req.top_k, 100))
    req.max_snippet_chars = max(100, min(req.max_snippet_chars, 5000))

    client = _client_for(req.project_id)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.query(
        query_texts=[req.query],
        n_results=req.top_k,
        include=["documents", "metadatas", "distances"],
    )

    items: List[Dict[str, Any]] = []
    ids = res.get("ids", [[]])[0] or []
    docs = res.get("documents", [[]])[0] or []
    metas = res.get("metadatas", [[]])[0] or []
    dists = res.get("distances", [[]])[0] or []

    for i in range(len(ids)):
        meta = metas[i] or {}
        text = docs[i] or ""
        items.append(
            {
                "id": ids[i],
                "score": float(dists[i]) if i < len(dists) else None,
                "title": meta.get("title") or meta.get("path") or "Untitled",
                "url": meta.get("url"),
                "source": meta.get("source"),
                "snippet": text[: req.max_snippet_chars],
            }
        )

    return ChromaSearchChunkResponse(query=req.query, items=items, count=len(items))


async def chroma_open_chunks(req: ChromaOpenChunksRequest) -> ChromaOpenChunksResponse:
    req.max_chars_per_chunk = max(200, min(req.max_chars_per_chunk, 10_000))
    if not req.ids:
        return ChromaOpenChunksResponse(result=[])

    client = _client_for(req.project_id)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.get(ids=req.ids, include=["documents", "metadatas"])

    out: List[Dict[str, Any]] = []
    got_ids = res.get("ids", []) or []
    docs = res.get("documents", []) or []
    metas = res.get("metadatas", []) or []

    for i in range(len(got_ids)):
        meta = metas[i] or {}
        text = (docs[i] or "")[: req.max_chars_per_chunk]
        out.append(
            {
                "id": got_ids[i],
                "title": meta.get("title") or meta.get("path") or "Untitled",
                "url": meta.get("url"),
                "source": meta.get("source"),
                "text": text,
            }
        )

    return ChromaOpenChunksResponse(result=out)


async def repo_tree(req: RepoTreeRequest, ctx: Any = None) -> RepoTreeResponse:
    req.max_depth = max(1, min(req.max_depth, 12))
    req.max_entries = max(1, min(req.max_entries, 3000))

    meta = await get_project_metadata(req.project_id)
    branch = (req.branch or meta.default_branch or "main").strip() or "main"
    base_rel = req.path.strip("/")
    repo_path_raw = str(meta.repo_path or "").strip()

    async def _run_browser_local() -> RepoTreeResponse:
        result = await _run_browser_local_git_tool(
            tool_name="repo_tree",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "branch": branch,
                "path": base_rel,
                "max_depth": req.max_depth,
                "include_files": req.include_files,
                "include_dirs": req.include_dirs,
                "max_entries": req.max_entries,
                "glob": req.glob,
            },
            timeout_sec=45,
        )
        raw_entries = result.get("entries")
        nodes: list[RepoTreeNode] = []
        if isinstance(raw_entries, list):
            for item in raw_entries:
                if not isinstance(item, dict):
                    continue
                node_type = str(item.get("type") or "").strip().lower()
                if node_type not in {"file", "dir"}:
                    continue
                try:
                    depth = int(item.get("depth") or 1)
                except Exception:
                    depth = 1
                size_raw = item.get("size")
                try:
                    size = int(size_raw) if size_raw is not None else None
                except Exception:
                    size = None
                nodes.append(
                    RepoTreeNode(
                        path=str(item.get("path") or ""),
                        type="file" if node_type == "file" else "dir",
                        depth=max(1, depth),
                        size=size,
                    )
                )
                if len(nodes) >= req.max_entries:
                    break
        root_out = str(result.get("root") or base_rel or ".")
        branch_out = str(result.get("branch") or branch)
        return RepoTreeResponse(root=root_out, branch=branch_out, entries=nodes)

    if _is_browser_local_repo_path(repo_path_raw):
        return await _run_browser_local()

    root = Path(repo_path_raw) if repo_path_raw else None
    entries: list[RepoTreeNode] = []

    if root and root.exists():
        repo_path = str(root)
        current = _current_branch(repo_path)
        branch_files: list[str] = []
        from_branch = branch != current and _branch_exists(repo_path, branch)

        if from_branch:
            branch_files = _iter_branch_files(repo_path, branch, req.glob)
            dir_set: set[str] = set()
            for rel in branch_files:
                if base_rel and not (rel == base_rel or rel.startswith(base_rel + "/")):
                    continue
                rel_from_base = rel[len(base_rel) + 1 :] if base_rel and rel.startswith(base_rel + "/") else rel
                depth = rel_from_base.count("/") + 1
                if depth > req.max_depth:
                    continue
                if req.include_files:
                    entries.append(RepoTreeNode(path=rel, type="file", depth=depth, size=None))
                parent = Path(rel)
                while len(parent.parts) > 1:
                    parent = parent.parent
                    d = str(parent).replace("\\", "/")
                    if d and d != ".":
                        dir_set.add(d)
            if req.include_dirs:
                for d in sorted(dir_set):
                    if base_rel and not (d == base_rel or d.startswith(base_rel + "/")):
                        continue
                    rel_from_base = d[len(base_rel) + 1 :] if base_rel and d.startswith(base_rel + "/") else d
                    depth = rel_from_base.count("/") + 1
                    if depth <= req.max_depth:
                        entries.append(RepoTreeNode(path=d, type="dir", depth=depth, size=None))
        else:
            start = _safe_join_repo(repo_path, base_rel) if base_rel else Path(repo_path)
            if start.exists():
                for p in start.rglob("*"):
                    rel = str(p.relative_to(root)).replace("\\", "/")
                    if _is_ignored_path(rel):
                        continue
                    if req.glob and not _glob_match(rel, req.glob):
                        continue
                    rel_from_base = rel[len(base_rel) + 1 :] if base_rel and rel.startswith(base_rel + "/") else rel
                    depth = rel_from_base.count("/") + 1
                    if depth > req.max_depth:
                        continue
                    if p.is_dir() and req.include_dirs:
                        entries.append(RepoTreeNode(path=rel, type="dir", depth=depth, size=None))
                    elif p.is_file() and req.include_files:
                        entries.append(RepoTreeNode(path=rel, type="file", depth=depth, size=int(p.stat().st_size)))

    else:
        remote = await _remote_repo_connector(req.project_id)
        if remote:
            files = await _remote_list_tree(remote, branch)
            dir_set: set[str] = set()
            for rel in files:
                if _is_ignored_path(rel):
                    continue
                if base_rel and not (rel == base_rel or rel.startswith(base_rel + "/")):
                    continue
                if req.glob and not _glob_match(rel, req.glob):
                    continue
                rel_from_base = rel[len(base_rel) + 1 :] if base_rel and rel.startswith(base_rel + "/") else rel
                depth = rel_from_base.count("/") + 1
                if depth > req.max_depth:
                    continue
                if req.include_files:
                    entries.append(RepoTreeNode(path=rel, type="file", depth=depth, size=None))
                parent = Path(rel)
                while len(parent.parts) > 1:
                    parent = parent.parent
                    d = str(parent).replace("\\", "/")
                    if d and d != ".":
                        dir_set.add(d)
            if req.include_dirs:
                for d in sorted(dir_set):
                    if base_rel and not (d == base_rel or d.startswith(base_rel + "/")):
                        continue
                    rel_from_base = d[len(base_rel) + 1 :] if base_rel and d.startswith(base_rel + "/") else d
                    depth = rel_from_base.count("/") + 1
                    if depth <= req.max_depth:
                        entries.append(RepoTreeNode(path=d, type="dir", depth=depth, size=None))
        elif _ctx_field(ctx, "user_id"):
            logger.info(
                "repo_tree.browser_local_fallback project=%s branch=%s reason=no_local_repo_no_remote_connector",
                req.project_id,
                branch,
            )
            try:
                return await _run_browser_local()
            except Exception as err:
                logger.warning(
                    "repo_tree.browser_local_fallback_failed project=%s branch=%s err=%s",
                    req.project_id,
                    branch,
                    err,
                )

    entries = sorted(entries, key=lambda e: (e.path.count("/"), e.path, e.type))[: req.max_entries]
    return RepoTreeResponse(root=base_rel or ".", branch=branch, entries=entries)


async def git_list_branches(req: GitListBranchesRequest, ctx: Any = None) -> GitListBranchesResponse:
    logger.info("git_list_branches.start project=%s max_branches=%s", req.project_id, req.max_branches)
    req.max_branches = max(1, min(req.max_branches, 1000))
    meta = await get_project_metadata(req.project_id)
    default_branch = (meta.default_branch or "main").strip() or "main"
    repo_path = str(meta.repo_path or "").strip()

    if _is_browser_local_repo_path(repo_path):
        result = await _run_browser_local_git_tool(
            tool_name="git_list_branches",
            project_id=req.project_id,
            ctx=ctx,
            args={"max_branches": req.max_branches},
            timeout_sec=45,
        )
        active_branch = str(result.get("active_branch") or default_branch).strip() or default_branch
        raw = result.get("branches")
        parsed: list[GitBranchItem] = []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict):
                    name = str(item.get("name") or "").strip()
                    commit = str(item.get("commit") or "").strip() or None
                else:
                    name = str(item or "").strip()
                    commit = None
                if not name:
                    continue
                parsed.append(GitBranchItem(name=name, commit=commit))
        branches = _merge_branch_items(
            parsed,
            default_branch=default_branch,
            active_branch=active_branch,
            max_branches=req.max_branches,
        )
        await _store_browser_local_branch_state(
            project_id=req.project_id,
            active_branch=active_branch,
            branches=[b.name for b in branches],
            set_default_branch=False,
        )
        out = GitListBranchesResponse(
            active_branch=active_branch,
            default_branch=default_branch,
            remote_mode=False,
            branches=branches,
        )
        logger.info(
            "git_list_branches.done project=%s mode=browser_local active=%s count=%s",
            req.project_id,
            out.active_branch,
            len(out.branches),
        )
        return out

    root = Path(repo_path) if repo_path else None

    if root and root.exists():
        repo_path = str(root)
        active_branch = _current_branch(repo_path)
        raw_items = _local_branch_items(repo_path)
        branches = _merge_branch_items(
            raw_items,
            default_branch=default_branch,
            active_branch=active_branch,
            max_branches=req.max_branches,
        )
        return GitListBranchesResponse(
            active_branch=active_branch,
            default_branch=default_branch,
            remote_mode=False,
            branches=branches,
        )

    remote = await _remote_repo_connector(req.project_id)
    if remote:
        config = remote.get("config") or {}
        active_branch = str(config.get("branch") or default_branch or "main").strip() or "main"
        raw_items = await _remote_branch_items(remote, req.max_branches)
        branches = _merge_branch_items(
            raw_items,
            default_branch=default_branch,
            active_branch=active_branch,
            max_branches=req.max_branches,
        )
        return GitListBranchesResponse(
            active_branch=active_branch,
            default_branch=default_branch,
            remote_mode=True,
            branches=branches,
        )

    out = GitListBranchesResponse(
        active_branch=default_branch,
        default_branch=default_branch,
        remote_mode=False,
        branches=[GitBranchItem(name=default_branch, is_default=True)],
    )
    logger.info(
        "git_list_branches.done project=%s mode=fallback default_branch=%s count=%s",
        req.project_id,
        default_branch,
        len(out.branches),
    )
    return out


async def git_checkout_branch(req: GitCheckoutBranchRequest, ctx: Any = None) -> GitCheckoutBranchResponse:
    logger.info(
        "git_checkout_branch.start project=%s branch=%s create_if_missing=%s start_point=%s",
        req.project_id,
        req.branch,
        bool(req.create_if_missing),
        req.start_point or "",
    )
    branch = _sanitize_branch_name(req.branch)
    start_point = _sanitize_branch_name(req.start_point) if (req.start_point or "").strip() else None

    meta = await get_project_metadata(req.project_id)
    repo_path = str(meta.repo_path or "").strip()
    if _is_browser_local_repo_path(repo_path):
        result = await _run_browser_local_git_tool(
            tool_name="git_checkout_branch",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "branch": branch,
                "create_if_missing": bool(req.create_if_missing),
                "start_point": start_point,
            },
            timeout_sec=50,
        )
        out = GitCheckoutBranchResponse(
            branch=str(result.get("branch") or branch).strip() or branch,
            previous_branch=str(result.get("previous_branch") or "").strip() or None,
            created=bool(result.get("created")),
            remote_mode=False,
            message=str(result.get("message") or f"Checked out local browser branch '{branch}'."),
        )
        await _store_browser_local_branch_state(
            project_id=req.project_id,
            active_branch=out.branch,
            branches=[out.branch],
            set_default_branch=bool(req.set_default_branch),
        )
        logger.info(
            "git_checkout_branch.done project=%s mode=browser_local branch=%s previous=%s created=%s",
            req.project_id,
            out.branch,
            out.previous_branch or "",
            out.created,
        )
        return out

    root = Path(repo_path) if repo_path else None
    if root and root.exists():
        repo_path = str(root)
        previous_branch = _current_branch(repo_path)
        created = False

        if _branch_exists(repo_path, branch):
            proc = _run_git(repo_path, ["checkout", branch], timeout=25)
            if proc.returncode != 0:
                raise RuntimeError(_proc_output(proc, 5000) or f"Failed to checkout branch: {branch}")
        else:
            if not req.create_if_missing:
                raise RuntimeError(f"Branch does not exist locally: {branch}")
            source = start_point or previous_branch or (meta.default_branch or "main")
            proc = _run_git(repo_path, ["checkout", "-b", branch, source], timeout=30)
            if proc.returncode != 0:
                raise RuntimeError(_proc_output(proc, 5000) or f"Failed to create branch: {branch}")
            created = True

        if req.set_default_branch:
            await _set_project_default_branch(req.project_id, branch)

        out = GitCheckoutBranchResponse(
            branch=branch,
            previous_branch=previous_branch,
            created=created,
            remote_mode=False,
            message=f"Checked out local branch '{branch}'.",
        )
        logger.info(
            "git_checkout_branch.done project=%s mode=local branch=%s previous=%s created=%s",
            req.project_id,
            out.branch,
            out.previous_branch or "",
            out.created,
        )
        return out

    remote = await _remote_repo_connector(req.project_id)
    if not remote:
        raise RuntimeError("No local repository or remote git connector is available")

    config = remote.get("config") or {}
    previous_branch = str(config.get("branch") or meta.default_branch or "main").strip() or "main"
    branches = await _remote_branch_items(remote, 2000)
    names = {b.name for b in branches if b.name}
    created = False
    if branch not in names:
        if not req.create_if_missing:
            raise RuntimeError(f"Branch does not exist on remote connector: {branch}")
        source = start_point or previous_branch or (meta.default_branch or "main")
        await _create_remote_branch(remote, branch, source)
        created = True

    await _set_remote_branch_config(req.project_id, remote, branch, set_default_branch=bool(req.set_default_branch))
    out = GitCheckoutBranchResponse(
        branch=branch,
        previous_branch=previous_branch,
        created=created,
        remote_mode=True,
        message=f"Active connector branch set to '{branch}'.",
    )
    logger.info(
        "git_checkout_branch.done project=%s mode=remote connector=%s branch=%s previous=%s created=%s",
        req.project_id,
        str(remote.get("type") or ""),
        out.branch,
        out.previous_branch or "",
        out.created,
    )
    return out


async def git_create_branch(req: GitCreateBranchRequest, ctx: Any = None) -> GitCreateBranchResponse:
    logger.info(
        "git_create_branch.start project=%s branch=%s source_ref=%s checkout=%s",
        req.project_id,
        req.branch,
        req.source_ref or "",
        bool(req.checkout),
    )
    branch = _sanitize_branch_name(req.branch)
    source_ref = _sanitize_branch_name(req.source_ref) if (req.source_ref or "").strip() else ""

    meta = await get_project_metadata(req.project_id)
    repo_path = str(meta.repo_path or "").strip()
    if _is_browser_local_repo_path(repo_path):
        result = await _run_browser_local_git_tool(
            tool_name="git_create_branch",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "branch": branch,
                "source_ref": source_ref,
                "checkout": bool(req.checkout),
            },
            timeout_sec=55,
        )
        out = GitCreateBranchResponse(
            branch=str(result.get("branch") or branch).strip() or branch,
            source_ref=str(result.get("source_ref") or source_ref or "").strip() or (source_ref or "main"),
            created=bool(result.get("created", True)),
            checked_out=bool(result.get("checked_out", req.checkout)),
            remote_mode=False,
            message=str(result.get("message") or f"Created local browser branch '{branch}'."),
        )
        await _store_browser_local_branch_state(
            project_id=req.project_id,
            active_branch=out.branch if out.checked_out else None,
            branches=[out.branch, out.source_ref],
            set_default_branch=bool(req.set_default_branch and out.checked_out),
        )
        logger.info(
            "git_create_branch.done project=%s mode=browser_local branch=%s source=%s checked_out=%s",
            req.project_id,
            out.branch,
            out.source_ref,
            out.checked_out,
        )
        return out

    root = Path(repo_path) if repo_path else None
    if root and root.exists():
        repo_path = str(root)
        current = _current_branch(repo_path)
        source = source_ref or current or (meta.default_branch or "main")
        if _branch_exists(repo_path, branch):
            raise RuntimeError(f"Branch already exists locally: {branch}")
        if not _branch_exists(repo_path, source):
            raise RuntimeError(f"Source branch not found locally: {source}")

        proc = _run_git(repo_path, ["branch", branch, source], timeout=25)
        if proc.returncode != 0:
            raise RuntimeError(_proc_output(proc, 5000) or f"Failed to create branch: {branch}")

        checked_out = False
        if req.checkout:
            switch_proc = _run_git(repo_path, ["checkout", branch], timeout=25)
            if switch_proc.returncode != 0:
                raise RuntimeError(_proc_output(switch_proc, 5000) or f"Failed to checkout branch: {branch}")
            checked_out = True

        if req.set_default_branch and checked_out:
            await _set_project_default_branch(req.project_id, branch)

        out = GitCreateBranchResponse(
            branch=branch,
            source_ref=source,
            created=True,
            checked_out=checked_out,
            remote_mode=False,
            message=f"Created local branch '{branch}' from '{source}'.",
        )
        logger.info(
            "git_create_branch.done project=%s mode=local branch=%s source=%s checked_out=%s",
            req.project_id,
            out.branch,
            out.source_ref,
            out.checked_out,
        )
        return out

    remote = await _remote_repo_connector(req.project_id)
    if not remote:
        logger.error(
            "git_create_branch.no_repo_or_connector project=%s repo_path=%s",
            req.project_id,
            meta.repo_path or "",
        )
        raise RuntimeError("No local repository or remote git connector is available")

    config = remote.get("config") or {}
    source = source_ref or str(config.get("branch") or meta.default_branch or "main").strip() or "main"
    branches = await _remote_branch_items(remote, 2000)
    names = {b.name for b in branches if b.name}
    if branch in names:
        raise RuntimeError(f"Branch already exists on remote connector: {branch}")

    await _create_remote_branch(remote, branch, source)
    checked_out = bool(req.checkout)
    if checked_out:
        await _set_remote_branch_config(req.project_id, remote, branch, set_default_branch=bool(req.set_default_branch))
    elif req.set_default_branch:
        await _set_project_default_branch(req.project_id, branch)

    out = GitCreateBranchResponse(
        branch=branch,
        source_ref=source,
        created=True,
        checked_out=checked_out,
        remote_mode=True,
        message=f"Created remote branch '{branch}' from '{source}'.",
    )
    logger.info(
        "git_create_branch.done project=%s mode=remote connector=%s branch=%s source=%s checked_out=%s",
        req.project_id,
        str(remote.get("type") or ""),
        out.branch,
        out.source_ref,
        out.checked_out,
    )
    return out


async def git_stage_files(req: GitStageFilesRequest) -> GitStageFilesResponse:
    logger.info("git_stage_files.start project=%s all=%s paths=%s", req.project_id, bool(req.all), len(req.paths or []))
    meta = await get_project_metadata(req.project_id)
    repo_path = _require_local_repo_path(meta, "git_stage_files")

    if req.all:
        proc = _run_git(repo_path, ["add", "-A"], timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(_proc_output(proc, 5000) or "Failed to stage all files")
        status = await git_status(GitStatusRequest(project_id=req.project_id))
        out = GitStageFilesResponse(staged_paths=status.staged, status="Staged all changes.")
        logger.info("git_stage_files.done project=%s staged=%s", req.project_id, len(out.staged_paths))
        return out

    paths = _sanitize_rel_paths(req.paths or [])
    if not paths:
        raise RuntimeError("paths is required when all=false")
    proc = _run_git(repo_path, ["add", "--", *paths], timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 5000) or "Failed to stage files")
    status = await git_status(GitStatusRequest(project_id=req.project_id))
    out = GitStageFilesResponse(staged_paths=status.staged, status=f"Staged {len(paths)} path(s).")
    logger.info("git_stage_files.done project=%s staged=%s", req.project_id, len(out.staged_paths))
    return out


async def git_unstage_files(req: GitUnstageFilesRequest) -> GitUnstageFilesResponse:
    logger.info("git_unstage_files.start project=%s all=%s paths=%s", req.project_id, bool(req.all), len(req.paths or []))
    meta = await get_project_metadata(req.project_id)
    repo_path = _require_local_repo_path(meta, "git_unstage_files")

    if req.all:
        proc = _run_git(repo_path, ["reset"], timeout=25)
        if proc.returncode != 0:
            raise RuntimeError(_proc_output(proc, 5000) or "Failed to unstage all files")
        status = await git_status(GitStatusRequest(project_id=req.project_id))
        out = GitUnstageFilesResponse(unstaged_paths=status.modified + status.untracked, status="Unstaged all files.")
        logger.info("git_unstage_files.done project=%s unstaged=%s", req.project_id, len(out.unstaged_paths))
        return out

    paths = _sanitize_rel_paths(req.paths or [])
    if not paths:
        raise RuntimeError("paths is required when all=false")
    proc = _run_git(repo_path, ["reset", "HEAD", "--", *paths], timeout=25)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 5000) or "Failed to unstage files")
    status = await git_status(GitStatusRequest(project_id=req.project_id))
    out = GitUnstageFilesResponse(
        unstaged_paths=status.modified + status.untracked,
        status=f"Unstaged {len(paths)} path(s).",
    )
    logger.info("git_unstage_files.done project=%s unstaged=%s", req.project_id, len(out.unstaged_paths))
    return out


async def git_commit(req: GitCommitRequest) -> GitCommitResponse:
    logger.info("git_commit.start project=%s all=%s amend=%s", req.project_id, bool(req.all), bool(req.amend))
    message = (req.message or "").strip()
    if not message:
        raise RuntimeError("message is required")

    meta = await get_project_metadata(req.project_id)
    repo_path = _require_local_repo_path(meta, "git_commit")

    args = ["commit", "-m", message]
    if req.all:
        args.insert(1, "-a")
    if req.amend:
        args.insert(1, "--amend")
    proc = _run_git(repo_path, args, timeout=40)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 7000) or "git commit failed")

    commit = _git_stdout(repo_path, ["rev-parse", "HEAD"], timeout=15, not_found_ok=True).strip() or "HEAD"
    branch = _current_branch(repo_path)
    summary = _proc_output(proc, 6000) or f"Committed to {branch}"
    out = GitCommitResponse(branch=branch, commit=commit, summary=summary)
    logger.info("git_commit.done project=%s branch=%s commit=%s", req.project_id, out.branch, out.commit)
    return out


async def git_fetch(req: GitFetchRequest, ctx: Any = None) -> GitFetchResponse:
    logger.info("git_fetch.start project=%s remote=%s prune=%s", req.project_id, req.remote, bool(req.prune))
    meta = await get_project_metadata(req.project_id)
    remote = (req.remote or "origin").strip() or "origin"
    repo_path_raw = str(meta.repo_path or "").strip()
    if _is_browser_local_repo_path(repo_path_raw):
        remote_connector = await _remote_repo_connector(req.project_id)
        if not remote_connector:
            # Browser-local mode without configured remote connector:
            # keep tool non-fatal and refresh local branch refs from browser git metadata.
            local_result = await _run_browser_local_git_tool(
                tool_name="git_list_branches",
                project_id=req.project_id,
                ctx=ctx,
                args={"max_branches": 1000},
                timeout_sec=45,
            )
            active_branch = str(local_result.get("active_branch") or meta.default_branch or "main").strip() or "main"
            raw = local_result.get("branches")
            parsed: list[GitBranchItem] = []
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        name = str(item.get("name") or "").strip()
                    else:
                        name = str(item or "").strip()
                    if not name:
                        continue
                    parsed.append(GitBranchItem(name=name))
            merged = _merge_branch_items(
                parsed,
                default_branch=(meta.default_branch or "main").strip() or "main",
                active_branch=active_branch,
                max_branches=1000,
            )
            await _store_browser_local_branch_state(
                project_id=req.project_id,
                active_branch=active_branch,
                branches=[b.name for b in merged],
                set_default_branch=False,
            )
            out = GitFetchResponse(
                remote=remote,
                output=(
                    "Browser-local repository has no configured remote connector. "
                    "Remote fetch was skipped; local branch refs were refreshed from the local git metadata."
                ),
            )
            logger.info(
                "git_fetch.done project=%s mode=browser_local_local_refs_only branches=%s",
                req.project_id,
                len(merged),
            )
            return out
        default_branch = (meta.default_branch or "main").strip() or "main"
        active_branch = str((remote_connector.get("config") or {}).get("branch") or default_branch).strip() or default_branch
        raw_items = await _remote_branch_items(remote_connector, 1000)
        merged = _merge_branch_items(
            raw_items,
            default_branch=default_branch,
            active_branch=active_branch,
            max_branches=1000,
        )
        await _store_browser_local_branch_state(
            project_id=req.project_id,
            active_branch=active_branch,
            branches=[b.name for b in merged],
            set_default_branch=False,
        )
        connector_kind = str(remote_connector.get("type") or "remote")
        out = GitFetchResponse(
            remote=remote,
            output=(
                f"Fetched branch refs from {connector_kind} connector (browser-local mode). "
                f"Discovered {len(merged)} branch(es)."
            ),
        )
        logger.info(
            "git_fetch.done project=%s mode=browser_local connector=%s branches=%s",
            req.project_id,
            connector_kind,
            len(merged),
        )
        return out
    repo_path = _require_local_repo_path(meta, "git_fetch")
    args = ["fetch", remote]
    if req.prune:
        args.append("--prune")
    proc = _run_git(repo_path, args, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 7000) or "git fetch failed")
    out = GitFetchResponse(remote=remote, output=_proc_output(proc, 7000) or f"Fetched from {remote}.")
    logger.info("git_fetch.done project=%s remote=%s", req.project_id, out.remote)
    return out


async def git_pull(req: GitPullRequest) -> GitPullResponse:
    logger.info("git_pull.start project=%s remote=%s branch=%s rebase=%s", req.project_id, req.remote, req.branch or "", bool(req.rebase))
    meta = await get_project_metadata(req.project_id)
    repo_path_raw = str(meta.repo_path or "").strip()
    if _is_browser_local_repo_path(repo_path_raw):
        raise RuntimeError(
            "git_pull is not available in browser-local repository mode via web runtime. "
            "Run pull in your local git client, or switch this project to a backend-local repository path."
        )
    repo_path = _require_local_repo_path(meta, "git_pull")
    remote = (req.remote or "origin").strip() or "origin"
    branch = (req.branch or _current_branch(repo_path) or "main").strip() or "main"
    args = ["pull", remote, branch]
    if req.rebase:
        args.append("--rebase")
    proc = _run_git(repo_path, args, timeout=90)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 9000) or "git pull failed")
    out = GitPullResponse(remote=remote, branch=branch, output=_proc_output(proc, 9000) or f"Pulled {remote}/{branch}.")
    logger.info("git_pull.done project=%s remote=%s branch=%s", req.project_id, out.remote, out.branch)
    return out


async def git_push(req: GitPushRequest) -> GitPushResponse:
    logger.info(
        "git_push.start project=%s remote=%s branch=%s set_upstream=%s force_with_lease=%s",
        req.project_id,
        req.remote,
        req.branch or "",
        bool(req.set_upstream),
        bool(req.force_with_lease),
    )
    meta = await get_project_metadata(req.project_id)
    repo_path_raw = str(meta.repo_path or "").strip()
    if _is_browser_local_repo_path(repo_path_raw):
        raise RuntimeError(
            "git_push is not available in browser-local repository mode via web runtime. "
            "Run push in your local git client, or switch this project to a backend-local repository path."
        )
    repo_path = _require_local_repo_path(meta, "git_push")
    remote = (req.remote or "origin").strip() or "origin"
    branch = (req.branch or _current_branch(repo_path) or "main").strip() or "main"
    args = ["push"]
    if req.set_upstream:
        args.append("-u")
    if req.force_with_lease:
        args.append("--force-with-lease")
    args.extend([remote, branch])
    proc = _run_git(repo_path, args, timeout=90)
    if proc.returncode != 0:
        raise RuntimeError(_proc_output(proc, 9000) or "git push failed")
    out = GitPushResponse(remote=remote, branch=branch, output=_proc_output(proc, 9000) or f"Pushed to {remote}/{branch}.")
    logger.info("git_push.done project=%s remote=%s branch=%s", req.project_id, out.remote, out.branch)
    return out


async def git_status(req: GitStatusRequest) -> GitStatusResponse:
    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path)
    if not root.exists():
        raise RuntimeError("Local repository not available for git_status")

    repo_path = str(root)
    out = _git_stdout(repo_path, ["status", "--porcelain=v1", "--branch"], timeout=25)
    lines = [ln.rstrip("\n") for ln in out.splitlines() if ln.strip()]

    branch = _current_branch(repo_path)
    upstream: Optional[str] = None
    ahead = 0
    behind = 0
    staged: list[str] = []
    modified: list[str] = []
    untracked: list[str] = []

    if lines and lines[0].startswith("## "):
        hdr = lines[0][3:]
        m = re.match(r"([^\.\s]+)(?:\.\.\.([^\s]+))?(?: \[(.+)\])?", hdr)
        if m:
            branch = m.group(1) or branch
            upstream = m.group(2)
            status = m.group(3) or ""
            ma = re.search(r"ahead (\d+)", status)
            mb = re.search(r"behind (\d+)", status)
            ahead = int(ma.group(1)) if ma else 0
            behind = int(mb.group(1)) if mb else 0
        lines = lines[1:]

    for ln in lines:
        if ln.startswith("??"):
            untracked.append(ln[3:])
            continue
        if len(ln) < 4:
            continue
        x, y = ln[0], ln[1]
        path = ln[3:]
        if x != " ":
            staged.append(path)
        if y != " ":
            modified.append(path)

    clean = not staged and not modified and not untracked
    return GitStatusResponse(
        branch=branch,
        upstream=upstream,
        ahead=ahead,
        behind=behind,
        staged=staged,
        modified=modified,
        untracked=untracked,
        clean=clean,
    )


async def git_diff(req: GitDiffRequest) -> GitDiffResponse:
    req.max_chars = max(800, min(req.max_chars, 120_000))
    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path)
    if not root.exists():
        raise RuntimeError("Local repository not available for git_diff")

    repo_path = str(root)
    args = ["diff", "--unified=3"]

    if req.ref_base and req.ref_head:
        args.append(f"{req.ref_base}..{req.ref_head}")
    elif req.ref_base:
        args.append(req.ref_base)
    elif req.branch:
        args.append(req.branch)

    if req.path_glob:
        args.extend(["--", req.path_glob])

    out = _git_stdout(repo_path, args, timeout=40, not_found_ok=True)
    diff, truncated = _limit_text(out, req.max_chars)
    return GitDiffResponse(ref_base=req.ref_base, ref_head=req.ref_head, diff=diff, truncated=truncated)


async def git_log(req: GitLogRequest) -> GitLogResponse:
    req.max_count = max(1, min(req.max_count, 200))
    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path)
    if not root.exists():
        raise RuntimeError("Local repository not available for git_log")

    repo_path = str(root)
    ref = (req.ref or req.branch or _current_branch(repo_path) or "HEAD").strip()

    pretty = "%H%x1f%an%x1f%ad%x1f%s"
    args = ["log", f"--max-count={req.max_count}", f"--pretty=format:{pretty}", "--date=iso", ref]
    if req.path:
        args.extend(["--", req.path])

    out = _git_stdout(repo_path, args, timeout=35, not_found_ok=True)
    commits: list[GitLogItem] = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) != 4:
            continue
        commits.append(GitLogItem(commit=parts[0], author=parts[1], date=parts[2], subject=parts[3]))
    return GitLogResponse(ref=ref, commits=commits)


async def git_show_file_at_ref(req) -> OpenFileResponse:
    open_req = OpenFileRequest(
        project_id=req.project_id,
        path=req.path,
        ref=req.ref,
        start_line=req.start_line,
        end_line=req.end_line,
        max_chars=req.max_chars,
    )
    return await open_file(open_req)


async def compare_branches(req: CompareBranchesRequest) -> CompareBranchesResponse:
    req.max_files = max(1, min(req.max_files, 1000))
    base_branch = (req.base_branch or "").strip()
    target_branch = (req.target_branch or "").strip()
    if not base_branch or not target_branch:
        raise RuntimeError("base_branch and target_branch are required")

    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path)
    if not root.exists():
        raise RuntimeError("Local repository not available for compare_branches")

    repo_path = str(root)
    if not _branch_exists(repo_path, base_branch):
        raise RuntimeError(f"Base branch not found locally: {base_branch}")
    if not _branch_exists(repo_path, target_branch):
        raise RuntimeError(f"Target branch not found locally: {target_branch}")

    out = _git_stdout(
        repo_path,
        ["diff", "--name-status", f"{base_branch}...{target_branch}"],
        timeout=35,
        not_found_ok=True,
    )
    changed_files: list[BranchDiffFile] = []
    stats = {"added": 0, "modified": 0, "deleted": 0, "renamed": 0, "other": 0}
    status_map = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed"}
    for line in out.splitlines():
        raw = line.strip()
        if not raw:
            continue
        parts = raw.split("\t")
        if len(parts) < 2:
            continue
        code = (parts[0] or "").strip()
        path = parts[-1].strip().replace("\\", "/")
        if not path:
            continue
        status_key = status_map.get(code[:1], "other")
        stats[status_key] = stats.get(status_key, 0) + 1
        changed_files.append(BranchDiffFile(path=path, status=status_key))
        if len(changed_files) >= req.max_files:
            break

    summary = (
        f"{len(changed_files)} changed files "
        f"(added={stats['added']}, modified={stats['modified']}, "
        f"deleted={stats['deleted']}, renamed={stats['renamed']}, other={stats['other']})"
    )
    return CompareBranchesResponse(
        base_branch=base_branch,
        target_branch=target_branch,
        changed_files=changed_files,
        summary=summary,
    )


_SYMBOL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("class", re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("function", re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("function", re.compile(r"^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("interface", re.compile(r"^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("type", re.compile(r"^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("struct", re.compile(r"^\s*struct\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
    ("enum", re.compile(r"^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)),
]


async def symbol_search(req: SymbolSearchRequest) -> SymbolSearchResponse:
    req.max_results = max(1, min(req.max_results, 300))
    query = req.query.strip().lower()
    kinds = {k.lower() for k in req.kinds}

    rg_req = RepoGrepRequest(
        project_id=req.project_id,
        branch=req.branch,
        pattern=query,
        regex=False,
        case_sensitive=False,
        max_results=max(req.max_results * 3, 60),
        context_lines=1,
    )
    candidates = await repo_grep(rg_req)

    hits: list[SymbolSearchHit] = []
    seen: set[tuple[str, int, str]] = set()

    for m in candidates.matches:
        kind_guess = "symbol"
        symbol_guess = query
        snippet = m.snippet.strip()

        for k, pat in _SYMBOL_PATTERNS:
            mm = pat.search(snippet)
            if mm:
                kind_guess = k
                symbol_guess = mm.group(1)
                break

        if kinds and kind_guess not in kinds:
            continue

        key = (m.path, m.line, symbol_guess)
        if key in seen:
            continue
        seen.add(key)
        hits.append(
            SymbolSearchHit(
                path=m.path,
                line=m.line,
                kind=kind_guess,
                symbol=symbol_guess,
                snippet=snippet[:400],
            )
        )
        if len(hits) >= req.max_results:
            break

    return SymbolSearchResponse(items=hits)


def _detect_test_command(repo_path: str) -> Optional[str]:
    root = Path(repo_path)
    if (root / "pytest.ini").exists() or (root / "pyproject.toml").exists() or (root / "requirements.txt").exists():
        return "pytest -q"
    if (root / "package.json").exists():
        return "npm test -- --watch=false"
    if (root / "go.mod").exists():
        return "go test ./..."
    if (root / "Cargo.toml").exists():
        return "cargo test --quiet"
    return None


def _project_test_config(project_doc: dict[str, Any]) -> tuple[Optional[str], list[str]]:
    extra = project_doc.get("extra") or {}
    tooling = extra.get("tooling") if isinstance(extra, dict) else {}
    if not isinstance(tooling, dict):
        tooling = {}

    default_cmd = tooling.get("run_tests_cmd") or tooling.get("test_command")
    default_cmd = str(default_cmd).strip() if default_cmd else None

    allowed_raw = tooling.get("allowed_test_commands")
    allowed: list[str] = []
    if isinstance(allowed_raw, list):
        for item in allowed_raw:
            s = str(item).strip()
            if s:
                allowed.append(s)
    return default_cmd, allowed


async def run_tests(req: RunTestsRequest) -> RunTestsResponse:
    req.timeout_sec = max(5, min(req.timeout_sec, 1800))
    req.max_output_chars = max(1000, min(req.max_output_chars, 150_000))

    doc = await _project_doc(req.project_id)
    repo_path = str((doc.get("repo_path") or "").strip())
    if not repo_path or not Path(repo_path).exists():
        raise RuntimeError("Local repository not available for run_tests")

    _assert_branch_checked_out(req.branch, repo_path)

    default_cmd, allowed_cmds = _project_test_config(doc)
    cmd = (req.command or "").strip() or default_cmd or _detect_test_command(repo_path)
    if not cmd:
        raise RuntimeError("Could not determine a test command. Configure project extra.tooling.run_tests_cmd.")

    if allowed_cmds and cmd not in allowed_cmds:
        raise RuntimeError(f"Requested test command not in allowed_test_commands: {cmd}")

    argv = shlex.split(cmd)
    proc = subprocess.run(
        argv,
        cwd=repo_path,
        capture_output=True,
        text=True,
        timeout=req.timeout_sec,
        check=False,
    )
    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    output, truncated = _limit_text(combined, req.max_output_chars)

    return RunTestsResponse(
        command=cmd,
        exit_code=int(proc.returncode),
        success=(proc.returncode == 0),
        output=output,
        truncated=truncated,
    )


async def read_docs_folder(req: ReadDocsFolderRequest, ctx: Any = None) -> ReadDocsFolderResponse:
    req.max_files = max(1, min(req.max_files, 400))
    req.max_chars_per_file = max(100, min(req.max_chars_per_file, 20_000))

    meta = await get_project_metadata(req.project_id)
    branch = (req.branch or meta.default_branch or "main").strip() or "main"
    docs_root = req.path.strip("/") or "documentation"
    files: list[ReadDocsFile] = []

    repo_path_raw = str(meta.repo_path or "").strip()
    root = Path(repo_path_raw) if repo_path_raw else None

    async def _run_browser_local_docs() -> ReadDocsFolderResponse:
        result = await _run_browser_local_git_tool(
            tool_name="read_docs_folder",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "path": docs_root,
                "branch": branch,
                "max_files": req.max_files,
                "max_chars_per_file": req.max_chars_per_file,
            },
            timeout_sec=60,
        )
        raw_files = result.get("files")
        out_files: list[ReadDocsFile] = []
        if isinstance(raw_files, list):
            for item in raw_files:
                if not isinstance(item, dict):
                    continue
                out_files.append(
                    ReadDocsFile(
                        path=str(item.get("path") or ""),
                        content=str(item.get("content") or ""),
                    )
                )
                if len(out_files) >= req.max_files:
                    break
        return ReadDocsFolderResponse(branch=str(result.get("branch") or branch), files=out_files)

    if _is_browser_local_repo_path(repo_path_raw):
        return await _run_browser_local_docs()

    if root and root.exists():
        repo_path = str(root)
        current = _current_branch(repo_path)

        if branch != current and _branch_exists(repo_path, branch):
            candidates = _iter_branch_files(repo_path, branch, f"{docs_root}/**")
            candidates = [c for c in candidates if c.lower().endswith(".md")][: req.max_files]
            for rel in candidates:
                text = _read_file_from_branch(repo_path, branch, rel, max_chars=req.max_chars_per_file)
                files.append(ReadDocsFile(path=rel, content=text))
        else:
            base = _safe_join_repo(repo_path, docs_root)
            if base.exists() and base.is_dir():
                for p in sorted(base.rglob("*.md"))[: req.max_files]:
                    rel = str(p.relative_to(root)).replace("\\", "/")
                    text = _read_text_file(p, req.max_chars_per_file)
                    files.append(ReadDocsFile(path=rel, content=text))
    else:
        remote = await _remote_repo_connector(req.project_id)
        if remote:
            all_files = await _remote_list_tree(remote, branch)
            md_files = [p for p in all_files if p.startswith(docs_root + "/") and p.lower().endswith(".md")]
            for rel in md_files[: req.max_files]:
                try:
                    text, _ = await _remote_open_file(remote, rel, branch)
                except Exception:
                    continue
                text, _ = _limit_text(text, req.max_chars_per_file)
                files.append(ReadDocsFile(path=rel, content=text))
        elif _ctx_field(ctx, "user_id"):
            try:
                return await _run_browser_local_docs()
            except Exception as err:
                logger.warning("read_docs_folder.browser_local_fallback_failed project=%s err=%s", req.project_id, err)

    return ReadDocsFolderResponse(branch=branch, files=files)


async def read_chat_messages(req: ReadChatMessagesRequest) -> ReadChatMessagesResponse:
    req.limit = max(1, min(req.limit, 300))
    req.max_chars_per_message = max(100, min(req.max_chars_per_message, 20_000))

    chat_repo = repository_factory().global_chat
    chat = await chat_repo.find_legacy_chat(
        chat_id=req.chat_id,
        project_id=req.project_id,
        branch=req.branch,
        user=req.user,
        projection={"chat_id": 1, "messages": 1},
        fallback_to_chat_id=True,
    )
    if not chat:
        return ReadChatMessagesResponse(chat_id=req.chat_id, found=False)

    include_roles = {str(r).strip().lower() for r in req.include_roles if str(r).strip()}
    raw_messages = chat.get("messages") or []
    filtered: list[dict[str, Any]] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if include_roles and role not in include_roles:
            continue
        content = str(item.get("content") or "")
        if len(content) > req.max_chars_per_message:
            content = content[: req.max_chars_per_message] + "\n... (truncated)\n"
        ts_raw = item.get("ts")
        ts = str(ts_raw) if ts_raw is not None else None
        filtered.append({"role": role or "unknown", "content": content, "ts": ts})

    total_messages = len(filtered)
    selected = filtered[-req.limit :]
    return ReadChatMessagesResponse(
        chat_id=req.chat_id,
        found=True,
        total_messages=total_messages,
        returned_messages=len(selected),
        messages=selected,
    )


async def workspace_get_context(req: WorkspaceGetContextRequest) -> WorkspaceGetContextResponse:
    branch = str(req.branch or "main").strip() or "main"
    user = str(req.user or "").strip() or "dev@local"
    context = await assemble_workspace_context(
        project_id=req.project_id,
        branch=branch,
        user_id=user,
        chat_id=(str(req.chat_id or "").strip() or None),
        payload=None,
    )
    return WorkspaceGetContextResponse(
        found=True,
        context=context,
        context_text=workspace_context_to_text(context),
    )


async def request_user_input(req: RequestUserInputRequest) -> RequestUserInputResponse:
    question = (req.question or "").strip()
    if not question:
        raise RuntimeError("question is required")

    answer_mode = str(req.answer_mode or "open_text").strip().lower()
    if answer_mode not in {"open_text", "single_choice"}:
        answer_mode = "open_text"

    options: list[str] = []
    seen: set[str] = set()
    for raw in req.options or []:
        item = str(raw or "").strip()
        if not item:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        options.append(item)
        if len(options) >= 12:
            break

    if answer_mode == "single_choice":
        if len(options) < 2:
            raise RuntimeError("single_choice mode requires at least 2 options")
    else:
        options = []

    chat_repo = repository_factory().global_chat
    pending_id = str(ObjectId())
    now = datetime.utcnow()
    payload = {
        "id": pending_id,
        "question": question,
        "answer_mode": answer_mode,
        "options": options,
        "created_at": now,
    }
    updated = await chat_repo.set_legacy_pending_user_question(
        chat_id=req.chat_id,
        project_id=req.project_id,
        payload=payload,
        now=now,
    )
    if not updated:
        raise RuntimeError("Chat not found for request_user_input")

    return RequestUserInputResponse(
        id=pending_id,
        chat_id=req.chat_id,
        question=question,
        answer_mode=answer_mode,
        options=options,
        awaiting=True,
    )


async def create_jira_issue(req: CreateJiraIssueRequest) -> CreateJiraIssueResponse:
    summary = (req.summary or "").strip()
    description = (req.description or "").strip()
    if not summary:
        raise RuntimeError("summary is required")
    if not description:
        raise RuntimeError("description is required")

    connector = await _find_enabled_connector(req.project_id, "jira")
    if not connector:
        raise RuntimeError("Jira connector is not enabled for this project")

    config = connector.get("config") or {}
    base_url = str(config.get("baseUrl") or "").rstrip("/")
    email = str(config.get("email") or "").strip()
    api_token = str(config.get("apiToken") or "").strip()
    if not base_url or not email or not api_token:
        raise RuntimeError("Jira connector missing baseUrl/email/apiToken")

    project_key = (req.project_key or "").strip().upper() or _extract_jira_project_key(config)
    if not project_key:
        raise RuntimeError("Jira project key is missing (set connector projectKey or provide project_key)")

    issue_type = (req.issue_type or "Task").strip() or "Task"
    auth = base64.b64encode(f"{email}:{api_token}".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": issue_type},
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": description}],
                    }
                ],
            },
        }
    }

    endpoint = f"{base_url}/rest/api/3/issue"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(endpoint, headers=headers, json=payload)
        resp.raise_for_status()
        body = resp.json() or {}

    key = str(body.get("key") or "").strip()
    if not key:
        raise RuntimeError("Jira issue creation failed: missing issue key in response")
    url = f"{base_url}/browse/{key}"
    return CreateJiraIssueResponse(key=key, url=url, summary=summary)


async def write_documentation_file(req: WriteDocumentationFileRequest, ctx: Any = None) -> WriteDocumentationFileResponse:
    raw_path = (req.path or "").strip().replace("\\", "/")
    if not raw_path:
        raise RuntimeError("path is required")
    if ".." in raw_path.split("/"):
        raise RuntimeError("path must not contain '..'")

    if not raw_path.startswith("documentation/"):
        raw_path = f"documentation/{raw_path.lstrip('/')}"
    if not raw_path.lower().endswith(".md"):
        raw_path = f"{raw_path}.md"

    content = str(req.content or "")
    if not content.strip():
        raise RuntimeError("content is required")

    doc = await _project_doc(req.project_id)
    repo_path = str((doc.get("repo_path") or "").strip())
    if _is_browser_local_repo_path(repo_path):
        if not _ctx_field(ctx, "user_id"):
            raise RuntimeError("User context is required for browser-local documentation writes")
        branch = (req.branch or str(doc.get("default_branch") or "main")).strip() or "main"
        write_out = await _run_browser_local_git_tool(
            tool_name="write_docs_bundle",
            project_id=req.project_id,
            ctx=ctx,
            args={
                "docs_root": "documentation",
                "clear_first": False,
                "files": [{"path": raw_path, "content": content}],
            },
            timeout_sec=45,
        )
        written_paths_raw = write_out.get("written_paths")
        written_paths = [str(p).strip() for p in (written_paths_raw if isinstance(written_paths_raw, list) else []) if str(p).strip()]
        if not written_paths:
            raise RuntimeError(f"Failed to write documentation file in browser-local repo: {raw_path}")
        bytes_written = len((content if content.endswith("\n") else content + "\n").encode("utf-8"))
        return WriteDocumentationFileResponse(
            path=written_paths[0],
            bytes_written=bytes_written,
            branch=branch,
            overwritten=bool(req.overwrite),
        )

    if not repo_path or not Path(repo_path).exists():
        raise RuntimeError("Local repository not available for write_documentation_file")

    branch = _assert_branch_checked_out(req.branch, repo_path)
    full = _safe_join_repo(repo_path, raw_path)
    full.parent.mkdir(parents=True, exist_ok=True)

    already_exists = full.exists()
    if already_exists and not bool(req.overwrite):
        raise RuntimeError(f"File already exists and overwrite=false: {raw_path}")

    normalized = content if content.endswith("\n") else content + "\n"
    full.write_text(normalized, encoding="utf-8")
    return WriteDocumentationFileResponse(
        path=raw_path,
        bytes_written=len(normalized.encode("utf-8")),
        branch=branch,
        overwritten=already_exists,
    )


async def create_chat_task(req: CreateChatTaskRequest, ctx: Any | None = None) -> CreateChatTaskResponse:
    title = (req.title or "").strip()
    if not title:
        raise RuntimeError("title is required")

    now = _utc_iso_now()
    resolved_chat_id = (req.chat_id or "").strip() or _ctx_field(ctx, "chat_id") or None
    if resolved_chat_id:
        resolved_chat_id = resolved_chat_id.strip()
    repo = repository_factory().chat_tasks
    doc: dict[str, Any] = {
        "project_id": req.project_id,
        "chat_id": resolved_chat_id,
        "title": title,
        "details": (req.details or "").strip(),
        "assignee": (req.assignee or "").strip() or None,
        "due_date": (req.due_date or "").strip() or None,
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    logger.info(
        "create_chat_task.write project=%s chat_id=%s title=%s",
        req.project_id,
        doc.get("chat_id") or "",
        title,
    )
    row = await repo.create_chat_task(doc=doc)
    if not isinstance(row, dict):
        raise RuntimeError("Failed to create task")
    task_id = str(row.get("_id") or row.get("id") or "").strip()
    if not task_id:
        raise RuntimeError("Failed to create task")
    return CreateChatTaskResponse(id=task_id, title=title, status="open", created_at=now)


async def list_chat_tasks(req: ListChatTasksRequest) -> ListChatTasksResponse:
    repo = repository_factory().chat_tasks
    q: dict[str, Any] = {"project_id": req.project_id}
    if (req.chat_id or "").strip():
        chat_id = (req.chat_id or "").strip()
        q["$or"] = [
            {"chat_id": chat_id},
            {"chat_id": None},
            {"chat_id": ""},
            {"chat_id": {"$exists": False}},
        ]
    if (req.status or "").strip():
        q["status"] = (req.status or "").strip().lower()
    if (req.assignee or "").strip():
        q["assignee"] = (req.assignee or "").strip()
    limit = max(1, min(int(req.limit or 50), 500))
    rows = await repo.list_chat_tasks(query=q, limit=limit)
    items = [_task_item_from_doc(row) for row in rows if isinstance(row, dict)]
    return ListChatTasksResponse(total=len(items), items=items)


async def update_chat_task(req: UpdateChatTaskRequest) -> UpdateChatTaskResponse:
    task_id = (req.task_id or "").strip()
    if not task_id:
        raise RuntimeError("task_id is required")

    q: dict[str, Any] = {"project_id": req.project_id}
    if ObjectId.is_valid(task_id):
        q["_id"] = ObjectId(task_id)
    else:
        q["id"] = task_id

    repo = repository_factory().chat_tasks
    row = await repo.find_chat_task(query=q)
    if not isinstance(row, dict):
        raise RuntimeError("Task not found")

    changes: dict[str, Any] = {}
    if req.title is not None:
        title = str(req.title or "").strip()
        if not title:
            raise RuntimeError("title must not be empty")
        changes["title"] = title

    if req.details is not None:
        next_details = str(req.details or "").strip()
        if bool(req.append_details) and next_details:
            current = str(row.get("details") or "").strip()
            if current:
                next_details = f"{current}\n\n{next_details}"
        changes["details"] = next_details

    if req.status is not None:
        status = str(req.status or "").strip().lower()
        if not status:
            raise RuntimeError("status must not be empty")
        if status not in {"open", "in_progress", "blocked", "done", "cancelled"}:
            raise RuntimeError("status must be one of: open, in_progress, blocked, done, cancelled")
        changes["status"] = status

    if req.assignee is not None:
        changes["assignee"] = str(req.assignee or "").strip() or None

    if req.due_date is not None:
        changes["due_date"] = str(req.due_date or "").strip() or None

    if not changes:
        return UpdateChatTaskResponse(item=_task_item_from_doc(row))

    changes["updated_at"] = _utc_iso_now()
    row_id_raw = row.get("_id")
    row_id = str(row_id_raw).strip() if row_id_raw is not None else ""
    if not row_id or not ObjectId.is_valid(row_id):
        raise RuntimeError("Task update failed")
    next_row = await repo.update_chat_task_by_id(task_id=row_id, patch=changes)
    if not isinstance(next_row, dict):
        raise RuntimeError("Task update failed")
    return UpdateChatTaskResponse(item=_task_item_from_doc(next_row))


async def create_automation(req: CreateAutomationRequest, ctx: Any | None = None) -> CreateAutomationResponse:
    user_id = _ctx_field(ctx, "user_id") or "agent@system"
    item = await create_automation_service(
        req.project_id,
        user_id=user_id,
        name=req.name,
        description=req.description,
        enabled=bool(req.enabled),
        trigger=req.trigger if isinstance(req.trigger, dict) else {},
        conditions=req.conditions if isinstance(req.conditions, dict) else {},
        action=req.action if isinstance(req.action, dict) else {},
        cooldown_sec=int(req.cooldown_sec or 0),
        run_access=str(req.run_access or "member_runnable"),
        tags=req.tags if isinstance(req.tags, list) else [],
    )
    logger.info(
        "create_automation.write project=%s name=%s trigger=%s action=%s",
        req.project_id,
        str(req.name or "").strip(),
        str((req.trigger or {}).get("type") if isinstance(req.trigger, dict) else ""),
        str((req.action or {}).get("type") if isinstance(req.action, dict) else ""),
    )
    return CreateAutomationResponse(item=item)


async def list_automations(req: ListAutomationsRequest) -> ListAutomationsResponse:
    items = await list_automations_service(
        req.project_id,
        include_disabled=bool(req.include_disabled),
        limit=max(1, min(int(req.limit or 100), 500)),
    )
    return ListAutomationsResponse(total=len(items), items=items)


async def update_automation(req: UpdateAutomationRequest, ctx: Any | None = None) -> UpdateAutomationResponse:
    user_id = _ctx_field(ctx, "user_id") or "agent@system"
    patch: dict[str, Any] = {}
    for key in ("name", "description", "enabled", "trigger", "conditions", "action", "cooldown_sec", "run_access", "tags"):
        value = getattr(req, key, None)
        if value is None:
            continue
        patch[key] = value
    if not patch:
        current = await get_automation_service(req.project_id, req.automation_id)
        if not current:
            raise RuntimeError("Automation not found")
        return UpdateAutomationResponse(item=current)
    try:
        item = await update_automation_service(req.project_id, req.automation_id, user_id=user_id, patch=patch)
    except ValueError as err:
        raise RuntimeError(str(err))
    except KeyError:
        raise RuntimeError("Automation not found")
    return UpdateAutomationResponse(item=item)


async def delete_automation(req: DeleteAutomationRequest) -> DeleteAutomationResponse:
    try:
        deleted = await delete_automation_service(req.project_id, req.automation_id)
    except ValueError as err:
        raise RuntimeError(str(err))
    if not deleted:
        raise RuntimeError("Automation not found")
    return DeleteAutomationResponse(deleted=True, automation_id=req.automation_id)


async def run_automation(req: RunAutomationRequest, ctx: Any | None = None) -> RunAutomationResponse:
    payload = dict(req.payload or {})
    payload.setdefault("project_id", req.project_id)
    payload.setdefault("branch", _ctx_field(ctx, "branch"))
    payload.setdefault("chat_id", _ctx_field(ctx, "chat_id"))
    payload.setdefault("user_id", _ctx_field(ctx, "user_id"))
    try:
        run = await run_automation_service(
            req.project_id,
            req.automation_id,
            triggered_by="manual",
            event_type="manual",
            event_payload=payload,
            user_id=str(payload.get("user_id") or ""),
            dry_run=bool(req.dry_run),
        )
    except ValueError as err:
        raise RuntimeError(str(err))
    except KeyError:
        raise RuntimeError("Automation not found")
    except RuntimeError as err:
        raise RuntimeError(str(err))
    return RunAutomationResponse(run=run)


async def list_automation_templates(req: ListAutomationTemplatesRequest) -> ListAutomationTemplatesResponse:
    items = await list_automation_templates_service()
    return ListAutomationTemplatesResponse(total=len(items), items=items)
