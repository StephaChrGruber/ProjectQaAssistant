import json
import requests
from ..settings import settings

def is_configured() -> bool:
    return bool(settings.LLM_BASE_URL and settings.LLM_MODEL)

def build_cited_prompt(question: str, context_items: list[dict]) -> list[dict]:
    sources = []
    for i, it in enumerate(context_items, start=1):
        sources.append(
            f"[{i}] {it.get('title')} ({it.get('source')})\n"
            f"URL: {it.get('url')}\n"
            f"EXCERPT: {it.get('text')}\n"
        )

    system = (
        "You are a project Q&A assistant. Answer ONLY using the provided SOURCES.\n"
        "Rules:\n"
        "- If not supported by SOURCES, say you don't know.\n"
        "- Cite sources like [1] at the end of each sentence that uses them.\n"
        "- Be concise and actionable.\n"
    )
    user = f"QUESTION:\n{question}\n\nSOURCES:\n" + "\n".join(sources)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]

def chat(messages, temperature=0.1, max_tokens=600) -> str:
    base = settings.LLM_BASE_URL.rstrip("/")
    url = f"{base}/chat/completions"

    headers = {"Content-Type": "application/json"}
    # Ollama doesn't require a key, but accepts it
    if settings.LLM_API_KEY:
        headers["Authorization"] = f"Bearer {settings.LLM_API_KEY}"

    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }

    r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=120)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]
