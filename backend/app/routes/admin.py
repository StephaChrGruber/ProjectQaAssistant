from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership, Connector

router = APIRouter()

class CreateProject(BaseModel):
    key: str
    name: str
    description: str | None = None
    repo_path: str | None = None
    default_branch: str = "main"
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None


class UpdateProject(BaseModel):
    name: str | None = None
    description: str | None = None
    repo_path: str | None = None
    default_branch: str | None = None
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None


class UpsertConnector(BaseModel):
    isEnabled: bool = True
    config: dict = {}


def _serialize_project(p: Project) -> dict:
    return {
        "id": str(p.id),
        "key": p.key,
        "name": p.name,
        "description": p.description,
        "repo_path": p.repo_path,
        "default_branch": p.default_branch,
        "llm_provider": p.llm_provider,
        "llm_base_url": p.llm_base_url,
        "llm_model": p.llm_model,
        "llm_api_key": p.llm_api_key,
        "createdAt": p.createdAt.isoformat() if p.createdAt else None,
    }

@router.post("/admin/projects")
async def create_project(req: CreateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    existing = await Project.find_one(Project.key == req.key)
    if existing:
        raise HTTPException(409, "Project key already exists")

    p = Project(
        key=req.key,
        name=req.name,
        description=req.description,
        repo_path=req.repo_path,
        default_branch=req.default_branch or "main",
        llm_provider=req.llm_provider,
        llm_base_url=req.llm_base_url,
        llm_model=req.llm_model,
        llm_api_key=req.llm_api_key,
    )
    await p.insert()

    # Make creator admin member (optional)
    await Membership(userId=str(user.id), projectId=str(p.id), role="admin").insert()
    return _serialize_project(p)


@router.get("/admin/projects")
async def list_projects(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    projects = await Project.find_all().to_list()
    out = []
    for p in projects:
        connectors = await Connector.find(Connector.projectId == str(p.id)).to_list()
        out.append(
            {
                **_serialize_project(p),
                "connectors": [
                    {
                        "id": str(c.id),
                        "type": c.type,
                        "isEnabled": c.isEnabled,
                        "config": c.config,
                        "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
                    }
                    for c in connectors
                ],
            }
        )
    return out


@router.patch("/admin/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")

    data = req.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    await p.save()

    return _serialize_project(p)


@router.get("/admin/projects/{project_id}/connectors")
async def list_project_connectors(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    connectors = await Connector.find(Connector.projectId == project_id).to_list()
    return [
        {
            "id": str(c.id),
            "type": c.type,
            "isEnabled": c.isEnabled,
            "config": c.config,
            "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
        }
        for c in connectors
    ]


@router.put("/admin/projects/{project_id}/connectors/{connector_type}")
async def upsert_connector(
    project_id: str,
    connector_type: str,
    req: UpsertConnector,
    user=Depends(current_user),
):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if connector_type not in ("confluence", "jira", "github"):
        raise HTTPException(400, "Invalid connector type")

    existing = await Connector.find_one(Connector.projectId == project_id, Connector.type == connector_type)
    now = datetime.utcnow()

    if existing:
        existing.isEnabled = req.isEnabled
        existing.config = req.config
        existing.updatedAt = now
        await existing.save()
        doc = existing
    else:
        doc = Connector(
            projectId=project_id,
            type=connector_type,
            isEnabled=req.isEnabled,
            config=req.config,
            createdAt=now,
            updatedAt=now,
        )
        await doc.insert()

    return {
        "id": str(doc.id),
        "type": doc.type,
        "isEnabled": doc.isEnabled,
        "config": doc.config,
        "updatedAt": doc.updatedAt.isoformat() if doc.updatedAt else None,
    }
