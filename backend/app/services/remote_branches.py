from __future__ import annotations

import base64
import logging
import subprocess
from pathlib import Path
from typing import Any

import httpx

from ..repositories.factory import repository_factory

logger = logging.getLogger(__name__)


def ordered_branches(default_branch: str, branches: list[str]) -> list[str]:
    default = (default_branch or "main").strip() or "main"
    seen: set[str] = set()
    out: list[str] = []
    if default:
        out.append(default)
        seen.add(default)
    for raw in branches:
        name = str(raw or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out or [default]


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _bitbucket_headers(config: dict[str, Any]) -> dict[str, str]:
    token = str(config.get("token") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}
    username = str(config.get("username") or "").strip()
    app_password = str(config.get("app_password") or config.get("appPassword") or "").strip()
    if username and app_password:
        raw = f"{username}:{app_password}".encode("utf-8")
        return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}
    return {}


def _bitbucket_base_url(config: dict[str, Any]) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://api.bitbucket.org/2.0").rstrip("/")


def _azure_headers(config: dict[str, Any]) -> dict[str, str]:
    pat = str(config.get("pat") or config.get("token") or "").strip()
    if not pat:
        return {}
    raw = f":{pat}".encode("utf-8")
    return {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}


def _azure_base_url(config: dict[str, Any]) -> str:
    return str(config.get("base_url") or config.get("baseUrl") or "https://dev.azure.com").rstrip("/")


def _azure_parts(config: dict[str, Any]) -> tuple[str, str, str]:
    org = str(config.get("organization") or config.get("org") or "").strip()
    project = str(config.get("project") or "").strip()
    repo = str(config.get("repository") or config.get("repo") or "").strip()
    return org, project, repo


async def _github_branches(config: dict[str, Any], limit: int = 400) -> list[str]:
    owner = str(config.get("owner") or "").strip()
    repo = str(config.get("repo") or "").strip()
    if not owner or not repo:
        return []
    headers = _github_headers(str(config.get("token") or "").strip())
    out: list[str] = []
    async with httpx.AsyncClient(timeout=20) as client:
        page = 1
        while len(out) < limit:
            res = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/branches",
                headers=headers,
                params={"per_page": 100, "page": page},
            )
            res.raise_for_status()
            rows = res.json() or []
            if not isinstance(rows, list) or not rows:
                break
            for row in rows:
                name = str((row or {}).get("name") or "").strip()
                if name:
                    out.append(name)
                if len(out) >= limit:
                    break
            if len(rows) < 100:
                break
            page += 1
    return out


async def _bitbucket_branches(config: dict[str, Any], limit: int = 400) -> list[str]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return []
    endpoint = f"{_bitbucket_base_url(config)}/repositories/{workspace}/{repo_slug}/refs/branches"
    out: list[str] = []
    async with httpx.AsyncClient(timeout=20) as client:
        next_url: str | None = endpoint
        params: dict[str, Any] | None = {"pagelen": 100}
        while next_url and len(out) < limit:
            res = await client.get(next_url, headers=_bitbucket_headers(config), params=params)
            res.raise_for_status()
            body = res.json() or {}
            rows = body.get("values") or []
            if not isinstance(rows, list):
                rows = []
            for row in rows:
                name = str((row or {}).get("name") or "").strip()
                if name:
                    out.append(name)
                if len(out) >= limit:
                    break
            next_url = body.get("next")
            params = None
    return out


async def _azure_branches(config: dict[str, Any], limit: int = 1000) -> list[str]:
    org, project, repo = _azure_parts(config)
    if not org or not project or not repo:
        return []
    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    endpoint = f"{_azure_base_url(config)}/{org}/{project}/_apis/git/repositories/{repo}/refs"
    out: list[str] = []
    continuation: str | None = None
    async with httpx.AsyncClient(timeout=20) as client:
        while len(out) < limit:
            params: dict[str, Any] = {
                "filter": "heads/",
                "$top": min(1000, limit),
                "api-version": api_version,
            }
            if continuation:
                params["continuationToken"] = continuation
            res = await client.get(endpoint, headers=_azure_headers(config), params=params)
            res.raise_for_status()
            body = res.json() or {}
            rows = body.get("value") or []
            if not isinstance(rows, list):
                rows = []
            for row in rows:
                raw = str((row or {}).get("name") or "").strip()
                name = raw.removeprefix("refs/heads/") if raw.startswith("refs/heads/") else raw
                if name:
                    out.append(name)
                if len(out) >= limit:
                    break
            continuation = str(res.headers.get("x-ms-continuationtoken") or "").strip() or None
            if not continuation:
                break
    return out


