import json
import os
from datetime import datetime
from typing import Any

from .models import Project, Connector

DEFAULT_PROJECT_KEY = "POC"
DEFAULT_PROJECT_NAME = "Local POC Project"

def _now():
    return datetime.utcnow()

async def ensure_default_project() -> Project:
    p = await Project.find_one(Project.key == DEFAULT_PROJECT_KEY)
    if not p:
        p = Project(key=DEFAULT_PROJECT_KEY, name=DEFAULT_PROJECT_NAME, description="Auto-created POC project")
        await p.insert()
    return p

async def seed_connectors_for_project(project_id: str):
    """
    Optional seeding for local POC so you don't have to use Compass.
    Two ways to provide seed data:
      A) env var POC_CONNECTORS_JSON containing {"connectors":[...]}
      B) file /app/seed_connectors.json inside container (mount or COPY)
    """
    seed = None

    env_json = os.getenv("POC_CONNECTORS_JSON")
    if env_json:
        seed = json.loads(env_json)

    if seed is None and os.path.exists("/app/seed_connectors.json"):
        with open("/app/seed_connectors.json", "r", encoding="utf-8") as f:
            seed = json.load(f)

    if not seed:
        return

    connectors = seed.get("connectors", [])
    for c in connectors:
        # Ensure projectId is set
        c["projectId"] = project_id
        c.setdefault("isEnabled", True)

        # Upsert by (projectId,type) for POC
        existing = await Connector.find_one(
            Connector.projectId == project_id,
            Connector.type == c["type"],
            )
        if existing:
            existing.isEnabled = c.get("isEnabled", True)
            existing.config = c.get("config", {})
            existing.updatedAt = _now()
            await existing.save()
        else:
            await Connector(
                projectId=project_id,
                type=c["type"],
                isEnabled=c.get("isEnabled", True),
                config=c.get("config", {}),
                createdAt=_now(),
                updatedAt=_now(),
            ).insert()
