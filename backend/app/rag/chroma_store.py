import os
import chromadb
from sentence_transformers import SentenceTransformer
import logging

logger = logging.getLogger(__name__)

_embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

def _collection(chroma_root: str, project_key: str, collection_name: str = "docs"):
    path = os.path.join(chroma_root, project_key)
    client = chromadb.PersistentClient(path=path)
    logger.info(f"Path: {path}, ChromaRoot: {chroma_root}, ProjectKey: {project_key}, CollectionName: {collection_name}")
    return client.get_or_create_collection(name=collection_name)

def upsert_chunks(chroma_root: str, project_key: str, chunks: list[dict]):
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
    embs = _embedder.encode(docs).tolist()

    col.upsert(ids=ids, documents=docs, metadatas=metas, embeddings=embs)
    return len(ids)
