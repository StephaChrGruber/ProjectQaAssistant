from ..connectors.loader import load_connectors
from ..connectors import confluence, jira, github
from .chroma_store import upsert_chunks
from ..settings import settings

async def ingest_project(project) -> dict:
    """
    project: Project document
    returns stats
    """
    connectors = await load_connectors(str(project.id))

    total_docs = 0
    total_chunks = 0
    per_source = {}

    for c in connectors:
        if c.type == "confluence":
            docs = await confluence.fetch_confluence_pages(c.config)
            chunks = confluence.to_chunks(docs)
        elif c.type == "jira":
            docs = await jira.fetch_jira_issues(c.config)
            chunks = jira.to_chunks(docs)
        elif c.type == "github":
            docs = await github.fetch_github_docs(c.config)
            chunks = github.to_chunks(docs)
        else:
            continue

        total_docs += len(docs)
        total_chunks += len(chunks)
        per_source[c.type] = {"docs": len(docs), "chunks": len(chunks)}

        if chunks:
            upsert_chunks(settings.CHROMA_ROOT, project.key, chunks)

    return {
        "projectKey": project.key,
        "connectors": [c.type for c in connectors],
        "totalDocs": total_docs,
        "totalChunks": total_chunks,
        "perSource": per_source,
    }
