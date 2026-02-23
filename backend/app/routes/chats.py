import logging
from fastapi import APIRouter, HTTPException, Header
from datetime import datetime, timedelta
from typing import Any
from bson import ObjectId
from ..models.chat import ChatDoc, AppendReq, ChatResponse, ChatMessage
from pydantic import BaseModel, Field
from ..db import get_db
from ..repositories.chat_repository import (
    append_chat_message,
    clear_chat_messages,
    ensure_chat as repo_ensure_chat,
    get_chat as repo_get_chat,
    get_chat_owner,
    get_is_global_admin,
    list_active_tool_approvals,
    list_project_chats,
    revoke_tool_approval,
    update_chat_llm_profile,
    update_chat_tool_policy,
    upsert_tool_approval,
)
from ..services.feature_flags import load_project_feature_flags

router = APIRouter(prefix="/chats", tags=["chats"])
logger = logging.getLogger(__name__)


class ChatToolPolicyReq(BaseModel):
    allowed_tools: list[str] = Field(default_factory=list)
    blocked_tools: list[str] = Field(default_factory=list)
    strict_allowlist: bool = False
    read_only_only: bool = False
    timeout_overrides: dict[str, int] = Field(default_factory=dict)
    rate_limit_overrides: dict[str, int] = Field(default_factory=dict)
    retry_overrides: dict[str, int] = Field(default_factory=dict)
    cache_ttl_overrides: dict[str, int] = Field(default_factory=dict)


class ChatLlmProfileReq(BaseModel):
    llm_profile_id: str | None = None


class ChatToolApprovalReq(BaseModel):
    tool_name: str
    ttl_minutes: int = 30


class CreateChatTaskReq(BaseModel):
    title: str
    details: str = ""
    assignee: str | None = None
    due_date: str | None = None
    status: str = "open"


class UpdateChatTaskReq(BaseModel):
    title: str | None = None
    details: str | None = None
    status: str | None = None
    assignee: str | None = None
    due_date: str | None = None


class MemoryUpdateReq(BaseModel):
    decisions: list[str] | None = None
    open_questions: list[str] | None = None
    next_steps: list[str] | None = None


def _norm_tool_name(v: str) -> str:
    return str(v or "").strip()


