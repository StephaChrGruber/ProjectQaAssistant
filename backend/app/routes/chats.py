from fastapi import APIRouter, HTTPException, Header
from datetime import datetime
from ..db import get_db
from ..models.chat import ChatDoc, AppendReq, ChatResponse, ChatMessage

router = APIRouter(prefix="/chats", tags=["chats"])

COLL = "chats"


async def _ensure_chat_doc(payload: ChatDoc):
    # Upsert: create if missing.
    await get_db()[COLL].update_one(
        {"chat_id": payload.chat_id},
        {"$setOnInsert": payload.model_dump()},
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
    return docs


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    return doc

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
