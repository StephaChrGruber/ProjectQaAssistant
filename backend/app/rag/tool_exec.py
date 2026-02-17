from __future__ import annotations

import base64
import fnmatch
import logging
import os
import re
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
import httpx
from bson import ObjectId

from ..db import get_db
from ..models.tools import (
    ChromaCountRequest,
    ChromaCountResponse,
    ChromaOpenChunksRequest,
    ChromaOpenChunksResponse,
    ChromaSearchChunkResponse,
    ChromaSearchChunksRequest,
    GitDiffRequest,
    GitDiffResponse,
    GitLogItem,
    GitLogRequest,
    GitLogResponse,
    GitStatusRequest,
    GitStatusResponse,
    GrepMatch,
    KeywordHit,
    KeywordSearchRequest,
    KeywordSearchResponse,
    OpenFileRequest,
    OpenFileResponse,
    ProjectMetadataResponse,
    ReadChatMessagesRequest,
    ReadChatMessagesResponse,
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
    SymbolSearchHit,
    SymbolSearchRequest,
    SymbolSearchResponse,
)
from ..services.documentation import DocumentationError, generate_project_documentation
from ..settings import settings

logger = logging.getLogger(__name__)

COLLECTION_NAME = "docs"
IGNORE_PARTS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"}


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


def _limit_text(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars] + "\n... (truncated)\n", True


async def _project_doc(project_id: str) -> dict[str, Any]:
    db = get_db()
    if ObjectId.is_valid(project_id):
        q: dict[str, Any] = {"_id": ObjectId(project_id)}
    else:
        q = {"key": project_id}
    doc = await db["projects"].find_one(q)
    if not doc:
        raise KeyError(f"Project not found: {project_id}")
    return doc


async def _github_connector_config(project_id: str) -> Optional[dict]:
    db = get_db()
    connector = await db["connectors"].find_one(
        {"projectId": project_id, "type": "github", "isEnabled": True}
    )
    if not connector:
        return None
    config = connector.get("config") or {}
    required = ("owner", "repo", "token")
    if not all(str(config.get(k, "")).strip() for k in required):
        return None
    return config


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


async def generate_project_docs(project_id: str, branch: Optional[str] = None) -> dict:
    try:
        return await generate_project_documentation(project_id=project_id, branch=branch)
    except DocumentationError as err:
        raise RuntimeError(str(err)) from err


async def repo_grep(req: RepoGrepRequest) -> RepoGrepResponse:
    req.max_results = max(1, min(req.max_results, 500))
    req.context_lines = max(0, min(req.context_lines, 12))
    pat = _compile_search_pattern(req)

    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path) if meta.repo_path else None

    if not (root and root.exists()):
        gh = await _github_connector_config(req.project_id)
        if not gh:
            return RepoGrepResponse(matches=[])
        files = await _github_list_tree(gh, req.branch or str(gh.get("branch") or "main"))
        matches: list[GrepMatch] = []
        for rel in files:
            if not _glob_match(rel, req.glob):
                continue
            try:
                text, _ = await _github_open_file_content(gh, rel, ref=req.branch)
            except Exception:
                continue
            lines = text.splitlines()
            for idx, line in enumerate(lines, start=1):
                m = pat.search(line)
                if not m:
                    continue
                ctx = req.context_lines
                before = lines[max(0, idx - 1 - ctx) : idx - 1]
                after = lines[idx : min(len(lines), idx + ctx)]
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
            ctx = req.context_lines
            before = lines[max(0, idx - 1 - ctx) : idx - 1]
            after = lines[idx : min(len(lines), idx + ctx)]
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


