from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from .bootstrap import ensure_default_project, seed_connectors_for_project
from .core.logging import configure_logging
from .db import init_db
from .middleware.request_id import RequestIdMiddleware
from .ollama_wait import wait_for_ollama
from .routes.admin import router as admin_router
from .routes.ask_agent import router as ask_agent_router
from .routes.ask_stream import router as ask_stream_router
from .routes.automations import router as automations_router
from .routes.chat import router as chat_router
from .routes.chat_global import router as chat_global_router
from .routes.chats import router as chats_router
from .routes.custom_tools import router as custom_tools_router
from .routes.ingestion import router as ingestion_router
from .routes.me import router as me_router
from .routes.notifications import router as notifications_router
from .routes.projects import router as projects_router
from .routes.qa import router as qa_router
from .routes.tools import router as tools_router
from .routes.runtime import router as runtime_router
from .routes.workspace import router as workspace_router
from .services.automations import start_automation_worker, stop_automation_worker
from .services.runtime_state import mark_failed, mark_ready, mark_starting, mark_stopping
from .settings import settings

configure_logging()
logger = logging.getLogger(__name__)

DEBUG = str(os.getenv("DEBUG", "")).lower() in {"1", "true", "yes", "on"}
if DEBUG:
    import pydevd_pycharm

    pydevd_pycharm.settrace(
        "host.docker.internal",
        port=7890,
        suspend=True,
        trace_only_current_thread=False,
    )


def _allowed_origins() -> list[str]:
    raw = [settings.WEB_ORIGIN, "http://localhost:3000"]
    configured = os.getenv("CORS_ALLOW_ORIGINS", "")
    if configured.strip():
        raw.extend(x.strip() for x in configured.split(","))

    out: list[str] = []
    seen: set[str] = set()
    for value in raw:
        origin = str(value or "").strip()
        if not origin or origin in seen:
            continue
        seen.add(origin)
        out.append(origin)
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("startup.begin")
    mark_starting()
    try:
        await init_db()

        if settings.LLM_BASE_URL and "ollama:11434" in settings.LLM_BASE_URL:
            wait_for_ollama("http://ollama:11434", settings.LLM_MODEL)

        default_project = await ensure_default_project()
        await seed_connectors_for_project(str(default_project.id))
        start_automation_worker()
        mark_ready()
        logger.info("startup.ready")
    except Exception as err:
        mark_failed(str(err))
        raise
    try:
        yield
    finally:
        mark_stopping()
        await stop_automation_worker()
        mongo_client = getattr(app.state, "mongo_client", None)
        if mongo_client is not None:
            mongo_client.close()
        logger.info("shutdown.done")


app = FastAPI(title="Project Q&A API", lifespan=lifespan)
client = AsyncIOMotorClient(settings.MONGODB_URI)
app.state.mongo_client = client
app.state.db = client[settings.MONGODB_DB]

app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(me_router)
app.include_router(qa_router)
app.include_router(admin_router)
app.include_router(ingestion_router)
app.include_router(ask_agent_router)
app.include_router(chat_router)
app.include_router(chat_global_router)
app.include_router(ask_stream_router)
app.include_router(projects_router)
app.include_router(workspace_router)
app.include_router(tools_router)
app.include_router(runtime_router)
app.include_router(chats_router)
app.include_router(custom_tools_router)
app.include_router(automations_router)
app.include_router(notifications_router)
