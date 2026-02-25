from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..services.automations import (
    create_custom_automation_preset,
    create_automation,
    delete_custom_automation_preset,
    delete_automation,
    dispatch_automation_event,
    get_automation,
    get_custom_automation_preset,
    list_custom_automation_preset_versions,
    list_custom_automation_presets,
    list_automation_runs,
    list_automation_templates,
    list_automations,
    run_automation,
    rollback_custom_automation_preset,
    update_custom_automation_preset,
    update_automation,
)

router = APIRouter(prefix="/projects", tags=["automations"])
logger = logging.getLogger(__name__)


class CreateAutomationReq(BaseModel):
    name: str
    description: str = ""
    enabled: bool = True
    trigger: dict[str, Any]
    conditions: dict[str, Any] = Field(default_factory=dict)
    action: dict[str, Any]
    cooldown_sec: int = 0
    run_access: str = "member_runnable"
    tags: list[str] = Field(default_factory=list)


class UpdateAutomationReq(BaseModel):
    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    trigger: dict[str, Any] | None = None
    conditions: dict[str, Any] | None = None
    action: dict[str, Any] | None = None
    cooldown_sec: int | None = None
    run_access: str | None = None
    tags: list[str] | None = None


class RunAutomationReq(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None
    dry_run: bool = False


class DispatchEventReq(BaseModel):
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class CreateAutomationPresetReq(BaseModel):
    name: str
    description: str = ""
    trigger: dict[str, Any]
    conditions: dict[str, Any] = Field(default_factory=dict)
    action: dict[str, Any]
    cooldown_sec: int = 0
    run_access: str = "member_runnable"
    tags: list[str] = Field(default_factory=list)


class UpdateAutomationPresetReq(BaseModel):
    name: str | None = None
    description: str | None = None
    trigger: dict[str, Any] | None = None
    conditions: dict[str, Any] | None = None
    action: dict[str, Any] | None = None
    cooldown_sec: int | None = None
    run_access: str | None = None
    tags: list[str] | None = None


class RollbackAutomationPresetReq(BaseModel):
    version_id: str


async def _require_user_or_401(x_dev_user: str | None) -> str:
    user = str(x_dev_user or "").strip()
    if not user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    return user


async def _require_project_or_404(project_id: str) -> dict[str, Any]:
    q: dict[str, Any] = {"_id": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    row = await get_db()["projects"].find_one(q)
    if not isinstance(row, dict):
        row = await get_db()["projects"].find_one({"key": project_id})
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Project not found")
    return row


@router.get("/{project_id}/automations/templates")
async def get_automation_templates(project_id: str, x_dev_user: str | None = Header(default=None)):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    return {
        "project_id": project_id,
        "items": await list_automation_templates(),
    }


@router.get("/{project_id}/automations")
async def get_project_automations(
    project_id: str,
    include_disabled: bool = True,
    limit: int = 200,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    items = await list_automations(project_id, include_disabled=include_disabled, limit=limit)
    return {
        "project_id": project_id,
        "total": len(items),
        "items": items,
    }


@router.get("/{project_id}/automations/presets")
async def get_project_automation_presets(
    project_id: str,
    limit: int = 200,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    items = await list_custom_automation_presets(project_id, limit=limit)
    return {"project_id": project_id, "total": len(items), "items": items}


@router.post("/{project_id}/automations/presets")
async def post_project_automation_preset(
    project_id: str,
    req: CreateAutomationPresetReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        item = await create_custom_automation_preset(
            project_id,
            user_id=user,
            name=req.name,
            description=req.description,
            trigger=req.trigger,
            conditions=req.conditions,
            action=req.action,
            cooldown_sec=req.cooldown_sec,
            run_access=req.run_access,
            tags=req.tags,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"project_id": project_id, "item": item}


@router.delete("/{project_id}/automations/presets/{preset_id}")
async def delete_project_automation_preset(
    project_id: str,
    preset_id: str,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        deleted = await delete_custom_automation_preset(project_id, preset_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not deleted:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"project_id": project_id, "deleted": True, "preset_id": preset_id}


@router.patch("/{project_id}/automations/presets/{preset_id}")
async def patch_project_automation_preset(
    project_id: str,
    preset_id: str,
    req: UpdateAutomationPresetReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    patch = req.model_dump(exclude_unset=True)
    if not patch:
        item = await get_custom_automation_preset(project_id, preset_id)
        if not item:
            raise HTTPException(status_code=404, detail="Preset not found")
        return {"project_id": project_id, "item": item}
    try:
        item = await update_custom_automation_preset(project_id, preset_id, user_id=user, patch=patch)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except KeyError:
        raise HTTPException(status_code=404, detail="Preset not found")
    return {"project_id": project_id, "item": item}


@router.get("/{project_id}/automations/presets/{preset_id}/versions")
async def get_project_automation_preset_versions(
    project_id: str,
    preset_id: str,
    limit: int = 100,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        items = await list_custom_automation_preset_versions(project_id, preset_id, limit=limit)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"project_id": project_id, "preset_id": preset_id, "total": len(items), "items": items}


@router.post("/{project_id}/automations/presets/{preset_id}/rollback")
async def post_project_automation_preset_rollback(
    project_id: str,
    preset_id: str,
    req: RollbackAutomationPresetReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        item = await rollback_custom_automation_preset(
            project_id,
            preset_id,
            version_id=str(req.version_id or "").strip(),
            user_id=user,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"project_id": project_id, "item": item, "rolled_back_to_version_id": str(req.version_id or "").strip()}


@router.post("/{project_id}/automations")
async def post_project_automation(
    project_id: str,
    req: CreateAutomationReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        item = await create_automation(
            project_id,
            user_id=user,
            name=req.name,
            description=req.description,
            enabled=req.enabled,
            trigger=req.trigger,
            conditions=req.conditions,
            action=req.action,
            cooldown_sec=req.cooldown_sec,
            run_access=req.run_access,
            tags=req.tags,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"project_id": project_id, "item": item}


@router.get("/{project_id}/automations/{automation_id}")
async def get_project_automation(
    project_id: str,
    automation_id: str,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    item = await get_automation(project_id, automation_id)
    if not item:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"project_id": project_id, "item": item}


@router.patch("/{project_id}/automations/{automation_id}")
async def patch_project_automation(
    project_id: str,
    automation_id: str,
    req: UpdateAutomationReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    patch = req.model_dump(exclude_unset=True)
    if not patch:
        item = await get_automation(project_id, automation_id)
        if not item:
            raise HTTPException(status_code=404, detail="Automation not found")
        return {"project_id": project_id, "item": item}
    try:
        item = await update_automation(project_id, automation_id, user_id=user, patch=patch)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except KeyError:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"project_id": project_id, "item": item}


@router.delete("/{project_id}/automations/{automation_id}")
async def delete_project_automation(
    project_id: str,
    automation_id: str,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    try:
        deleted = await delete_automation(project_id, automation_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if not deleted:
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"project_id": project_id, "deleted": True, "automation_id": automation_id}


@router.post("/{project_id}/automations/{automation_id}/run")
async def run_project_automation(
    project_id: str,
    automation_id: str,
    req: RunAutomationReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    payload = dict(req.payload or {})
    payload.setdefault("project_id", project_id)
    payload.setdefault("user_id", user)
    payload.setdefault("trigger_reason", str(req.reason or "").strip())
    try:
        run_row = await run_automation(
            project_id,
            automation_id,
            triggered_by="manual",
            event_type="manual",
            event_payload=payload,
            user_id=user,
            dry_run=bool(req.dry_run),
        )
    except PermissionError as err:
        raise HTTPException(status_code=403, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except KeyError:
        raise HTTPException(status_code=404, detail="Automation not found")
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"project_id": project_id, "run": run_row}


@router.get("/{project_id}/automations/runs")
async def get_project_automation_runs(
    project_id: str,
    automation_id: str | None = None,
    limit: int = 120,
    x_dev_user: str | None = Header(default=None),
):
    await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    items = await list_automation_runs(project_id, automation_id=automation_id, limit=limit)
    return {"project_id": project_id, "total": len(items), "items": items}


@router.post("/{project_id}/automations/dispatch")
async def post_project_automation_dispatch(
    project_id: str,
    req: DispatchEventReq,
    x_dev_user: str | None = Header(default=None),
):
    user = await _require_user_or_401(x_dev_user)
    await _require_project_or_404(project_id)
    payload = dict(req.payload or {})
    payload.setdefault("project_id", project_id)
    payload.setdefault("user_id", user)
    payload.setdefault("dispatched_at", datetime.utcnow().isoformat() + "Z")
    runs = await dispatch_automation_event(
        project_id,
        event_type=str(req.event_type or "").strip(),
        payload=payload,
    )
    logger.info(
        "automations.dispatch.manual project=%s event=%s runs=%s",
        project_id,
        str(req.event_type or "").strip(),
        len(runs),
    )
    return {"project_id": project_id, "event_type": str(req.event_type or "").strip(), "runs": runs}
