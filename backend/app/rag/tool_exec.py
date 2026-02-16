from __future__ import annotations

import os
import re
import fnmatch
import base64
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
import httpx
from bson import ObjectId

from ..db import get_db
from ..settings import settings
from ..services.documentation import generate_project_documentation, DocumentationError

import logging

from ..models.tools import (
    RepoGrepRequest,
    RepoGrepResponse,
    GrepMatch,
    OpenFileRequest,
    OpenFileResponse,
    KeywordSearchRequest,
    KeywordSearchResponse,
    KeywordHit,
    ProjectMetadataResponse,
    ChromaCountRequest,
    ChromaCountResponse,
    ChromaSearchChunksRequest,
    ChromaSearchChunkResponse,
    ChromaOpenChunksRequest,
    ChromaOpenChunksResponse
)

logger = logging.getLogger(__name__)

# ----------------------------
# Mongo wiring (Motor)
# ----------------------------
# If you already have a shared mongo client helper, import it instead.
# Example:
#   from ..db.mongo import db
#
# Below is a minimal "best guess" that works in many FastAPI+Motor setups.

# ----------------------------
# Helpers
# ----------------------------

def _oid_str(x: Any) -> str:
    if isinstance(x, ObjectId):
        return str(x)
    return str(x)


def _safe_join_repo(repo_path: str, rel_path: str) -> Path:
    """
    Prevent path traversal outside repo.
    """
    root = Path(repo_path).resolve()
    p = (root / rel_path).resolve()
    if root not in p.parents and root != p:
        raise ValueError("Path escapes repo root")
    return p


def _read_text_file(p: Path, max_chars: int) -> str:
    data = p.read_text(encoding="utf-8", errors="replace")
    if len(data) > max_chars:
        data = data[:max_chars] + "\n... (truncated)\n"
    return data


def _line_slice(text: str, start_line: Optional[int], end_line: Optional[int]) -> tuple[int, int, str]:
    lines = text.splitlines()
    total = len(lines)
    s = max(1, start_line or 1)
    e = min(total, end_line or total)
    if e < s:
        e = s
    sliced = "\n".join(lines[s - 1 : e])
    return s, e, sliced


def _wanted(path: str, prefixes: list[str] | None) -> bool:
    if not prefixes:
        return True
    return any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes)


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


def _github_headers(token: str) -> dict:
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
        j = resp.json()
        if j.get("encoding") != "base64" or "content" not in j:
            raise ValueError(f"GitHub returned non-base64 content for {path}")
        raw = base64.b64decode(j["content"]).decode("utf-8", errors="replace")
        html_url = j.get("html_url") or f"https://github.com/{owner}/{repo}/blob/{branch}/{path}"
        return raw, html_url


async def _repo_grep_github(req: RepoGrepRequest, config: dict) -> RepoGrepResponse:
    owner = str(config.get("owner", "")).strip()
    repo = str(config.get("repo", "")).strip()
    token = str(config.get("token", "")).strip()
    branch = (req.branch or str(config.get("branch", "")).strip() or "main")
    prefixes = config.get("paths") if isinstance(config.get("paths"), list) else None
    headers = _github_headers(token)

    flags = 0 if req.case_sensitive else re.IGNORECASE
    pattern = re.compile(req.pattern if req.regex else re.escape(req.pattern), flags=flags)
    glob_pat = req.glob or "*"
    ctx = max(0, req.context_lines)
    matches: List[GrepMatch] = []
    seen_paths: set[str] = set()

    # GitHub code search doesn't support regex, but gives candidate files quickly.
    # We search by literal token, then apply regex/fixed matching locally per file content.
    literal_hint = req.pattern if not req.regex else re.sub(r"[^A-Za-z0-9_.:/-]", " ", req.pattern).strip()
    if not literal_hint:
        literal_hint = req.pattern
    query = f"{literal_hint} repo:{owner}/{repo}"

    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while len(matches) < req.max_results and page <= 3:
            res = await client.get(
                "https://api.github.com/search/code",
                headers=headers,
                params={"q": query, "per_page": 100, "page": page},
            )
            if res.status_code >= 400:
                break
            items = res.json().get("items") or []
            if not items:
                break

            for item in items:
                path = str(item.get("path") or "")
                if not path or path in seen_paths:
                    continue
                seen_paths.add(path)

                if prefixes and not _wanted(path, prefixes):
                    continue
                if req.glob and not fnmatch.fnmatch(path, glob_pat):
                    continue

                try:
                    text, _ = await _github_open_file_content(config, path, ref=branch)
                except Exception:
                    continue

                lines = text.splitlines()
                for i, line in enumerate(lines, start=1):
                    m = pattern.search(line)
                    if not m:
                        continue
                    before = lines[max(0, i - 1 - ctx): i - 1]
                    after = lines[i: min(len(lines), i + ctx)]
                    matches.append(
                        GrepMatch(
                            path=path,
                            line=i,
                            column=(m.start() + 1),
                            snippet=line[:500],
                            before=before,
                            after=after,
                        )
                    )
                    if len(matches) >= req.max_results:
                        return RepoGrepResponse(matches=matches)

            page += 1

    return RepoGrepResponse(matches=matches)


