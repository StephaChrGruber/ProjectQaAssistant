from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests

from ..settings import settings
from .tool_runtime import ToolContext, ToolRuntime, build_default_tool_runtime

logger = logging.getLogger(__name__)


class LLMUpstreamError(RuntimeError):
    pass


_RUNTIME: ToolRuntime = build_default_tool_runtime()


def _base(llm_base_url: str | None = None) -> str:
    base = (llm_base_url or settings.LLM_BASE_URL or "http://ollama:11434").rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + "/v1/"


def _policy_hint(policy: dict[str, Any] | None) -> str:
    p = policy or {}
    if not isinstance(p, dict) or not p:
        return ""
    allowed = p.get("allowed_tools") or p.get("allow_tools") or []
    blocked = p.get("blocked_tools") or p.get("deny_tools") or []
    read_only_only = bool(p.get("read_only_only"))
    lines: list[str] = ["Tool policy:"]
    if isinstance(allowed, list) and allowed:
        lines.append(f"- allowed_tools = {', '.join(str(x) for x in allowed)}")
    if isinstance(blocked, list) and blocked:
        lines.append(f"- blocked_tools = {', '.join(str(x) for x in blocked)}")
    if read_only_only:
        lines.append("- read_only_only = true")
    if len(lines) == 1:
        return ""
    return "\n".join(lines) + "\n\n"


def _system_prompt(project_id: str, branch: str, user_id: str, runtime: ToolRuntime, policy: dict[str, Any] | None) -> str:
    tool_schema = runtime.schema_text()
    policy_text = _policy_hint(policy)
    return (
        "You are an onboarding + developer assistant for a codebase.\n"
        f"Context:\n"
        f"- project_id = {project_id}\n"
        f"- branch = {branch}\n"
        f"- user = {user_id}\n\n"
        f"{policy_text}"
        "When you need tools, reply with EXACTLY one JSON object (no markdown, no extra text):\n"
        "{\n"
        '  "tool": "<tool_name>",\n'
        '  "args": { ... }\n'
        "}\n\n"
        "IMPORTANT:\n"
        "- Use only tools listed below.\n"
        "- Only include tool args that exist in that tool schema.\n"
        "- Do not invent arguments.\n"
        "- Prefer tools over guessing.\n"
        "- Gather concrete evidence from tools before answering.\n"
        "- If branch comparison is requested, use compare_branches.\n"
        "- If asked to update docs in repository, call generate_project_docs.\n"
        "- If user asks for a chart/graph/visualization, return a ```chart fenced JSON block using this schema:\n"
        '  {"type":"line|bar","title":"...","xKey":"...","series":[{"key":"...","label":"...","color":"#0088FE"}],"data":[{"x":"...","metric":123}]}\n'
        "- Always cite file paths + line numbers when explaining code.\n"
        "- After TOOL_RESULT, continue reasoning.\n"
        "- If enough info is available, answer in normal text (NOT JSON).\n\n"
        "AVAILABLE TOOLS\n"
        "────────────────────────────────\n"
        f"{tool_schema}"
    )


def _try_parse_tool_call(text: str, runtime: ToolRuntime) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    s = text.strip()
    if not (s.startswith("{") and s.endswith("}")):
        return None
    try:
        obj = json.loads(s)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None

    tool = obj.get("tool")
    args = obj.get("args", {})
    if not isinstance(tool, str) or not runtime.has_tool(tool):
        return None
    if not isinstance(args, dict):
        return None
    return {"tool": tool, "args": args}


