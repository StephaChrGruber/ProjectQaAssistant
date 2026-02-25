from __future__ import annotations

import asyncio
import base64
import difflib
import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin

import httpx
import requests
from bson import ObjectId

from ..db import get_db
from ..models.base_mongo_models import LocalToolJob
from ..services.llm_profiles import resolve_project_llm_config
from ..settings import settings

logger = logging.getLogger(__name__)

BROWSER_LOCAL_REPO_PREFIX = "browser-local://"
IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"}
LOCAL_TOOL_POLL_INTERVAL_SEC = 0.35
MAX_DEFAULT_FILE_CHARS = 260_000
MAX_SUGGEST_CONTEXT_CHARS = 130_000
MAX_SUGGEST_FILE_COUNT = 8
READONLY_LARGE_FILE_BYTES = 380_000
READ_PREVIEW_CHARS = 120_000
REMOTE_HTTP_RETRIES = 2

BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tgz",
    ".bz2",
    ".7z",
    ".rar",
    ".jar",
    ".war",
    ".class",
    ".o",
    ".so",
    ".dylib",
    ".dll",
    ".exe",
    ".bin",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp3",
    ".mp4",
    ".mov",
    ".avi",
    ".wav",
    ".ogg",
    ".psd",
}


class WorkspaceError(RuntimeError):
    pass


_BROWSER_LOCAL_WORKSPACE_CODE: dict[str, str] = {
    "workspace_list_tree": """
async function run(args, context, helpers) {
  const maxDepth = Math.max(1, Math.min(Number(args.max_depth || 6), 16))
  const maxEntries = Math.max(1, Math.min(Number(args.max_entries || 2000), 6000))
  const includeFiles = args.include_files !== false
  const includeDirs = args.include_dirs !== false
  const base = String(args.path || "").trim().replace(/^\\/+|\\/+$/g, "")

  const files = helpers.localRepo.listFiles(8000)
  const entries = []
  const dirSet = new Set()

  for (const rawPath of files) {
    const rel = String(rawPath || "").replaceAll("\\\\", "/").replace(/^\\.\\//, "").replace(/^\\//, "")
    if (!rel) continue
    if (base && !(rel === base || rel.startsWith(base + "/"))) continue

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
    mode: "browser_local",
    entries: entries.slice(0, maxEntries),
  }
}
""".strip(),
    "workspace_read_file": """
async function run(args, context, helpers) {
  const path = String(args.path || "").trim().replace(/^\\.\\//, "").replace(/^\\//, "")
  if (!path) {
    throw new Error("workspace_read_file requires args.path")
  }
  const maxChars = Math.max(500, Math.min(Number(args.max_chars || 260000), 600000))
  const text = String(helpers.localRepo.readFile(path, maxChars) || "")
  return {
    path,
    branch: String(args.branch || "main"),
    mode: "browser_local",
    content: text,
  }
}
""".strip(),
    "workspace_write_file": """
async function run(args, context, helpers) {
  const path = String(args.path || "").trim().replace(/^\\.\\//, "").replace(/^\\//, "")
  if (!path) {
    throw new Error("workspace_write_file requires args.path")
  }
  const content = String(args.content || "")
  await helpers.localRepo.writeFile(path, content)
  return {
    path,
    mode: "browser_local",
    bytes_written: content.length,
  }
}
""".strip(),
    "workspace_delete_file": """
async function run(args, context, helpers) {
  const path = String(args.path || "").trim().replace(/^\\.\\//, "").replace(/^\\//, "")
  if (!path) {
    throw new Error("workspace_delete_file requires args.path")
  }
  const out = await helpers.localRepo.deleteFile(path)
  return {
    path,
    mode: "browser_local",
    deleted: Boolean(out?.deleted),
  }
}
""".strip(),
}


def _is_browser_local_repo_path(repo_path: str | None) -> bool:
    return str(repo_path or "").strip().lower().startswith(BROWSER_LOCAL_REPO_PREFIX)


def _normalize_rel_path(path: str) -> str:
    p = str(path or "").strip().replace("\\", "/")
    p = p.replace("//", "/")
    p = re.sub(r"^\./", "", p)
    p = p.lstrip("/")
    if not p:
        raise WorkspaceError("path is required")
    if any(part in {"", ".", ".."} for part in p.split("/")):
        raise WorkspaceError("Invalid path")
    return p


def _sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="replace")).hexdigest()


def _is_ignored_path(path: str) -> bool:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return any(p in IGNORE_PARTS for p in parts)


def _is_binary_extension(path: str) -> bool:
    p = str(path or "").strip().lower()
    if not p:
        return False
    suffix = Path(p).suffix.lower()
    return bool(suffix and suffix in BINARY_EXTENSIONS)


def _looks_binary_bytes(raw: bytes) -> bool:
    if not raw:
        return False
    sample = raw[:8192]
    if b"\x00" in sample:
        return True
    # If the sample is valid UTF-8, treat it as text.
    try:
        sample.decode("utf-8")
        return False
    except UnicodeDecodeError:
        pass
    text_range = bytes(bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x7F))))
    non_text = sample.translate(None, text_range)
    return (len(non_text) / max(1, len(sample))) > 0.30


def _remote_error_detail(body: str) -> str:
    raw = str(body or "").strip()
    if not raw:
        return ""
    try:
        parsed = json.loads(raw)
    except Exception:
        return raw[:500]
    if isinstance(parsed, dict):
        err = parsed.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or err.get("detail") or "").strip()
            if msg:
                return msg
        for key in ("message", "detail", "error_description"):
            msg = str(parsed.get(key) or "").strip()
            if msg:
                return msg
    return raw[:500]


def _safe_local_root_from_project_path(repo_path: str | None) -> str:
    raw = str(repo_path or "").strip()
    if raw:
        return raw
    # Fallback to repository root when project repo_path is not configured.
    try:
        return str(Path(__file__).resolve().parents[3])
    except Exception:
        return str(Path.cwd())


def _safe_join(root: str, rel_path: str) -> Path:
    root_path = Path(root).resolve()
    out = (root_path / rel_path).resolve()
    if root_path not in out.parents and root_path != out:
        raise WorkspaceError("Path escapes repository root")
    return out


async def _project_doc(project_id: str) -> dict[str, Any]:
    db = get_db()
    if ObjectId.is_valid(project_id):
        row = await db["projects"].find_one({"_id": ObjectId(project_id)})
        if row:
            return row
    row = await db["projects"].find_one({"_id": project_id})
    if row:
        return row
    row = await db["projects"].find_one({"key": project_id})
    if row:
        return row
    raise WorkspaceError("Project not found")


async def _remote_repo_connector(project_id: str) -> dict[str, Any] | None:
    db = get_db()
    rows = await db["connectors"].find(
        {"projectId": project_id, "isEnabled": True, "type": {"$in": ["github", "git", "bitbucket", "azure_devops"]}}
    ).to_list(length=30)
    by_type = {str(r.get("type") or ""): r for r in rows}
    for t in ("github", "git", "bitbucket", "azure_devops"):
        row = by_type.get(t)
        if not row:
            continue
        normalized_type = "github" if t == "git" else t
        return {"type": normalized_type, "connector_type": t, "config": row.get("config") or {}}
    return None


def _ref_candidates(remote: dict[str, Any], requested_ref: str | None) -> list[str]:
    cfg = remote.get("config") or {}
    requested = str(requested_ref or "").strip()
    base = str(cfg.get("branch") or "").strip()
    default = str(cfg.get("default_branch") or "").strip()

    out: list[str] = []
    for ref in (requested, base, default, "main", "master"):
        r = str(ref or "").strip()
        if not r or r in out:
            continue
        out.append(r)

    for ref in list(out):
        if ref.startswith("heads/"):
            alt = ref.removeprefix("heads/")
            if alt and alt not in out:
                out.append(alt)
        else:
            alt = f"heads/{ref}"
            if alt not in out:
                out.append(alt)

    return out or ["main", "master"]


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _github_list_tree(config: dict[str, Any], ref: str) -> list[str]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    token = str(config.get("token") or "").strip()
    if not owner or not repo or not token:
        return []

    headers = _github_headers(token)
    async with httpx.AsyncClient(timeout=40) as client:
        ref_resp = await client.get(f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{quote(ref, safe='')}", headers=headers)
        ref_resp.raise_for_status()
        sha = ((ref_resp.json() or {}).get("object") or {}).get("sha")
        if not sha:
            return []
        tree_resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}",
            headers=headers,
            params={"recursive": "1"},
        )
        tree_resp.raise_for_status()
        tree = (tree_resp.json() or {}).get("tree") or []
    out: list[str] = []
    for item in tree:
        if str(item.get("type") or "") != "blob":
            continue
        p = str(item.get("path") or "").strip()
        if p:
            out.append(p)
    return out


