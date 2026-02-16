from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import requests
import shutil
from pathlib import Path
from ..deps import current_user
from ..models.base_mongo_models import Project, Membership, Connector
from ..settings import settings
from ..db import get_db

router = APIRouter()

OLLAMA_DEFAULT_BASE_URL = "http://ollama:11434/v1"
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"
FALLBACK_OLLAMA_MODELS = [
    "llama3.2:3b",
    "llama3.1:8b",
    "mistral:7b",
    "qwen2.5:7b",
]
FALLBACK_OPENAI_MODELS = [
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4o",
]

MAX_PATH_PICKER_ENTRIES = 500

class CreateProject(BaseModel):
    key: str
    name: str
    description: str | None = None
    repo_path: str | None = None
    default_branch: str = "main"
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None


class UpdateProject(BaseModel):
    name: str | None = None
    description: str | None = None
    repo_path: str | None = None
    default_branch: str | None = None
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None


class UpsertConnector(BaseModel):
    isEnabled: bool = True
    config: dict = {}


def _serialize_project(p: Project) -> dict:
    return {
        "id": str(p.id),
        "key": p.key,
        "name": p.name,
        "description": p.description,
        "repo_path": p.repo_path,
        "default_branch": p.default_branch,
        "llm_provider": p.llm_provider,
        "llm_base_url": p.llm_base_url,
        "llm_model": p.llm_model,
        "llm_api_key": p.llm_api_key,
        "createdAt": p.createdAt.isoformat() if p.createdAt else None,
    }


def _normalize_ollama_tags_url(base_url: str | None) -> str:
    base = (base_url or settings.LLM_BASE_URL or OLLAMA_DEFAULT_BASE_URL).rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + "/api/tags"


def _discover_ollama_models(base_url: str | None) -> tuple[list[str], str | None]:
    try:
        res = requests.get(_normalize_ollama_tags_url(base_url), timeout=3)
        res.raise_for_status()
        data = res.json() or {}
        raw = data.get("models") or []
        names: list[str] = []
        for item in raw:
            name = (item or {}).get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
        if names:
            # Keep stable order while deduplicating.
            deduped = list(dict.fromkeys(names))
            return deduped, None
    except Exception as err:
        return FALLBACK_OLLAMA_MODELS, str(err)

    return FALLBACK_OLLAMA_MODELS, None


def _path_picker_roots() -> list[Path]:
    raw = (settings.PATH_PICKER_ROOTS or "/").split(",")
    roots: list[Path] = []
    for item in raw:
        p = item.strip()
        if not p:
            continue
        try:
            roots.append(Path(p).expanduser().resolve())
        except Exception:
            continue
    return roots or [Path("/")]


def _is_allowed_path(path: Path, roots: list[Path]) -> bool:
    for root in roots:
        if str(root) == "/":
            return True
        if path == root or root in path.parents:
            return True
    return False

