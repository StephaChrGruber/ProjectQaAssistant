from __future__ import annotations

import json
import logging
import re
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

_DISCOVERY_TOOLS = {"list_tools", "search_tools", "get_tool_details"}


def _as_text(v: Any) -> str:
    return str(v or "").strip()


def _normalize_question_key(question: str) -> str:
    text = _as_text(question).lower()
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[^a-z0-9 _:/?.,()-]", "", text)
    return text[:220]


def _interaction_hint(policy: dict[str, Any] | None) -> str:
    p = policy or {}
    if not isinstance(p, dict) or not p:
        return ""
    lines: list[str] = ["Clarification policy for this turn:"]
    goal_id = _as_text(p.get("goal_id"))
    if goal_id:
        lines.append(f"- goal_id = {goal_id}")
    try:
        remaining = int(p.get("clarification_budget_remaining"))
    except Exception:
        remaining = -1
    if remaining >= 0:
        lines.append(f"- clarification_budget_remaining = {remaining}")
    if bool(p.get("continue_mode")):
        lines.append("- continue_mode = true (proceed with assumptions unless destructive action is needed)")
    if bool(p.get("disable_request_user_input")):
        lines.append(f"- request_user_input is disabled for this turn ({_as_text(p.get('disable_reason')) or 'policy'})")
    if bool(p.get("conflict_signal")):
        lines.append("- conflict_signal = true (repeat clarification may be allowed)")
    if len(lines) == 1:
        return ""
    return "\n".join(lines) + "\n\n"


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