async def _github_open_file(config: dict[str, Any], path: str, ref: str) -> tuple[str, str, int, bool]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    token = str(config.get("token") or "").strip()
    if not owner or not repo or not token:
        raise WorkspaceError("GitHub connector is not fully configured")

    headers = _github_headers(token)
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/contents/{quote(path, safe='/')}",
            headers=headers,
            params={"ref": ref},
        )
        resp.raise_for_status()
        body = resp.json() or {}
    if body.get("encoding") != "base64":
        raise WorkspaceError("GitHub returned non-base64 file payload")
    raw_bytes = base64.b64decode(str(body.get("content") or ""))
    binary = _looks_binary_bytes(raw_bytes) or _is_binary_extension(path)
    raw = raw_bytes.decode("utf-8", errors="replace")
    url = str(body.get("html_url") or f"https://github.com/{owner}/{repo}/blob/{ref}/{path}")
    return raw, url, len(raw_bytes), binary


def _bitbucket_headers(config: dict[str, Any]) -> dict[str, str]:
    token = str(config.get("token") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}
    username = str(config.get("username") or "").strip()
    app_password = str(config.get("app_password") or config.get("appPassword") or "").strip()
    if username and app_password:
        raw = f"{username}:{app_password}".encode("utf-8")
        return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}
    return {}


def _bitbucket_base_url(config: dict[str, Any]) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://api.bitbucket.org/2.0").rstrip("/")


async def _bitbucket_list_tree(config: dict[str, Any], ref: str) -> list[str]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return []

    url = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src/{quote(ref, safe='')}"
    headers = _bitbucket_headers(config)

    out: list[str] = []
    async with httpx.AsyncClient(timeout=40) as client:
        next_url: str | None = url
        params: dict[str, Any] | None = {"pagelen": 100}
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


async def _bitbucket_open_file(config: dict[str, Any], path: str, ref: str) -> tuple[str, str, int, bool]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        raise WorkspaceError("Bitbucket connector missing workspace/repo")

    endpoint = (
        f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src/"
        f"{quote(ref, safe='')}/{quote(path, safe='/')}"
    )
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.get(endpoint, headers=_bitbucket_headers(config))
        resp.raise_for_status()
        text = resp.text
    url = f"https://bitbucket.org/{workspace}/{repo_slug}/src/{ref}/{path}"
    raw_bytes = text.encode("utf-8", errors="replace")
    return text, url, len(raw_bytes), _looks_binary_bytes(raw_bytes) or _is_binary_extension(path)


def _azure_headers(config: dict[str, Any]) -> dict[str, str]:
    pat = str(config.get("pat") or config.get("token") or "").strip()
    if not pat:
        return {}
    raw = f":{pat}".encode("utf-8")
    return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}


def _azure_base_url(config: dict[str, Any]) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://dev.azure.com").rstrip("/")


def _azure_parts(config: dict[str, Any]) -> tuple[str, str, str]:
    org = str(config.get("organization") or config.get("org") or "").strip()
    project = str(config.get("project") or "").strip()
    repo = str(config.get("repository") or config.get("repo") or "").strip()
    return org, project, repo


async def _azure_list_tree(config: dict[str, Any], ref: str) -> list[str]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        return []

    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    params = {
        "scopePath": "/",
        "recursionLevel": "Full",
        "includeContentMetadata": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": ref,
        "api-version": str(config.get("api_version") or "7.1"),
    }
    async with httpx.AsyncClient(timeout=40) as client:
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


async def _azure_open_file(config: dict[str, Any], path: str, ref: str) -> tuple[str, str, int, bool]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise WorkspaceError("Azure DevOps connector missing organization/project/repository")

    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    params = {
        "path": f"/{path.lstrip('/')}",
        "includeContent": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": ref,
        "api-version": str(config.get("api_version") or "7.1"),
    }
    headers = _azure_headers(config)
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.get(endpoint, headers=headers, params=params)
        resp.raise_for_status()
        ctype = str(resp.headers.get("content-type") or "").lower()
        if "application/json" in ctype:
            data = resp.json() or {}
            content = data.get("content")
            if isinstance(content, str):
                url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{ref}"
                raw_bytes = content.encode("utf-8", errors="replace")
                return content, url, len(raw_bytes), _looks_binary_bytes(raw_bytes) or _is_binary_extension(path)
        raw_resp = await client.get(
            endpoint,
            headers=headers,
            params={
                "path": f"/{path.lstrip('/')}",
                "download": "true",
                "versionDescriptor.versionType": "branch",
                "versionDescriptor.version": ref,
                "api-version": str(config.get("api_version") or "7.1"),
            },
        )
        raw_resp.raise_for_status()
    url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{ref}"
    text = raw_resp.text
    raw_bytes = text.encode("utf-8", errors="replace")
    return text, url, len(raw_bytes), _looks_binary_bytes(raw_bytes) or _is_binary_extension(path)


async def _remote_list_tree(remote: dict[str, Any], requested_ref: str | None) -> tuple[list[str], str]:
    rtype = str(remote.get("type") or "").strip()
    cfg = remote.get("config") if isinstance(remote.get("config"), dict) else {}
    refs = _ref_candidates(remote, requested_ref)
    last_err: Exception | None = None

    for ref in refs:
        try:
            if rtype == "github":
                return await _github_list_tree(cfg, ref), ref
            if rtype == "bitbucket":
                return await _bitbucket_list_tree(cfg, ref), ref
            if rtype == "azure_devops":
                return await _azure_list_tree(cfg, ref), ref
            break
        except Exception as err:
            last_err = err
            continue
    if last_err:
        raise WorkspaceError(f"Remote repository tree lookup failed: {last_err}")
    raise WorkspaceError("No supported remote connector is configured")


async def _remote_open_file(
    remote: dict[str, Any], path: str, requested_ref: str | None
) -> tuple[str, str, str, int, bool]:
    rtype = str(remote.get("type") or "").strip()
    cfg = remote.get("config") if isinstance(remote.get("config"), dict) else {}
    refs = _ref_candidates(remote, requested_ref)
    last_err: Exception | None = None

    for ref in refs:
        try:
            if rtype == "github":
                text, url, size_bytes, is_binary = await _github_open_file(cfg, path, ref)
                return text, url, ref, size_bytes, is_binary
            if rtype == "bitbucket":
                text, url, size_bytes, is_binary = await _bitbucket_open_file(cfg, path, ref)
                return text, url, ref, size_bytes, is_binary
            if rtype == "azure_devops":
                text, url, size_bytes, is_binary = await _azure_open_file(cfg, path, ref)
                return text, url, ref, size_bytes, is_binary
            break
        except Exception as err:
            last_err = err
            continue

    if last_err:
        raise WorkspaceError(f"Remote file read failed: {last_err}")
    raise WorkspaceError("No supported remote connector is configured")


async def _create_browser_local_job(
    *,
    tool_name: str,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    args: dict[str, Any],
    timeout_sec: int = 45,
) -> str:
    code = _BROWSER_LOCAL_WORKSPACE_CODE.get(tool_name)
    if not code:
        raise WorkspaceError(f"No browser-local workspace code for {tool_name}")
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
            "source": "workspace_builtin_browser_local",
        },
        status="queued",
        createdAt=now,
        updatedAt=now,
        expiresAt=expires,
    )
    await job.insert()
    logger.info(
        "workspace.browser_local.job_queued tool=%s project=%s branch=%s chat=%s job=%s",
        tool_name,
        project_id,
        branch,
        chat_id or "",
        str(job.id),
    )
    return str(job.id)


async def _wait_browser_local_job(job_id: str, timeout_sec: int = 45) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + max(1, timeout_sec)
    while True:
        row = await LocalToolJob.get(job_id)
        if not row:
            raise WorkspaceError("Browser-local workspace job not found")
        status = str(row.status or "")
        if status == "completed":
            result = row.result if isinstance(row.result, dict) else {}
            return dict(result)
        if status in {"failed", "timeout", "cancelled"}:
            raise WorkspaceError(str(row.error or f"Browser-local workspace job failed ({status})"))

        if loop.time() >= deadline:
            row.status = "timeout"
            row.error = "Browser-local workspace job timed out while waiting for browser execution."
            row.updatedAt = datetime.utcnow()
            row.completedAt = datetime.utcnow()
            await row.save()
            raise WorkspaceError("Browser-local workspace job timed out")

        await asyncio.sleep(LOCAL_TOOL_POLL_INTERVAL_SEC)


