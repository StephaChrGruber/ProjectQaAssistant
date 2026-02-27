from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from ..settings import settings

RuntimeMode = Literal["server", "desktop_local_fullstack", "desktop_remote_slim"]
BackendOrigin = Literal["local", "remote"]


@dataclass(frozen=True)
class RuntimeContext:
    mode: RuntimeMode
    backend_origin: BackendOrigin
    storage_engine: str
    app_version: str
    build_sha: str | None
    desktop_session_id: str | None
    profile_path: str | None
    profile_loaded: bool
    data_dir: str | None
    local_ports: dict[str, int]
    feature_flags: dict[str, bool]


def _normalize_mode(raw: str | None) -> RuntimeMode:
    value = str(raw or "").strip().lower()
    aliases: dict[str, RuntimeMode] = {
        "server": "server",
        "desktop_local_fullstack": "desktop_local_fullstack",
        "local_fullstack": "desktop_local_fullstack",
        "desktop_remote_slim": "desktop_remote_slim",
        "remote_slim": "desktop_remote_slim",
    }
    return aliases.get(value, "server")


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _safe_profile_doc(path_value: str | None) -> tuple[dict[str, Any], str | None, bool]:
    path = str(path_value or "").strip()
    if not path:
        return {}, None, False
    p = Path(path)
    if not p.exists() or not p.is_file():
        return {}, str(p), False
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}, str(p), False
    if not isinstance(payload, dict):
        return {}, str(p), False
    return payload, str(p), True


def load_runtime_context() -> RuntimeContext:
    profile, profile_path, profile_loaded = _safe_profile_doc(
        os.getenv("RUNTIME_PROFILE_PATH") or settings.RUNTIME_PROFILE_PATH
    )

    mode = _normalize_mode(
        os.getenv("APP_RUNTIME_MODE")
        or profile.get("mode")
        or settings.APP_RUNTIME_MODE
    )

    backend_origin_raw = (
        os.getenv("APP_BACKEND_ORIGIN")
        or str(profile.get("backend_origin") or "").strip()
        or settings.APP_BACKEND_ORIGIN
    ).strip().lower()
    if backend_origin_raw in {"local", "remote"}:
        backend_origin: BackendOrigin = backend_origin_raw  # type: ignore[assignment]
    else:
        backend_origin = "remote" if mode == "desktop_remote_slim" else "local"

    local_ports_obj = profile.get("local_ports")
    if not isinstance(local_ports_obj, dict):
        local_ports_obj = {}
    local_ports = {
        "web": _parse_int(local_ports_obj.get("web"), 3000),
        "backend": _parse_int(local_ports_obj.get("backend"), 8080),
        "mongo": _parse_int(local_ports_obj.get("mongo"), 27017),
    }

    data_dir = (
        str(os.getenv("APP_DATA_DIR") or "").strip()
        or str(profile.get("data_dir") or "").strip()
        or None
    )
    build_sha = str(os.getenv("APP_BUILD_SHA") or settings.APP_BUILD_SHA or "").strip() or None
    desktop_session_id = str(os.getenv("DESKTOP_SESSION_ID") or settings.DESKTOP_SESSION_ID or "").strip() or None
    storage_engine = str(os.getenv("APP_STORAGE_ENGINE") or settings.APP_STORAGE_ENGINE or "mongo").strip() or "mongo"
    app_version = str(os.getenv("APP_VERSION") or settings.APP_VERSION or "dev").strip() or "dev"

    feature_flags = {
        "workspace": True,
        "local_tools": True,
        "automations": True,
        "notifications": True,
        "local_backend": mode != "desktop_remote_slim",
        "local_mongo": mode == "desktop_local_fullstack",
    }

    return RuntimeContext(
        mode=mode,
        backend_origin=backend_origin,
        storage_engine=storage_engine,
        app_version=app_version,
        build_sha=build_sha,
        desktop_session_id=desktop_session_id,
        profile_path=profile_path,
        profile_loaded=profile_loaded,
        data_dir=data_dir,
        local_ports=local_ports,
        feature_flags=feature_flags,
    )


def runtime_info_payload() -> dict[str, Any]:
    ctx = load_runtime_context()
    return {
        "mode": ctx.mode,
        "storage_engine": ctx.storage_engine,
        "backend_origin": ctx.backend_origin,
        "version": ctx.app_version,
        "build_sha": ctx.build_sha,
        "desktop_session_id": ctx.desktop_session_id,
        "profile_path": ctx.profile_path,
        "profile_loaded": ctx.profile_loaded,
        "data_dir": ctx.data_dir,
        "local_ports": ctx.local_ports,
        "features": ctx.feature_flags,
    }
