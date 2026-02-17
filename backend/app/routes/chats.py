from fastapi import APIRouter, HTTPException, Header
from datetime import datetime, timedelta
from typing import Any
from ..db import get_db
from ..models.chat import ChatDoc, AppendReq, ChatResponse, ChatMessage
from pydantic import BaseModel, Field

router = APIRouter(prefix="/chats", tags=["chats"])

COLL = "chats"


class ChatToolPolicyReq(BaseModel):
    allowed_tools: list[str] = Field(default_factory=list)
    blocked_tools: list[str] = Field(default_factory=list)
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


def _norm_tool_name(v: str) -> str:
    return str(v or "").strip()


async def _get_chat_owner_or_403(chat_id: str, x_dev_user: str | None) -> dict[str, Any]:
    chat = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0, "chat_id": 1, "user": 1})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    owner = str(chat.get("user") or "").strip().lower()
    caller = str(x_dev_user or "").strip().lower()
    if not caller:
        raise HTTPException(status_code=401, detail="Missing X-Dev-User header")
    if caller and owner and caller != owner:
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

    return {
        "allowed_tools": clean_list(req.allowed_tools),
        "blocked_tools": clean_list(req.blocked_tools),
        "read_only_only": bool(req.read_only_only),
        "timeout_overrides": clean_int_map(req.timeout_overrides, 1, 3600),
        "rate_limit_overrides": clean_int_map(req.rate_limit_overrides, 1, 6000),
        "retry_overrides": clean_int_map(req.retry_overrides, 0, 5),
        "cache_ttl_overrides": clean_int_map(req.cache_ttl_overrides, 0, 3600),
    }


async def _ensure_chat_doc(payload: ChatDoc):
    # Upsert: create if missing.
    await get_db()[COLL].update_one(
        {"chat_id": payload.chat_id},
        {"$setOnInsert": {**payload.model_dump(), "tool_policy": {}, "llm_profile_id": None}},
        upsert=True,
    )
    return await get_db()[COLL].find_one({"chat_id": payload.chat_id}, {"_id": 0})

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

    q: dict = {"project_id": project_id, "user": user_id}
    if branch:
        q["branch"] = branch

    cursor = (
        get_db()[COLL]
        .find(q, {"_id": 0, "messages": 0})
        .sort("updated_at", -1)
        .limit(max(1, min(limit, 300)))
    )
    docs = await cursor.to_list(length=max(1, min(limit, 300)))
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
async def get_chat(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    return doc


@router.get("/{chat_id}/memory")
async def get_chat_memory(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0, "chat_id": 1, "memory_summary": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    summary = doc.get("memory_summary")
    if not isinstance(summary, dict):
        summary = {"decisions": [], "open_questions": [], "next_steps": []}
    return {"chat_id": chat_id, "memory_summary": summary}

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

    res = await get_db()[COLL].update_one(
        {"chat_id": chat_id},
        {
            "$push": {"messages": msg},
            "$set": {"updated_at": now},
        },
        upsert=False,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")

    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0})
    return doc

@router.post("/{chat_id}/clear", response_model=ChatResponse)
async def clear_chat(chat_id: str):
    now = datetime.utcnow()
    res = await get_db()[COLL].update_one(
        {"chat_id": chat_id},
        {"$set": {"messages": [], "updated_at": now}},
        upsert=False,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")

    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0})
    return doc


@router.get("/{chat_id}/tool-policy")
async def get_chat_tool_policy(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0, "chat_id": 1, "tool_policy": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    policy = doc.get("tool_policy") if isinstance(doc.get("tool_policy"), dict) else {}
    return {"chat_id": chat_id, "tool_policy": policy}


@router.put("/{chat_id}/tool-policy")
async def put_chat_tool_policy(chat_id: str, req: ChatToolPolicyReq):
    policy = _clean_policy(req)
    res = await get_db()[COLL].update_one(
        {"chat_id": chat_id},
        {"$set": {"tool_policy": policy, "updated_at": datetime.utcnow()}},
        upsert=False,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"chat_id": chat_id, "tool_policy": policy}


@router.get("/{chat_id}/llm-profile")
async def get_chat_llm_profile(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0, "chat_id": 1, "llm_profile_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    profile_id = (doc.get("llm_profile_id") or "").strip() or None
    return {"chat_id": chat_id, "llm_profile_id": profile_id}


@router.put("/{chat_id}/llm-profile")
async def put_chat_llm_profile(chat_id: str, req: ChatLlmProfileReq):
    profile_id = (req.llm_profile_id or "").strip() or None
    update_doc: dict[str, Any] = {"updated_at": datetime.utcnow()}
    if profile_id is None:
        update_doc["llm_profile_id"] = None
    else:
        update_doc["llm_profile_id"] = profile_id

    res = await get_db()[COLL].update_one(
        {"chat_id": chat_id},
        {"$set": update_doc},
        upsert=False,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"chat_id": chat_id, "llm_profile_id": profile_id}


@router.get("/{chat_id}/tool-approvals")
async def list_chat_tool_approvals(chat_id: str, x_dev_user: str | None = Header(default=None)):
    await _get_chat_owner_or_403(chat_id, x_dev_user)
    now = datetime.utcnow()
    rows = await get_db()["chat_tool_approvals"].find(
        {"chatId": chat_id, "expiresAt": {"$gt": now}},
        {"_id": 0},
    ).sort("createdAt", -1).limit(200).to_list(length=200)
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

    await get_db()["chat_tool_approvals"].update_one(
        {
            "chatId": chat_id,
            "toolName": name,
            "userId": str(chat.get("user") or ""),
        },
        {
            "$set": {
                "approvedBy": str(x_dev_user or chat.get("user") or ""),
                "createdAt": now,
                "expiresAt": exp,
            }
        },
        upsert=True,
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
    await get_db()["chat_tool_approvals"].delete_many(
        {"chatId": chat_id, "toolName": name, "userId": str(chat.get("user") or "")}
    )
    return {"chat_id": chat_id, "tool_name": name, "revoked": True}