def _system_prompt(
    project_id: str,
    branch: str,
    user_id: str,
    runtime: ToolRuntime,
    policy: dict[str, Any] | None,
    interaction_policy: dict[str, Any] | None = None,
) -> str:
    policy_text = _policy_hint(policy)
    interaction_text = _interaction_hint(interaction_policy)
    return (
        "You are an onboarding + developer assistant for a codebase.\n"
        f"Context:\n"
        f"- project_id = {project_id}\n"
        f"- branch = {branch}\n"
        f"- user = {user_id}\n\n"
        f"{policy_text}"
        f"{interaction_text}"
        "When you need tools, reply with EXACTLY one JSON object (no markdown, no extra text):\n"
        "{\n"
        '  "tool": "<tool_name>",\n'
        '  "args": { ... }\n'
        "}\n\n"
        "IMPORTANT:\n"
        "- Use only tools listed below or returned by list_tools.\n"
        "- Only include tool args that exist in tool details from get_tool_details.\n"
        "- Do not invent arguments.\n"
        "- Prefer tools over guessing.\n"
        "- Final answers must be based only on TOOL_RESULT evidence gathered in this chat.\n"
        "- If evidence is missing, ask the user for more input using request_user_input.\n"
        "- Do not browse/search the web or use external actions unless the user explicitly asks and confirms.\n"
        "- If external information/action is needed but not confirmed, ask first via request_user_input.\n"
        "- Start tool discovery with list_tools/search_tools/get_tool_details.\n"
        "- If discovery says a tool is unavailable/blocked, do not claim the tool is missing; explain the blocked_reason and how to unblock it.\n"
        "- If the user asks you to perform a change/action (e.g. create/switch branch, commit, push/pull, write/update), you MUST execute the corresponding tool before final answer.\n"
        "- Never stop at planning language like 'I will now do X' without an actual tool call.\n"
        "- If key information is missing from the user, call request_user_input.\n"
        "- For free-form user replies use answer_mode='open_text'.\n"
        "- For clickable choices use answer_mode='single_choice' and provide 2-8 clear options.\n"
        "- After calling request_user_input, stop and wait for the user's response.\n"
        "- If branch comparison is requested, use compare_branches.\n"
        "- If asked to update docs in repository, call generate_project_docs.\n"
        "- If user asks for a chart/graph/visualization, return a ```chart fenced JSON block using this schema:\n"
        '  {"type":"line|bar","title":"...","xKey":"...","series":[{"key":"...","label":"...","color":"#0088FE"}],"data":[{"x":"...","metric":123}]}\n'
        "- Always cite file paths + line numbers when explaining code.\n"
        "- After TOOL_RESULT, continue reasoning.\n"
        "- If enough info is available, answer in normal text (NOT JSON).\n\n"
        "BOOTSTRAP TOOLS\n"
        "────────────────────────────────\n"
        "- list_tools(args): include_unavailable?:bool, include_parameters?:bool, limit?:int\n"
        "- search_tools(args): query:str, include_unavailable?:bool, include_parameters?:bool, limit?:int\n"
        "- get_tool_details(args): tool_name:str, include_unavailable?:bool\n"
        "- request_user_input(args): question:str, answer_mode:'open_text'|'single_choice', options?:string[]\n"
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


def _question_is_tool_catalog_request(text: str) -> bool:
    q = (text or "").strip().lower()
    if not q:
        return False
    markers = (
        "list tools",
        "what tools",
        "which tools",
        "available tools",
        "tool catalog",
        "search tools",
    )
    return any(m in q for m in markers)


def _required_action_tools(question: str) -> set[str]:
    q = (question or "").strip().lower()
    if not q:
        return set()
    required: set[str] = set()

    if "create branch" in q or "new branch" in q:
        required.update({"git_create_branch", "git_checkout_branch"})
    if "checkout branch" in q or "switch branch" in q or "change branch" in q:
        required.add("git_checkout_branch")
    if "list branch" in q or "show branches" in q or "which branches" in q:
        required.add("git_list_branches")
    if "stage " in q or "git add" in q:
        required.add("git_stage_files")
    if "unstage" in q or "git reset" in q:
        required.add("git_unstage_files")
    if "commit" in q:
        required.add("git_commit")
    if "fetch" in q:
        required.add("git_fetch")
    if "pull" in q:
        required.add("git_pull")
    if "push" in q:
        required.add("git_push")

    # Chat-task actions should always trigger task tools, not discovery-only answers.
    if "chat task" in q or " task" in q:
        if "create" in q or "add" in q or "new task" in q:
            required.add("create_chat_task")
        if "update task" in q or "edit task" in q or "change task" in q:
            required.add("update_chat_task")
        if "list task" in q or "show task" in q or "tasks" in q:
            required.add("list_chat_tasks")
        if "close task" in q or "complete task" in q or "done task" in q or "mark task" in q:
            required.add("update_chat_task")
    return required


def _has_successful_tool(events: list[dict[str, Any]], names: set[str]) -> bool:
    if not names:
        return False
    for ev in events or []:
        if not isinstance(ev, dict) or not bool(ev.get("ok")):
            continue
        tool = str(ev.get("tool") or "").strip()
        if tool in names:
            return True
    return False


def _has_attempted_tool(events: list[dict[str, Any]], names: set[str]) -> bool:
    if not names:
        return False
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        tool = str(ev.get("tool") or "").strip()
        if tool in names:
            return True
    return False


def _has_successful_evidence_tool(events: list[dict[str, Any]]) -> bool:
    for ev in events or []:
        if not isinstance(ev, dict) or not bool(ev.get("ok")):
            continue
        tool = str(ev.get("tool") or "").strip()
        if not tool:
            continue
        if tool in _DISCOVERY_TOOLS:
            continue
        if tool == "request_user_input":
            continue
        return True
    return False


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
        interaction_policy: dict[str, Any] | None = None,
        prior_messages: list[dict[str, str]] | None = None,
        system_context: str | None = None,
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
        self.interaction_policy = interaction_policy or {}
        self.prior_messages = prior_messages or []
        self.system_context = _as_text(system_context)
        self.runtime = runtime or _RUNTIME

    async def run(self, user_text: str) -> dict[str, Any]:
        system_prompt = _system_prompt(
            self.project_id,
            self.branch,
            self.user_id,
            self.runtime,
            self.tool_policy,
            self.interaction_policy,
        )
        messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]

        if isinstance(self.prior_messages, list):
            for row in self.prior_messages:
                if not isinstance(row, dict):
                    continue
                role = _as_text(row.get("role")).lower()
                content = _as_text(row.get("content"))
                if role not in {"user", "assistant"} or not content:
                    continue
                messages.append({"role": role, "content": content})

        if self.system_context:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "Hierarchical memory context (chat/branch/project/user). "
                        "Use this for continuity; prioritize newest, highest-confidence evidence.\n\n"
                        f"{self.system_context}"
                    ),
                }
            )
        messages.append({"role": "user", "content": user_text})

        tool_calls = 0
        tool_events: list[dict[str, Any]] = []
        no_evidence_cycles = 0
        required_action_tools = _required_action_tools(user_text)
        answered_map: dict[str, str] = {}
        for row in (self.interaction_policy.get("answered_questions") or []):
            if not isinstance(row, dict):
                continue
            q_key = _normalize_question_key(_as_text(row.get("question_key")) or _as_text(row.get("question")))
            q_answer = _as_text(row.get("answer"))
            if q_key and q_answer:
                answered_map[q_key] = q_answer

        try:
            clarification_budget_remaining = int(self.interaction_policy.get("clarification_budget_remaining"))
        except Exception:
            clarification_budget_remaining = -1
        clarification_disable = bool(self.interaction_policy.get("disable_request_user_input"))
        clarification_disable_reason = _as_text(self.interaction_policy.get("disable_reason"))
        continue_mode = bool(self.interaction_policy.get("continue_mode"))
        destructive_intent = bool(self.interaction_policy.get("destructive_intent"))
        allow_repeat_on_conflict = bool(self.interaction_policy.get("allow_repeat_on_conflict", True))
        conflict_signal = bool(self.interaction_policy.get("conflict_signal"))
        clarification_calls_this_run = 0
        clarification_block_cycles = 0
        logger.info(
            "agent2.run.start project=%s branch=%s user=%s chat_id=%s required_action_tools=%s prompt_messages=%s clar={goal:%s remaining:%s disable:%s reason:%s continue:%s destructive:%s answered:%s}",
            self.project_id,
            self.branch,
            self.user_id,
            self.chat_id or "",
            sorted(required_action_tools),
            len(messages),
            _as_text(self.interaction_policy.get("goal_id")),
            clarification_budget_remaining,
            clarification_disable,
            clarification_disable_reason,
            continue_mode,
            destructive_intent,
            len(answered_map),
        )

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
                has_any_ok_tool = any(bool((ev or {}).get("ok")) for ev in tool_events)
                has_evidence_tool = _has_successful_evidence_tool(tool_events)
                has_required_action_tool = _has_successful_tool(tool_events, required_action_tools)
                has_attempted_required_action_tool = _has_attempted_tool(tool_events, required_action_tools)

                if required_action_tools and not has_required_action_tool and not has_attempted_required_action_tool:
                    no_evidence_cycles += 1
                    logger.warning(
                        "agent2.guard.missing_required_action_tool project=%s chat_id=%s required=%s tools_seen=%s cycle=%s",
                        self.project_id,
                        self.chat_id or "",
                        sorted(required_action_tools),
                        [str((ev or {}).get("tool") or "") for ev in tool_events],
                        no_evidence_cycles,
                    )
                    if no_evidence_cycles > 3:
                        return {
                            "answer": (
                                "I could not complete the requested action because no required action tool was executed. "
                                "Please retry and I will run the tool directly."
                            ),
                            "tool_events": tool_events,
                        }
                    messages.append({"role": "assistant", "content": assistant_text})
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "You must execute an action tool before answering. "
                                f"Required tool(s): {', '.join(sorted(required_action_tools))}. "
                                "If clarification is needed, call request_user_input. "
                                "Do not respond with planning text."
                            ),
                        }
                    )
                    continue
                if required_action_tools and not has_required_action_tool and has_attempted_required_action_tool:
                    logger.info(
                        "agent2.guard.required_action_attempted_but_failed project=%s chat_id=%s required=%s tools_seen=%s",
                        self.project_id,
                        self.chat_id or "",
                        sorted(required_action_tools),
                        [str((ev or {}).get("tool") or "") for ev in tool_events],
                    )
                    return {"answer": assistant_text, "tool_events": tool_events}

                if not has_evidence_tool:
                    if has_any_ok_tool and _question_is_tool_catalog_request(user_text):
                        logger.info(
                            "agent2.guard.allow_discovery_only_answer project=%s chat_id=%s",
                            self.project_id,
                            self.chat_id or "",
                        )
                        return {"answer": assistant_text, "tool_events": tool_events}
                    no_evidence_cycles += 1
                    if no_evidence_cycles > 2:
                        return {
                            "answer": (
                                "I need to gather evidence from tools before I can answer. "
                                "Please clarify what source/context to use, and I will continue."
                            ),
                            "tool_events": tool_events,
                        }
                    messages.append({"role": "assistant", "content": assistant_text})
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "You must gather evidence via tools before finalizing an answer. "
                                "Discovery tools alone are not enough unless user explicitly asked for tool catalog. "
                                "Call relevant execution/read tools now."
                            ),
                        }
                    )
                    continue
                return {"answer": assistant_text, "tool_events": tool_events}

            tool_calls += 1
            no_evidence_cycles = 0
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
            envelope_data: dict[str, Any]
            if tool_name == "request_user_input":
                request_question = _as_text(model_args.get("question"))
                question_key = _normalize_question_key(request_question)
                repeat_answer = answered_map.get(question_key) if question_key else None
                repeat_allowed = allow_repeat_on_conflict and conflict_signal
                disable_reason = ""
                if clarification_disable:
                    disable_reason = clarification_disable_reason or "clarification_disabled_by_policy"
                elif clarification_budget_remaining >= 0 and clarification_calls_this_run >= clarification_budget_remaining:
                    disable_reason = "clarification_budget_exhausted_for_turn"

                if repeat_answer and not repeat_allowed:
                    clarification_block_cycles += 1
                    synthetic_result = {
                        "id": f"auto-{question_key[:12] or 'repeat'}",
                        "chat_id": self.chat_id or "",
                        "question": request_question,
                        "answer_mode": "open_text",
                        "options": [],
                        "awaiting": False,
                        "auto_resolved": True,
                        "question_key": question_key,
                        "answer": repeat_answer,
                        "reason": "already_answered",
                    }
                    envelope_data = {
                        "tool": tool_name,
                        "ok": True,
                        "duration_ms": 0,
                        "attempts": 1,
                        "cached": False,
                        "input_bytes": len(json.dumps(model_args, ensure_ascii=False).encode("utf-8")),
                        "result_bytes": len(json.dumps(synthetic_result, ensure_ascii=False).encode("utf-8")),
                        "result": synthetic_result,
                    }
                elif disable_reason:
                    clarification_block_cycles += 1
                    synthetic_result = {
                        "id": "",
                        "chat_id": self.chat_id or "",
                        "question": request_question,
                        "answer_mode": _as_text(model_args.get("answer_mode")) or "open_text",
                        "options": model_args.get("options") if isinstance(model_args.get("options"), list) else [],
                        "awaiting": False,
                        "blocked": True,
                        "reason": disable_reason,
                    }
                    envelope_data = {
                        "tool": tool_name,
                        "ok": True,
                        "duration_ms": 0,
                        "attempts": 1,
                        "cached": False,
                        "input_bytes": len(json.dumps(model_args, ensure_ascii=False).encode("utf-8")),
                        "result_bytes": len(json.dumps(synthetic_result, ensure_ascii=False).encode("utf-8")),
                        "result": synthetic_result,
                    }
                else:
                    envelope = await self.runtime.execute(tool_name, model_args, ctx)
                    envelope_data = envelope.model_dump()
                    if bool(envelope_data.get("ok")):
                        clarification_calls_this_run += 1
            else:
                envelope = await self.runtime.execute(tool_name, model_args, ctx)
                envelope_data = envelope.model_dump()

            tool_events.append(envelope_data)
            logger.info(
                "agent2.tool_event tool=%s ok=%s duration_ms=%s attempts=%s",
                tool_name,
                bool(envelope_data.get("ok")),
                int(envelope_data.get("duration_ms") or 0),
                int(envelope_data.get("attempts") or 1),
            )

            if tool_name == "request_user_input" and bool(envelope_data.get("ok")):
                result = envelope_data.get("result")
                pending = result if isinstance(result, dict) else {}
                if bool(pending.get("auto_resolved")):
                    reuse_answer = _as_text(pending.get("answer"))
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
                                "Do not ask the same clarification again. "
                                f"Use the already provided answer for that question: {reuse_answer}\n"
                                "Continue and produce the best grounded answer now."
                            ),
                        }
                    )
                    continue
                if bool(pending.get("blocked")):
                    if clarification_block_cycles > 3:
                        return {
                            "answer": (
                                "I cannot ask additional clarification questions for this goal right now. "
                                "I should proceed using existing context and assumptions."
                            ),
                            "tool_events": tool_events,
                        }
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
                                "Clarification questions are disabled for this turn. "
                                "Proceed with available evidence and clearly state assumptions. "
                                "Do NOT call request_user_input again unless a destructive action truly requires confirmation."
                            ),
                        }
                    )
                    continue
                question = str(pending.get("question") or "").strip()
                answer_mode = str(pending.get("answer_mode") or "open_text").strip().lower()
                options = pending.get("options")
                if not isinstance(options, list):
                    options = []
                question_key = _normalize_question_key(question)
                if question_key:
                    pending["question_key"] = question_key
                goal_id = _as_text(self.interaction_policy.get("goal_id"))
                if goal_id:
                    pending["goal_id"] = goal_id
                prompt_text = (
                    f"I need more input before I can continue:\n\n{question}"
                    if question
                    else "I need more input before I can continue."
                )
                if answer_mode == "single_choice" and options:
                    prompt_text += "\n\nChoose one option below."
                else:
                    prompt_text += "\n\nPlease reply with your answer."
                return {
                    "answer": prompt_text,
                    "tool_events": tool_events,
                    "pending_user_question": pending,
                }

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
    interaction_policy: dict[str, Any] | None = None,
    prior_messages: list[dict[str, str]] | None = None,
    system_context: str | None = None,
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
        interaction_policy=interaction_policy,
        prior_messages=prior_messages,
        system_context=system_context,
        runtime=runtime,
    )
    out = await agent.run(question)
    if include_tool_events:
        return out
    return out.get("answer") or ""
