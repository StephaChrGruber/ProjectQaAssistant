import base64
import httpx
from ..rag.text import chunk_text

def _wanted(path: str, prefixes: list[str] | None) -> bool:
    if not prefixes:
        return True
    return any(path == p or path.startswith(p.rstrip("/") + "/") for p in prefixes)

def _is_text_file(path: str) -> bool:
    # POC heuristic
    lower = path.lower()
    return any(lower.endswith(ext) for ext in [
        ".md", ".txt", ".rst", ".py", ".js", ".ts", ".tsx", ".json", ".yml", ".yaml",
        ".java", ".kt", ".cs", ".sql", ".html", ".css"
    ])

async def fetch_github_docs(config: dict) -> list[dict]:
    token = config["token"]
    owner = config["owner"]
    repo = config["repo"]
    branch = config.get("branch", "main")
    prefixes = config.get("paths")  # optional

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # 1) Get tree SHA for branch
    async with httpx.AsyncClient(timeout=60) as client:
        ref = await client.get(f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{branch}", headers=headers)
        ref.raise_for_status()
        sha = ref.json()["object"]["sha"]

        # 2) Get recursive tree
        tree = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}",
            headers=headers,
            params={"recursive": "1"},
        )
        tree.raise_for_status()
        items = tree.json().get("tree", [])

        docs = []
        for it in items:
            if it.get("type") != "blob":
                continue
            path = it.get("path", "")
            if not _wanted(path, prefixes):
                continue
            if not _is_text_file(path):
                continue

            # 3) Fetch file content
            cont = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
                headers=headers,
                params={"ref": branch},
            )
            if cont.status_code != 200:
                continue
            j = cont.json()
            if j.get("encoding") != "base64" or "content" not in j:
                continue

            raw = base64.b64decode(j["content"]).decode("utf-8", errors="ignore")
            url = j.get("html_url") or f"https://github.com/{owner}/{repo}/blob/{branch}/{path}"

            docs.append({
                "source": "github",
                "doc_id": path,
                "title": path,
                "url": url,
                "text": raw.strip(),
            })

        return docs

def to_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for d in docs:
        parts = chunk_text(d["text"])
        for idx, part in enumerate(parts):
            chunks.append({
                "id": f"github:{d['doc_id']}#{idx}",
                "text": part,
                "metadata": {
                    "source": d["source"],
                    "title": d["title"],
                    "url": d["url"],
                    "doc_id": d["doc_id"],
                    "chunk": idx,
                }
            })
    return chunks
