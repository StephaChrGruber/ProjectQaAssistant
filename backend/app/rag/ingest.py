from ..connectors.loader import load_connectors
from ..connectors import azure_devops, bitbucket, confluence, github, jira, local_repo
from .chroma_store import upsert_chunks, _collection
from ..settings import settings
import logging

logger = logging.getLogger(__name__)


async def ingest_project(project) -> dict:
    connectors = await load_connectors(str(project.id))

    total_docs = 0
    total_chunks = 0
    per_source = {}
    errors = {}

    for c in connectors:
        try:
            if c.type == "confluence":
                docs = await confluence.fetch_confluence_pages(c.config)
                chunks = confluence.to_chunks(docs)
            elif c.type == "jira":
                docs = await jira.fetch_jira_issues(c.config)
                chunks = jira.to_chunks(docs)
            elif c.type == "github":
                docs = await github.fetch_github_docs(c.config)
                chunks = github.to_chunks(docs)
            elif c.type == "bitbucket":
                docs = await bitbucket.fetch_bitbucket_docs(c.config)
                chunks = bitbucket.to_chunks(docs)
            elif c.type == "azure_devops":
                docs = await azure_devops.fetch_azure_devops_docs(c.config)
                chunks = azure_devops.to_chunks(docs)
            elif c.type == "local":
                docs = await local_repo.fetch_local_repo_docs(project, c.config)
                chunks = local_repo.to_chunks(docs)
            else:
                continue

            per_source[c.type] = {"docs": len(docs), "chunks": len(chunks)}
            total_docs += len(docs)
            total_chunks += len(chunks)

            if chunks:
                upsert_chunks(settings.CHROMA_ROOT, str(project.id), chunks)

        except Exception as e:
            errors[c.type] = str(e)
            per_source[c.type] = {"docs": 0, "chunks": 0}

    return {
        "projectId": str(project.id),
        "projectKey": project.key,
        "connectors": [c.type for c in connectors],
        "totalDocs": total_docs,
        "totalChunks": total_chunks,
        "perSource": per_source,
        "errors": errors,
    }
