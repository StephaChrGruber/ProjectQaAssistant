from fastapi import APIRouter
from pydantic import BaseModel
from ..db import get_db
from datetime import datetime
from bson import ObjectId
from ..settings import settings

from ..rag.agent2 import answer_with_agent

router = APIRouter()

class AskReq(BaseModel):
    project_id: str
    question: str
    branch: str = "main"
    user: str = "dev"
    chat_id: str | None = None
    top_k: int = 8
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None


async def _project_llm_defaults(project_id: str) -> dict[str, str | None]:
    db = get_db()
    q = {"key": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    project = await db["projects"].find_one(q) or {}

    provider = (project.get("llm_provider") or "").strip().lower()
    base_url = (project.get("llm_base_url") or "").strip() or None
    api_key = (project.get("llm_api_key") or "").strip() or None
    model = (project.get("llm_model") or "").strip() or None

    # Provider-aware defaults for OpenAI-compatible clients.
    if provider == "ollama":
        base_url = base_url or "http://ollama:11434/v1"
        api_key = api_key or "ollama"
        model = model or settings.LLM_MODEL or "llama3.2:3b"
    elif provider in ("openai", "chatgpt"):
        base_url = base_url or "https://api.openai.com/v1"
        api_key = api_key or settings.OPENAI_API_KEY or settings.LLM_API_KEY
        model = model or "gpt-4o-mini"
    else:
        # Legacy/global fallback.
        base_url = base_url or settings.LLM_BASE_URL or "http://ollama:11434/v1"
        api_key = api_key or settings.LLM_API_KEY
        model = model or settings.LLM_MODEL or "llama3.2:3b"

    return {
        "llm_base_url": base_url,
        "llm_api_key": api_key,
        "llm_model": model,
    }


@router.post("/ask_agent")
async def ask_agent(req: AskReq):
    chat_id = req.chat_id or f"{req.project_id}::{req.branch}::{req.user}"
    now = datetime.utcnow()

    # ensure chat
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {"$setOnInsert": {
            "chat_id": chat_id,
            "project_id": req.project_id,
            "branch": req.branch,
            "user": req.user,
            "title": "New chat",
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )

    # append user message
    user_msg = {"role": "user", "content": req.question, "ts": now}
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$push": {"messages": user_msg},
            "$set": {
                "updated_at": now,
                "last_message_at": now,
                "last_message_preview": req.question[:160],
            },
            "$setOnInsert": {"title": req.question[:60] or "New chat"},
        },
    )

    # run your existing retrieval + llm
    defaults = await _project_llm_defaults(req.project_id)
    answer = await answer_with_agent(
        project_id=req.project_id,
        branch=req.branch,
        user_id=req.user,
        question=req.question,
        llm_base_url=req.llm_base_url or defaults["llm_base_url"],
        llm_api_key=req.llm_api_key or defaults["llm_api_key"],
        llm_model=req.llm_model or defaults["llm_model"],
    )

    # append assistant message
    done = datetime.utcnow()
    await get_db()["chats"].update_one(
        {"chat_id": chat_id},
        {
            "$push": {"messages": {"role": "assistant", "content": answer, "ts": done}},
            "$set": {
                "updated_at": done,
                "last_message_at": done,
                "last_message_preview": answer[:160],
            },
        },
    )

    return {"answer": answer, "chat_id": chat_id}
