from __future__ import annotations

import asyncio
import contextvars
import inspect
import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional
from uuid import uuid4

from ..models.thinking_trace import ThinkingTrace, ThinkingTracePhase, ThinkingTraceStep

StreamEmitter = Callable[[dict[str, Any]], Any]

_STREAM_EMITTER_VAR: contextvars.ContextVar[StreamEmitter | None] = contextvars.ContextVar(
    "thinking_stream_emitter",
    default=None,
)
_REQUEST_ID_VAR: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "thinking_request_id",
    default=None,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _now_ms() -> float:
    return time.perf_counter() * 1000.0


def _truncate(text: str, max_chars: int = 280) -> str:
    raw = str(text or "")
    if len(raw) <= max_chars:
        return raw
    return raw[: max_chars - 1] + "…"


def _redact_text(text: str) -> str:
    value = str(text or "")
    if not value:
        return value
    patterns = [
        r"(?i)(api[_-]?key\s*[:=]\s*)([^\s,;]+)",
        r"(?i)(token\s*[:=]\s*)([^\s,;]+)",
        r"(?i)(authorization\s*[:=]\s*bearer\s+)([^\s,;]+)",
        r"(?i)(password\s*[:=]\s*)([^\s,;]+)",
        r"(?i)(secret\s*[:=]\s*)([^\s,;]+)",
    ]
    out = value
    for pat in patterns:
        out = re.sub(pat, r"\1***", out)
    return out


def _sanitize(value: Any, *, max_chars: int = 320) -> Any:
    if value is None:
        return None
    if isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate(_redact_text(value), max_chars=max_chars)
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k or "")
            if re.search(r"(?i)token|secret|password|api[_-]?key|authorization", key):
                out[key] = "***"
                continue
            out[key] = _sanitize(v, max_chars=max_chars)
        return out
    if isinstance(value, list):
        return [_sanitize(v, max_chars=max_chars) for v in value[:20]]
    return _truncate(_redact_text(str(value)), max_chars=max_chars)


async def _maybe_await(value: Any) -> None:
    if inspect.isawaitable(value):
        await value


async def emit_stream_event(event_type: str, payload: dict[str, Any], *, request_id: str | None = None) -> None:
    emitter = _STREAM_EMITTER_VAR.get()
    if emitter is None:
        return
    rid = str(request_id or _REQUEST_ID_VAR.get() or "").strip() or str(uuid4())
    event = {
        "type": event_type,
        "request_id": rid,
        "ts": _iso_now(),
        "payload": payload,
    }
    await _maybe_await(emitter(event))


def bind_stream_context(
    *,
    emitter: StreamEmitter | None,
    request_id: str | None = None,
) -> tuple[contextvars.Token, contextvars.Token]:
    token_emitter = _STREAM_EMITTER_VAR.set(emitter)
    token_request = _REQUEST_ID_VAR.set(str(request_id or "").strip() or str(uuid4()))
    return token_emitter, token_request


def reset_stream_context(tokens: tuple[contextvars.Token, contextvars.Token]) -> None:
    token_emitter, token_request = tokens
    _STREAM_EMITTER_VAR.reset(token_emitter)
    _REQUEST_ID_VAR.reset(token_request)


def current_stream_request_id() -> str:
    value = str(_REQUEST_ID_VAR.get() or "").strip()
    return value or str(uuid4())


