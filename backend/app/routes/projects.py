# app/routes/projects.py
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Any
from bson import ObjectId
import subprocess

from ..db import get_db  # however you access Mongo (Motor/PyMongo)
from ..services.documentation import (
    DocumentationError,
    generate_project_documentation,
    generate_project_documentation_from_local_context,
    list_project_documentation,
    read_project_documentation_file,
)

router = APIRouter(prefix="/projects", tags=["projects"])


class GenerateDocumentationReq(BaseModel):
    branch: str | None = None


class GenerateLocalDocumentationReq(BaseModel):
    branch: str | None = None
    local_repo_root: str | None = None
    local_repo_file_paths: list[str] = []
    local_repo_context: str

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


@router.post("/{project_id}/documentation/generate")
async def generate_documentation(
    project_id: str,
    req: GenerateDocumentationReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await generate_project_documentation(project_id=project_id, branch=req.branch)
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/documentation/generate-local")
async def generate_documentation_local(
    project_id: str,
    req: GenerateLocalDocumentationReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await generate_project_documentation_from_local_context(
            project_id=project_id,
            branch=req.branch,
            local_repo_root=req.local_repo_root or "",
            local_repo_file_paths=req.local_repo_file_paths or [],
            local_repo_context=req.local_repo_context or "",
        )
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/documentation")
async def list_documentation(
    project_id: str,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await list_project_documentation(project_id=project_id, branch=branch)
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/documentation/file")
async def open_documentation_file(
    project_id: str,
    path: str,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")

    try:
        return await read_project_documentation_file(project_id=project_id, path=path, branch=branch)
    except DocumentationError as err:
        raise HTTPException(status_code=400, detail=str(err))
