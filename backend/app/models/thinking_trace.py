from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ThinkingTraceStep(BaseModel):
    id: str
    kind: Literal["phase", "llm_cycle", "tool_call", "clarification", "status", "final"]
    title: str
    status: Literal["running", "ok", "error", "info"] = "info"
    ts: str
    duration_ms: Optional[int] = None
    tool: Optional[str] = None
    summary: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class ThinkingTracePhase(BaseModel):
    name: str
    status: Literal["start", "done", "error"] = "start"
    ts: str
    duration_ms: Optional[int] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class ThinkingTrace(BaseModel):
    version: str = "v1"
    started_at: str
    finished_at: Optional[str] = None
    total_duration_ms: Optional[int] = None
    phases: List[ThinkingTracePhase] = Field(default_factory=list)
    steps: List[ThinkingTraceStep] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)
