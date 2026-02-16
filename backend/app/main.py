import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sympy import false

from .db import init_db
from .settings import settings

from .bootstrap import ensure_default_project, seed_connectors_for_project
from .routes.me import router as me_router
from .routes.qa import router as qa_router
from .routes.admin import router as admin_router
from .routes.ingestion import router as ingestion_router
from .routes.ask_agent import router as ask_agent_router
from .routes.chat import router as chat_router
from .routes.ask_stream import router as ask_stream_router
from .routes.projects import router as projects_router
from .routes.chats import router as chats_router
from .ollama_wait import wait_for_ollama
from fastapi import FastAPI
from .routes.tools import router as tools_router

from motor.motor_asyncio import AsyncIOMotorClient

import logging, sys

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)
DEBUG = os.getenv("DEBUG", False)
if DEBUG:
    import pydevd_pycharm
    pydevd_pycharm.settrace(
        "host.docker.internal",
        port=7890,
        suspend=True,
        trace_only_current_thread=False,
    )

app = FastAPI(title="Project Q&A API")

mongo_url = os.getenv("MONGO_URL", "mongodb://mongo:27017")
mongo_db = os.getenv("MONGO_DB", "project_qa")

client = AsyncIOMotorClient(mongo_url)
app.state.mongo_client = client
app.state.db = client[mongo_db]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.WEB_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    logger.info("Startup")

    await init_db()

    # If using Ollama via docker network
    if settings.LLM_BASE_URL and "ollama:11434" in settings.LLM_BASE_URL:
        wait_for_ollama("http://ollama:11434", settings.LLM_MODEL)

    p = await ensure_default_project()
    await seed_connectors_for_project(str(p.id))

app.include_router(me_router)
app.include_router(qa_router)
app.include_router(admin_router)
app.include_router(ingestion_router)
app.include_router(ask_agent_router)
app.include_router(chat_router)
app.include_router(ask_stream_router)
app.include_router(projects_router)
app.include_router(tools_router)
app.include_router(chats_router)