async def remote_project_branches(project_id: str, default_branch: str) -> list[str]:
    logger.info("projects.branches.remote_lookup.start project=%s default=%s", project_id, default_branch)
    rows = await repository_factory().access_policy.list_enabled_connectors(
        project_id=project_id,
        types=["github", "git", "bitbucket", "azure_devops"],
        limit=20,
    )
    by_type = {str(r.get("type") or ""): r for r in rows}
    for connector_type in ("github", "git", "bitbucket", "azure_devops"):
        row = by_type.get(connector_type)
        if not row:
            continue
        config = row.get("config") or {}
        try:
            if connector_type in {"github", "git"}:
                out = ordered_branches(default_branch, await _github_branches(config))
                logger.info(
                    "projects.branches.remote_lookup.done project=%s connector=%s count=%s",
                    project_id,
                    connector_type,
                    len(out),
                )
                return out
            if connector_type == "bitbucket":
                out = ordered_branches(default_branch, await _bitbucket_branches(config))
                logger.info("projects.branches.remote_lookup.done project=%s connector=bitbucket count=%s", project_id, len(out))
                return out
            if connector_type == "azure_devops":
                out = ordered_branches(default_branch, await _azure_branches(config))
                logger.info(
                    "projects.branches.remote_lookup.done project=%s connector=azure_devops count=%s",
                    project_id,
                    len(out),
                )
                return out
        except Exception:
            logger.exception("projects.branches.remote_lookup.failed project=%s connector=%s", project_id, connector_type)
            continue
    logger.info("projects.branches.remote_lookup.fallback project=%s default=%s", project_id, default_branch)
    return [default_branch]


async def list_project_branches(project_id: str, project_doc: dict[str, Any]) -> list[str]:
    default_branch = (project_doc.get("default_branch") or "main").strip() or "main"
    repo_path = (project_doc.get("repo_path") or "").strip()
    logger.info(
        "projects.branches.start project=%s default=%s repo_path_set=%s",
        project_id,
        default_branch,
        bool(repo_path),
    )
    if not repo_path:
        branches = await remote_project_branches(project_id, default_branch)
        logger.info("projects.branches.done project=%s mode=remote_only count=%s", project_id, len(branches))
        return branches

    if repo_path.lower().startswith("browser-local://"):
        extra = project_doc.get("extra") if isinstance(project_doc.get("extra"), dict) else {}
        browser_local = extra.get("browser_local") if isinstance(extra.get("browser_local"), dict) else {}
        active_branch = str(browser_local.get("active_branch") or "").strip()
        known = browser_local.get("branches") if isinstance(browser_local.get("branches"), list) else []
        candidates: list[str] = []
        if active_branch:
            candidates.append(active_branch)
        candidates.extend([str(x or "").strip() for x in known])
        branches = ordered_branches(default_branch, candidates)
        logger.info("projects.branches.done project=%s mode=browser_local count=%s", project_id, len(branches))
        return branches

    if not Path(repo_path).exists():
        branches = await remote_project_branches(project_id, default_branch)
        logger.info("projects.branches.done project=%s mode=repo_missing_remote_fallback count=%s", project_id, len(branches))
        return branches

    try:
        proc = subprocess.run(
            [
                "git",
                "-C",
                repo_path,
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes/origin",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except Exception:
        return [default_branch]

    if proc.returncode != 0:
        logger.warning(
            "projects.branches.local_git_failed project=%s repo_path=%s returncode=%s",
            project_id,
            repo_path,
            proc.returncode,
        )
        return [default_branch]

    seen: set[str] = set()
    branches: list[str] = []
    for line in proc.stdout.splitlines():
        item = line.strip()
        if not item or item == "origin/HEAD":
            continue
        if item.startswith("origin/"):
            item = item[7:]
        if item and item not in seen:
            seen.add(item)
            branches.append(item)

    if default_branch in seen:
        branches = [default_branch] + [b for b in branches if b != default_branch]
    elif branches:
        branches = [default_branch] + branches
    else:
        branches = [default_branch]

    logger.info("projects.branches.done project=%s mode=local count=%s", project_id, len(branches))
    return branches
