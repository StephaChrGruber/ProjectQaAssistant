from ..connectors.loader import load_connectors
from ..connectors import azure_devops, bitbucket, confluence, github, jira, local_repo
from .chroma_store import upsert_chunks, _collection
from ..settings import settings
import logging
from types import SimpleNamespace

logger = logging.getLogger(__name__)


async def ingest_project(project, *, connectors_filter: list[str] | None = None) -> dict:
    connectors = await load_connectors(str(project.id))
    wanted = {str(x).strip() for x in (connectors_filter or []) if str(x).strip()}
    include_local = (not connectors_filter) or ("local" in wanted)
    if connectors_filter:
        connectors = [c for c in connectors if c.type in wanted]

    has_local_connector = any(getattr(c, "type", "") == "local" for c in connectors)
    synthetic_local_added = False
    if include_local and not has_local_connector:
        # Local source should be available even when no explicit local connector document exists.
        connectors.append(SimpleNamespace(type="local", config={}))
        synthetic_local_added = True
        logger.info(
            "ingest.local_source.synthetic_added project=%s repo_path=%s",
            str(project.id),
            str(getattr(project, "repo_path", "") or ""),
        )
    connector_types = [str(getattr(c, "type", "") or "") for c in connectors]
    logger.info(
        "ingest.project.start project=%s key=%s requested=%s include_local=%s synthetic_local=%s effective=%s",
        str(project.id),
        str(getattr(project, "key", "") or ""),
        sorted(list(wanted)) if connectors_filter else [],
        include_local,
        synthetic_local_added,
        connector_types,
    )

    total_docs = 0
    total_chunks = 0
    per_source = {}
    errors = {}

    for c in connectors:
        ctype = str(getattr(c, "type", "") or "")
        try:
            if ctype == "confluence":
                docs = await confluence.fetch_confluence_pages(c.config)
                chunks = confluence.to_chunks(docs)
            elif ctype == "jira":
                docs = await jira.fetch_jira_issues(c.config)
                chunks = jira.to_chunks(docs)
            elif ctype == "github":
                docs = await github.fetch_github_docs(c.config)
                chunks = github.to_chunks(docs)
            elif ctype == "bitbucket":
                docs = await bitbucket.fetch_bitbucket_docs(c.config)
                chunks = bitbucket.to_chunks(docs)
            elif ctype == "azure_devops":
                docs = await azure_devops.fetch_azure_devops_docs(c.config)
                chunks = azure_devops.to_chunks(docs)
            elif ctype == "local":
                docs = await local_repo.fetch_local_repo_docs(project, c.config)
                chunks = local_repo.to_chunks(docs)
            else:
                continue

            per_source[ctype] = {"docs": len(docs), "chunks": len(chunks)}
            total_docs += len(docs)
            total_chunks += len(chunks)
            logger.info(
                "ingest.source.done project=%s source=%s docs=%s chunks=%s",
                str(project.id),
                ctype,
                len(docs),
                len(chunks),
            )

            if chunks:
                upsert_chunks(settings.CHROMA_ROOT, str(project.id), chunks)

        except Exception as e:
            errors[ctype] = str(e)
            per_source[ctype] = {"docs": 0, "chunks": 0}
            logger.exception("ingest.source.failed project=%s source=%s", str(project.id), ctype)

    logger.info(
        "ingest.project.done project=%s total_docs=%s total_chunks=%s sources=%s errors=%s",
        str(project.id),
        total_docs,
        total_chunks,
        list(per_source.keys()),
        list(errors.keys()),
    )
    return {
        "projectId": str(project.id),
        "projectKey": project.key,
        "connectors": connector_types,
        "totalDocs": total_docs,
        "totalChunks": total_chunks,
        "perSource": per_source,
        "errors": errors,
    }
