import base64
import httpx
from ..rag.text import chunk_text

def _adf_to_text(value) -> str:
    """
    Jira Cloud issue description is often Atlassian Document Format (ADF).
    This is a minimal POC extractor that pulls "text" nodes.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        t = ""
        if value.get("type") == "text" and "text" in value:
            t += value["text"]
        for c in value.get("content", []) or []:
            t += " " + _adf_to_text(c)
        return t.strip()
    if isinstance(value, list):
        return " ".join(_adf_to_text(x) for x in value).strip()
    return ""

async def fetch_jira_issues(config: dict) -> list[dict]:
    base = config["baseUrl"].rstrip("/")
    email = config["email"]
    token = config["apiToken"]
    jql = config["jql"]

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}

    url = f"{base}/rest/api/3/search"
    payload = {
        "jql": jql,
        "maxResults": 50,
        "fields": ["summary", "description", "updated", "issuetype", "project"],
    }

    docs = []
    async with httpx.AsyncClient(timeout=60) as client:
        start = 0
        while True:
            payload["startAt"] = start
            r = await client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
            issues = data.get("issues", [])
            if not issues:
                break

            for it in issues:
                key = it["key"]
                fields = it.get("fields", {})
                summary = fields.get("summary", key)
                desc = _adf_to_text(fields.get("description"))
                text = f"{summary}\n\n{desc}".strip()
                webui = f"{base}/browse/{key}"

                docs.append({
                    "source": "jira",
                    "doc_id": key,
                    "title": f"{key}: {summary}",
                    "url": webui,
                    "text": text,
                })

            if len(issues) < payload["maxResults"]:
                break
            start += payload["maxResults"]

    return docs

def to_chunks(docs: list[dict]) -> list[dict]:
    chunks = []
    for d in docs:
        parts = chunk_text(d["text"])
        for idx, part in enumerate(parts):
            chunks.append({
                "id": f"jira:{d['doc_id']}#{idx}",
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
