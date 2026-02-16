# app/routes/projects.py
from fastapi import APIRouter, Header, HTTPException
from typing import Any
from bson import ObjectId
import subprocess

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
    cursor = get_db().projects.find(
        {},
        {
            "name": 1,
            "key": 1,
            "description": 1,
            "repo_path": 1,
            "default_branch": 1,
            "llm_provider": 1,
            "llm_base_url": 1,
            "llm_model": 1,
        },
    ).sort("name", 1)
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


@router.get("/{project_id}/branches")
async def list_project_branches(project_id: str, x_dev_user: str | None = Header(default=None)):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    p = await get_db().projects.find_one({"_id": oid(project_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    default_branch = (p.get("default_branch") or "main").strip() or "main"
    repo_path = (p.get("repo_path") or "").strip()
    if not repo_path:
        return {"branches": [default_branch]}

    try:
        proc = subprocess.run(
            [
                "git",
                "-C",
                repo_path,
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes/origin",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except Exception:
        return {"branches": [default_branch]}

    if proc.returncode != 0:
        return {"branches": [default_branch]}

    seen: set[str] = set()
    branches: list[str] = []
    for line in proc.stdout.splitlines():
        b = line.strip()
        if not b or b == "origin/HEAD":
            continue
        if b.startswith("origin/"):
            b = b[7:]
        if b and b not in seen:
            seen.add(b)
            branches.append(b)

    if default_branch in seen:
        branches = [default_branch] + [b for b in branches if b != default_branch]
    elif branches:
        branches = [default_branch] + branches
    else:
        branches = [default_branch]

    return {"branches": branches}
