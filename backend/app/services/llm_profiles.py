from __future__ import annotations

from typing import Any

from bson import ObjectId

from ..db import get_db
from ..settings import settings

OLLAMA_DEFAULT_BASE_URL = "http://ollama:11434/v1"
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"


def _normalize_provider(provider: str | None) -> str:
    p = (provider or "").strip().lower()
    if p in ("chatgpt", "openai"):
        return "openai"
    if p:
        return p
    return "ollama"


def _normalize_api_key(api_key: str | None) -> str | None:
    key = (api_key or "").strip() or None
    if key and key.lower() == "ollama":
        return None
    return key


def _default_base_url(provider: str) -> str:
    if provider == "openai":
        return OPENAI_DEFAULT_BASE_URL
    return settings.LLM_BASE_URL or OLLAMA_DEFAULT_BASE_URL


def _default_model(provider: str) -> str:
    if provider == "openai":
        return "gpt-4o-mini"
    return settings.LLM_MODEL or "llama3.2:3b"


def _default_api_key(provider: str) -> str | None:
    if provider == "openai":
        return settings.OPENAI_API_KEY or settings.LLM_API_KEY
    return settings.LLM_API_KEY or "ollama"


async def load_llm_profile(profile_id: str | None) -> dict[str, Any] | None:
    pid = (profile_id or "").strip()
    if not pid:
        return None

    db = get_db()
    q: dict[str, Any] = {"_id": pid}
    if ObjectId.is_valid(pid):
        q = {"_id": ObjectId(pid)}

    doc = await db["llm_profiles"].find_one(q)
    if not doc:
        return None
    if not bool(doc.get("isEnabled", True)):
        return None
    return doc


async def resolve_project_llm_config(
    project: dict[str, Any],
    *,
    override_profile_id: str | None = None,
) -> dict[str, Any]:
    requested_profile_id = (override_profile_id or "").strip() or None
    project_profile_id = (project.get("llm_profile_id") or "").strip() or None
    effective_profile_id = requested_profile_id or project_profile_id

    profile = await load_llm_profile(effective_profile_id)

    profile_provider = _normalize_provider((profile or {}).get("provider")) if profile else ""
    project_provider = _normalize_provider(project.get("llm_provider"))
    provider = profile_provider or project_provider

    base_url = (
        ((profile or {}).get("base_url") if profile else None)
        or project.get("llm_base_url")
        or _default_base_url(provider)
    )
    model = (
        ((profile or {}).get("model") if profile else None)
        or project.get("llm_model")
        or _default_model(provider)
    )
    api_key = _normalize_api_key(
        ((profile or {}).get("api_key") if profile else None)
        or project.get("llm_api_key")
        or _default_api_key(provider)
    )

    if provider == "openai":
        base_url = (base_url or OPENAI_DEFAULT_BASE_URL).strip() or OPENAI_DEFAULT_BASE_URL
        model = (str(model or "").strip() or "gpt-4o-mini")
        api_key = api_key or settings.OPENAI_API_KEY or settings.LLM_API_KEY
    else:
        base_url = (base_url or OLLAMA_DEFAULT_BASE_URL).strip() or OLLAMA_DEFAULT_BASE_URL
        model = (str(model or "").strip() or settings.LLM_MODEL or "llama3.2:3b")
        api_key = api_key or settings.LLM_API_KEY or "ollama"

    return {
        "provider": provider,
        "llm_base_url": base_url,
        "llm_api_key": api_key,
        "llm_model": model,
        "llm_profile_id": str((profile or {}).get("_id")) if profile else None,
        "llm_profile_name": (profile or {}).get("name") if profile else None,
    }


async def resolve_project_llm_config_by_id(
    project_id: str,
    *,
    override_profile_id: str | None = None,
) -> dict[str, Any]:
    db = get_db()
    q: dict[str, Any] = {"key": project_id}
    if ObjectId.is_valid(project_id):
        q = {"_id": ObjectId(project_id)}
    project = await db["projects"].find_one(q) or {}
    return await resolve_project_llm_config(project, override_profile_id=override_profile_id)
