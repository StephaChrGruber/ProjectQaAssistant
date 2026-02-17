import base64
from urllib.parse import quote

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
    token = str(config.get("token") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}

    username = str(config.get("username") or "").strip()
    app_password = str(config.get("app_password") or config.get("appPassword") or "").strip()
    if username and app_password:
        auth = base64.b64encode(f"{username}:{app_password}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {auth}"}
    return {}


def _base_url(config: dict) -> str:
    base = str(config.get("base_url") or config.get("baseUrl") or "https://api.bitbucket.org/2.0").strip()
    return base.rstrip("/")


async def _list_tree(config: dict, branch: str) -> list[str]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return []

    headers = _headers(config)
    base = _base_url(config)
    url = f"{base}/repositories/{workspace}/{repo_slug}/src/{quote(branch, safe='')}"

    paths: list[str] = []
    async with httpx.AsyncClient(timeout=60) as client:
        next_url = url
        params = {"pagelen": 100}
        while next_url:
            resp = await client.get(next_url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json() or {}
            values = data.get("values") or []
            for item in values:
                if str(item.get("type") or "") != "commit_file":
                    continue
                p = str(item.get("path") or "").strip()
                if p:
                    paths.append(p)
            next_url = data.get("next")
            params = None
    return paths


async def _open_file(config: dict, path: str, branch: str) -> str:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
    if not workspace or not repo_slug:
        return ""

    headers = _headers(config)
    base = _base_url(config)
    endpoint = f"{base}/repositories/{workspace}/{repo_slug}/src/{quote(branch, safe='')}/{quote(path, safe='/')}"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(endpoint, headers=headers)
        if resp.status_code != 200:
            return ""
        return resp.text


async def fetch_bitbucket_docs(config: dict) -> list[dict]:
    workspace = str(config.get("workspace") or "").strip()
    repo_slug = str(config.get("repo_slug") or config.get("repo") or "").strip()
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
                "source": "bitbucket",
                "doc_id": path,
                "title": path,
                "url": f"https://bitbucket.org/{workspace}/{repo_slug}/src/{branch}/{path}",
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
                    "id": f"bitbucket:{d['doc_id']}#{idx}",
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
