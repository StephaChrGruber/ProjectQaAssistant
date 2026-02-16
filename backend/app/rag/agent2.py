# app/app/rag/agent2.py
from __future__ import annotations

import inspect
import json
import logging
import time
from urllib.parse import urljoin

import requests

from ..settings import settings
from .tool_exec import (
    get_project_metadata,
    repo_grep,
    open_file,
    keyword_search,
    chroma_count,
    chroma_search_chunks,
    chroma_open_chunks,
)

from typing import Any, Dict, List, Optional, Union, get_args, get_origin, get_type_hints
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class LLMUpstreamError(RuntimeError):
    pass

#import pydevd_pycharm
#pydevd_pycharm.settrace(
#    "host.docker.internal",
#    port=7890,
 #   suspend=True,              # stops immediately so you can set breakpoints
  #  trace_only_current_thread=False,
#)

ALLOWED_TOOLS = {
    "get_project_metadata": get_project_metadata,
    "repo_grep": repo_grep,
    "open_file": open_file,
    #"keyword_search": keyword_search,
    "chroma_count": chroma_count,
    "chroma_search_chunks": chroma_search_chunks,
    "chroma_open_chunks": chroma_open_chunks,
}


def _base(llm_base_url: str | None = None) -> str:
    base = (llm_base_url or settings.LLM_BASE_URL or "http://ollama:11434").rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + "/v1/"


def _type_to_str(tp: Any) -> str:
    """
    Best-effort pretty printer for type hints used in tool signatures.
    Works for common cases like str, int, Optional[str], list[str], Dict[str, Any], etc.
    """
    if tp is inspect._empty:
        return "any"

    origin = get_origin(tp)
    args = get_args(tp)

    # Optional[T] comes through as Union[T, NoneType]
    if origin is Union:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1 and len(args) == 2:
            return f"optional[{_type_to_str(non_none[0])}]"
        return " | ".join(_type_to_str(a) for a in args)

    if origin in (list, List):
        inner = _type_to_str(args[0]) if args else "any"
        return f"array[{inner}]"

    if origin in (dict, Dict):
        k = _type_to_str(args[0]) if len(args) > 0 else "any"
        v = _type_to_str(args[1]) if len(args) > 1 else "any"
        return f"object[{k} -> {v}]"

    # Plain builtins / classes
    if hasattr(tp, "__name__"):
        return tp.__name__

    return str(tp)

def _is_pydantic_model_type(tp: Any) -> bool:
    logger.info(f"Tp: {tp}, class: {tp.__class__}")
    if tp is None or BaseModel is None:
        return False
    try:
        logger.info(f"Is Basemodel: {isinstance(tp, BaseModel)}")
        logger.info(f"IsSubclass: {issubclass(tp, BaseModel)}")
        return issubclass(tp, BaseModel)
    except Exception as e:
        return False


