from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


_STATE: dict[str, Any] = {
    "status": "starting",
    "started_at": datetime.now(timezone.utc),
    "ready_at": None,
    "updated_at": datetime.now(timezone.utc),
    "last_error": None,
}


def _stamp() -> datetime:
    return datetime.now(timezone.utc)


def mark_starting() -> None:
    _STATE["status"] = "starting"
    _STATE["started_at"] = _stamp()
    _STATE["ready_at"] = None
    _STATE["last_error"] = None
    _STATE["updated_at"] = _stamp()


def mark_ready() -> None:
    now = _stamp()
    _STATE["status"] = "ready"
    _STATE["ready_at"] = now
    _STATE["updated_at"] = now


def mark_failed(error_text: str) -> None:
    _STATE["status"] = "failed"
    _STATE["last_error"] = str(error_text or "startup_failed")
    _STATE["updated_at"] = _stamp()


def mark_stopping() -> None:
    _STATE["status"] = "stopping"
    _STATE["updated_at"] = _stamp()


def snapshot() -> dict[str, Any]:
    return dict(_STATE)


def is_ready() -> bool:
    return str(_STATE.get("status") or "") == "ready"
