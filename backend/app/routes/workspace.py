from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.workspace import (
    WorkspaceError,
    apply_patch,
    build_patch_preview,
    delete_file,
    get_draft,
    get_workspace_capabilities,
    list_tree,
    read_file,
    save_draft,
    suggest_patch,
    write_file,
)

router = APIRouter(prefix="/projects", tags=["workspace"])
logger = logging.getLogger(__name__)


class WorkspaceDraftSaveReq(BaseModel):
    branch: str = "main"
    chat_id: str
    path: str
    content: str = ""


class WorkspaceWriteReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str
    content: str
    expected_hash: str | None = None


class WorkspaceDeleteReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str
    expected_hash: str | None = None
    ignore_missing: bool = False


class WorkspaceSuggestReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    primary_path: str
    paths: list[str] = Field(default_factory=list)
    selected_text: str | None = None
    intent: str | None = None
    max_context_chars: int = 130000
    llm_profile_id: str | None = None


class PatchPreviewFile(BaseModel):
    path: str
    original_content: str = ""
    target_content: str = ""


class WorkspacePatchPreviewReq(BaseModel):
    files: list[PatchPreviewFile]


class PatchSelectionItem(BaseModel):
    file: str
    hunk_ids: list[int] = Field(default_factory=list)


class WorkspacePatchApplyReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    patch: dict[str, Any]
    selection: list[PatchSelectionItem] = Field(default_factory=list)


@router.get("/{project_id}/workspace/capabilities")
async def workspace_capabilities(
    project_id: str,
    branch: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await get_workspace_capabilities(project_id, branch=branch)
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/workspace/tree")
async def workspace_tree(
    project_id: str,
    branch: str = "main",
    path: str = "",
    max_depth: int = 6,
    max_entries: int = 2000,
    include_files: bool = True,
    include_dirs: bool = True,
    chat_id: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await list_tree(
            project_id=project_id,
            branch=branch,
            user_id=x_dev_user,
            chat_id=chat_id,
            path=path,
            max_depth=max_depth,
            max_entries=max_entries,
            include_files=include_files,
            include_dirs=include_dirs,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/workspace/file")
async def workspace_file(
    project_id: str,
    branch: str = "main",
    path: str = "",
    max_chars: int = 260000,
    allow_large: bool = False,
    chat_id: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await read_file(
            project_id=project_id,
            branch=branch,
            user_id=x_dev_user,
            chat_id=chat_id,
            path=path,
            max_chars=max_chars,
            allow_large=allow_large,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/draft/save")
async def workspace_draft_save(
    project_id: str,
    req: WorkspaceDraftSaveReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await save_draft(
            project_id=project_id,
            branch=req.branch,
            chat_id=req.chat_id,
            user_id=x_dev_user,
            path=req.path,
            content=req.content,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/workspace/draft")
async def workspace_draft_get(
    project_id: str,
    branch: str,
    chat_id: str,
    path: str,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await get_draft(
            project_id=project_id,
            branch=branch,
            chat_id=chat_id,
            user_id=x_dev_user,
            path=path,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/file/write")
async def workspace_file_write(
    project_id: str,
    req: WorkspaceWriteReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await write_file(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
            content=req.content,
            expected_hash=req.expected_hash,
        )
    except WorkspaceError as err:
        detail = str(err)
        if detail.startswith("conflict:"):
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)


@router.post("/{project_id}/workspace/file/delete")
async def workspace_file_delete(
    project_id: str,
    req: WorkspaceDeleteReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await delete_file(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
            expected_hash=req.expected_hash,
            ignore_missing=bool(req.ignore_missing),
        )
    except WorkspaceError as err:
        detail = str(err)
        if detail.startswith("conflict:"):
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=400, detail=detail)


@router.post("/{project_id}/workspace/suggest")
async def workspace_suggest(
    project_id: str,
    req: WorkspaceSuggestReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await suggest_patch(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            primary_path=req.primary_path,
            paths=req.paths,
            intent=req.intent,
            selected_text=req.selected_text,
            llm_profile_id=req.llm_profile_id,
            max_context_chars=req.max_context_chars,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/patch/preview")
async def workspace_patch_preview(
    project_id: str,
    req: WorkspacePatchPreviewReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        files = [
            {"path": row.path, "original_content": row.original_content, "target_content": row.target_content}
            for row in req.files
        ]
        return {"project_id": project_id, "patch": build_patch_preview(files)}
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/patch/apply")
async def workspace_patch_apply(
    project_id: str,
    req: WorkspacePatchApplyReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        out = await apply_patch(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            patch=req.patch,
            selection=[row.model_dump() for row in req.selection],
        )
        if int(out.get("conflict_count") or 0) > 0:
            raise HTTPException(status_code=409, detail=out)
        return out
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))