def _unwrap_optional(tp: Any) -> Any:
    origin = get_origin(tp)
    if origin is Union:
        args = [a for a in get_args(tp) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return tp

def _iter_pydantic_fields(model_cls: Any) -> List[Dict[str, Any]]:
    """
    Returns list of dicts:
      {"name": str, "type": Any, "required": bool, "default": Any}
    Supports pydantic v2 + v1.
    """
    fields_out: List[Dict[str, Any]] = []

    # Pydantic v2
    if hasattr(model_cls, "model_fields"):
        mf = getattr(model_cls, "model_fields")  # dict[str, FieldInfo]
        for name, finfo in mf.items():
            ann = getattr(finfo, "annotation", inspect._empty)
            required = getattr(finfo, "is_required", lambda: False)()
            default = getattr(finfo, "default", inspect._empty)
            fields_out.append({"name": name, "type": ann, "required": required, "default": default})
        return fields_out

    # Pydantic v1
    if hasattr(model_cls, "__fields__"):
        f = getattr(model_cls, "__fields__")  # dict[str, ModelField]
        for name, mfield in f.items():
            ann = getattr(mfield, "outer_type_", inspect._empty)
            required = bool(getattr(mfield, "required", False))
            default = getattr(mfield, "default", inspect._empty)
            fields_out.append({"name": name, "type": ann, "required": required, "default": default})
        return fields_out

    return fields_out


def _expand_type_if_model(tp: Any) -> Any:
    """
    If tp is Optional[Model], list[Model], etc -> returns inner Model type if applicable.
    Otherwise returns tp.
    """
    tp = _unwrap_optional(tp)
    origin = get_origin(tp)
    args = get_args(tp)

    if _is_pydantic_model_type(tp):
        return tp

    if origin in (list, List) and args:
        inner = _unwrap_optional(args[0])
        if _is_pydantic_model_type(inner):
            return inner

    if origin in (dict, Dict) and len(args) == 2:
        inner = _unwrap_optional(args[1])
        if _is_pydantic_model_type(inner):
            return inner

    return tp


def _render_default(d: Any) -> str:
    if d is inspect._empty:
        return ""
    if d is None:
        return " (default=null)"
    if isinstance(d, str):
        if len(d) > 40:
            d = d[:37] + "..."
        return f' (default="{d}")'
    return f" (default={d})"


def _render_model_schema(model_cls: Any, *, indent: str = "    ", depth: int = 0, max_depth: int = 2) -> List[str]:
    """
    Render model fields. Expands nested BaseModels up to max_depth.
    """
    lines: List[str] = []
    fields = _iter_pydantic_fields(model_cls)

    for f in fields:
        name = f["name"]
        ftype = f["type"]
        required = f["required"]
        default = f["default"]

        req_str = "REQUIRED" if required else "OPTIONAL"
        type_str = _type_to_str(ftype)
        lines.append(f"{indent}- {name}: {type_str} — {req_str}{_render_default(default)}")

        # nested expansion
        if depth < max_depth:
            inner_model = _expand_type_if_model(ftype)
            if _is_pydantic_model_type(inner_model) and inner_model is not model_cls:
                lines.append(f"{indent}  Fields of {inner_model.__name__}:")
                lines.extend(_render_model_schema(inner_model, indent=indent + "  ", depth=depth + 1, max_depth=max_depth))

    return lines

def _autogen_tool_schema_text(tools: Dict[str, Any]) -> str:
    lines: List[str] = []

    for name, fn in tools.items():
        type_hints = get_type_hints(fn)
        sig = inspect.signature(fn)
        doc = (inspect.getdoc(fn) or "").strip()
        first_doc_line = doc.splitlines()[0].strip() if doc else "No description available."

        lines.append(f"{name}")
        lines.append(f"  Description: {first_doc_line}")

        # params
        params_rendered: List[str] = []
        for p_key, p in sig.parameters.items():
            if p.name in ("self", "cls"):
                continue
            if p.kind == inspect.Parameter.VAR_POSITIONAL:
                continue

            if p.kind == inspect.Parameter.VAR_KEYWORD:
                params_rendered.append("  - **kwargs: object — accepts extra parameters")
                continue

            required = (p.default is inspect._empty)
            tp = type_hints.get(p_key, p.annotation)
            tp_unwrapped = _unwrap_optional(tp)

            req_str = "REQUIRED" if required else "OPTIONAL"
            default_str = "" if required else _render_default(p.default)

            # If parameter is a Pydantic model, expand it
            model_cls = _expand_type_if_model(tp_unwrapped)
            logger.info(f"Model: {model_cls}")
            if _is_pydantic_model_type(model_cls):
                logger.info("Is pydantic model")
                params_rendered.append(
                    f"  - {p.name}: {model_cls.__name__} — {req_str}{default_str}"
                )
                params_rendered.append(f"    Fields of {model_cls.__name__}:")
                params_rendered.extend(_render_model_schema(model_cls, indent="    ", max_depth=2))
            else:
                logger.info("Is no pydantic model")
                params_rendered.append(
                    f"  - {p.name}: {_type_to_str(tp)} — {req_str}{default_str}"
                )

        if params_rendered:
            lines.append("  Parameters:")
            lines.extend(params_rendered)
        else:
            lines.append("  Parameters: none")

        lines.append("")  # blank between tools

    return "\n".join(lines).rstrip() + "\n"


def _system_prompt(project_id: str, branch: str, user_id: str) -> str:
    tool_schema = _autogen_tool_schema_text(ALLOWED_TOOLS)

    return (
        "You are an onboarding + developer assistant for a codebase.\n"
        f"Context:\n"
        f"- project_id = {project_id}\n"
        f"- branch = {branch}\n"
        f"- user = {user_id}\n\n"
        "You can call tools by replying with EXACTLY ONE JSON object (no markdown, no text outside JSON) "
        "using the following format:\n"
        "{\n"
        '  "tool": "<tool_name>",\n'
        '  "args": { ... }\n'
        "}\n\n"
        "IMPORTANT:\n"
        "- Only include parameters explicitly listed for the tool.\n"
        "- Do NOT invent parameters.\n"
        "- Required parameters MUST be provided.\n"
        "- If required parameters are missing, ask for clarification instead of guessing.\n"
        "- Tool selection must be one of the tools listed below.\n\n"
        "────────────────────────────────\n"
        "AVAILABLE TOOLS (auto-generated)\n"
        "────────────────────────────────\n"
        f"{tool_schema}\n"
        "────────────────────────────────\n"
        "GENERAL RULES\n"
        "────────────────────────────────\n"
        "- Prefer tools over guessing.\n"
        "- Use repo_grep to locate symbols, endpoints, config keys, and files in the git repo.\n"
        "- Use open_file to read exact code around grep results.\n"
        "- Use keyword_search or chroma_search_chunks for documentation and explanations.\n"
        "- Always include file paths and line numbers when citing code.\n"
        "- After receiving a TOOL_RESULT, continue reasoning.\n"
        "- When you have enough information, respond with a normal text answer (no JSON).\n"
        "- If the answer cannot be proven with tool results, explicitly say what information is missing.\n"
    )


def _try_parse_tool_call(text: str) -> Optional[Dict[str, Any]]:
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
    if not isinstance(tool, str) or tool not in ALLOWED_TOOLS:
        return None
    if not isinstance(args, dict):
        return None
    return {"tool": tool, "args": args}


def _is_basemodel_subclass(tp: Any) -> bool:
    try:
        return issubclass(tp, BaseModel)
    except TypeError:
        return False

def _model_from_dict(model_cls: type[BaseModel], data: Any) -> BaseModel:
    # v2
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(data)
    # v1
    return model_cls.parse_obj(data)

def _coerce_value_to_type(value: Any, tp: Any) -> Any:
    """
    Convert JSON-ish `value` into the expected type `tp`.
    Supports BaseModel, Optional, Union, list[T], dict[K,V].
    """
    if tp is inspect._empty or tp is Any:
        return value

    origin = get_origin(tp)
    args = get_args(tp)

    # Optional[T] / Union[...]
    if origin is Union:
        # allow None
        if value is None:
            if any(a is type(None) for a in args):
                return None
        # try each union arm until one works
        last_err = None
        for a in args:
            if a is type(None):
                continue
            try:
                return _coerce_value_to_type(value, a)
            except Exception as e:
                last_err = e
        if last_err:
            raise last_err
        return value

    # list[T]
    if origin in (list, List):
        inner = args[0] if args else Any
        if value is None:
            return None
        if not isinstance(value, list):
            raise TypeError(f"Expected list for {tp}, got {type(value)}")
        return [_coerce_value_to_type(v, inner) for v in value]

    # dict[K,V]
    if origin in (dict, Dict):
        k_tp = args[0] if len(args) > 0 else Any
        v_tp = args[1] if len(args) > 1 else Any
        if value is None:
            return None
        if not isinstance(value, dict):
            raise TypeError(f"Expected dict for {tp}, got {type(value)}")
        return {
            _coerce_value_to_type(k, k_tp): _coerce_value_to_type(v, v_tp)
            for k, v in value.items()
        }

    # BaseModel
    if _is_basemodel_subclass(tp):
        if isinstance(value, tp):
            return value
        if not isinstance(value, dict):
            raise TypeError(f"Expected object/dict for {tp.__name__}, got {type(value)}")
        return _model_from_dict(tp, value)

    # plain types (int/str/bool/float/etc.)
    if isinstance(tp, type):
        # don't coerce aggressively; just validate
        if value is None:
            return None
        if isinstance(value, tp):
            return value
        # permissive conversion for common primitives
        if tp in (int, float, str, bool):
            return tp(value)
        return value

    return value

def _coerce_kwargs_for_callable(fn, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """
    For a function `fn`, coerce each kwarg to its annotated type.
    Only coerces keys that exist in the signature.
    """
    sig = inspect.signature(fn)
    hints = get_type_hints(fn, globalns=fn.__globals__)

    out: Dict[str, Any] = {}
    for name, p in sig.parameters.items():
        if name in ("self", "cls"):
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue

        if name not in kwargs:
            continue

        tp = hints.get(name, p.annotation)
        out[name] = _coerce_value_to_type(kwargs[name], tp)

    # keep any extras only if **kwargs exists
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        for k, v in kwargs.items():
            if k not in out:
                out[k] = v

    return out

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
            try:
                body = r.json()
                detail = (body.get("error") or {}).get("message") or ""
            except Exception:
                detail = r.text[:500]
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


def _filter_kwargs_for_callable(fn, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    sig = inspect.signature(fn)
    params = sig.parameters

    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs

    allowed = {name for name, p in params.items() if p.kind in (
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
        inspect.Parameter.KEYWORD_ONLY,
    )}

    return {k: v for k, v in kwargs.items() if k in allowed}

def _autowrap_single_model_arg(fn, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    If fn has exactly one non-context parameter (besides project_id/branch/user_id etc.)
    and that parameter is a BaseModel type, then wrap the whole args dict into it.

    Example:
      fn(req: ChromaCountRequest)
      incoming args = {"projectId": "..."}
      -> {"req": {"projectId": "..."}}
    """
    sig = inspect.signature(fn)
    hints = get_type_hints(fn, globalns=fn.__globals__)

    # parameters we inject automatically
    CONTEXT = {"project_id", "projectId", "branch", "user_id", "userId"}

    candidates = []
    for name, p in sig.parameters.items():
        if name in ("self", "cls"):
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if name in CONTEXT:
            continue
        candidates.append(name)

    # Only if there is exactly one "real" parameter
    if len(candidates) != 1:
        return args

    only_name = candidates[0]
    tp = hints.get(only_name, sig.parameters[only_name].annotation)
    tp = _unwrap_optional(tp)

    # If already provided correctly, do nothing
    if only_name in args:
        return args

    # If that param is a pydantic model, wrap whole args into it
    if _is_basemodel_subclass(tp):
        return {only_name: args}

    return args


def _jsonable(obj: Any) -> Any:
    """
    Convert common non-JSON-serializable objects to JSON-serializable equivalents.
    - Pydantic v2: model_dump()
    - Pydantic v1: dict()
    - fallback: str(obj)
    """
    if obj is None:
        return None

    if hasattr(obj, "model_dump"):  # pydantic v2
        try:
            return obj.model_dump()
        except Exception:
            pass

    if hasattr(obj, "dict"):  # pydantic v1
        try:
            return obj.dict()
        except Exception:
            pass

    if isinstance(obj, (str, int, float, bool)):
        return obj

    if isinstance(obj, list):
        return [_jsonable(x) for x in obj]

    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}

    return str(obj)


class Agent2:
    def __init__(
            self,
            project_id: str,
            branch: str,
            user_id: str,
            *,
            temperature: float = 0.1,
            max_tokens: int = 800,
            max_tool_calls: int = 8,
            llm_base_url: str | None = None,
            llm_api_key: str | None = None,
            llm_model: str | None = None,
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

    async def run(self, user_text: str) -> str:
        system_prompt = _system_prompt(self.project_id, self.branch, self.user_id)
        logger.info(f"System prompt:\n{system_prompt}")
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        tool_calls = 0

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

            tool_call = _try_parse_tool_call(assistant_text)
            if not tool_call:
                return assistant_text

            tool_calls += 1
            if tool_calls > self.max_tool_calls:
                return (
                    "I made too many tool calls without reaching a final answer. "
                    "Please narrow the question or increase max_tool_calls."
                )

            tool_name = tool_call["tool"]
            model_args = dict(tool_call["args"] or {})
            ctx = {"project_id": self.project_id, "branch": self.branch}
            merged_args = {**ctx, **model_args}

            fn = ALLOWED_TOOLS[tool_name]

            # ✅ NEW: if the tool expects a single BaseModel payload, wrap args into it
            merged_args = _autowrap_single_model_arg(fn, merged_args)

            # keep only parameters the function actually accepts
            call_args = _filter_kwargs_for_callable(fn, merged_args)

            # ✅ NEW: coerce dicts into BaseModels / handle Optional/list/dict/Union
            call_args = _coerce_kwargs_for_callable(fn, call_args)

            logger.info("Executing tool=%s args=%s", tool_name, call_args)

            try:
                result = await fn(**call_args)
                result = _jsonable(result)
                logger.info(f"Result from tool call: {result}")
            except Exception as e:
                logger.exception("Tool execution failed: %s", e)
                result = {"error": str(e)}

            messages.append({"role": "assistant", "content": assistant_text})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"TOOL_RESULT {tool_name}:\n"
                        f"{json.dumps(result, ensure_ascii=False, indent=2)}\n"
                    ),
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Continue using the TOOL_RESULT above. "
                        "If you have enough information, answer the original question now in normal text (no JSON). "
                        "Otherwise, call the next tool as JSON."
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
) -> str:
    agent = Agent2(
        project_id=project_id,
        branch=branch,
        user_id=user_id,
        temperature=temperature,
        max_tokens=max_tokens,
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
    )
    return await agent.run(question)