async def _get_chat_owner_or_403(chat_id: str, x_dev_user: str | None) -> dict[str, Any]:
    chat = await get_chat_owner(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    owner = str(chat.get("user") or "").strip().lower()
    caller = str(x_dev_user or "").strip().lower()
    if not caller:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header")
    if caller and owner and caller != owner:
        if not await get_is_global_admin(caller):
            raise HTTPException(status_code=403, detail="Not allowed for this chat")
    return chat


def _clean_policy(req: ChatToolPolicyReq) -> dict[str, Any]:
    def clean_list(values: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for raw in values:
            s = str(raw or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
        return out

    def clean_int_map(values: dict[str, int], min_value: int, max_value: int) -> dict[str, int]:
        out: dict[str, int] = {}
        for k, v in (values or {}).items():
            key = str(k or "").strip()
            if not key:
                continue
            try:
                num = int(v)
            except Exception:
                continue
            out[key] = max(min_value, min(max_value, num))
        return out

    strict_allowlist = bool(req.strict_allowlist)
    allowed_tools = clean_list(req.allowed_tools) if strict_allowlist else []
    blocked_tools = clean_list(req.blocked_tools)
    return {
        "allowed_tools": allowed_tools,
        "blocked_tools": blocked_tools,
        "strict_allowlist": strict_allowlist,
        "read_only_only": bool(req.read_only_only),
        "timeout_overrides": clean_int_map(req.timeout_overrides, 1, 3600),
        "rate_limit_overrides": clean_int_map(req.rate_limit_overrides, 1, 6000),
        "retry_overrides": clean_int_map(req.retry_overrides, 0, 5),
        "cache_ttl_overrides": clean_int_map(req.cache_ttl_overrides, 0, 3600),
    }


def _clean_memory_list(raw: list[str] | None, *, max_items: int = 24, max_chars: int = 400) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    if not isinstance(raw, list):
        return out
    for item in raw:
        text = str(item or "").strip()
        if not text:
            continue
        compact = " ".join(text.split())
        if not compact:
            continue
        if len(compact) > max_chars:
            compact = compact[:max_chars].rstrip() + "..."
        if compact in seen:
            continue
        seen.add(compact)
        out.append(compact)
        if len(out) >= max_items:
            break
    return out


def _serialize_task_row(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    oid = item.get("_id")
    if oid is not None:
        item["id"] = str(oid)
    item.pop("_id", None)
    for key in ("created_at", "updated_at"):
        if isinstance(item.get(key), datetime):
            item[key] = item[key].isoformat() + "Z"
    return item


async def _ensure_chat_doc(payload: ChatDoc):
    return await repo_ensure_chat(payload.model_dump())

@router.get("/by-project/{project_id}")
async def list_chats_by_project(
    project_id: str,
    branch: str | None = None,
    user: str | None = None,
    limit: int = 100,
    x_dev_user: str | None = Header(default=None),
):
    user_id = (user or x_dev_user or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user")

    docs = await list_project_chats(project_id=project_id, user=user_id, branch=branch, limit=limit)
    # Be tolerant if duplicate chat_id docs exist in legacy data.
    deduped: list[dict] = []
    seen: set[str] = set()
    for d in docs:
        cid = str(d.get("chat_id") or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        deduped.append(d)
    return deduped


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat_by_id(chat_id: str):
    doc = await repo_get_chat(chat_id, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    return doc


@router.get("/{chat_id}/memory")
async def get_chat_memory(chat_id: str):
    doc = await repo_get_chat(chat_id, {"_id": 0, "chat_id": 1, "memory_summary": 1, "task_state": 1, "hierarchical_memory": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    summary = doc.get("memory_summary")
    if not isinstance(summary, dict):
        summary = {"decisions": [], "open_questions": [], "next_steps": [], "goals": [], "constraints": [], "blockers": [], "assumptions": []}
    task_state = doc.get("task_state") if isinstance(doc.get("task_state"), dict) else {}
    hierarchical = doc.get("hierarchical_memory") if isinstance(doc.get("hierarchical_memory"), dict) else {}
    return {"chat_id": chat_id, "memory_summary": summary, "task_state": task_state, "hierarchical_memory": hierarchical}


@router.patch("/{chat_id}/memory")
async def patch_chat_memory(chat_id: str, req: MemoryUpdateReq, x_dev_user: str | None = Header(default=None)):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    project_id = str(chat.get("project_id") or "")
    flags = await load_project_feature_flags(project_id) if project_id else {}
    if not bool(flags.get("enable_memory_controls", True)):
        raise HTTPException(status_code=403, detail="Memory controls are disabled for this project")
    doc = await repo_get_chat(chat_id, {"_id": 0, "memory_summary": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")

    memory = doc.get("memory_summary") if isinstance(doc.get("memory_summary"), dict) else {}
    next_summary = {
        "decisions": _clean_memory_list(req.decisions if req.decisions is not None else memory.get("decisions") or []),
        "open_questions": _clean_memory_list(
            req.open_questions if req.open_questions is not None else memory.get("open_questions") or []
        ),
        "next_steps": _clean_memory_list(req.next_steps if req.next_steps is not None else memory.get("next_steps") or []),
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    await get_db()["chats"].update_one({"chat_id": chat_id}, {"$set": {"memory_summary": next_summary, "updated_at": datetime.utcnow()}})
    return {"chat_id": chat_id, "memory_summary": next_summary}


@router.post("/{chat_id}/memory/reset")
async def reset_chat_memory(chat_id: str, x_dev_user: str | None = Header(default=None)):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    project_id = str(chat.get("project_id") or "")
    flags = await load_project_feature_flags(project_id) if project_id else {}
    if not bool(flags.get("enable_memory_controls", True)):
        raise HTTPException(status_code=403, detail="Memory controls are disabled for this project")
    empty = {
        "decisions": [],
        "open_questions": [],
        "next_steps": [],
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$set": {"memory_summary": empty, "task_state": {}, "hierarchical_memory": {}, "updated_at": datetime.utcnow()}},
    )
    return {"chat_id": chat_id, "memory_summary": empty, "task_state": {}}


@router.get("/{chat_id}/tasks")
async def list_chat_tasks(
    chat_id: str,
    status: str | None = None,
    limit: int = 120,
    x_dev_user: str | None = Header(default=None),
):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    q: dict[str, Any] = {
        "project_id": str(chat.get("project_id") or ""),
        "chat_id": chat_id,
    }
    if (status or "").strip():
        q["status"] = status.strip().lower()
    safe_limit = max(1, min(int(limit or 120), 500))
    rows = await get_db()["chat_tasks"].find(q).sort("updated_at", -1).limit(safe_limit).to_list(length=safe_limit)
    items = [_serialize_task_row(row) for row in rows if isinstance(row, dict)]
    return {"chat_id": chat_id, "items": items}


@router.post("/{chat_id}/tasks")
async def create_chat_task(chat_id: str, req: CreateChatTaskReq, x_dev_user: str | None = Header(default=None)):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    title = str(req.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    now = datetime.utcnow().isoformat() + "Z"
    doc = {
        "project_id": str(chat.get("project_id") or ""),
        "chat_id": chat_id,
        "title": title,
        "details": str(req.details or "").strip(),
        "assignee": str(req.assignee or "").strip() or None,
        "due_date": str(req.due_date or "").strip() or None,
        "status": str(req.status or "open").strip().lower() or "open",
        "created_at": now,
        "updated_at": now,
    }
    if doc["status"] not in {"open", "in_progress", "blocked", "done", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await get_db()["chat_tasks"].insert_one(doc)
    row = await get_db()["chat_tasks"].find_one({"_id": res.inserted_id})
    if not isinstance(row, dict):
        raise HTTPException(status_code=500, detail="Failed to create task")
    return {"chat_id": chat_id, "item": _serialize_task_row(row)}


@router.patch("/{chat_id}/tasks/{task_id}")
async def patch_chat_task(
    chat_id: str,
    task_id: str,
    req: UpdateChatTaskReq,
    x_dev_user: str | None = Header(default=None),
):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    q: dict[str, Any] = {
        "project_id": str(chat.get("project_id") or ""),
        "chat_id": chat_id,
    }
    if ObjectId.is_valid(task_id):
        q["_id"] = ObjectId(task_id)
    else:
        q["id"] = task_id

    row = await get_db()["chat_tasks"].find_one(q)
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Task not found")

    patch: dict[str, Any] = {}
    if req.title is not None:
        title = str(req.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title must not be empty")
        patch["title"] = title
    if req.details is not None:
        patch["details"] = str(req.details or "").strip()
    if req.status is not None:
        status = str(req.status or "").strip().lower()
        if status not in {"open", "in_progress", "blocked", "done", "cancelled"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        patch["status"] = status
    if req.assignee is not None:
        patch["assignee"] = str(req.assignee or "").strip() or None
    if req.due_date is not None:
        patch["due_date"] = str(req.due_date or "").strip() or None
    if not patch:
        return {"chat_id": chat_id, "item": _serialize_task_row(row)}
    patch["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await get_db()["chat_tasks"].update_one({"_id": row["_id"]}, {"$set": patch})
    next_row = await get_db()["chat_tasks"].find_one({"_id": row["_id"]})
    if not isinstance(next_row, dict):
        raise HTTPException(status_code=500, detail="Task update failed")
    return {"chat_id": chat_id, "item": _serialize_task_row(next_row)}

@router.post("/ensure", response_model=ChatResponse)
async def ensure_chat(payload: ChatDoc):
    return await _ensure_chat_doc(payload)


# Dedicated path used by web to avoid collision with legacy /chats/ensure route.
@router.post("/ensure-doc", response_model=ChatResponse)
async def ensure_chat_doc(payload: ChatDoc):
    return await _ensure_chat_doc(payload)

@router.post("/{chat_id}/append", response_model=ChatResponse)
async def append_message(chat_id: str, req: AppendReq):
    msg = ChatMessage(role=req.role, content=req.content).model_dump()
    now = datetime.utcnow()
    if await append_chat_message(chat_id, msg, now) == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    doc = await repo_get_chat(chat_id, {"_id": 0})
    return doc

@router.post("/{chat_id}/clear", response_model=ChatResponse)
async def clear_chat(chat_id: str):
    now = datetime.utcnow()
    if await clear_chat_messages(chat_id, now) == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    doc = await repo_get_chat(chat_id, {"_id": 0})
    return doc


@router.get("/{chat_id}/tool-policy")
async def get_chat_tool_policy(chat_id: str):
    doc = await repo_get_chat(chat_id, {"_id": 0, "chat_id": 1, "tool_policy": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    policy = doc.get("tool_policy") if isinstance(doc.get("tool_policy"), dict) else {}
    return {"chat_id": chat_id, "tool_policy": policy}


@router.put("/{chat_id}/tool-policy")
async def put_chat_tool_policy(chat_id: str, req: ChatToolPolicyReq):
    policy = _clean_policy(req)
    logger.info(
        "chat.tool_policy.update chat_id=%s strict_allowlist=%s read_only_only=%s allowed=%s blocked=%s",
        chat_id,
        bool(policy.get("strict_allowlist")),
        bool(policy.get("read_only_only")),
        len(policy.get("allowed_tools") or []),
        len(policy.get("blocked_tools") or []),
    )
    if await update_chat_tool_policy(chat_id, policy, datetime.utcnow()) == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"chat_id": chat_id, "tool_policy": policy}


@router.get("/{chat_id}/llm-profile")
async def get_chat_llm_profile(chat_id: str):
    doc = await repo_get_chat(chat_id, {"_id": 0, "chat_id": 1, "llm_profile_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    profile_id = (doc.get("llm_profile_id") or "").strip() or None
    return {"chat_id": chat_id, "llm_profile_id": profile_id}


@router.put("/{chat_id}/llm-profile")
async def put_chat_llm_profile(chat_id: str, req: ChatLlmProfileReq):
    profile_id = (req.llm_profile_id or "").strip() or None
    if await update_chat_llm_profile(chat_id, profile_id, datetime.utcnow()) == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"chat_id": chat_id, "llm_profile_id": profile_id}


@router.get("/{chat_id}/tool-approvals")
async def list_chat_tool_approvals(chat_id: str, x_dev_user: str | None = Header(default=None)):
    await _get_chat_owner_or_403(chat_id, x_dev_user)
    now = datetime.utcnow()
    rows = await list_active_tool_approvals(chat_id, now, limit=200)
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for key in ("createdAt", "expiresAt"):
            if isinstance(item.get(key), datetime):
                item[key] = item[key].isoformat() + "Z"
        items.append(item)
    return {"chat_id": chat_id, "items": items}


@router.post("/{chat_id}/tool-approvals")
async def approve_chat_tool(chat_id: str, req: ChatToolApprovalReq, x_dev_user: str | None = Header(default=None)):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    name = _norm_tool_name(req.tool_name)
    if not name:
        raise HTTPException(status_code=400, detail="tool_name is required")

    ttl = max(1, min(int(req.ttl_minutes or 30), 24 * 60))
    now = datetime.utcnow()
    exp = now if ttl <= 0 else now.replace(microsecond=0)
    exp = exp + timedelta(minutes=ttl)

    await upsert_tool_approval(
        chat_id=chat_id,
        tool_name=name,
        user_id=str(chat.get("user") or ""),
        approved_by=str(x_dev_user or chat.get("user") or ""),
        created_at=now,
        expires_at=exp,
    )
    return {
        "chat_id": chat_id,
        "tool_name": name,
        "user_id": str(chat.get("user") or ""),
        "approved_by": str(x_dev_user or chat.get("user") or ""),
        "createdAt": now.isoformat() + "Z",
        "expiresAt": exp.isoformat() + "Z",
    }


@router.delete("/{chat_id}/tool-approvals/{tool_name}")
async def revoke_chat_tool_approval(chat_id: str, tool_name: str, x_dev_user: str | None = Header(default=None)):
    chat = await _get_chat_owner_or_403(chat_id, x_dev_user)
    name = _norm_tool_name(tool_name)
    if not name:
        raise HTTPException(status_code=400, detail="tool_name is required")
    await revoke_tool_approval(chat_id, name, str(chat.get("user") or ""))
    return {"chat_id": chat_id, "tool_name": name, "revoked": True}
