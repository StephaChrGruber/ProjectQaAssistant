from __future__ import annotations

from typing import Any, Dict, List, Optional
import chromadb
from ..settings import settings


COLLECTION_NAME = "docs"


def _client_for(project_key: str) -> chromadb.PersistentClient:
    # Each project has its own persisted Chroma folder
    path = f"{settings.CHROMA_ROOT.rstrip('/')}/{project_key}"
    return chromadb.PersistentClient(path=path)


def chroma_count(project_key: str) -> int:
    client = _client_for(project_key)
    col = client.get_or_create_collection(COLLECTION_NAME)
    return col.count()


def search_chunks(
        project_key: str,
        query: str,
        top_k: int = 6,
        max_snippet_chars: int = 350,
) -> Dict[str, Any]:
    """
    Returns small snippets only (keeps context small).
    """
    client = _client_for(project_key)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.query(
        query_texts=[query],
        n_results=max(1, min(top_k, 20)),
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
                "snippet": text[:max_snippet_chars],
            }
        )

    return {"query": query, "items": items, "count": len(items)}


def open_chunks(
        project_key: str,
        ids: List[str],
        max_chars_per_chunk: int = 2000,
) -> Dict[str, Any]:
    """
    Opens the full chunk text (capped), with metadata for citations.
    """
    if not ids:
        return {"items": []}

    client = _client_for(project_key)
    col = client.get_or_create_collection(COLLECTION_NAME)

    res = col.get(
        ids=ids,
        include=["documents", "metadatas"],
    )

    out: List[Dict[str, Any]] = []
    got_ids = res.get("ids", []) or []
    docs = res.get("documents", []) or []
    metas = res.get("metadatas", []) or []

    for i in range(len(got_ids)):
        meta = metas[i] or {}
        text = (docs[i] or "")[:max_chars_per_chunk]
        out.append(
            {
                "id": got_ids[i],
                "title": meta.get("title") or meta.get("path") or "Untitled",
                "url": meta.get("url"),
                "source": meta.get("source"),
                "text": text,
            }
        )

    return {"items": out}
