import base64

import httpx

from ..rag.text import chunk_text


def _wanted(path: str, prefixes: list[str] | None) -> bool:
    if not prefixes:
        return True
    return any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes)


def _is_text_file(path: str) -> bool:
    lower = path.lower()
    return any(
        lower.endswith(ext)
        for ext in [
            ".md",
            ".txt",
            ".rst",
            ".py",
            ".js",
            ".ts",
            ".tsx",
            ".json",
            ".yml",
            ".yaml",
            ".java",
            ".kt",
            ".cs",
            ".sql",
            ".html",
            ".css",
            ".go",
            ".rs",
        ]
    )


def _headers(config: dict) -> dict[str, str]:
    pat = str(config.get("pat") or config.get("token") or "").strip()
    if not pat:
        return {}
    token = base64.b64encode(f":{pat}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def _base_url(config: dict) -> str:
    base = str(config.get("base_url") or config.get("baseUrl") or "https://dev.azure.com").strip()
    return base.rstrip("/")


def _repo_path(config: dict) -> tuple[str, str, str]:
    organization = str(config.get("organization") or config.get("org") or "").strip()
    project = str(config.get("project") or "").strip()
    repository = str(config.get("repository") or config.get("repo") or "").strip()
    return organization, project, repository


async def _list_tree(config: dict, branch: str) -> list[str]:
    organization, project, repository = _repo_path(config)
    if not organization or not project or not repository:
        return []

    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    headers = _headers(config)
    base = _base_url(config)
    endpoint = f"{base}/{organization}/{project}/_apis/git/repositories/{repository}/items"

    params = {
        "scopePath": "/",
        "recursionLevel": "Full",
        "includeContentMetadata": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": branch,
        "api-version": api_version,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(endpoint, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json() or {}

    out: list[str] = []
    for item in data.get("value") or []:
        if bool(item.get("isFolder")):
            continue
        p = str(item.get("path") or "").lstrip("/").strip()
        if p:
            out.append(p)
    return out


async def _open_file(config: dict, path: str, branch: str) -> str:
    organization, project, repository = _repo_path(config)
    if not organization or not project or not repository:
        return ""

    api_version = str(config.get("api_version") or "7.1").strip() or "7.1"
    headers = _headers(config)
    base = _base_url(config)
    endpoint = f"{base}/{organization}/{project}/_apis/git/repositories/{repository}/items"

    params = {
        "path": f"/{path.lstrip('/')}",
        "includeContent": "true",
        "versionDescriptor.versionType": "branch",
        "versionDescriptor.version": branch,
        "api-version": api_version,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(endpoint, headers=headers, params=params)
        if resp.status_code != 200:
            return ""
        ctype = str(resp.headers.get("content-type") or "").lower()
        if "application/json" in ctype:
            data = resp.json() or {}
            content = data.get("content")
            if isinstance(content, str):
                return content

        # Fallback: request as raw download.
        raw_params = {
            "path": f"/{path.lstrip('/')}",
            "download": "true",
            "versionDescriptor.versionType": "branch",
            "versionDescriptor.version": branch,
            "api-version": api_version,
        }
        raw_resp = await client.get(endpoint, headers=headers, params=raw_params)
        if raw_resp.status_code != 200:
            return ""
        return raw_resp.text


async def fetch_azure_devops_docs(config: dict) -> list[dict]:
    organization, project, repository = _repo_path(config)
    branch = str(config.get("branch") or "main").strip() or "main"
    prefixes = config.get("paths")

    paths = await _list_tree(config, branch)

    docs: list[dict] = []
    for path in paths:
        if not _wanted(path, prefixes):
            continue
        if not _is_text_file(path):
            continue
        raw = await _open_file(config, path, branch)
        if not raw:
            continue
        docs.append(
            {
                "source": "azure_devops",
                "doc_id": path,
                "title": path,
                "url": f"https://dev.azure.com/{organization}/{project}/_git/{repository}?path=/{path}&version=GB{branch}",
                "text": raw.strip(),
            }
        )

    return docs


def to_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for d in docs:
        parts = chunk_text(d["text"])
        for idx, part in enumerate(parts):
            chunks.append(
                {
                    "id": f"azure_devops:{d['doc_id']}#{idx}",
                    "text": part,
                    "metadata": {
                        "source": d["source"],
                        "title": d["title"],
                        "url": d["url"],
                        "doc_id": d["doc_id"],
                        "chunk": idx,
                    },
                }
            )
    return chunks
