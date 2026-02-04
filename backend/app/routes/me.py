from fastapi import APIRouter, Depends
from ..deps import current_user
from ..models import Project, Membership

router = APIRouter()

@router.get("/me")
async def me(user = Depends(current_user)):
    if user.isGlobalAdmin:
        projects = await Project.find_all().to_list()
        return {
            "user": {
                "id": str(user.id),
                "email": user.email,
                "displayName": user.displayName,
                "isGlobalAdmin": user.isGlobalAdmin
            },
            "projects": [{"id": str(p.id), "key": p.key, "name": p.name} for p in projects],
            "memberships": []  # optional; can include memberships too if you want
        }

    memberships = await Membership.find(Membership.userId == str(user.id)).to_list()
    proj_ids = [m.projectId for m in memberships]
    projects = await Project.find(Project.id.in_(proj_ids)).to_list() if proj_ids else []
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "displayName": user.displayName,
            "isGlobalAdmin": user.isGlobalAdmin
        },
        "projects": [{"id": str(p.id), "key": p.key, "name": p.name} for p in projects],
        "memberships": [{"projectId": m.projectId, "role": m.role} for m in memberships],
    }