async def open_file(req: OpenFileRequest) -> OpenFileResponse:
    req.max_chars = max(1000, min(req.max_chars, 400_000))
    meta = await get_project_metadata(req.project_id)

    root = Path(meta.repo_path) if meta.repo_path else None
    if root and root.exists():
        repo_path = str(root)
        current = _current_branch(repo_path)
        branch = (req.branch or "").strip()

        if req.ref:
            text = _read_file_from_branch(repo_path, req.ref, req.path, max_chars=req.max_chars)
            if not text:
                raise FileNotFoundError(f"File not found at ref: {req.ref}:{req.path}")
            s, e, sliced = _line_slice(text, req.start_line, req.end_line)
            return OpenFileResponse(path=req.path, ref=req.ref, start_line=s, end_line=e, content=sliced)

        if branch and branch != current and _branch_exists(repo_path, branch):
            text = _read_file_from_branch(repo_path, branch, req.path, max_chars=req.max_chars)
            if not text:
                raise FileNotFoundError(f"File not found at branch: {branch}:{req.path}")
            s, e, sliced = _line_slice(text, req.start_line, req.end_line)
            return OpenFileResponse(path=req.path, ref=branch, start_line=s, end_line=e, content=sliced)

        full = _safe_join_repo(repo_path, req.path)
        if not full.exists() or not full.is_file():
            raise FileNotFoundError(f"File not found: {req.path}")
        text = _read_text_file(full, req.max_chars)
        s, e, sliced = _line_slice(text, req.start_line, req.end_line)
        return OpenFileResponse(path=req.path, ref=None, start_line=s, end_line=e, content=sliced)

    gh = await _github_connector_config(req.project_id)
    if gh:
        text, _ = await _github_open_file_content(gh, req.path, ref=req.ref or req.branch)
        text, _ = _limit_text(text, req.max_chars)
        s, e, sliced = _line_slice(text, req.start_line, req.end_line)
        return OpenFileResponse(path=req.path, ref=req.ref or req.branch, start_line=s, end_line=e, content=sliced)

    raise FileNotFoundError(f"File not found and no GitHub connector available: {req.path}")


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


async def repo_tree(req: RepoTreeRequest) -> RepoTreeResponse:
    req.max_depth = max(1, min(req.max_depth, 12))
    req.max_entries = max(1, min(req.max_entries, 3000))

    meta = await get_project_metadata(req.project_id)
    branch = (req.branch or meta.default_branch or "main").strip() or "main"
    base_rel = req.path.strip("/")

    root = Path(meta.repo_path) if meta.repo_path else None
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
        gh = await _github_connector_config(req.project_id)
        if gh:
            files = await _github_list_tree(gh, branch)
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

    entries = sorted(entries, key=lambda e: (e.path.count("/"), e.path, e.type))[: req.max_entries]
    return RepoTreeResponse(root=base_rel or ".", branch=branch, entries=entries)


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

    current = _current_branch(repo_path)
    if req.branch and req.branch.strip() and req.branch.strip() != current:
        raise RuntimeError(
            f"Requested branch '{req.branch}' is not checked out locally (current: '{current}'). "
            "Switch local branch first or omit branch."
        )

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


async def read_docs_folder(req: ReadDocsFolderRequest) -> ReadDocsFolderResponse:
    req.max_files = max(1, min(req.max_files, 400))
    req.max_chars_per_file = max(100, min(req.max_chars_per_file, 20_000))

    meta = await get_project_metadata(req.project_id)
    branch = (req.branch or meta.default_branch or "main").strip() or "main"
    docs_root = req.path.strip("/") or "documentation"
    files: list[ReadDocsFile] = []

    root = Path(meta.repo_path) if meta.repo_path else None
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
        gh = await _github_connector_config(req.project_id)
        if gh:
            all_files = await _github_list_tree(gh, branch)
            md_files = [p for p in all_files if p.startswith(docs_root + "/") and p.lower().endswith(".md")]
            for rel in md_files[: req.max_files]:
                try:
                    text, _ = await _github_open_file_content(gh, rel, ref=branch)
                except Exception:
                    continue
                text, _ = _limit_text(text, req.max_chars_per_file)
                files.append(ReadDocsFile(path=rel, content=text))

    return ReadDocsFolderResponse(branch=branch, files=files)


async def read_chat_messages(req: ReadChatMessagesRequest) -> ReadChatMessagesResponse:
    req.limit = max(1, min(req.limit, 300))
    req.max_chars_per_message = max(100, min(req.max_chars_per_message, 20_000))

    db = get_db()
    q: dict[str, Any] = {"chat_id": req.chat_id, "project_id": req.project_id}
    if req.branch:
        q["branch"] = req.branch
    if req.user:
        q["user"] = req.user

    chat = await db["chats"].find_one(q, {"chat_id": 1, "messages": 1})
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
