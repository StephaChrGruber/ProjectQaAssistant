from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from . import llm
from .tools import search_chunks, open_chunks


SYSTEM = """You are a project assistant.
You do NOT get the full project database. Instead you must use tools.

You can use these tools:
1) search: semantic search across the project knowledge base
2) open: open one or more chunks by id (to read more detail)

RULES:
- Use tools as needed. Do NOT guess.
- Keep tool usage minimal: usually 1-3 searches, then open 1-2 chunks.
- When you answer, include citations with chunk IDs in square brackets, e.g. [ch_abc123].
- If you cannot find information after a few searches, say so.

OUTPUT FORMAT (IMPORTANT):
You MUST respond with exactly ONE JSON object and nothing else.

If you want to call a tool:
{"tool":"search","args":{"query":"...","topK":6}}
{"tool":"open","args":{"ids":["...","..."],"maxChars":2000}}

If you want to provide a final answer:
{"final":{"answer":"...","citations":["chunk_id_1","chunk_id_2"]}}
"""


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    # Remove ```json ... ``` or ``` ... ```
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _parse_json_obj(text: str) -> Dict[str, Any]:
    """
    Strict: must be a JSON object.
    """
    cleaned = _strip_code_fences(text)
    obj = json.loads(cleaned)
    if not isinstance(obj, dict):
        raise ValueError("LLM output must be a JSON object")
    return obj


def answer_with_agent(
        project_key: str,
        question: str,
        *,
        max_steps: int = 3,
        top_k_default: int = 4,
) -> Dict[str, Any]:
    """
    Agent loop:
    - model requests tool calls
    - backend executes
    - model answers with citations
    """
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": question},
    ]

    # Track chunks we opened so we can return "Sources" to UI
    opened_by_id: Dict[str, Dict[str, Any]] = {}

    for step in range(max_steps):
        # Keep responses short-ish to reduce timeouts
        raw = llm.chat(messages, temperature=0.1, max_tokens=350)

        try:
            obj = _parse_json_obj(raw)
        except Exception as e:
            # If the model violates format, force it back into protocol once
            messages.append({"role": "assistant", "content": raw})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your last message was not valid JSON. "
                        "Return exactly one JSON object in the required format."
                    ),
                }
            )
            continue

        # Final answer
        if "final" in obj:
            final = obj.get("final") or {}

            raw_answer = final.get("answer", "")
            # Some models may return answer as a list of strings/paragraphs
            if isinstance(raw_answer, list):
                raw_answer = "\n".join(str(x) for x in raw_answer)
            elif raw_answer is None:
                raw_answer = ""
            else:
                raw_answer = str(raw_answer)

            answer = raw_answer.strip()

            raw_citations = final.get("citations") or []
            if isinstance(raw_citations, str):
                citations = [raw_citations]
            elif isinstance(raw_citations, list):
                citations = [str(x) for x in raw_citations]
            else:
                citations = []

            # Build sources list for the UI from opened chunks (fallback: empty)
            sources = []
            for cid in citations:
                if cid in opened_by_id:
                    sources.append(opened_by_id[cid])
            # If model didn't cite, still return whatever it opened
            if not sources and opened_by_id:
                sources = list(opened_by_id.values())[:8]

            return {
                "answer": answer,
                "sources": sources,
                "agent": {"steps": step + 1},
            }

        # Tool call
        tool = obj.get("tool")
        args = obj.get("args") or {}

        if tool == "search":
            query = (args.get("query") or "").strip()
            if not query:
                query = question
            top_k = int(args.get("topK") or top_k_default)

            result = search_chunks(project_key, query, top_k=top_k)
            messages.append({"role": "assistant", "content": json.dumps(obj)})
            messages.append({"role": "tool", "name": "search", "content": json.dumps(result)})

        elif tool == "open":
            ids = args.get("ids") or []
            if isinstance(ids, str):
                ids = [ids]
            ids = [str(x) for x in ids][:2]  # safety cap
            max_chars = int(args.get("maxChars") or 800)

            result = open_chunks(project_key, ids, max_chars_per_chunk=max_chars)
            # Track for later citations/UI
            for it in result.get("items", []):
                opened_by_id[it["id"]] = it

            messages.append({"role": "assistant", "content": json.dumps(obj)})
            messages.append({"role": "tool", "name": "open", "content": json.dumps(result)})

        else:
            # Unknown tool -> instruct and continue
            messages.append({"role": "assistant", "content": json.dumps(obj)})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Unknown tool. Use only: search or open. "
                        "Return a valid tool JSON or a final answer JSON."
                    ),
                }
            )

    # Step limit reached
    sources = list(opened_by_id.values())[:8]
    return {
        "answer": "I couldn't find enough information in the knowledge base to answer that confidently.",
        "sources": sources,
        "agent": {"steps": max_steps, "stopped": "max_steps"},
    }
