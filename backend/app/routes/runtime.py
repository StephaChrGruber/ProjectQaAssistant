from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..services.runtime_context import runtime_info_payload
from ..services.runtime_state import is_ready, snapshot

router = APIRouter(tags=["runtime"])


def _iso(value: datetime | None) -> str | None:
    if not isinstance(value, datetime):
        return None
    text = value.isoformat()
    if text.endswith("+00:00"):
        return text[:-6] + "Z"
    if value.tzinfo is None:
        return text + "Z"
    return text


@router.get("/health/live")
async def health_live() -> dict:
    state = snapshot()
    return {
        "status": "alive",
        "runtime_status": str(state.get("status") or "unknown"),
        "started_at": _iso(state.get("started_at")),
        "updated_at": _iso(state.get("updated_at")),
    }


@router.get("/health/ready")
async def health_ready() -> dict:
    state = snapshot()
    payload = {
        "status": str(state.get("status") or "unknown"),
        "ready": bool(is_ready()),
        "ready_at": _iso(state.get("ready_at")),
        "last_error": str(state.get("last_error") or "") or None,
    }
    if not is_ready():
        raise HTTPException(status_code=503, detail=payload)
    return payload


@router.get("/runtime/info")
async def runtime_info() -> dict:
    state = snapshot()
    return {
        **runtime_info_payload(),
        "runtime_status": str(state.get("status") or "unknown"),
        "started_at": _iso(state.get("started_at")),
        "ready_at": _iso(state.get("ready_at")),
        "last_error": str(state.get("last_error") or "") or None,
    }
