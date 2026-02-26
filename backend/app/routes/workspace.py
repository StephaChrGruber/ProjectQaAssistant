from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..services.workspace import (
    WorkspaceError,
    apply_patch,
    assemble_workspace_context,
    build_patch_preview,
    extract_and_store_chat_code_artifacts,
    create_file,
    create_folder,
    get_latest_workspace_diagnostics,
    delete_file,
    get_draft,
    get_workspace_capabilities,
    list_tree,
    move_path,
    normalize_patch_payload,
    promote_chat_code_artifact_to_patch,
    read_file,
    rename_path,
    run_workspace_diagnostics,
    save_draft,
    suggest_inline,
    suggest_patch,
    workspace_context_to_text,
    write_file,
)
from ..models.tools import (
    GitCommitRequest,
    GitFetchRequest,
    GitPullRequest,
    GitPushRequest,
    GitStageFilesRequest,
    GitStatusRequest,
    GitUnstageFilesRequest,
)
from ..rag.tool_exec import (
    git_commit,
    git_fetch,
    git_pull,
    git_push,
    git_stage_files,
    git_status,
    git_unstage_files,
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
    cursor: dict[str, int] | None = None
    scope: str | None = "open_tabs"
    intent: str | None = None
    max_context_chars: int = 130000
    llm_profile_id: str | None = None


class WorkspaceInlineSuggestReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str
    cursor: dict[str, int] | None = None
    selected_text: str | None = None
    intent: str | None = None
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


class WorkspacePatchNormalizeReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    content: str
    fallback_path: str | None = None


class WorkspaceChatArtifactExtractReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    context_key: str | None = None
    message_id: str | None = None
    content: str = ""


class WorkspaceChatArtifactPromoteReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    context_key: str | None = None
    message_id: str | None = None
    artifact_id: str
    fallback_path: str | None = None


class WorkspaceCreateFileReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str
    content: str = ""
    overwrite: bool = False


class WorkspaceCreateFolderReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str


class WorkspaceRenamePathReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    path: str
    new_path: str
    overwrite: bool = False


class WorkspaceMovePathReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    src_path: str
    dest_path: str
    overwrite: bool = False


class WorkspaceDiagnosticsRunReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    target: str = "active_file"
    paths: list[str] = Field(default_factory=list)
    command: str | None = None
    timeout_sec: int = 240
    max_output_chars: int = 60000


class WorkspaceContextReq(BaseModel):
    branch: str = "main"
    chat_id: str | None = None
    active_path: str | None = None
    active_preview: str | None = None
    open_tabs: list[str] = Field(default_factory=list)
    dirty_paths: list[str] = Field(default_factory=list)
    draft_previews: list[dict[str, str]] = Field(default_factory=list)
    cursor: dict[str, int] | None = None


class WorkspaceGitStatusReq(BaseModel):
    branch: str = "main"


class WorkspaceGitStageReq(BaseModel):
    branch: str = "main"
    paths: list[str] = Field(default_factory=list)
    all: bool = False


class WorkspaceGitUnstageReq(BaseModel):
    branch: str = "main"
    paths: list[str] = Field(default_factory=list)
    all: bool = False


class WorkspaceGitCommitReq(BaseModel):
    branch: str = "main"
    message: str
    all: bool = False
    amend: bool = False


class WorkspaceGitFetchReq(BaseModel):
    branch: str = "main"
    remote: str = "origin"
    prune: bool = False


class WorkspaceGitPullReq(BaseModel):
    branch: str = "main"
    remote: str = "origin"
    rebase: bool = False


class WorkspaceGitPushReq(BaseModel):
    branch: str = "main"
    remote: str = "origin"
    set_upstream: bool = False
    force_with_lease: bool = False


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
            cursor=req.cursor,
            scope=req.scope,
            llm_profile_id=req.llm_profile_id,
            max_context_chars=req.max_context_chars,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/suggest-inline")
async def workspace_suggest_inline(
    project_id: str,
    req: WorkspaceInlineSuggestReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await suggest_inline(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
            cursor=req.cursor,
            selected_text=req.selected_text,
            intent=req.intent,
            llm_profile_id=req.llm_profile_id,
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


@router.post("/{project_id}/workspace/patch/normalize")
async def workspace_patch_normalize(
    project_id: str,
    req: WorkspacePatchNormalizeReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await normalize_patch_payload(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            content=req.content,
            fallback_path=req.fallback_path,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/chat-artifacts/extract")
async def workspace_chat_artifacts_extract(
    project_id: str,
    req: WorkspaceChatArtifactExtractReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await extract_and_store_chat_code_artifacts(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            context_key=req.context_key,
            message_id=req.message_id,
            content=req.content,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/chat-artifacts/promote")
async def workspace_chat_artifacts_promote(
    project_id: str,
    req: WorkspaceChatArtifactPromoteReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await promote_chat_code_artifact_to_patch(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            context_key=req.context_key,
            message_id=req.message_id,
            artifact_id=req.artifact_id,
            fallback_path=req.fallback_path,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/file/create")
async def workspace_file_create(
    project_id: str,
    req: WorkspaceCreateFileReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await create_file(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
            content=req.content,
            overwrite=bool(req.overwrite),
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/folder/create")
async def workspace_folder_create(
    project_id: str,
    req: WorkspaceCreateFolderReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await create_folder(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/file/rename")
async def workspace_file_rename(
    project_id: str,
    req: WorkspaceRenamePathReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await rename_path(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            path=req.path,
            new_path=req.new_path,
            overwrite=bool(req.overwrite),
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/file/move")
async def workspace_file_move(
    project_id: str,
    req: WorkspaceMovePathReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await move_path(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            src_path=req.src_path,
            dest_path=req.dest_path,
            overwrite=bool(req.overwrite),
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/diagnostics/run")
async def workspace_diagnostics_run(
    project_id: str,
    req: WorkspaceDiagnosticsRunReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await run_workspace_diagnostics(
            project_id=project_id,
            branch=req.branch,
            user_id=x_dev_user,
            chat_id=req.chat_id,
            target=req.target,
            paths=req.paths,
            command=req.command,
            timeout_sec=req.timeout_sec,
            max_output_chars=req.max_output_chars,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/{project_id}/workspace/diagnostics/latest")
async def workspace_diagnostics_latest(
    project_id: str,
    branch: str = "main",
    chat_id: str | None = None,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await get_latest_workspace_diagnostics(
            project_id=project_id,
            branch=branch,
            user_id=x_dev_user,
            chat_id=chat_id,
        )
    except WorkspaceError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/context")
async def workspace_context_collect(
    project_id: str,
    req: WorkspaceContextReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    context = await assemble_workspace_context(
        project_id=project_id,
        branch=req.branch,
        user_id=x_dev_user,
        chat_id=req.chat_id,
        payload={
            "active_path": req.active_path,
            "active_preview": req.active_preview,
            "open_tabs": req.open_tabs,
            "dirty_paths": req.dirty_paths,
            "draft_previews": req.draft_previews,
            "cursor": req.cursor,
        },
    )
    return {
        "context": context,
        "context_text": workspace_context_to_text(context),
    }


@router.post("/{project_id}/workspace/git/status")
async def workspace_git_status(
    project_id: str,
    req: WorkspaceGitStatusReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_status(
            GitStatusRequest(
                project_id=project_id,
                branch=req.branch,
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/stage")
async def workspace_git_stage(
    project_id: str,
    req: WorkspaceGitStageReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_stage_files(
            GitStageFilesRequest(
                project_id=project_id,
                paths=req.paths,
                all=bool(req.all),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/unstage")
async def workspace_git_unstage(
    project_id: str,
    req: WorkspaceGitUnstageReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_unstage_files(
            GitUnstageFilesRequest(
                project_id=project_id,
                paths=req.paths,
                all=bool(req.all),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/commit")
async def workspace_git_commit(
    project_id: str,
    req: WorkspaceGitCommitReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_commit(
            GitCommitRequest(
                project_id=project_id,
                message=req.message,
                all=bool(req.all),
                amend=bool(req.amend),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/fetch")
async def workspace_git_fetch(
    project_id: str,
    req: WorkspaceGitFetchReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_fetch(
            GitFetchRequest(
                project_id=project_id,
                remote=req.remote,
                prune=bool(req.prune),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/pull")
async def workspace_git_pull(
    project_id: str,
    req: WorkspaceGitPullReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_pull(
            GitPullRequest(
                project_id=project_id,
                remote=req.remote,
                branch=req.branch,
                rebase=bool(req.rebase),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/{project_id}/workspace/git/push")
async def workspace_git_push(
    project_id: str,
    req: WorkspaceGitPushReq,
    x_dev_user: str | None = Header(default=None),
):
    if not x_dev_user:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header (POC auth)")
    try:
        return await git_push(
            GitPushRequest(
                project_id=project_id,
                remote=req.remote,
                branch=req.branch,
                set_upstream=bool(req.set_upstream),
                force_with_lease=bool(req.force_with_lease),
            )
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))