async def _run_browser_local_workspace_tool(
    *,
    tool_name: str,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    args: dict[str, Any],
    timeout_sec: int = 45,
) -> dict[str, Any]:
    if not str(user_id or "").strip():
        raise WorkspaceError("Browser-local workspace mode requires a user context")

    job_id = await _create_browser_local_job(
        tool_name=tool_name,
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        chat_id=chat_id,
        args=args,
        timeout_sec=timeout_sec,
    )
    out = await _wait_browser_local_job(job_id, timeout_sec=timeout_sec)
    logger.info(
        "workspace.browser_local.job_done tool=%s project=%s branch=%s chat=%s job=%s",
        tool_name,
        project_id,
        branch,
        chat_id or "",
        job_id,
    )
    return out


def _local_tree_entries(
    *,
    root_path: str,
    path: str,
    max_depth: int,
    max_entries: int,
    include_files: bool,
    include_dirs: bool,
) -> list[dict[str, Any]]:
    root = Path(root_path).resolve()
    base = str(path or "").strip().strip("/")
    base_prefix = f"{base}/" if base else ""

    files: list[str] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        if _is_ignored_path(rel):
            continue
        if base and not (rel == base or rel.startswith(base_prefix)):
            continue
        rel_from_base = rel[len(base_prefix) :] if base and rel.startswith(base_prefix) else ("" if rel == base else rel)
        depth = len([seg for seg in rel_from_base.split("/") if seg]) if rel_from_base else 1
        if depth > max_depth:
            continue
        files.append(rel)
        if len(files) >= max_entries * 5:
            break

    entries: list[dict[str, Any]] = []
    dirs: set[str] = set()

    for rel in files:
        rel_from_base = rel[len(base_prefix) :] if base and rel.startswith(base_prefix) else ("" if rel == base else rel)
        depth = len([seg for seg in rel_from_base.split("/") if seg]) if rel_from_base else 1
        if include_files:
            try:
                size = (root / rel).stat().st_size
            except Exception:
                size = None
            entries.append({"path": rel, "type": "file", "depth": depth, "size": size})

        parts = rel.split("/")
        while len(parts) > 1:
            parts.pop()
            d = "/".join(parts)
            if not d:
                break
            if base and not (d == base or d.startswith(base_prefix)):
                continue
            d_rel = d[len(base_prefix) :] if base and d.startswith(base_prefix) else ("" if d == base else d)
            d_depth = len([seg for seg in d_rel.split("/") if seg]) if d_rel else 1
            if d_depth <= max_depth:
                dirs.add(d)

    if include_dirs:
        for d in dirs:
            d_rel = d[len(base_prefix) :] if base and d.startswith(base_prefix) else ("" if d == base else d)
            d_depth = len([seg for seg in d_rel.split("/") if seg]) if d_rel else 1
            if d_depth <= max_depth:
                entries.append({"path": d, "type": "dir", "depth": d_depth, "size": None})

    entries.sort(key=lambda e: (len(str(e.get("path") or "").split("/")), str(e.get("path") or ""), 0 if e.get("type") == "dir" else 1))
    return entries[:max_entries]


def _build_dir_entries_from_paths(
    *,
    file_paths: list[str],
    path: str,
    max_depth: int,
    max_entries: int,
    include_files: bool,
    include_dirs: bool,
) -> list[dict[str, Any]]:
    base = str(path or "").strip().strip("/")
    base_prefix = f"{base}/" if base else ""
    entries: list[dict[str, Any]] = []
    dirs: set[str] = set()

    for rel in file_paths:
        rel = str(rel or "").strip().replace("\\", "/").lstrip("/")
        if not rel:
            continue
        if base and not (rel == base or rel.startswith(base_prefix)):
            continue
        rel_from_base = rel[len(base_prefix) :] if base and rel.startswith(base_prefix) else ("" if rel == base else rel)
        depth = len([seg for seg in rel_from_base.split("/") if seg]) if rel_from_base else 1
        if depth > max_depth:
            continue
        if include_files:
            entries.append({"path": rel, "type": "file", "depth": depth, "size": None})

        parts = rel.split("/")
        while len(parts) > 1:
            parts.pop()
            d = "/".join(parts)
            if not d:
                break
            if base and not (d == base or d.startswith(base_prefix)):
                continue
            d_rel = d[len(base_prefix) :] if base and d.startswith(base_prefix) else ("" if d == base else d)
            d_depth = len([seg for seg in d_rel.split("/") if seg]) if d_rel else 1
            if d_depth <= max_depth:
                dirs.add(d)

    if include_dirs:
        for d in dirs:
            d_rel = d[len(base_prefix) :] if base and d.startswith(base_prefix) else ("" if d == base else d)
            d_depth = len([seg for seg in d_rel.split("/") if seg]) if d_rel else 1
            if d_depth <= max_depth:
                entries.append({"path": d, "type": "dir", "depth": d_depth, "size": None})

    entries.sort(key=lambda e: (len(str(e.get("path") or "").split("/")), str(e.get("path") or ""), 0 if e.get("type") == "dir" else 1))
    return entries[:max_entries]


async def get_workspace_capabilities(project_id: str, *, branch: str | None = None) -> dict[str, Any]:
    project = await _project_doc(project_id)
    repo_path = str(project.get("repo_path") or "").strip()
    browser_local = _is_browser_local_repo_path(repo_path)
    local_path = _safe_local_root_from_project_path(repo_path)
    local_exists = bool(local_path and Path(local_path).exists() and Path(local_path).is_dir() and not browser_local)

    remote = await _remote_repo_connector(str(project.get("_id") or project_id))
    mode = "none"
    if browser_local:
        mode = "browser_local"
    elif local_exists:
        mode = "local"
    elif remote:
        mode = f"remote:{remote.get('type')}"

    return {
        "project_id": str(project.get("_id") or project_id),
        "branch": str(branch or project.get("default_branch") or "main"),
        "mode": mode,
        "repo_path": repo_path,
        "has_local_repo": bool(local_exists),
        "has_browser_local_repo": bool(browser_local),
        "has_remote_repo": bool(remote),
        "remote_type": str((remote or {}).get("type") or "") or None,
        "workspace_v1": True,
    }


async def list_tree(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    path: str = "",
    max_depth: int = 6,
    max_entries: int = 2000,
    include_files: bool = True,
    include_dirs: bool = True,
) -> dict[str, Any]:
    logger.info(
        "workspace.tree.start project=%s branch=%s chat=%s path=%s depth=%s max_entries=%s",
        project_id,
        branch,
        chat_id or "",
        path or ".",
        max_depth,
        max_entries,
    )
    project = await _project_doc(project_id)
    pid = str(project.get("_id") or project_id)
    repo_path = str(project.get("repo_path") or "").strip()
    safe_branch = str(branch or project.get("default_branch") or "main").strip() or "main"
    base_path = str(path or "").strip().strip("/")

    if _is_browser_local_repo_path(repo_path):
        out = await _run_browser_local_workspace_tool(
            tool_name="workspace_list_tree",
            project_id=pid,
            branch=safe_branch,
            user_id=user_id,
            chat_id=chat_id,
            args={
                "path": base_path,
                "branch": safe_branch,
                "max_depth": max_depth,
                "max_entries": max_entries,
                "include_files": include_files,
                "include_dirs": include_dirs,
            },
            timeout_sec=50,
        )
        entries = out.get("entries") if isinstance(out.get("entries"), list) else []
        return {
            "project_id": pid,
            "branch": safe_branch,
            "root": str(out.get("root") or base_path or "."),
            "mode": "browser_local",
            "entries": entries,
        }

    local_root = _safe_local_root_from_project_path(repo_path)
    if Path(local_root).exists() and Path(local_root).is_dir() and not _is_browser_local_repo_path(repo_path):
        entries = _local_tree_entries(
            root_path=local_root,
            path=base_path,
            max_depth=max(1, min(int(max_depth), 20)),
            max_entries=max(1, min(int(max_entries), 6000)),
            include_files=bool(include_files),
            include_dirs=bool(include_dirs),
        )
        return {
            "project_id": pid,
            "branch": safe_branch,
            "root": base_path or ".",
            "mode": "local",
            "entries": entries,
        }

    remote = await _remote_repo_connector(pid)
    if remote:
        paths, resolved_ref = await _remote_list_tree(remote, safe_branch)
        entries = _build_dir_entries_from_paths(
            file_paths=paths,
            path=base_path,
            max_depth=max(1, min(int(max_depth), 20)),
            max_entries=max(1, min(int(max_entries), 6000)),
            include_files=bool(include_files),
            include_dirs=bool(include_dirs),
        )
        return {
            "project_id": pid,
            "branch": resolved_ref,
            "root": base_path or ".",
            "mode": f"remote:{str(remote.get('type') or '')}",
            "entries": entries,
        }

    raise WorkspaceError("No repository source is configured for this project")