@router.post("/admin/projects")
async def create_project(req: CreateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    existing = await Project.find_one(Project.key == req.key)
    if existing:
        raise HTTPException(409, "Project key already exists")

    p = Project(
        key=req.key,
        name=req.name,
        description=req.description,
        repo_path=req.repo_path,
        default_branch=req.default_branch or "main",
        llm_provider=req.llm_provider,
        llm_base_url=req.llm_base_url,
        llm_model=req.llm_model,
        llm_api_key=req.llm_api_key,
    )
    await p.insert()

    # Make creator admin member (optional)
    await Membership(userId=str(user.id), projectId=str(p.id), role="admin").insert()
    return _serialize_project(p)


@router.get("/admin/projects")
async def list_projects(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    projects = await Project.find_all().to_list()
    out = []
    for p in projects:
        connectors = await Connector.find(Connector.projectId == str(p.id)).to_list()
        out.append(
            {
                **_serialize_project(p),
                "connectors": [
                    {
                        "id": str(c.id),
                        "type": c.type,
                        "isEnabled": c.isEnabled,
                        "config": c.config,
                        "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
                    }
                    for c in connectors
                ],
            }
        )
    return out


@router.patch("/admin/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProject, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")

    data = req.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    await p.save()

    return _serialize_project(p)


@router.delete("/admin/projects/{project_id}")
async def delete_project(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    p = await Project.get(project_id)
    if not p:
        raise HTTPException(404, "Project not found")

    db = get_db()

    # Legacy chat-store format kept messages in a separate collection.
    legacy_chat_docs = await db["chats"].find(
        {"projectId": project_id},
        {"_id": 1},
    ).to_list(length=50000)
    legacy_chat_ids = [str(d.get("_id")) for d in legacy_chat_docs if d.get("_id") is not None]

    connectors_res = await db["connectors"].delete_many({"projectId": project_id})
    memberships_res = await db["memberships"].delete_many({"projectId": project_id})
    chats_res = await db["chats"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )
    chunks_res = await db["chunks"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )
    docs_res = await db["docs"].delete_many(
        {"$or": [{"project_id": project_id}, {"projectId": project_id}]}
    )

    messages_deleted = 0
    if legacy_chat_ids:
        msg_res = await db["messages"].delete_many({"chatId": {"$in": legacy_chat_ids}})
        messages_deleted = int(msg_res.deleted_count or 0)

    await p.delete()

    chroma_path = Path(settings.CHROMA_ROOT) / project_id
    chroma_deleted = False
    chroma_error: str | None = None
    if chroma_path.exists():
        try:
            shutil.rmtree(chroma_path)
            chroma_deleted = True
        except Exception as err:
            chroma_error = str(err)

    return {
        "projectId": project_id,
        "projectKey": p.key,
        "deleted": {
            "project": 1,
            "connectors": int(connectors_res.deleted_count or 0),
            "memberships": int(memberships_res.deleted_count or 0),
            "chats": int(chats_res.deleted_count or 0),
            "messages": messages_deleted,
            "chunks": int(chunks_res.deleted_count or 0),
            "docs": int(docs_res.deleted_count or 0),
        },
        "chroma": {
            "path": str(chroma_path),
            "deleted": chroma_deleted,
            "error": chroma_error,
        },
    }


@router.get("/admin/projects/{project_id}/connectors")
async def list_project_connectors(project_id: str, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    connectors = await Connector.find(Connector.projectId == project_id).to_list()
    return [
        {
            "id": str(c.id),
            "type": c.type,
            "isEnabled": c.isEnabled,
            "config": c.config,
            "updatedAt": c.updatedAt.isoformat() if c.updatedAt else None,
        }
        for c in connectors
    ]


@router.put("/admin/projects/{project_id}/connectors/{connector_type}")
async def upsert_connector(
    project_id: str,
    connector_type: str,
    req: UpsertConnector,
    user=Depends(current_user),
):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if connector_type not in ("confluence", "jira", "github"):
        raise HTTPException(400, "Invalid connector type")

    existing = await Connector.find_one(Connector.projectId == project_id, Connector.type == connector_type)
    now = datetime.utcnow()

    if existing:
        existing.isEnabled = req.isEnabled
        existing.config = req.config
        existing.updatedAt = now
        await existing.save()
        doc = existing
    else:
        doc = Connector(
            projectId=project_id,
            type=connector_type,
            isEnabled=req.isEnabled,
            config=req.config,
            createdAt=now,
            updatedAt=now,
        )
        await doc.insert()

    return {
        "id": str(doc.id),
        "type": doc.type,
        "isEnabled": doc.isEnabled,
        "config": doc.config,
        "updatedAt": doc.updatedAt.isoformat() if doc.updatedAt else None,
    }


@router.get("/admin/llm/options")
async def llm_options(user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    ollama_models, discovery_error = _discover_ollama_models(OLLAMA_DEFAULT_BASE_URL)

    return {
        "providers": [
            {
                "value": "ollama",
                "label": "Ollama (local)",
                "defaultBaseUrl": OLLAMA_DEFAULT_BASE_URL,
                "requiresApiKey": False,
            },
            {
                "value": "openai",
                "label": "ChatGPT / OpenAI API",
                "defaultBaseUrl": OPENAI_DEFAULT_BASE_URL,
                "requiresApiKey": True,
            },
        ],
        "ollama_models": ollama_models,
        "openai_models": FALLBACK_OPENAI_MODELS,
        "discovery_error": discovery_error,
    }


@router.get("/admin/fs/list")
async def list_paths(path: str | None = None, user=Depends(current_user)):
    if not user.isGlobalAdmin:
        raise HTTPException(403, "Global admin required")

    roots = _path_picker_roots()
    roots_out = [str(r) for r in roots]

    if not path:
        dirs = [
            {
                "name": (r.name or str(r)),
                "path": str(r),
            }
            for r in roots
        ]
        return {
            "path": "",
            "parent": None,
            "roots": roots_out,
            "directories": dirs,
        }

    try:
        current = Path(path).expanduser().resolve()
    except Exception:
        raise HTTPException(400, "Invalid path")

    if not _is_allowed_path(current, roots):
        raise HTTPException(400, "Path not allowed by PATH_PICKER_ROOTS")

    if not current.exists() or not current.is_dir():
        raise HTTPException(404, "Directory not found")

    directories = []
    try:
        for entry in sorted(current.iterdir(), key=lambda p: p.name.lower()):
            if not entry.is_dir():
                continue
            if entry.name.startswith("."):
                continue
            if not _is_allowed_path(entry.resolve(), roots):
                continue
            directories.append({"name": entry.name, "path": str(entry.resolve())})
            if len(directories) >= MAX_PATH_PICKER_ENTRIES:
                break
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    parent: str | None = None
    if current.parent != current and _is_allowed_path(current.parent.resolve(), roots):
        parent = str(current.parent.resolve())

    return {
        "path": str(current),
        "parent": parent,
        "roots": roots_out,
        "directories": directories,
    }
