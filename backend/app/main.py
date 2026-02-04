from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .settings import settings

from .bootstrap import ensure_default_project, seed_connectors_for_project
from .routes.me import router as me_router
from .routes.qa import router as qa_router
from .routes.admin import router as admin_router
from .routes.ingestion import router as ingestion_router

from .ollama_wait import wait_for_ollama

app = FastAPI(title="Project Q&A API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.WEB_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
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
