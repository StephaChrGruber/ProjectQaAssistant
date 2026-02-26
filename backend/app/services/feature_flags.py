from __future__ import annotations

from typing import Any

from bson import ObjectId

from ..db import get_db

FEATURE_FLAGS_KEY = "feature_flags"

DEFAULT_FEATURE_FLAGS: dict[str, bool] = {
    "enable_audit_events": True,
    "enable_connector_health": True,
    "enable_memory_controls": True,
    "dry_run_tools_default": False,
    "require_approval_for_write_tools": False,
    "workspace_v1": True,
    "workspace_docked_v2": True,
    "workspace_inline_ai": True,
    "workspace_diagnostics": True,
    "workspace_chat_patch_apply": True,
    "chat_thinking_trace": True,
    "chat_thinking_trace_stream": True,
    "tool_classes_v1": True,
}


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on"}:
            return True
        if raw in {"0", "false", "no", "off"}:
            return False
    return default


def normalize_feature_flags(raw: Any) -> dict[str, bool]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, bool] = {}
    for key, default in DEFAULT_FEATURE_FLAGS.items():
        out[key] = _coerce_bool(src.get(key), default)
    return out


def project_feature_flags(project: dict[str, Any] | None) -> dict[str, bool]:
    if not isinstance(project, dict):
        return dict(DEFAULT_FEATURE_FLAGS)
    extra = project.get("extra")
    if not isinstance(extra, dict):
        return dict(DEFAULT_FEATURE_FLAGS)
    return normalize_feature_flags(extra.get(FEATURE_FLAGS_KEY))


async def load_project_feature_flags(project_id: str) -> dict[str, bool]:
    q: dict[str, Any]
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    else:
        q = {"key": project_id}
    row = await get_db()["projects"].find_one(q, {"extra": 1})
    return project_feature_flags(row if isinstance(row, dict) else {})


async def update_project_feature_flags(project_id: str, patch: dict[str, Any]) -> dict[str, bool]:
    q: dict[str, Any]
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    else:
        q = {"key": project_id}
    db = get_db()
    row = await db["projects"].find_one(q, {"extra": 1})
    if not isinstance(row, dict):
        raise ValueError("Project not found")

    extra = row.get("extra")
    current = extra if isinstance(extra, dict) else {}
    current_flags = normalize_feature_flags(current.get(FEATURE_FLAGS_KEY))
    for key in DEFAULT_FEATURE_FLAGS.keys():
        if key in patch:
            current_flags[key] = _coerce_bool(patch.get(key), DEFAULT_FEATURE_FLAGS[key])

    next_extra = dict(current)
    next_extra[FEATURE_FLAGS_KEY] = current_flags
    await db["projects"].update_one(q, {"$set": {"extra": next_extra}})
    return current_flags
