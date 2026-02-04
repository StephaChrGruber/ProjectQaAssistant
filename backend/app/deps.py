from fastapi import Header, HTTPException
from .settings import settings
from .models import User, Membership

async def current_user(
        x_dev_user: str | None = Header(default=None),
        x_dev_admin: str | None = Header(default=None),
        authorization: str = Header(default=""),
) -> User:
    if settings.AUTH_MODE != "dev":
        raise HTTPException(500, "AUTH_MODE not set to dev for this POC")

    if not x_dev_user:
        raise HTTPException(401, "Missing X-Dev-User header (POC auth)")

    # JIT user creation
    u = await User.find_one(User.email == x_dev_user)
    if not u:
        u = User(email=x_dev_user, displayName=x_dev_user.split("@")[0], isActive=True, isGlobalAdmin=False)
        await u.insert()

    # allow “be admin” locally
    if x_dev_admin and x_dev_admin.lower() in ("1", "true", "yes"):
        if not u.isGlobalAdmin:
            u.isGlobalAdmin = True
            await u.save()

    if not u.isActive:
        raise HTTPException(403, "User disabled")

    return u

async def require_project_role(project_id: str, allowed: set[str], user: User):
    if user.isGlobalAdmin:
        return

    membership = await Membership.find_one(Membership.userId == str(user.id), Membership.projectId == project_id)
    if not membership or membership.role not in allowed:
        raise HTTPException(403, "Not permitted for this project")
