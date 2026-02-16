from fastapi import APIRouter
from pydantic import BaseModel
from ..db import get_db
from datetime import datetime

from ..rag.agent2 import answer_with_agent
from ..rag.llm import LLM

router = APIRouter()

class AskReq(BaseModel):
    project_id: str
    question: str
    branch: str = "main"
    user: str = "dev"
    top_k: int = 8

@router.post("/ask_agent")
async def ask_agent(req: AskReq):
    chat_id = f"{req.project_id}::{req.branch}::{req.user}"
    llm = LLM()

    # ensure chat
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$setOnInsert": {
            "chat_id": chat_id,
            "project_id": req.project_id,
            "branch": req.branch,
            "user": req.user,
            "messages": [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }},
        upsert=True,
    )

    # append user message
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$push": {"messages": {"role": "user", "content": req.question, "ts": datetime.utcnow()}},
         "$set": {"updated_at": datetime.utcnow()}},
    )

    # run your existing retrieval + llm
    answer = await answer_with_agent(
        project_id=req.project_id,
        branch=req.branch,
        user_id=req.user,
        question=req.question,
        #top_k=req.top_k,
    )

    # append assistant message
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$push": {"messages": {"role": "assistant", "content": answer, "ts": datetime.utcnow()}},
         "$set": {"updated_at": datetime.utcnow()}},
    )

    return answer
