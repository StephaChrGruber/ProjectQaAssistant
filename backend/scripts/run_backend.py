#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os

import uvicorn


def _set_env(name: str, value: str | None) -> None:
    if value is None:
        return
    clean = str(value).strip()
    if clean:
        os.environ[name] = clean


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Project QA backend with desktop runtime options.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--app", default="app.main:app")

    parser.add_argument("--runtime-mode", choices=["server", "desktop_local_fullstack", "desktop_remote_slim", "local_fullstack", "remote_slim"])
    parser.add_argument("--backend-origin", choices=["local", "remote"])
    parser.add_argument("--storage-engine", default=None)
    parser.add_argument("--runtime-profile-path", default=None)
    parser.add_argument("--desktop-session-id", default=None)
    parser.add_argument("--app-version", default=None)
    parser.add_argument("--app-build-sha", default=None)
    parser.add_argument("--mongodb-uri", default=None)
    parser.add_argument("--mongodb-db", default=None)

    args = parser.parse_args()

    _set_env("APP_RUNTIME_MODE", args.runtime_mode)
    _set_env("APP_BACKEND_ORIGIN", args.backend_origin)
    _set_env("APP_STORAGE_ENGINE", args.storage_engine)
    _set_env("RUNTIME_PROFILE_PATH", args.runtime_profile_path)
    _set_env("DESKTOP_SESSION_ID", args.desktop_session_id)
    _set_env("APP_VERSION", args.app_version)
    _set_env("APP_BUILD_SHA", args.app_build_sha)
    _set_env("MONGODB_URI", args.mongodb_uri)
    _set_env("MONGODB_DB", args.mongodb_db)

    uvicorn.run(args.app, host=args.host, port=int(args.port), reload=bool(args.reload))


if __name__ == "__main__":
    main()

