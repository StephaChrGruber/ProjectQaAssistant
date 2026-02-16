from fastapi import APIRouter, HTTPException
from datetime import datetime
from ..db import get_db
from ..models.chat import ChatDoc, AppendReq, ChatResponse, ChatMessage

router = APIRouter(prefix="/chats", tags=["chats"])

COLL = "chats"

@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(chat_id: str):
    doc = await get_db()[COLL].find_one({"chat_id": chat_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    return doc

@router.post("/ensure", response_model=ChatResponse)
async def ensure_chat(payload: ChatDoc):
    now = datetime.utcnow()
    # Upsert: create if missing
    await get_db()[COLL].update_one(
        {"chat_id": payload.chat_id},
        {"$setOnInsert": payload.model_dump()},
        upsert=True,
    )
    doc = await get_db()[COLL].find_one({"chat_id": payload.chat_id}, {"_id": 0})
    return doc

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
