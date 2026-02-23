import os
import chromadb
from sentence_transformers import SentenceTransformer
from . import llm

_embedder: SentenceTransformer | None = None
_EMBEDDER_MODEL = os.getenv("EMBEDDER_MODEL", "sentence-transformers/all-MiniLM-L6-v2")


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(_EMBEDDER_MODEL)
    return _embedder

def _collection_for_project(chroma_root: str, project_key: str, collection_name: str = "docs"):
    path = os.path.join(chroma_root, project_key)
    client = chromadb.PersistentClient(path=path)
    return client.get_or_create_collection(name=collection_name)

def retrieve(project_key: str, chroma_root: str, question: str, k: int = 6):
    col = _collection_for_project(chroma_root, project_key)
    q_emb = _get_embedder().encode([question]).tolist()[0]
    res = col.query(
        query_embeddings=[q_emb],
        n_results=k,
        include=["documents", "metadatas", "distances"],
    )
    items = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        items.append({
            "text": doc,
            "source": meta.get("source"),
            "title": meta.get("title"),
            "url": meta.get("url"),
            "distance": dist,
        })
    return items

def answer(project_key: str, chroma_root: str, question: str, k: int = 6):
    ctx = retrieve(project_key, chroma_root, question, k)

    # If no LLM configured, return sources only
    if not llm.is_configured():
        return {
            "answer": "LLM not configured. Here are the most relevant sources I found:",
            "sources": [{"n": i+1, "title": c["title"], "url": c["url"], "source": c["source"]} for i, c in enumerate(ctx)],
        }

    prompt = llm.build_cited_prompt(question, ctx)
    try:
        text = llm.chat(prompt)
    except Exception as e:
        text = f"LLM error (likely model not loaded): {e}\n\nHere are the most relevant sources:"

    return {
        "answer": text,
        "sources": [{"n": i+1, "title": c["title"], "url": c["url"], "source": c["source"]} for i, c in enumerate(ctx)],
    }
