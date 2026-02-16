from fastapi import APIRouter, Depends, HTTPException
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership
from ..rag.ingest import ingest_project

router = APIRouter(tags=["ingestion"])

@router.post("/admin/projects/{project_id}/ingest")
async def ingest(project_id: str, user=Depends(current_user)):
    # POC: require global admin OR project admin
    if not user.isGlobalAdmin:
        ms = await Membership.find_one(Membership.userId == str(user.id), Membership.projectId == project_id)
        if not ms or ms.role != "admin":
            raise HTTPException(403, "Admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    stats = await ingest_project(project)
    return stats
