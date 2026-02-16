from fastapi import APIRouter, Depends
from pydantic import BaseModel
from ..deps import require_project_role, current_user
from ..models.base_mongo_models import Project, AuditLog
from ..settings import settings
from ..rag.rag import answer

router = APIRouter()

class AskReq(BaseModel):
    projectId: str
    question: str
    topK: int = 6

@router.post("/ask")
async def ask(req: AskReq, user=Depends(current_user)):
    project = await Project.get(req.projectId)
    if not project:
        return {"error": "Project not found"}

    await require_project_role(req.projectId, {"admin","member","viewer"}, user)

    out = answer(project.key, settings.CHROMA_ROOT, req.question, req.topK)

    await AuditLog(
        userId=str(user.id),
        projectId=req.projectId,
        action="ask",
        payload={"question": req.question, "topK": req.topK, "sourceUrls": [s["url"] for s in out["sources"]]},
    ).insert()

    return out
