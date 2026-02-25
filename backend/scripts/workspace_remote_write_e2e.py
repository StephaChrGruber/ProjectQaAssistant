from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


def _err(msg: str) -> None:
    print(f"[workspace-e2e] ERROR: {msg}", file=sys.stderr)


def _ok(msg: str) -> None:
    print(f"[workspace-e2e] {msg}")


def _backend_json(
    *,
    base_url: str,
    path: str,
    user: str,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout_sec: int = 40,
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    headers = {"X-Dev-User": user, "Content-Type": "application/json"}
    payload = json.dumps(body) if body is not None else None
    resp = requests.request(method.upper(), url, headers=headers, data=payload, timeout=timeout_sec)
    text = resp.text
    if resp.status_code >= 400:
        raise RuntimeError(f"{method} {path} failed ({resp.status_code}): {text[:600]}")
    try:
        return resp.json() if text.strip() else {}
    except Exception as err:
        raise RuntimeError(f"{method} {path} returned non-JSON response: {text[:400]}") from err


def run() -> int:
    parser = argparse.ArgumentParser(
        description="Workspace remote-write E2E harness. Writes a marker file via workspace API and verifies round-trip."
    )
    parser.add_argument("--base-url", default="http://localhost:8080", help="Backend URL, e.g. http://localhost:8080")
    parser.add_argument("--project-id", required=True, help="Project id")
    parser.add_argument("--branch", default="main", help="Target branch")
    parser.add_argument("--user", default="dev@local", help="X-Dev-User identity")
    parser.add_argument("--allow-write", action="store_true", help="Required to actually write")
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete the test artifact file after verification (creates one extra delete commit).",
    )
    parser.add_argument(
        "--cleanup-only",
        action="store_true",
        help="Only run cleanup/delete for --file-path and exit.",
    )
    parser.add_argument(
        "--file-path",
        default="documentation/.pqa-e2e/workspace-remote-write.md",
        help="Workspace-relative file path to write",
    )
    args = parser.parse_args()

    _ok(f"Checking workspace capabilities for project={args.project_id} branch={args.branch}")
    caps = _backend_json(
        base_url=args.base_url,
        path=f"/projects/{args.project_id}/workspace/capabilities?branch={args.branch}",
        user=args.user,
    )
    mode = str(caps.get("mode") or "")
    _ok(f"Mode: {mode}")
    if not mode.startswith("remote:"):
        _err("Project is not in remote connector mode. This harness only validates remote write.")
        return 2

    if args.cleanup_only:
        _ok(f"Cleanup-only: deleting {args.file_path} if it exists")
        cleanup_out = _backend_json(
            base_url=args.base_url,
            path=f"/projects/{args.project_id}/workspace/file/delete",
            user=args.user,
            method="POST",
            body={
                "branch": args.branch,
                "chat_id": f"workspace-e2e::{args.project_id}::{args.branch}::{args.user}",
                "path": args.file_path,
                "ignore_missing": True,
            },
            timeout_sec=80,
        )
        _ok(
            f"Cleanup result: deleted={bool(cleanup_out.get('deleted'))} "
            f"commit={cleanup_out.get('commit_id') or '<none>'}"
        )
        return 0

    if not args.allow_write:
        _ok("Dry run complete (no write). Re-run with --allow-write to execute mutation checks.")
        return 0

    marker = f"workspace_e2e_marker_{int(time.time())}"
    content = (
        f"# Workspace Remote Write E2E\n\n"
        f"- marker: `{marker}`\n"
        f"- project: `{args.project_id}`\n"
        f"- branch: `{args.branch}`\n"
        f"- timestamp_utc: `{datetime.now(tz=timezone.utc).isoformat()}`\n"
    )
    _ok(f"Writing marker file: {args.file_path}")
    write_out = _backend_json(
        base_url=args.base_url,
        path=f"/projects/{args.project_id}/workspace/file/write",
        user=args.user,
        method="POST",
        body={
            "branch": args.branch,
            "chat_id": f"workspace-e2e::{args.project_id}::{args.branch}::{args.user}",
            "path": args.file_path,
            "content": content,
        },
        timeout_sec=80,
    )
    _ok(f"Write OK: mode={write_out.get('mode')} commit={write_out.get('commit_id')}")

    _ok("Reading back file")
    read_out = _backend_json(
        base_url=args.base_url,
        path=(
            f"/projects/{args.project_id}/workspace/file"
            f"?branch={args.branch}&path={requests.utils.quote(args.file_path, safe='')}&allow_large=1"
        ),
        user=args.user,
    )
    read_content = str(read_out.get("content") or "")
    if marker not in read_content:
        _err("Round-trip validation failed: marker not found in read content")
        return 3

    mode = str(read_out.get("mode") or "")
    web_url = str(write_out.get("web_url") or read_out.get("web_url") or "")
    _ok(f"Round-trip OK (mode={mode})")
    if web_url:
        _ok(f"Web URL: {web_url}")

    if args.cleanup:
        _ok(f"Cleaning up test artifact: {args.file_path}")
        cleanup_out = _backend_json(
            base_url=args.base_url,
            path=f"/projects/{args.project_id}/workspace/file/delete",
            user=args.user,
            method="POST",
            body={
                "branch": args.branch,
                "chat_id": f"workspace-e2e::{args.project_id}::{args.branch}::{args.user}",
                "path": args.file_path,
                "ignore_missing": True,
            },
            timeout_sec=80,
        )
        _ok(
            f"Cleanup done: deleted={bool(cleanup_out.get('deleted'))} "
            f"commit={cleanup_out.get('commit_id') or '<none>'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
