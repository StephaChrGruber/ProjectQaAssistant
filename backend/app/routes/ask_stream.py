from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
import json
import time

from ..deps import current_user
from ..db import get_db
from ..services.chat_store import add_message
from ..rag.agent import answer_with_agent  # your existing agent function
from ..utils.mongo import oid

router = APIRouter()

async def _get_chat(chat_id: str, user_id: str) -> dict:
    db = get_db()
    chat = await db["chats"].find_one({"_id": chat_id, "userId": user_id})
    if not chat:
        raise HTTPException(404, "Chat not found")
    return chat

async def _get_project(project_id: str) -> dict:
    db = get_db()
    proj = await db["projects"].find_one({"_id": oid(project_id)})
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj

@router.post("/chats/{chat_id}/ask_stream")
async def ask_stream(chat_id: str, body: dict, user=Depends(current_user)):
    chat = await _get_chat(chat_id, user["id"])
    project = await _get_project(chat["projectId"])

    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question required")

    top_k = int(body.get("topK") or 5)
    max_steps = int(body.get("maxSteps") or 4)

    # persist user msg
    await add_message(chat_id, "user", question, meta={"branch": chat["branch"]})

    async def event_gen():
        # immediate status
        yield {"event": "status", "data": "thinking"}

        # ---- IMPORTANT ----
        # Your current agent likely calls llm.chat() and returns a final answer.
        # Here we stream "fake tokens" by chunking the final output.
        #
        # Later, when you switch llm.chat() to true streaming, you can yield real tokens.
        # -------------------

        # run agent
        out = answer_with_agent(
            project_key=project.get("key", "project"),
            chroma_root=project.get("chromaRoot", ""),  # adapt if you store it elsewhere
            question=question,
            top_k=top_k,
            max_steps=max_steps,
        )

        answer = (out.get("answer") or "")
        citations = out.get("sources") or out.get("citations") or []
        attachments = out.get("attachments") or []

        # stream tokens (simple chunking)
        buf = ""
        for ch in answer:
            buf += ch
            if len(buf) >= 40:
                yield {"event": "token", "data": buf}
                buf = ""
                await _sleep_small()
        if buf:
            yield {"event": "token", "data": buf}

        # persist assistant msg
        await add_message(
            chat_id,
            "assistant",
            answer,
            citations=citations,
            attachments=attachments,
            meta={"topK": top_k, "maxSteps": max_steps, "branch": chat["branch"]},
        )

        # final metadata
        yield {"event": "final", "data": json.dumps({"citations": citations, "attachments": attachments})}

    return EventSourceResponse(event_gen())

async def _sleep_small():
    # keep the UI “typing” without slowing too much
    import asyncio
    await asyncio.sleep(0.01)