# ----------------------------
# Project metadata tool
# ----------------------------

async def get_project_metadata(project_id: str) -> ProjectMetadataResponse:
    """
    Looks up a project in Mongo.
    Expected minimal fields:
      - _id
      - repo_path
      - default_branch (optional)
      - key/name/extra (optional)
    Adjust collection name / field names to your schema.
    """
    db = get_db()
    logger.info(20)
    # ⚠️ Adjust if your collection is named differently
    projects = db["projects"]
    logger.info(20.1)
    # Accept either ObjectId or string key
    q: Dict[str, Any]
    if ObjectId.is_valid(project_id):
        logger.info(20.2)
        q = {"_id": ObjectId(project_id)}
    else:
        logger.info(20.3)
        # allow key lookup
        q = {"key": project_id}
    logger.info(20.4)
    doc = await projects.find_one(q)
    logger.info(20.5)
    if not doc:
        logger.info(20.6)
        raise KeyError(f"Project not found: {project_id}")
    logger.info(f"20.7: {doc}")
    return ProjectMetadataResponse(
        id=_oid_str(doc.get("_id")),
        key=doc.get("key"),
        name=doc.get("name"),
        repo_path=(doc.get("repo_path") or "").strip(),
        default_branch=doc.get("default_branch", "main"),
        extra=doc.get("extra", {}) or {},
    )


async def generate_project_docs(project_id: str, branch: Optional[str] = None) -> dict:
    """
    Scans the project repository and generates/updates markdown documentation files
    under `documentation/` at the repository root for the selected branch.
    """
    try:
        return await generate_project_documentation(project_id=project_id, branch=branch)
    except DocumentationError as err:
        return {"error": str(err)}


# ----------------------------
# repo_grep tool
# ----------------------------

async def repo_grep(req: RepoGrepRequest) -> RepoGrepResponse:
    """
    Greps through files under the project's repo_path.
    This is a simple implementation (fast enough for small repos; can be optimized).
    """
    meta = await get_project_metadata(req.project_id)
    root = Path(meta.repo_path) if meta.repo_path else None
    use_local = bool(root and root.exists())
    if not use_local:
        gh = await _github_connector_config(req.project_id)
        if gh:
            return await _repo_grep_github(req, gh)
        return RepoGrepResponse(matches=[])

    # Glob filtering (optional)
    glob_pat = req.glob or "**/*"

    # Compile pattern
    flags = 0 if req.case_sensitive else re.IGNORECASE
    if req.regex:
        pat = re.compile(req.pattern, flags=flags)
    else:
        # escape fixed string and search
        pat = re.compile(re.escape(req.pattern), flags=flags)

    matches: List[GrepMatch] = []
    ctx = max(0, req.context_lines)

    # Iterate files
    for p in root.glob(glob_pat):  # type: ignore[union-attr]
        if p.is_dir():
            continue

        # Basic ignore list (tweak as desired)
        if any(part in (".git", "node_modules", ".next", "dist", "build", ".venv") for part in p.parts):
            continue

        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        lines = text.splitlines()

        for i, line in enumerate(lines, start=1):
            m = pat.search(line)
            if not m:
                continue

            before = lines[max(0, i - 1 - ctx) : i - 1]
            after = lines[i : min(len(lines), i + ctx)]

            matches.append(
                GrepMatch(
                    path=str(p.relative_to(root)).replace("\\", "/"),
                    line=i,
                    column=(m.start() + 1),
                    snippet=line[:500],
                    before=before,
                    after=after,
                )
            )
            if len(matches) >= req.max_results:
                return RepoGrepResponse(matches=matches)

    return RepoGrepResponse(matches=matches)


# ----------------------------
# open_file tool
# ----------------------------

async def open_file(req: OpenFileRequest) -> OpenFileResponse:
    """
    Opens a file from repo_path. (ref/git show not implemented here)
    If you need `ref`, you can extend this using `git show {ref}:{path}`.
    """
    meta = await get_project_metadata(req.project_id)
    if meta.repo_path:
        full = _safe_join_repo(meta.repo_path, req.path)

        if full.exists() and full.is_file():
            text = _read_text_file(full, req.max_chars)
            start, end, sliced = _line_slice(text, req.start_line, req.end_line)
            return OpenFileResponse(
                path=req.path,
                ref=req.ref,
                start_line=start,
                end_line=end,
                content=sliced,
            )

    # Fallback to GitHub connector when local filesystem is not accessible.
    gh = await _github_connector_config(req.project_id)
    if gh:
        text, _ = await _github_open_file_content(gh, req.path, ref=req.ref)
        if len(text) > req.max_chars:
            text = text[:req.max_chars] + "\n... (truncated)\n"
        start, end, sliced = _line_slice(text, req.start_line, req.end_line)
        return OpenFileResponse(
            path=req.path,
            ref=req.ref,
            start_line=start,
            end_line=end,
            content=sliced,
        )

    raise FileNotFoundError(f"File not found and no GitHub connector available: {req.path}")


