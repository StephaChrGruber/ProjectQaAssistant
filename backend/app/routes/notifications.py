from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.notifications import (
    create_notification,
    dismiss_all_notifications,
    list_notifications,
    set_notification_dismissed,
)

router = APIRouter(tags=["notifications"])


class UpdateNotificationReq(BaseModel):
    dismissed: bool = True


class DismissAllNotificationsReq(BaseModel):
    project_id: str | None = None


class CreateNotificationReq(BaseModel):
    title: str
    message: str = ""
    severity: str = "info"
    project_id: str | None = None
    user_id: str | None = None
    source: str = "api"
    event_type: str = ""
    data: dict = Field(default_factory=dict)


async def _require_user_or_401(x_dev_user: str | None) -> str:
    user = str(x_dev_user or "").strip()
    if not user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    return user


@router.get("/notifications")
async def get_notifications(
    project_id: str | None = None,
    include_dismissed: bool = False,
    limit: int = 200,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    items = await list_notifications(
        user_id=user,
        project_id=project_id,
        include_dismissed=include_dismissed,
        limit=limit,
    )
    active_count = sum(1 for item in items if not bool(item.get("dismissed")))
    return {
        "user_id": user,
        "project_id": str(project_id or "").strip() or None,
        "total": len(items),
        "active_count": active_count,
        "items": items,
    }


@router.patch("/notifications/{notification_id}")
async def patch_notification(
    notification_id: str,
    req: UpdateNotificationReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    try:
        item = await set_notification_dismissed(
            notification_id=notification_id,
            user_id=user,
            dismissed=bool(req.dismissed),
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not item:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"user_id": user, "item": item}


@router.post("/notifications/dismiss-all")
async def post_dismiss_all_notifications(
    req: DismissAllNotificationsReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    count = await dismiss_all_notifications(user_id=user, project_id=req.project_id)
    return {"user_id": user, "dismissed_count": count}


@router.post("/notifications")
async def post_notification(
    req: CreateNotificationReq,
    x_dev_user: str | None = Header(default=None),
):
    caller = await _require_user_or_401(x_dev_user)
    try:
        item = await create_notification(
            title=req.title,
            message=req.message,
            severity=req.severity,
            project_id=req.project_id,
            user_id=req.user_id,
            source=req.source or "api",
            event_type=req.event_type,
            data=req.data if isinstance(req.data, dict) else {},
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"user_id": caller, "item": item}
