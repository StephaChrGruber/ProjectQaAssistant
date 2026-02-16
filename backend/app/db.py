from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from .settings import settings
from .models.base_mongo_models import (
    User, Group, GroupMembership, Project, Membership, Connector, AuditLog
)
import os

_client: AsyncIOMotorClient | None = None

async def init_db():
    global _client
    _client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = _client[settings.MONGODB_DB]
    await init_beanie(
        database=db,
        document_models=[User, Group, GroupMembership, Project, Membership, Connector, AuditLog],
    )

def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        uri = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
        _client = AsyncIOMotorClient(uri)
    return _client

def get_db():
    name = os.environ.get("MONGO_DB", "project_qa")
    return get_client()[name]
