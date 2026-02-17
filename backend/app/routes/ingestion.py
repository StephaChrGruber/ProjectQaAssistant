from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership
from ..rag.ingest import ingest_project
from ..db import get_db

router = APIRouter(tags=["ingestion"])


class IncrementalIngestReq(BaseModel):
    connectors: list[str] = Field(default_factory=list)
    reason: str | None = None


class WebhookIngestReq(BaseModel):
    connector: str
    reason: str | None = None
    payload: dict = Field(default_factory=dict)


async def _require_project_admin(project_id: str, user):
    # POC: require global admin OR project admin
    if not user.isGlobalAdmin:
        ms = await Membership.find_one(Membership.userId == str(user.id), Membership.projectId == project_id)
        if not ms or ms.role != "admin":
            raise HTTPException(403, "Admin required")


async def _record_ingest_state(
    *,
    project_id: str,
    mode: str,
    reason: str | None,
    requested_connectors: list[str],
    stats: dict,
) -> None:
    db = get_db()
    now = datetime.utcnow()
    await db["ingestion_runs"].insert_one(
        {
            "project_id": project_id,
            "mode": mode,
            "reason": reason or "",
            "requested_connectors": requested_connectors,
            "stats": stats,
            "created_at": now,
        }
    )
    per_source = (stats or {}).get("perSource") or {}
    for connector_type in per_source.keys():
        await db["ingestion_state"].update_one(
            {"project_id": project_id, "connector": connector_type},
            {
                "$set": {
                    "last_ingested_at": now,
                    "last_mode": mode,
                    "last_reason": reason or "",
                }
            },
            upsert=True,
        )


@router.post("/admin/projects/{project_id}/ingest")
async def ingest(project_id: str, user=Depends(current_user)):
    await _require_project_admin(project_id, user)

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    stats = await ingest_project(project)
    await _record_ingest_state(
        project_id=project_id,
        mode="full",
        reason="manual",
        requested_connectors=[],
        stats=stats,
    )
    return stats


@router.post("/admin/projects/{project_id}/ingest/incremental")
async def ingest_incremental(project_id: str, req: IncrementalIngestReq, user=Depends(current_user)):
    await _require_project_admin(project_id, user)

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    connectors = [str(c).strip() for c in (req.connectors or []) if str(c).strip()]
    stats = await ingest_project(project, connectors_filter=connectors or None)
    await _record_ingest_state(
        project_id=project_id,
        mode="incremental",
        reason=req.reason or "manual_incremental",
        requested_connectors=connectors,
        stats=stats,
    )
    return {**stats, "mode": "incremental", "requested_connectors": connectors}


@router.post("/admin/projects/{project_id}/ingest/webhook")
async def ingest_webhook(project_id: str, req: WebhookIngestReq, user=Depends(current_user)):
    await _require_project_admin(project_id, user)

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    connector = str(req.connector or "").strip()
    if not connector:
        raise HTTPException(400, "connector is required")

    stats = await ingest_project(project, connectors_filter=[connector])
    await _record_ingest_state(
        project_id=project_id,
        mode="webhook",
        reason=req.reason or "webhook",
        requested_connectors=[connector],
        stats=stats,
    )
    return {**stats, "mode": "webhook", "requested_connectors": [connector]}


@router.get("/admin/projects/{project_id}/ingest/state")
async def ingest_state(project_id: str, hours: int = 24 * 30, user=Depends(current_user)):
    await _require_project_admin(project_id, user)
    safe_hours = max(1, min(int(hours), 24 * 180))
    since = datetime.utcnow() - timedelta(hours=safe_hours)

    db = get_db()
    rows = await db["ingestion_runs"].find(
        {"project_id": project_id, "created_at": {"$gte": since}},
        {"_id": 0},
    ).sort("created_at", -1).limit(120).to_list(length=120)
    state_rows = await db["ingestion_state"].find({"project_id": project_id}, {"_id": 0}).to_list(length=100)
    return {
        "project_id": project_id,
        "hours": safe_hours,
        "runs": rows,
        "connectors": state_rows,
    }
