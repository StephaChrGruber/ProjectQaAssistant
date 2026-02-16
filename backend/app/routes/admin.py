from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership

router = APIRouter()

class CreateProject(BaseModel):
    key: str
    name: str
    description: str | None = None

@router.post("/admin/projects")
async def create_project(req: CreateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    existing = await Project.find_one(Project.key == req.key)
    if existing:
        raise HTTPException(409, "Project key already exists")

    p = Project(key=req.key, name=req.name, description=req.description)
    await p.insert()

    # Make creator admin member (optional)
    await Membership(userId=str(user.id), projectId=str(p.id), role="admin").insert()
    return {"id": str(p.id), "key": p.key, "name": p.name}