def _llm_chat_nostream(
    messages: List[Dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
    llm_base_url: str | None = None,
    llm_api_key: str | None = None,
    llm_model: str | None = None,
) -> str:
    endpoint = urljoin(_base(llm_base_url), "chat/completions")
    payload = {
        "model": llm_model or settings.LLM_MODEL or "llama3.2:3b",
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }

    headers = {"Content-Type": "application/json"}
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.post(
                endpoint,
                json=payload,
                headers=headers,
                timeout=300,
            )
        except requests.RequestException as err:
            if attempt < max_attempts:
                time.sleep(1.5 * attempt)
                continue
            raise LLMUpstreamError(f"Could not reach LLM endpoint: {err}") from err

        if r.status_code == 429:
            retry_after_raw = r.headers.get("retry-after")
            retry_after = 0.0
            if retry_after_raw:
                try:
                    retry_after = float(retry_after_raw)
                except ValueError:
                    retry_after = 0.0

            if attempt < max_attempts:
                time.sleep(max(retry_after, 1.5 * attempt))
                continue

            detail = ""
            err_code = ""
            try:
                body = r.json()
                err = body.get("error") or {}
                detail = err.get("message") or ""
                err_code = err.get("code") or err.get("type") or ""
            except Exception:
                detail = r.text[:500]
                err_code = ""
            if err_code:
                detail = f"{detail} (code={err_code})".strip()
            raise LLMUpstreamError(
                f"LLM provider rate limited (429). {detail}".strip()
            )

        if r.status_code >= 500 and attempt < max_attempts:
            time.sleep(1.5 * attempt)
            continue

        try:
            r.raise_for_status()
        except requests.HTTPError as err:
            detail = ""
            try:
                body = r.json()
                detail = (body.get("error") or {}).get("message") or ""
            except Exception:
                detail = r.text[:500]
            raise LLMUpstreamError(
                f"LLM request failed ({r.status_code}). {detail}".strip()
            ) from err

        data = r.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""

    raise LLMUpstreamError("LLM request failed after retries.")


class Agent2:
    def __init__(
        self,
        project_id: str,
        branch: str,
        user_id: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 800,
        max_tool_calls: int = 12,
        llm_base_url: str | None = None,
        llm_api_key: str | None = None,
        llm_model: str | None = None,
        chat_id: str | None = None,
        tool_policy: dict[str, Any] | None = None,
        runtime: ToolRuntime | None = None,
    ):
        self.project_id = project_id
        self.branch = branch
        self.user_id = user_id
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_tool_calls = max_tool_calls
        self.llm_base_url = llm_base_url
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model
        self.chat_id = chat_id
        self.tool_policy = tool_policy or {}
        self.runtime = runtime or _RUNTIME

    async def run(self, user_text: str) -> dict[str, Any]:
        system_prompt = _system_prompt(self.project_id, self.branch, self.user_id, self.runtime, self.tool_policy)
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        tool_calls = 0
        tool_events: list[dict[str, Any]] = []

        while True:
            assistant_text = _llm_chat_nostream(
                messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                llm_base_url=self.llm_base_url,
                llm_api_key=self.llm_api_key,
                llm_model=self.llm_model,
            ).strip()

            logger.info("LLM raw assistant text: %r", assistant_text[:2000])

            tool_call = _try_parse_tool_call(assistant_text, self.runtime)
            if not tool_call:
                return {"answer": assistant_text, "tool_events": tool_events}

            tool_calls += 1
            if tool_calls > self.max_tool_calls:
                return {
                    "answer": (
                        "I made too many tool calls without reaching a final answer. "
                        "Please narrow the question or increase max_tool_calls."
                    ),
                    "tool_events": tool_events,
                }

            tool_name = tool_call["tool"]
            model_args = dict(tool_call["args"] or {})
            ctx = ToolContext(
                project_id=self.project_id,
                branch=self.branch,
                user_id=self.user_id,
                chat_id=self.chat_id,
                policy=self.tool_policy,
            )

            logger.info("tool.execute.request tool=%s args=%s", tool_name, model_args)
            envelope = await self.runtime.execute(tool_name, model_args, ctx)
            envelope_data = envelope.model_dump()
            tool_events.append(envelope_data)

            messages.append({"role": "assistant", "content": assistant_text})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"TOOL_RESULT {tool_name}:\n"
                        f"{json.dumps(envelope_data, ensure_ascii=False, indent=2)}\n"
                    ),
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Continue using TOOL_RESULT above. "
                        "If enough information is available, answer the original question now in normal text (no JSON). "
                        "Otherwise call the next tool as JSON."
                    ),
                }
            )


async def answer_with_agent(
    *,
    project_id: str,
    branch: str,
    user_id: str,
    question: str,
    temperature: float = 0.1,
    max_tokens: int = 800,
    llm_base_url: str | None = None,
    llm_api_key: str | None = None,
    llm_model: str | None = None,
    chat_id: str | None = None,
    tool_policy: dict[str, Any] | None = None,
    max_tool_calls: int = 12,
    include_tool_events: bool = False,
    runtime: ToolRuntime | None = None,
) -> Any:
    agent = Agent2(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        temperature=temperature,
        max_tokens=max_tokens,
        max_tool_calls=max(1, min(max_tool_calls, 80)),
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        chat_id=chat_id,
        tool_policy=tool_policy,
        runtime=runtime,
    )
    out = await agent.run(question)
    if include_tool_events:
        return out
    return out.get("answer") or ""
