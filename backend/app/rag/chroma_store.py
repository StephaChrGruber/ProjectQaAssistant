import os
import chromadb
from sentence_transformers import SentenceTransformer
import logging
from typing import Any

logger = logging.getLogger(__name__)

_embedder: SentenceTransformer | None = None
_EMBEDDER_MODEL = os.getenv("EMBEDDER_MODEL", "sentence-transformers/all-MiniLM-L6-v2")


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        logger.info("chroma_store.embedder.load model=%s", _EMBEDDER_MODEL)
        _embedder = SentenceTransformer(_EMBEDDER_MODEL)
    return _embedder

def _collection(chroma_root: str, project_key: str, collection_name: str = "docs"):
    path = os.path.join(chroma_root, project_key)
    client = chromadb.PersistentClient(path=path)
    logger.info(f"Path: {path}, ChromaRoot: {chroma_root}, ProjectKey: {project_key}, CollectionName: {collection_name}")
    return client.get_or_create_collection(name=collection_name)

def upsert_chunks(chroma_root: str, project_key: str, chunks: list[dict[str, Any]]):
    """
    chunks item:
      {
        "id": "...",
        "text": "...",
        "metadata": {"source":"jira|confluence|github","title":"..","url":"..","doc_id":"..","chunk":0}
      }
    """
    col = _collection(chroma_root, project_key)

    ids = [c["id"] for c in chunks]
    docs = [c["text"] for c in chunks]
    metas = [c["metadata"] for c in chunks]
    embs = _get_embedder().encode(docs).tolist()

    col.upsert(ids=ids, documents=docs, metadatas=metas, embeddings=embs)
    return len(ids)
