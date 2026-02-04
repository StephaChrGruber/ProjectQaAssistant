import base64
import httpx
from ..rag.text import strip_html, chunk_text

async def fetch_confluence_pages(config: dict) -> list[dict]:
    base = config["baseUrl"].rstrip("/")
    space = config["spaceKey"]
    email = config["email"]
    token = config["apiToken"]

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}"}

    # Pages listing (simple)
    url = f"{base}/rest/api/content"
    params = {
        "spaceKey": space,
        "type": "page",
        "limit": 50,
        "expand": "body.storage,version,space",
    }

    docs = []
    async with httpx.AsyncClient(timeout=60) as client:
        start = 0
        while True:
            params["start"] = start
            r = await client.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            if not results:
                break

            for p in results:
                pid = p["id"]
                title = p.get("title", f"page-{pid}")
                body_html = p.get("body", {}).get("storage", {}).get("value", "") or ""
                text = strip_html(body_html)

                # canonical web UI URL
                # base is ".../wiki"
                webui = f"{base}/spaces/{space}/pages/{pid}"

                docs.append({
                    "source": "confluence",
                    "doc_id": pid,
                    "title": title,
                    "url": webui,
                    "text": text,
                })

            # pagination
            if len(results) < params["limit"]:
                break
            start += params["limit"]

    return docs

def to_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for d in docs:
        parts = chunk_text(d["text"])
        for idx, part in enumerate(parts):
            chunks.append({
                "id": f"confluence:{d['doc_id']}#{idx}",
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
