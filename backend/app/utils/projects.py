from __future__ import annotations
from typing import Any, Dict
from bson import ObjectId
from fastapi import HTTPException


def oid(s: str) -> ObjectId:
    try:
        return ObjectId(s)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project_id")


async def get_project_or_404(db, project_id: str) -> Dict[str, Any]:
    p = await db.projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def project_meta(p: Dict[str, Any]) -> Dict[str, Any]:
    # ensure JSON safe
    return {
        "id": str(p["_id"]),
        "key": p.get("key"),
        "name": p.get("name"),
        "repo_path": p.get("repo_path") or "",
        "default_branch": p.get("default_branch") or "main",
        "extra": p.get("extra") or {},
    }
