from fastapi import APIRouter, Depends, HTTPException
import json
import time
from datetime import datetime
from ..utils.mongo import oid
import logging

from ..deps import current_user
from ..services.chat_store import ensure_chat, list_chats, get_messages, add_message

# you likely already have a Projects collection; adapt this getter to your structure.
from ..db import get_db

router = APIRouter()

logger = logging.getLogger(__name__)

def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    d = dict(doc)
    if isinstance(d.get("createdAt"), datetime):
        d["createdAt"] = d["createdAt"].isoformat()
    if isinstance(d.get("updatedAt"), datetime):
        d["updatedAt"] = d["updatedAt"].isoformat()
    if isinstance(d.get("lastMessageAt"), datetime):
        d["lastMessageAt"] = d["lastMessageAt"].isoformat()
    if isinstance(d.get("createdAt"), datetime):
        d["createdAt"] = d["createdAt"].isoformat()
    return d

async def _get_project(project_id: str) -> dict:
    db = get_db()
    proj = await db["projects"].find_one({"_id": oid(project_id)})
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj

@router.post("/chats/ensure")
async def chats_ensure(body: dict, user=Depends(current_user)):
    project_id = body.get("project_id")
    branch = body.get("branch") or "main"
    if not project_id:
        raise HTTPException(400, "projectId required")
    proj = await _get_project(project_id)
    chat = await ensure_chat(project_id, proj.get("key", "project"), branch, str(user.id))
    return _serialize(chat)

@router.get("/chats")
async def chats_list(projectId: str, branch: str | None = None, user=Depends(current_user)):
    items = await list_chats(projectId, branch, user["id"])
    return [_serialize(x) for x in items]

@router.get("/chats/{chat_id}/messages")
async def chats_messages(chat_id: str, user=Depends(current_user)):
    # optional: verify chat belongs to user
    msgs = await get_messages(chat_id)
    out = []
    for m in msgs:
        d = dict(m)
        if isinstance(d.get("createdAt"), datetime):
            d["createdAt"] = d["createdAt"].isoformat()
        out.append(d)
    return out
