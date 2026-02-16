# app/routes/projects.py
from fastapi import APIRouter, Header, HTTPException
from typing import Any
from bson import ObjectId

from ..db import get_db  # however you access Mongo (Motor/PyMongo)

router = APIRouter(prefix="/projects", tags=["projects"])

def oid(x: Any) -> ObjectId:
    try:
        return ObjectId(str(x))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project_id")

def project_to_json(p: dict) -> dict:
    # IMPORTANT: convert ObjectId to str so FastAPI can JSON encode it
    p = dict(p)
    p["_id"] = str(p["_id"])
    return p

@router.get("")
async def list_projects(x_dev_user: str | None = Header(default=None)):
    # If you're enforcing your POC auth header:
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    # Adjust collection name to your schema
    cursor = get_db().projects.find({}, {"name": 1, "key": 1}).sort("name", 1)
    items = await cursor.to_list(length=500)
    return [project_to_json(p) for p in items]

@router.get("/{project_id}")
async def get_project(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_to_json(p)