# ----------------------------
# keyword_search tool
# ----------------------------

async def keyword_search(req: KeywordSearchRequest) -> KeywordSearchResponse:
    """
    Very simple Mongo keyword search over an indexed 'chunks' collection.
    Assumes docs like:
      { project_id, branch, source, title, path, text, ... }
    You should add a text index on fields used.

    Adjust collection name / query shape to your ingestion pipeline.
    """
    db = get_db()

    # ⚠️ Adjust if your collection is named differently
    chunks = db["chunks"]

    q: Dict[str, Any] = {"project_id": req.project_id}

    if req.branch:
        q["branch"] = req.branch

    if req.source and req.source != "any":
        q["source"] = req.source

    # Use Mongo text search if you have it; otherwise fallback to regex
    # Recommended: create text index on {text:"text", title:"text", path:"text"}
    hits: List[KeywordHit] = []
    try:
        cursor = chunks.find(
            {**q, "$text": {"$search": req.query}},
            {"score": {"$meta": "textScore"}, "text": 1, "title": 1, "path": 1, "source": 1, "branch": 1},
        ).sort([("score", {"$meta": "textScore"})]).limit(req.top_k)

        async for d in cursor:
            preview = (d.get("text") or "")[:400]
            hits.append(
                KeywordHit(
                    id=_oid_str(d.get("_id")),
                    score=float(d.get("score") or 0.0),
                    path=d.get("path"),
                    title=d.get("title"),
                    source=d.get("source"),
                    branch=d.get("branch"),
                    preview=preview,
                )
            )
    except Exception:
        # Fallback for collections without text index.
        rx = re.compile(re.escape(req.query), re.IGNORECASE)
        cursor = chunks.find(
            {
                **q,
                "$or": [
                    {"text": {"$regex": rx}},
                    {"title": {"$regex": rx}},
                    {"path": {"$regex": rx}},
                ],
            },
            {"text": 1, "title": 1, "path": 1, "source": 1, "branch": 1},
        ).limit(req.top_k)
        async for d in cursor:
            preview = (d.get("text") or "")[:400]
            hits.append(
                KeywordHit(
                    id=_oid_str(d.get("_id")),
                    score=None,
                    path=d.get("path"),
                    title=d.get("title"),
                    source=d.get("source"),
                    branch=d.get("branch"),
                    preview=preview,
                )
            )

    return KeywordSearchResponse(hits=hits)

COLLECTION_NAME = "docs"

def _client_for(project_id: str) -> chromadb.PersistentClient:
    path = os.path.join(settings.CHROMA_ROOT, project_id)
    logger.info(f"Path: {path}, ChromaRoot: {settings.CHROMA_ROOT}, ProjectKey: {project_id}")
    return chromadb.PersistentClient(path=path)

async def chroma_count(req: ChromaCountRequest) -> ChromaCountResponse:
    client = _client_for(req.project_id)
    logger.info(f"Collections: {client.list_collections()}")
    col = client.get_or_create_collection(name=COLLECTION_NAME)
    logger.info(f"CollectionName: {COLLECTION_NAME}")
    return ChromaCountResponse(count=col.count())

async def chroma_search_chunks(req: ChromaSearchChunksRequest) -> ChromaSearchChunkResponse:
    client = _client_for(req.project_id)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.query(
        query_texts=[req.query],
        n_results=max(1, min(req.top_k, 1000)),
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
                "score": float(dists[i]) if i < len(dists) else None,  # lower is better in many setups
                "title": meta.get("title") or meta.get("path") or "Untitled",
                "url": meta.get("url"),
                "source": meta.get("source"),
                "snippet": text[:req.max_snippet_chars],
            }
        )

    return ChromaSearchChunkResponse(query=req.query, items=items, count=len(items))

async def chroma_open_chunks(req: ChromaOpenChunksRequest) -> ChromaOpenChunksResponse:
    if not req.ids:
        return ChromaOpenChunksResponse(result=[])

    client = _client_for(req.project_id)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.get(
        ids=req.ids,
        include=["documents", "metadatas"],
    )

    out: List[Dict[str, Any]] = []
    got_ids = res.get("ids", []) or []
    docs = res.get("documents", []) or []
    metas = res.get("metadatas", []) or []

    for i in range(len(got_ids)):
        meta = metas[i] or {}
        text = (docs[i] or "")[:req.max_chars_per_chunk]
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