class ThinkingTraceCollector:
    def __init__(self) -> None:
        self._started_ms = _now_ms()
        self._started_at = _iso_now()
        self._finished_at: str | None = None
        self._steps: list[ThinkingTraceStep] = []
        self._phases: list[ThinkingTracePhase] = []
        self._open_tool_steps: dict[str, int] = {}
        self._seq = 0

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq}"

    async def phase(self, name: str, status: str, details: dict[str, Any] | None = None) -> None:
        item = ThinkingTracePhase(
            name=str(name or "phase"),
            status="done" if status == "done" else ("error" if status == "error" else "start"),
            ts=_iso_now(),
            details=_sanitize(details or {}) if details else {},
        )
        self._phases.append(item)
        await emit_stream_event(
            "phase",
            {
                "name": item.name,
                "status": item.status,
                "ts": item.ts,
                "details": item.details,
            },
        )

    async def status(self, text: str, *, details: dict[str, Any] | None = None) -> None:
        step = ThinkingTraceStep(
            id=self._next_id("status"),
            kind="status",
            title=_truncate(str(text or "status"), 160),
            status="info",
            ts=_iso_now(),
            details=_sanitize(details or {}) if details else {},
        )
        self._steps.append(step)
        await emit_stream_event("status", step.model_dump())

    async def on_agent_event(self, event: dict[str, Any]) -> None:
        kind = str((event or {}).get("type") or "").strip()
        if not kind:
            return
        if kind == "llm_cycle_start":
            step = ThinkingTraceStep(
                id=self._next_id("llm"),
                kind="llm_cycle",
                title=f"Model cycle {(event or {}).get('cycle') or '?'}",
                status="running",
                ts=_iso_now(),
                details=_sanitize({"cycle": (event or {}).get("cycle")}),
            )
            self._steps.append(step)
            await emit_stream_event("status", step.model_dump())
            return

        if kind == "tool_call_start":
            tool = str((event or {}).get("tool") or "").strip() or "tool"
            call_id = str((event or {}).get("call_id") or self._next_id("tool"))
            step = ThinkingTraceStep(
                id=call_id,
                kind="tool_call",
                title=f"Running {tool}",
                status="running",
                ts=_iso_now(),
                tool=tool,
                details=_sanitize({"args": (event or {}).get("args"), "cycle": (event or {}).get("cycle")}),
            )
            self._open_tool_steps[call_id] = len(self._steps)
            self._steps.append(step)
            await emit_stream_event("tool_start", step.model_dump())
            return

        if kind == "tool_call_end":
            call_id = str((event or {}).get("call_id") or "").strip()
            idx = self._open_tool_steps.get(call_id)
            ok = bool((event or {}).get("ok"))
            payload = _sanitize(
                {
                    "cached": bool((event or {}).get("cached")),
                    "attempts": int((event or {}).get("attempts") or 1),
                    "error": (event or {}).get("error"),
                }
            )
            if idx is not None and 0 <= idx < len(self._steps):
                step = self._steps[idx]
                step.status = "ok" if ok else "error"
                step.duration_ms = int((event or {}).get("duration_ms") or 0)
                step.summary = "Completed" if ok else "Failed"
                step.details.update(payload if isinstance(payload, dict) else {})
                await emit_stream_event("tool_end", step.model_dump())
            else:
                step = ThinkingTraceStep(
                    id=call_id or self._next_id("tool"),
                    kind="tool_call",
                    title=f"Tool {(event or {}).get('tool') or 'tool'} finished",
                    status="ok" if ok else "error",
                    ts=_iso_now(),
                    tool=str((event or {}).get("tool") or ""),
                    duration_ms=int((event or {}).get("duration_ms") or 0),
                    details=payload if isinstance(payload, dict) else {},
                )
                self._steps.append(step)
                await emit_stream_event("tool_end", step.model_dump())
            return

        if kind == "clarification_requested":
            step = ThinkingTraceStep(
                id=self._next_id("clar"),
                kind="clarification",
                title="Waiting for user input",
                status="info",
                ts=_iso_now(),
                details=_sanitize({"question": (event or {}).get("question"), "answer_mode": (event or {}).get("answer_mode")}),
            )
            self._steps.append(step)
            await emit_stream_event("status", step.model_dump())
            return

        if kind == "final_ready":
            step = ThinkingTraceStep(
                id=self._next_id("final"),
                kind="final",
                title="Final answer ready",
                status="ok",
                ts=_iso_now(),
                details=_sanitize({"tool_calls": (event or {}).get("tool_calls")}),
            )
            self._steps.append(step)
            await emit_stream_event("status", step.model_dump())

    def finalize(
        self,
        *,
        tool_events: list[dict[str, Any]] | None,
        grounded: bool,
        sources_count: int,
        pending_user_input: bool,
    ) -> ThinkingTrace:
        self._finished_at = _iso_now()
        duration = int(max(0.0, _now_ms() - self._started_ms))
        ok_count = 0
        err_count = 0
        for ev in tool_events or []:
            if bool((ev or {}).get("ok")):
                ok_count += 1
            else:
                err_count += 1
        return ThinkingTrace(
            started_at=self._started_at,
            finished_at=self._finished_at,
            total_duration_ms=duration,
            phases=self._phases,
            steps=self._steps,
            summary={
                "tool_calls": len(tool_events or []),
                "tool_ok": ok_count,
                "tool_errors": err_count,
                "grounded": bool(grounded),
                "sources_count": int(sources_count or 0),
                "pending_user_input": bool(pending_user_input),
            },
        )

    def as_dict(
        self,
        *,
        tool_events: list[dict[str, Any]] | None,
        grounded: bool,
        sources_count: int,
        pending_user_input: bool,
    ) -> dict[str, Any]:
        trace = self.finalize(
            tool_events=tool_events,
            grounded=grounded,
            sources_count=sources_count,
            pending_user_input=pending_user_input,
        )
        return json.loads(trace.model_dump_json())