async def read_file(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    path: str,
    max_chars: int = MAX_DEFAULT_FILE_CHARS,
    allow_large: bool = False,
) -> dict[str, Any]:
    project = await _project_doc(project_id)
    pid = str(project.get("_id") or project_id)
    safe_path = _normalize_rel_path(path)
    safe_branch = str(branch or project.get("default_branch") or "main").strip() or "main"
    max_chars = max(500, min(int(max_chars or MAX_DEFAULT_FILE_CHARS), 600_000))
    repo_path = str(project.get("repo_path") or "").strip()

    if _is_browser_local_repo_path(repo_path):
        if _is_binary_extension(safe_path):
            return {
                "project_id": pid,
                "branch": safe_branch,
                "path": safe_path,
                "mode": "browser_local",
                "content": "",
                "content_hash": "",
                "truncated": False,
                "read_only": True,
                "read_only_reason": "binary_file",
                "size_bytes": None,
            }
        out = await _run_browser_local_workspace_tool(
            tool_name="workspace_read_file",
            project_id=pid,
            branch=safe_branch,
            user_id=user_id,
            chat_id=chat_id,
            args={"path": safe_path, "branch": safe_branch, "max_chars": max_chars},
            timeout_sec=45,
        )
        content = str(out.get("content") or "")
        size_bytes = len(content.encode("utf-8", errors="replace"))
        read_only = False
        read_only_reason: str | None = None
        if (not allow_large) and size_bytes > READONLY_LARGE_FILE_BYTES:
            content = content[:READ_PREVIEW_CHARS] + "\n... (preview: file is large; open full file to edit)\n"
            read_only = True
            read_only_reason = "large_file"
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "browser_local",
            "content": content,
            "content_hash": _sha256_text(content),
            "truncated": False,
            "read_only": read_only,
            "read_only_reason": read_only_reason,
            "size_bytes": size_bytes,
        }

    local_root = _safe_local_root_from_project_path(repo_path)
    if Path(local_root).exists() and Path(local_root).is_dir() and not _is_browser_local_repo_path(repo_path):
        full = _safe_join(local_root, safe_path)
        if not full.exists() or not full.is_file():
            raise WorkspaceError(f"File not found: {safe_path}")
        raw = full.read_bytes()
        size_bytes = len(raw)
        if _looks_binary_bytes(raw) or _is_binary_extension(safe_path):
            return {
                "project_id": pid,
                "branch": safe_branch,
                "path": safe_path,
                "mode": "local",
                "content": "",
                "content_hash": "",
                "truncated": False,
                "read_only": True,
                "read_only_reason": "binary_file",
                "size_bytes": size_bytes,
            }
        if (not allow_large) and size_bytes > READONLY_LARGE_FILE_BYTES:
            preview_text = raw[:READ_PREVIEW_CHARS].decode("utf-8", errors="replace")
            preview_text += "\n... (preview: file is large; open full file to edit)\n"
            return {
                "project_id": pid,
                "branch": safe_branch,
                "path": safe_path,
                "mode": "local",
                "content": preview_text,
                "content_hash": _sha256_text(preview_text),
                "truncated": True,
                "read_only": True,
                "read_only_reason": "large_file",
                "size_bytes": size_bytes,
            }
        content = raw.decode("utf-8", errors="replace")
        truncated = False
        if len(content) > max_chars:
            content = content[:max_chars] + "\n... (truncated)\n"
            truncated = True
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "local",
            "content": content,
            "content_hash": _sha256_text(content),
            "truncated": truncated,
            "read_only": False,
            "read_only_reason": None,
            "size_bytes": size_bytes,
        }

    remote = await _remote_repo_connector(pid)
    if remote:
        content, web_url, resolved_ref, size_bytes, is_binary = await _remote_open_file(remote, safe_path, safe_branch)
        if is_binary:
            return {
                "project_id": pid,
                "branch": resolved_ref,
                "path": safe_path,
                "mode": f"remote:{str(remote.get('type') or '')}",
                "content": "",
                "web_url": web_url,
                "content_hash": "",
                "truncated": False,
                "read_only": True,
                "read_only_reason": "binary_file",
                "size_bytes": size_bytes,
            }
        if (not allow_large) and size_bytes > READONLY_LARGE_FILE_BYTES:
            preview = content[:READ_PREVIEW_CHARS] + "\n... (preview: file is large; open full file to edit)\n"
            return {
                "project_id": pid,
                "branch": resolved_ref,
                "path": safe_path,
                "mode": f"remote:{str(remote.get('type') or '')}",
                "content": preview,
                "web_url": web_url,
                "content_hash": _sha256_text(preview),
                "truncated": True,
                "read_only": True,
                "read_only_reason": "large_file",
                "size_bytes": size_bytes,
            }
        if len(content) > max_chars:
            content = content[:max_chars] + "\n... (truncated)\n"
            truncated = True
        else:
            truncated = False
        return {
            "project_id": pid,
            "branch": resolved_ref,
            "path": safe_path,
            "mode": f"remote:{str(remote.get('type') or '')}",
            "content": content,
            "web_url": web_url,
            "content_hash": _sha256_text(content),
            "truncated": truncated,
            "read_only": False,
            "read_only_reason": None,
            "size_bytes": size_bytes,
        }

    raise WorkspaceError("No repository source is configured for this project")


