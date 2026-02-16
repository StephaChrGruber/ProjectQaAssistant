# app/app/rag/llm.py
import json
import requests
from urllib.parse import urljoin

from ..settings import settings
import logging

logger = logging.getLogger(__name__)

def _base() -> str:
    """
    Normalize LLM_BASE_URL so it ends with exactly one '/v1/'.
    Accepts:
      - http://ollama:11434
      - http://ollama:11434/
      - http://ollama:11434/v1
      - http://ollama:11434/v1/
    Returns:
      - http://ollama:11434/v1/
    """
    base = (settings.LLM_BASE_URL or "http://ollama:11434").rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + "/v1/"


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


def chat(messages, temperature=0.1, max_tokens=350) -> str:
    endpoint = urljoin(_base(), "chat/completions")  # <-- NO double /v1
    payload = {
        "model": settings.LLM_MODEL or "llama3.2:3b",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    logger.info("LLM endpoint: %s", endpoint)
    logger.info("LLM model: %s", payload["model"])
    logger.info("LLM messages: %s", json.dumps(messages, ensure_ascii=False)[:4000])
    with requests.post(
            endpoint,
            json=payload,  # use json=, not data=json.dumps
            headers={"Content-Type": "application/json"},
            stream=True,
            timeout=300,
    ) as r:
        r.raise_for_status()
        logger.info("Raw response text: %s", r.text[:5000])

        out = []
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data:"):
                data = line.split("data:", 1)[1].strip()
                if data == "[DONE]":
                    break

                chunk = json.loads(data)
                choice = (chunk.get("choices") or [{}])[0]

                delta = choice.get("delta") or {}
                content = delta.get("content")

                # log every chunk once while debugging
                logger.info("chunk finish=%s delta=%s", choice.get("finish_reason"), delta)

                # append even empty strings only if you want (debug)
                if content is not None:
                    out.append(content)


class LLM:
    def __init__(self):
        if not is_configured():
            raise RuntimeError("LLM not configured (LLM_BASE_URL / LLM_MODEL missing)")

    def chat(self, messages, temperature=0.1, max_tokens=350) -> str:
        return chat(messages, temperature=temperature, max_tokens=max_tokens)
