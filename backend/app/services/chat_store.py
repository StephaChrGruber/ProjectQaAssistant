from datetime import datetime
from typing import Optional
from ..db import get_db
from ..utils.ids import new_id

async def ensure_chat(project_id: str, project_key: str, branch: str, user_id: str) -> dict:
    db = get_db()
    chats = db["chats"]

    existing = await chats.find_one({
        "projectId": project_id,
        "branch": branch,
        "userId": user_id,
    })

    now = datetime.utcnow()

    if existing:
        await chats.update_one({"_id": existing["_id"]}, {"$set": {"updatedAt": now}})
        return existing

    chat = {
        "_id": new_id("chat"),
        "projectId": project_id,
        "projectKey": project_key,
        "branch": branch,
        "userId": user_id,
        "title": f"{project_key} / {branch}",
        "createdAt": now,
        "updatedAt": now,
        "lastMessageAt": None,
    }
    await chats.insert_one(chat)
    return chat

async def list_chats(project_id: str, branch: Optional[str], user_id: str) -> list[dict]:
    db = get_db()
    q = {"projectId": project_id, "userId": user_id}
    if branch:
        q["branch"] = branch
    cur = db["chats"].find(q).sort("updatedAt", -1).limit(50)
    return [doc async for doc in cur]

async def add_message(chat_id: str, role: str, content: str, citations=None, attachments=None, meta=None) -> dict:
    from ..utils.ids import new_id
    db = get_db()
    now = datetime.utcnow()
    msg = {
        "_id": new_id("msg"),
        "chatId": chat_id,
        "role": role,
        "content": content,
        "createdAt": now,
        "citations": citations or [],
        "attachments": attachments or [],
        "meta": meta or {},
    }
    await db["messages"].insert_one(msg)
    await db["chats"].update_one(
        {"_id": chat_id},
        {"$set": {"updatedAt": now, "lastMessageAt": now}}
    )
    return msg

async def get_messages(chat_id: str, limit: int = 200) -> list[dict]:
    db = get_db()
    cur = db["messages"].find({"chatId": chat_id}).sort("createdAt", 1).limit(limit)
    return [doc async for doc in cur]