async def _upsert_workspace_draft(
    *,
    project_id: str,
    branch: str,
    chat_id: str,
    user_id: str,
    path: str,
    content: str,
) -> dict[str, Any]:
    db = get_db()
    now = datetime.utcnow()
    query = {
        "project_id": project_id,
        "branch": branch,
        "chat_id": chat_id,
        "user_id": user_id,
        "path": path,
    }
    prev = await db["workspace_drafts"].find_one(query, {"version": 1})
    version = int((prev or {}).get("version") or 0) + 1
    doc = {
        **query,
        "content": content,
        "content_hash": _sha256_text(content),
        "version": version,
        "updated_at": now,
    }
    await db["workspace_drafts"].update_one(
        query,
        {
            "$set": doc,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {
        "project_id": project_id,
        "branch": branch,
        "chat_id": chat_id,
        "user_id": user_id,
        "path": path,
        "version": version,
        "updated_at": now.replace(tzinfo=timezone.utc).isoformat(),
        "content_hash": doc["content_hash"],
    }


async def save_draft(
    *,
    project_id: str,
    branch: str,
    chat_id: str,
    user_id: str,
    path: str,
    content: str,
) -> dict[str, Any]:
    safe_path = _normalize_rel_path(path)
    if not str(chat_id or "").strip():
        raise WorkspaceError("chat_id is required for draft save")
    return await _upsert_workspace_draft(
        project_id=project_id,
        branch=str(branch or "main").strip() or "main",
        chat_id=str(chat_id).strip(),
        user_id=str(user_id or "").strip(),
        path=safe_path,
        content=str(content or ""),
    )


async def get_draft(
    *,
    project_id: str,
    branch: str,
    chat_id: str,
    user_id: str,
    path: str,
) -> dict[str, Any]:
    safe_path = _normalize_rel_path(path)
    if not str(chat_id or "").strip():
        raise WorkspaceError("chat_id is required for draft lookup")
    db = get_db()
    row = await db["workspace_drafts"].find_one(
        {
            "project_id": project_id,
            "branch": str(branch or "main").strip() or "main",
            "chat_id": str(chat_id).strip(),
            "user_id": str(user_id or "").strip(),
            "path": safe_path,
        }
    )
    if not row:
        return {
            "found": False,
            "project_id": project_id,
            "branch": str(branch or "main").strip() or "main",
            "chat_id": str(chat_id).strip(),
            "path": safe_path,
        }

    updated = row.get("updated_at")
    if isinstance(updated, datetime):
        updated_iso = updated.replace(tzinfo=timezone.utc).isoformat()
    else:
        updated_iso = str(updated or "")

    return {
        "found": True,
        "project_id": project_id,
        "branch": row.get("branch"),
        "chat_id": row.get("chat_id"),
        "path": row.get("path"),
        "content": str(row.get("content") or ""),
        "content_hash": str(row.get("content_hash") or ""),
        "version": int(row.get("version") or 1),
        "updated_at": updated_iso,
    }


class _RemoteBranchNotFound(WorkspaceError):
    pass


def _retryable_http_status(code: int) -> bool:
    return int(code) in {429, 500, 502, 503, 504}


async def _http_request_with_retries(
    *,
    method: str,
    url: str,
    connector: str,
    operation: str,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | list[Any] | None = None,
    data: dict[str, Any] | None = None,
    files: Any = None,
    timeout_sec: int = 45,
) -> httpx.Response:
    last_err: Exception | None = None
    for attempt in range(1, REMOTE_HTTP_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                resp = await client.request(
                    method.upper(),
                    url,
                    headers=headers,
                    params=params,
                    json=json_body,
                    data=data,
                    files=files,
                )
        except Exception as err:
            last_err = err
            if attempt < REMOTE_HTTP_RETRIES:
                await asyncio.sleep(0.35 * attempt)
                continue
            raise WorkspaceError(f"{connector} {operation} failed: {err}") from err

        if resp.status_code < 400:
            return resp
        detail = _remote_error_detail(resp.text)
        if _retryable_http_status(resp.status_code) and attempt < REMOTE_HTTP_RETRIES:
            await asyncio.sleep(0.35 * attempt)
            continue
        raise WorkspaceError(
            f"{connector} {operation} failed ({resp.status_code})"
            + (f": {detail}" if detail else "")
        )

    if last_err:
        raise WorkspaceError(f"{connector} {operation} failed: {last_err}")
    raise WorkspaceError(f"{connector} {operation} failed")


def _workspace_commit_message(path: str, user_id: str) -> str:
    actor = str(user_id or "").strip() or "workspace"
    return f"workspace: update {path} by {actor}"


async def _github_write_file(
    config: dict[str, Any],
    *,
    path: str,
    content: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    token = str(config.get("token") or "").strip()
    if not owner or not repo or not token:
        raise WorkspaceError("GitHub connector is not fully configured for write")

    headers = _github_headers(token)
    safe_path = quote(path, safe="/")
    base_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{safe_path}"
    sha: str | None = None
    existing_url = f"https://github.com/{owner}/{repo}/blob/{branch}/{path}"

    async with httpx.AsyncClient(timeout=45) as client:
        probe = await client.get(base_url, headers=headers, params={"ref": branch})
    if probe.status_code == 200:
        payload = probe.json() or {}
        sha = str(payload.get("sha") or "").strip() or None
        existing_url = str(payload.get("html_url") or existing_url)
    elif probe.status_code == 404:
        detail = _remote_error_detail(probe.text).lower()
        if "branch" in detail and "not found" in detail:
            raise _RemoteBranchNotFound(f"Branch not found on GitHub: {branch}")
    else:
        detail = _remote_error_detail(probe.text)
        raise WorkspaceError(f"GitHub read-before-write failed ({probe.status_code})" + (f": {detail}" if detail else ""))

    payload: dict[str, Any] = {
        "message": _workspace_commit_message(path, user_id),
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha

    resp = await _http_request_with_retries(
        method="PUT",
        url=base_url,
        connector="GitHub",
        operation=f"write {path}",
        headers=headers,
        json_body=payload,
        timeout_sec=50,
    )
    body = resp.json() or {}
    commit_sha = str(((body.get("commit") or {}).get("sha")) or "").strip() or None
    web_url = str(((body.get("content") or {}).get("html_url")) or existing_url)
    return {"branch": branch, "web_url": web_url, "commit_id": commit_sha}


async def _bitbucket_write_file(
    config: dict[str, Any],
    *,
    path: str,
    content: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        raise WorkspaceError("Bitbucket connector missing workspace/repo")

    headers = _bitbucket_headers(config)
    endpoint = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src"
    data = {"branch": branch, "message": _workspace_commit_message(path, user_id)}
    files = [(path, (path.split("/")[-1] or "file.txt", content.encode("utf-8"), "text/plain"))]

    try:
        resp = await _http_request_with_retries(
            method="POST",
            url=endpoint,
            connector="Bitbucket",
            operation=f"write {path}",
            headers=headers,
            data=data,
            files=files,
            timeout_sec=60,
        )
    except WorkspaceError as err:
        lowered = str(err).lower()
        if "branch" in lowered and "not found" in lowered:
            raise _RemoteBranchNotFound(f"Branch not found on Bitbucket: {branch}") from err
        raise
    body = resp.json() if "application/json" in str(resp.headers.get("content-type") or "").lower() else {}
    commit_id = str((((body.get("commit") or {}).get("hash")) if isinstance(body, dict) else "") or "").strip() or None
    web_url = f"https://bitbucket.org/{workspace}/{repo_slug}/src/{branch}/{path}"
    return {"branch": branch, "web_url": web_url, "commit_id": commit_id}


async def _azure_branch_tip_sha(config: dict[str, Any], branch: str) -> str:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise WorkspaceError("Azure DevOps connector missing organization/project/repository")
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/refs"
    resp = await _http_request_with_retries(
        method="GET",
        url=endpoint,
        connector="Azure DevOps",
        operation=f"resolve branch {branch}",
        headers=_azure_headers(config),
        params={"filter": f"heads/{branch}", "$top": 1, "api-version": api_version},
    )
    rows = (resp.json() or {}).get("value") or []
    if not isinstance(rows, list) or not rows:
        raise _RemoteBranchNotFound(f"Branch not found on Azure DevOps: {branch}")
    sha = str((rows[0] or {}).get("objectId") or "").strip()
    if not sha:
        raise WorkspaceError(f"Could not resolve tip SHA for Azure DevOps branch: {branch}")
    return sha


async def _azure_write_file(
    config: dict[str, Any],
    *,
    path: str,
    content: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise WorkspaceError("Azure DevOps connector missing organization/project/repository")
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    headers = _azure_headers(config)
    old_sha = await _azure_branch_tip_sha(config, branch)

    item_endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    async with httpx.AsyncClient(timeout=35) as client:
        item_resp = await client.get(
            item_endpoint,
            headers=headers,
            params={
                "path": f"/{path.lstrip('/')}",
                "versionDescriptor.versionType": "branch",
                "versionDescriptor.version": branch,
                "includeContentMetadata": "true",
                "api-version": api_version,
            },
        )
    if item_resp.status_code == 200:
        change_type = "edit"
    elif item_resp.status_code == 404:
        change_type = "add"
    else:
        detail = _remote_error_detail(item_resp.text)
        raise WorkspaceError(
            f"Azure DevOps check file failed ({item_resp.status_code})" + (f": {detail}" if detail else "")
        )

    push_endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/pushes"
    payload = {
        "refUpdates": [{"name": f"refs/heads/{branch}", "oldObjectId": old_sha}],
        "commits": [
            {
                "comment": _workspace_commit_message(path, user_id),
                "changes": [
                    {
                        "changeType": change_type,
                        "item": {"path": f"/{path.lstrip('/')}"},
                        "newContent": {"content": content, "contentType": "rawtext"},
                    }
                ],
            }
        ],
    }
    resp = await _http_request_with_retries(
        method="POST",
        url=push_endpoint,
        connector="Azure DevOps",
        operation=f"write {path}",
        headers=headers,
        params={"api-version": api_version},
        json_body=payload,
        timeout_sec=60,
    )
    body = resp.json() or {}
    push_id = str(body.get("pushId") or "").strip() or None
    web_url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{branch}"
    return {"branch": branch, "web_url": web_url, "commit_id": push_id}


async def _remote_write_file(
    remote: dict[str, Any],
    *,
    path: str,
    content: str,
    requested_branch: str | None,
    user_id: str,
) -> dict[str, Any]:
    rtype = str(remote.get("type") or "").strip()
    cfg = remote.get("config") if isinstance(remote.get("config"), dict) else {}
    refs = _ref_candidates(remote, requested_branch)
    last_err: Exception | None = None

    for ref in refs:
        branch_name = ref.removeprefix("heads/") if ref.startswith("heads/") else ref
        try:
            if rtype == "github":
                result = await _github_write_file(cfg, path=path, content=content, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            if rtype == "bitbucket":
                result = await _bitbucket_write_file(cfg, path=path, content=content, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            if rtype == "azure_devops":
                result = await _azure_write_file(cfg, path=path, content=content, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            raise WorkspaceError(f"Unsupported remote connector type: {rtype}")
        except _RemoteBranchNotFound as err:
            last_err = err
            continue
        except Exception as err:
            last_err = err
            break

    if last_err:
        raise WorkspaceError(f"Remote repository write failed: {last_err}")
    raise WorkspaceError("Remote repository write failed")


async def _github_delete_file(
    config: dict[str, Any],
    *,
    path: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    token = str(config.get("token") or "").strip()
    if not owner or not repo or not token:
        raise WorkspaceError("GitHub connector is not fully configured for delete")

    headers = _github_headers(token)
    safe_path = quote(path, safe="/")
    base_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{safe_path}"
    web_url = f"https://github.com/{owner}/{repo}/blob/{branch}/{path}"

    async with httpx.AsyncClient(timeout=35) as client:
        probe = await client.get(base_url, headers=headers, params={"ref": branch})
    if probe.status_code == 404:
        detail = _remote_error_detail(probe.text).lower()
        if "branch" in detail and "not found" in detail:
            raise _RemoteBranchNotFound(f"Branch not found on GitHub: {branch}")
        return {"branch": branch, "deleted": False, "web_url": web_url, "commit_id": None}
    if probe.status_code >= 400:
        detail = _remote_error_detail(probe.text)
        raise WorkspaceError(f"GitHub read-before-delete failed ({probe.status_code})" + (f": {detail}" if detail else ""))

    payload = probe.json() or {}
    sha = str(payload.get("sha") or "").strip()
    if not sha:
        raise WorkspaceError("GitHub did not return file sha for delete operation")
    web_url = str(payload.get("html_url") or web_url)

    resp = await _http_request_with_retries(
        method="DELETE",
        url=base_url,
        connector="GitHub",
        operation=f"delete {path}",
        headers=headers,
        json_body={
            "message": _workspace_commit_message(path, user_id),
            "sha": sha,
            "branch": branch,
        },
        timeout_sec=50,
    )
    body = resp.json() or {}
    commit_id = str(((body.get("commit") or {}).get("sha")) or "").strip() or None
    return {"branch": branch, "deleted": True, "web_url": web_url, "commit_id": commit_id}


async def _bitbucket_delete_file(
    config: dict[str, Any],
    *,
    path: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        raise WorkspaceError("Bitbucket connector missing workspace/repo")

    headers = _bitbucket_headers(config)
    file_endpoint = (
        f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src/"
        f"{quote(branch, safe='')}/{quote(path, safe='/')}"
    )
    async with httpx.AsyncClient(timeout=35) as client:
        probe = await client.get(file_endpoint, headers=headers)
    if probe.status_code == 404:
        detail = _remote_error_detail(probe.text).lower()
        if "branch" in detail and "not found" in detail:
            raise _RemoteBranchNotFound(f"Branch not found on Bitbucket: {branch}")
        return {"branch": branch, "deleted": False, "web_url": f"https://bitbucket.org/{workspace}/{repo_slug}/src/{branch}/{path}", "commit_id": None}
    if probe.status_code >= 400:
        detail = _remote_error_detail(probe.text)
        raise WorkspaceError(
            f"Bitbucket read-before-delete failed ({probe.status_code})" + (f": {detail}" if detail else "")
        )

    endpoint = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/src"
    resp = await _http_request_with_retries(
        method="POST",
        url=endpoint,
        connector="Bitbucket",
        operation=f"delete {path}",
        headers=headers,
        data={
            "branch": branch,
            "message": _workspace_commit_message(path, user_id),
            "files": path,
        },
        timeout_sec=60,
    )
    body = resp.json() if "application/json" in str(resp.headers.get("content-type") or "").lower() else {}
    commit_id = str((((body.get("commit") or {}).get("hash")) if isinstance(body, dict) else "") or "").strip() or None
    web_url = f"https://bitbucket.org/{workspace}/{repo_slug}/src/{branch}/{path}"
    return {"branch": branch, "deleted": True, "web_url": web_url, "commit_id": commit_id}


async def _azure_delete_file(
    config: dict[str, Any],
    *,
    path: str,
    branch: str,
    user_id: str,
) -> dict[str, Any]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        raise WorkspaceError("Azure DevOps connector missing organization/project/repository")
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    headers = _azure_headers(config)
    web_url = f"https://dev.azure.com/{org}/{project}/_git/{repo}?path=/{path}&version=GB{branch}"

    item_endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/items"
    async with httpx.AsyncClient(timeout=35) as client:
        probe = await client.get(
            item_endpoint,
            headers=headers,
            params={
                "path": f"/{path.lstrip('/')}",
                "versionDescriptor.versionType": "branch",
                "versionDescriptor.version": branch,
                "includeContentMetadata": "true",
                "api-version": api_version,
            },
        )
    if probe.status_code == 404:
        detail = _remote_error_detail(probe.text).lower()
        if "branch" in detail and "not found" in detail:
            raise _RemoteBranchNotFound(f"Branch not found on Azure DevOps: {branch}")
        return {"branch": branch, "deleted": False, "web_url": web_url, "commit_id": None}
    if probe.status_code >= 400:
        detail = _remote_error_detail(probe.text)
        raise WorkspaceError(
            f"Azure DevOps read-before-delete failed ({probe.status_code})" + (f": {detail}" if detail else "")
        )

    old_sha = await _azure_branch_tip_sha(config, branch)
    push_endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/pushes"
    resp = await _http_request_with_retries(
        method="POST",
        url=push_endpoint,
        connector="Azure DevOps",
        operation=f"delete {path}",
        headers=headers,
        params={"api-version": api_version},
        json_body={
            "refUpdates": [{"name": f"refs/heads/{branch}", "oldObjectId": old_sha}],
            "commits": [
                {
                    "comment": _workspace_commit_message(path, user_id),
                    "changes": [{"changeType": "delete", "item": {"path": f"/{path.lstrip('/')}"}},],
                }
            ],
        },
        timeout_sec=60,
    )
    body = resp.json() or {}
    push_id = str(body.get("pushId") or "").strip() or None
    return {"branch": branch, "deleted": True, "web_url": web_url, "commit_id": push_id}


async def _remote_delete_file(
    remote: dict[str, Any],
    *,
    path: str,
    requested_branch: str | None,
    user_id: str,
) -> dict[str, Any]:
    rtype = str(remote.get("type") or "").strip()
    cfg = remote.get("config") if isinstance(remote.get("config"), dict) else {}
    refs = _ref_candidates(remote, requested_branch)
    last_err: Exception | None = None

    for ref in refs:
        branch_name = ref.removeprefix("heads/") if ref.startswith("heads/") else ref
        try:
            if rtype == "github":
                result = await _github_delete_file(cfg, path=path, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            if rtype == "bitbucket":
                result = await _bitbucket_delete_file(cfg, path=path, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            if rtype == "azure_devops":
                result = await _azure_delete_file(cfg, path=path, branch=branch_name, user_id=user_id)
                return {"resolved_ref": branch_name, **result}
            raise WorkspaceError(f"Unsupported remote connector type: {rtype}")
        except _RemoteBranchNotFound as err:
            last_err = err
            continue
        except Exception as err:
            last_err = err
            break

    if last_err:
        raise WorkspaceError(f"Remote repository delete failed: {last_err}")
    raise WorkspaceError("Remote repository delete failed")


async def write_file(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    path: str,
    content: str,
    expected_hash: str | None = None,
) -> dict[str, Any]:
    safe_path = _normalize_rel_path(path)
    safe_branch = str(branch or "main").strip() or "main"
    new_content = str(content or "")
    expected_hash = str(expected_hash or "").strip() or None

    current = await read_file(
        project_id=project_id,
        branch=safe_branch,
        user_id=user_id,
        chat_id=chat_id,
        path=safe_path,
        max_chars=max(len(new_content) + 2000, MAX_DEFAULT_FILE_CHARS),
        allow_large=True,
    )
    current_hash = str(current.get("content_hash") or "")
    mode = str(current.get("mode") or "")
    read_only_reason = str(current.get("read_only_reason") or "").strip()

    if read_only_reason == "binary_file":
        raise WorkspaceError("Cannot write binary files in workspace editor mode.")

    if expected_hash and current_hash and expected_hash != current_hash:
        raise WorkspaceError("conflict:file_changed_since_load")

    project = await _project_doc(project_id)
    pid = str(project.get("_id") or project_id)
    repo_path = str(project.get("repo_path") or "").strip()

    if mode == "browser_local" or _is_browser_local_repo_path(repo_path):
        await _run_browser_local_workspace_tool(
            tool_name="workspace_write_file",
            project_id=pid,
            branch=safe_branch,
            user_id=user_id,
            chat_id=chat_id,
            args={"path": safe_path, "content": new_content, "branch": safe_branch},
            timeout_sec=55,
        )
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "browser_local",
            "content_hash": _sha256_text(new_content),
            "bytes_written": len(new_content.encode("utf-8", errors="replace")),
        }

    if mode == "local":
        local_root = _safe_local_root_from_project_path(repo_path)
        full = _safe_join(local_root, safe_path)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(new_content, encoding="utf-8", errors="replace")
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "local",
            "content_hash": _sha256_text(new_content),
            "bytes_written": len(new_content.encode("utf-8", errors="replace")),
        }

    if mode.startswith("remote:"):
        remote = await _remote_repo_connector(pid)
        if not remote:
            raise WorkspaceError("No remote repository connector is available for write")
        remote_out = await _remote_write_file(
            remote,
            path=safe_path,
            content=new_content,
            requested_branch=safe_branch,
            user_id=user_id,
        )
        return {
            "project_id": pid,
            "branch": str(remote_out.get("resolved_ref") or safe_branch),
            "path": safe_path,
            "mode": f"remote:{str(remote.get('type') or '')}",
            "content_hash": _sha256_text(new_content),
            "bytes_written": len(new_content.encode("utf-8", errors="replace")),
            "web_url": remote_out.get("web_url"),
            "commit_id": remote_out.get("commit_id"),
        }

    raise WorkspaceError("No writable repository source is available")


async def delete_file(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    path: str,
    expected_hash: str | None = None,
    ignore_missing: bool = False,
) -> dict[str, Any]:
    safe_path = _normalize_rel_path(path)
    safe_branch = str(branch or "main").strip() or "main"
    expected_hash = str(expected_hash or "").strip() or None

    project = await _project_doc(project_id)
    pid = str(project.get("_id") or project_id)
    repo_path = str(project.get("repo_path") or "").strip()

    current: dict[str, Any] | None = None
    current_hash: str | None = None
    mode = "none"
    try:
        current = await read_file(
            project_id=project_id,
            branch=safe_branch,
            user_id=user_id,
            chat_id=chat_id,
            path=safe_path,
            allow_large=True,
        )
        mode = str(current.get("mode") or "")
        current_hash = str(current.get("content_hash") or "").strip() or None
    except Exception:
        if not ignore_missing:
            raise
        current = None

    if expected_hash and current_hash and expected_hash != current_hash:
        raise WorkspaceError("conflict:file_changed_since_load")

    if _is_browser_local_repo_path(repo_path) or mode == "browser_local":
        out = await _run_browser_local_workspace_tool(
            tool_name="workspace_delete_file",
            project_id=pid,
            branch=safe_branch,
            user_id=user_id,
            chat_id=chat_id,
            args={"path": safe_path, "branch": safe_branch},
            timeout_sec=55,
        )
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "browser_local",
            "deleted": bool(out.get("deleted", True)),
            "content_hash": None,
        }

    local_root = _safe_local_root_from_project_path(repo_path)
    if Path(local_root).exists() and Path(local_root).is_dir() and not _is_browser_local_repo_path(repo_path):
        full = _safe_join(local_root, safe_path)
        if not full.exists():
            if ignore_missing:
                return {
                    "project_id": pid,
                    "branch": safe_branch,
                    "path": safe_path,
                    "mode": "local",
                    "deleted": False,
                    "content_hash": None,
                }
            raise WorkspaceError(f"File not found: {safe_path}")
        full.unlink()
        return {
            "project_id": pid,
            "branch": safe_branch,
            "path": safe_path,
            "mode": "local",
            "deleted": True,
            "content_hash": None,
        }

    remote = await _remote_repo_connector(pid)
    if remote:
        remote_out = await _remote_delete_file(
            remote,
            path=safe_path,
            requested_branch=safe_branch,
            user_id=user_id,
        )
        return {
            "project_id": pid,
            "branch": str(remote_out.get("resolved_ref") or safe_branch),
            "path": safe_path,
            "mode": f"remote:{str(remote.get('type') or '')}",
            "deleted": bool(remote_out.get("deleted", True)),
            "content_hash": None,
            "web_url": remote_out.get("web_url"),
            "commit_id": remote_out.get("commit_id"),
        }

    raise WorkspaceError("No writable repository source is available")


def _unified_diff(path: str, original: str, target: str) -> str:
    from_lines = original.splitlines(keepends=True)
    to_lines = target.splitlines(keepends=True)
    diff = difflib.unified_diff(
        from_lines,
        to_lines,
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
        lineterm="",
    )
    return "\n".join(diff)


def _summarize_hunk(tag: str, old_count: int, new_count: int) -> str:
    if tag == "replace":
        return f"Replace {old_count} line(s) with {new_count} line(s)"
    if tag == "delete":
        return f"Delete {old_count} line(s)"
    if tag == "insert":
        return f"Insert {new_count} line(s)"
    return "Change"


def _build_file_patch(path: str, original: str, target: str) -> dict[str, Any]:
    original_lines = original.splitlines(keepends=True)
    target_lines = target.splitlines(keepends=True)
    matcher = difflib.SequenceMatcher(a=original_lines, b=target_lines)

    hunks: list[dict[str, Any]] = []
    opcodes: list[list[Any]] = []
    op_index = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        entry = [tag, i1, i2, j1, j2]
        opcodes.append(entry)
        if tag == "equal":
            op_index += 1
            continue

        preview_old = "".join(original_lines[i1:i2])
        preview_new = "".join(target_lines[j1:j2])
        hunks.append(
            {
                "id": len(hunks),
                "op_index": op_index,
                "tag": tag,
                "old_start": i1 + 1,
                "old_count": max(0, i2 - i1),
                "new_start": j1 + 1,
                "new_count": max(0, j2 - j1),
                "summary": _summarize_hunk(tag, i2 - i1, j2 - j1),
                "preview_old": preview_old[:1800],
                "preview_new": preview_new[:1800],
            }
        )
        op_index += 1

    return {
        "path": path,
        "base_hash": _sha256_text(original),
        "target_hash": _sha256_text(target),
        "unified_diff": _unified_diff(path, original, target),
        "hunks": hunks,
        "opcodes": opcodes,
        "target_content": target,
    }


def build_patch_preview(files: list[dict[str, Any]]) -> dict[str, Any]:
    patch_files: list[dict[str, Any]] = []
    changed_files = 0
    changed_hunks = 0

    for row in files:
        path = _normalize_rel_path(str(row.get("path") or ""))
        original = str(row.get("original_content") or "")
        target = str(row.get("target_content") or "")
        file_patch = _build_file_patch(path, original, target)
        if file_patch["hunks"]:
            changed_files += 1
            changed_hunks += len(file_patch["hunks"])
        patch_files.append(file_patch)

    return {
        "files": patch_files,
        "changed_files": changed_files,
        "changed_hunks": changed_hunks,
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
    }


def _apply_selected_hunks(current: str, target: str, opcodes: list[list[Any]], selected_op_indices: set[int]) -> str:
    current_lines = current.splitlines(keepends=True)
    target_lines = target.splitlines(keepends=True)

    out_lines: list[str] = []
    for idx, op in enumerate(opcodes):
        try:
            tag, i1, i2, j1, j2 = op
        except Exception:
            continue
        if tag == "equal":
            out_lines.extend(current_lines[i1:i2])
            continue
        if idx in selected_op_indices:
            out_lines.extend(target_lines[j1:j2])
        else:
            out_lines.extend(current_lines[i1:i2])
    return "".join(out_lines)


async def apply_patch(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    patch: dict[str, Any],
    selection: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    logger.info(
        "workspace.patch_apply.start project=%s branch=%s chat=%s files=%s selections=%s",
        project_id,
        branch,
        chat_id or "",
        len((patch or {}).get("files") or []),
        len(selection or []),
    )
    files = patch.get("files") if isinstance(patch, dict) else None
    if not isinstance(files, list) or not files:
        raise WorkspaceError("Patch payload has no files")

    selection_map: dict[str, set[int]] = {}
    for row in selection or []:
        if not isinstance(row, dict):
            continue
        path = str(row.get("file") or row.get("path") or "").strip()
        if not path:
            continue
        ids_raw = row.get("hunk_ids") if isinstance(row.get("hunk_ids"), list) else []
        ids: set[int] = set()
        for h in ids_raw:
            try:
                ids.add(int(h))
            except Exception:
                continue
        selection_map[_normalize_rel_path(path)] = ids

    applied: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for file_patch in files:
        if not isinstance(file_patch, dict):
            continue
        path = _normalize_rel_path(str(file_patch.get("path") or ""))
        target_content = str(file_patch.get("target_content") or "")
        base_hash = str(file_patch.get("base_hash") or "").strip()
        opcodes = file_patch.get("opcodes") if isinstance(file_patch.get("opcodes"), list) else []
        hunks = file_patch.get("hunks") if isinstance(file_patch.get("hunks"), list) else []

        loaded = await read_file(
            project_id=project_id,
            branch=branch,
            user_id=user_id,
            chat_id=chat_id,
            path=path,
            max_chars=max(len(target_content) + 3000, MAX_DEFAULT_FILE_CHARS),
        )
        current_content = str(loaded.get("content") or "")
        current_hash = str(loaded.get("content_hash") or "")

        if base_hash and current_hash and base_hash != current_hash:
            conflicts.append({
                "path": path,
                "reason": "hash_mismatch",
                "current_hash": current_hash,
                "expected_hash": base_hash,
            })
            continue

        selected_hunks = selection_map.get(path)
        next_content = target_content
        if selected_hunks is not None:
            op_indices: set[int] = set()
            for h in hunks:
                if not isinstance(h, dict):
                    continue
                try:
                    h_id = int(h.get("id"))
                except Exception:
                    continue
                if h_id in selected_hunks:
                    try:
                        op_indices.add(int(h.get("op_index")))
                    except Exception:
                        continue
            next_content = _apply_selected_hunks(current_content, target_content, opcodes, op_indices)

        try:
            write_out = await write_file(
                project_id=project_id,
                branch=branch,
                user_id=user_id,
                chat_id=chat_id,
                path=path,
                content=next_content,
                expected_hash=current_hash or None,
            )
            applied.append(
                {
                    "path": path,
                    "content_hash": write_out.get("content_hash"),
                    "bytes_written": write_out.get("bytes_written"),
                    "mode": write_out.get("mode"),
                }
            )
        except Exception as err:
            conflicts.append({"path": path, "reason": "write_failed", "detail": str(err)})

    out = {
        "applied": applied,
        "conflicts": conflicts,
        "applied_count": len(applied),
        "conflict_count": len(conflicts),
        "ok": len(conflicts) == 0,
    }
    logger.info(
        "workspace.patch_apply.done project=%s branch=%s chat=%s applied=%s conflicts=%s",
        project_id,
        branch,
        chat_id or "",
        len(applied),
        len(conflicts),
    )
    return out


def _llm_base_url(base: str | None) -> str:
    root = (base or settings.LLM_BASE_URL or "http://ollama:11434").rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    return root + "/v1/"


def _extract_json_obj(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None

    if raw.startswith("```"):
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, flags=re.IGNORECASE)
        if m:
            raw = m.group(1).strip()

    if raw.startswith("{") and raw.endswith("}"):
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else None
        except Exception:
            pass

    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            obj = json.loads(match.group(0))
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None
    return None


def _llm_chat_once(
    *,
    messages: list[dict[str, str]],
    llm_base_url: str | None,
    llm_api_key: str | None,
    llm_model: str | None,
    max_tokens: int = 1400,
) -> str:
    endpoint = urljoin(_llm_base_url(llm_base_url), "chat/completions")
    payload = {
        "model": llm_model or settings.LLM_MODEL or "llama3.2:3b",
        "messages": messages,
        "temperature": 0.12,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.post(endpoint, json=payload, headers=headers, timeout=180)
        except requests.RequestException as err:
            if attempt < max_attempts:
                continue
            raise WorkspaceError(f"Could not reach LLM endpoint: {err}") from err

        if resp.status_code == 429:
            detail = ""
            try:
                body = resp.json() or {}
                detail = str((body.get("error") or {}).get("message") or "")
            except Exception:
                detail = resp.text[:400]
            raise WorkspaceError(f"LLM provider rate limited (429). {detail}".strip())

        try:
            resp.raise_for_status()
        except requests.HTTPError as err:
            detail = ""
            try:
                body = resp.json() or {}
                detail = str((body.get("error") or {}).get("message") or "")
            except Exception:
                detail = resp.text[:400]
            raise WorkspaceError(f"LLM request failed ({resp.status_code}). {detail}".strip()) from err

        body = resp.json() or {}
        return str((((body.get("choices") or [{}])[0]).get("message") or {}).get("content") or "")

    raise WorkspaceError("LLM request failed")


def _trim_context_files(files: list[dict[str, Any]], max_chars: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    used = 0
    for row in files:
        path = str(row.get("path") or "").strip()
        content = str(row.get("content") or "")
        if not path:
            continue
        if len(content) > 60_000:
            content = content[:60_000] + "\n... (truncated)\n"
        block_len = len(path) + len(content) + 32
        if out and used + block_len > max_chars:
            break
        used += block_len
        out.append({"path": path, "content": content})
        if len(out) >= MAX_SUGGEST_FILE_COUNT:
            break
    return out


async def suggest_patch(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    chat_id: str | None,
    primary_path: str,
    paths: list[str],
    intent: str | None,
    selected_text: str | None,
    llm_profile_id: str | None = None,
    max_context_chars: int = MAX_SUGGEST_CONTEXT_CHARS,
) -> dict[str, Any]:
    logger.info(
        "workspace.suggest.start project=%s branch=%s chat=%s primary=%s candidate_paths=%s",
        project_id,
        branch,
        chat_id or "",
        primary_path,
        len(paths or []),
    )
    project = await _project_doc(project_id)
    pid = str(project.get("_id") or project_id)
    safe_branch = str(branch or project.get("default_branch") or "main").strip() or "main"
    safe_primary = _normalize_rel_path(primary_path)

    chosen_paths: list[str] = []
    seen: set[str] = set()
    for raw in [safe_primary, *(paths or [])]:
        try:
            p = _normalize_rel_path(raw)
        except Exception:
            continue
        if p in seen:
            continue
        seen.add(p)
        chosen_paths.append(p)
        if len(chosen_paths) >= MAX_SUGGEST_FILE_COUNT:
            break

    files_ctx: list[dict[str, Any]] = []
    for p in chosen_paths:
        try:
            file_doc = await read_file(
                project_id=pid,
                branch=safe_branch,
                user_id=user_id,
                chat_id=chat_id,
                path=p,
                max_chars=80_000,
            )
            files_ctx.append({"path": p, "content": str(file_doc.get("content") or "")})
        except Exception:
            continue

    if not files_ctx:
        raise WorkspaceError("No readable files are available for suggestion")

    files_ctx = _trim_context_files(files_ctx, max(20_000, min(int(max_context_chars or MAX_SUGGEST_CONTEXT_CHARS), 220_000)))

    llm_cfg = await resolve_project_llm_config(project, override_profile_id=(llm_profile_id or None))
    llm_base = str(llm_cfg.get("llm_base_url") or "").strip() or None
    llm_api_key = str(llm_cfg.get("llm_api_key") or "").strip() or None
    llm_model = str(llm_cfg.get("llm_model") or "").strip() or None

    context_lines = []
    for row in files_ctx:
        context_lines.append(f"FILE: {row['path']}\n```\n{row['content']}\n```")

    user_intent = str(intent or "").strip() or "Improve the code quality and keep behavior stable unless explicitly asked otherwise."
    selected = str(selected_text or "").strip()

    system_prompt = (
        "You are a precise code editing assistant. "
        "Return ONLY a valid JSON object with this schema:\n"
        "{\n"
        "  \"summary\": string,\n"
        "  \"files\": [\n"
        "    { \"path\": string, \"content\": string }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Include the primary file in files.\n"
        "- content must be full file content, not a diff.\n"
        "- Do not include markdown fences or explanations outside JSON.\n"
        "- Keep edits minimal and consistent with the intent.\n"
    )

    user_prompt = (
        f"project_id={pid}\n"
        f"branch={safe_branch}\n"
        f"primary_path={safe_primary}\n"
        f"intent={user_intent}\n"
        f"selected_text={selected or '<none>'}\n\n"
        "Repository context:\n"
        + "\n\n".join(context_lines)
    )

    llm_text = _llm_chat_once(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        llm_base_url=llm_base,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        max_tokens=1800,
    )

    payload = _extract_json_obj(llm_text)
    if not payload:
        raise WorkspaceError("LLM returned an invalid suggestion payload")

    suggested_files_raw = payload.get("files") if isinstance(payload.get("files"), list) else []
    suggested_files: list[dict[str, str]] = []
    for row in suggested_files_raw:
        if not isinstance(row, dict):
            continue
        try:
            p = _normalize_rel_path(str(row.get("path") or ""))
        except Exception:
            continue
        content = str(row.get("content") or "")
        suggested_files.append({"path": p, "content": content})

    if not suggested_files:
        raise WorkspaceError("LLM suggestion contained no files")

    if not any(row["path"] == safe_primary for row in suggested_files):
        for row in files_ctx:
            if row["path"] == safe_primary:
                suggested_files.insert(0, {"path": safe_primary, "content": row["content"]})
                break

    patch_input: list[dict[str, Any]] = []
    for item in suggested_files:
        original = ""
        for row in files_ctx:
            if row["path"] == item["path"]:
                original = row["content"]
                break
        if not original:
            try:
                read_out = await read_file(
                    project_id=pid,
                    branch=safe_branch,
                    user_id=user_id,
                    chat_id=chat_id,
                    path=item["path"],
                    max_chars=120_000,
                )
                original = str(read_out.get("content") or "")
            except Exception:
                original = ""

        patch_input.append(
            {
                "path": item["path"],
                "original_content": original,
                "target_content": item["content"],
            }
        )

    patch_preview = build_patch_preview(patch_input)

    out = {
        "project_id": pid,
        "branch": safe_branch,
        "summary": str(payload.get("summary") or "Suggested patch generated."),
        "suggestion": {
            "files": suggested_files,
            "raw": payload,
        },
        "patch": patch_preview,
    }
    logger.info(
        "workspace.suggest.done project=%s branch=%s chat=%s files=%s changed_files=%s changed_hunks=%s",
        pid,
        safe_branch,
        chat_id or "",
        len(suggested_files),
        int((patch_preview or {}).get("changed_files") or 0),
        int((patch_preview or {}).get("changed_hunks") or 0),
    )
    return out
