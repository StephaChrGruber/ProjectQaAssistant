from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from .settings import settings
from .models import (
    User, Group, GroupMembership, Project, Membership, Connector, AuditLog
)

client: AsyncIOMotorClient | None = None

async def init_db():
    global client
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB]
    await init_beanie(
        database=db,
        document_models=[User, Group, GroupMembership, Project, Membership, Connector, AuditLog],
    )
