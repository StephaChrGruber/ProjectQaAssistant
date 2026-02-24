from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from .settings import settings
from .models.base_mongo_models import (
    User, Group, GroupMembership, Project, Membership, Connector, AuditLog, LlmProfile,
    CustomTool, CustomToolVersion, CustomToolAudit, LocalToolJob, ChatToolApproval, SystemToolConfig,
)
import os

_client: AsyncIOMotorClient | None = None

async def init_db():
    global _client
    _client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = _client[settings.MONGODB_DB]
    await init_beanie(
        database=db,
        document_models=[
            User,
            Group,
            GroupMembership,
            Project,
            Membership,
            Connector,
            LlmProfile,
            AuditLog,
            CustomTool,
            CustomToolVersion,
            CustomToolAudit,
            LocalToolJob,
            ChatToolApproval,
            SystemToolConfig,
        ],
    )
    # Non-Beanie collections used by runtime/analytics.
    await db["tool_events"].create_index([("project_id", 1), ("created_at", -1)], name="tool_events_project_recent")
    await db["tool_events"].create_index([("chat_id", 1), ("created_at", -1)], name="tool_events_chat_recent")
    await db["chat_tasks"].create_index([("project_id", 1), ("chat_id", 1), ("updated_at", -1)], name="chat_tasks_project_chat")
    await db["chat_tasks"].create_index([("status", 1), ("updated_at", -1)], name="chat_tasks_status_recent")
    await db["audit_events"].create_index([("project_id", 1), ("created_at", -1)], name="audit_project_recent")
    await db["audit_events"].create_index([("chat_id", 1), ("created_at", -1)], name="audit_chat_recent")
    await db["connector_health_events"].create_index([("project_id", 1), ("checked_at", -1)], name="connector_health_project_recent")
    await db["connector_health_events"].create_index([("project_id", 1), ("connector_id", 1), ("checked_at", -1)], name="connector_health_connector_recent")
    await db["automations"].create_index([("project_id", 1), ("updated_at", -1)], name="automations_project_recent")
    await db["automations"].create_index([("project_id", 1), ("enabled", 1), ("next_run_at", 1)], name="automations_project_schedule")
    await db["automations"].create_index([("project_id", 1), ("trigger.type", 1), ("trigger.event_type", 1)], name="automations_project_event")
    await db["automation_runs"].create_index([("project_id", 1), ("started_at", -1)], name="automation_runs_project_recent")
    await db["automation_runs"].create_index([("project_id", 1), ("automation_id", 1), ("started_at", -1)], name="automation_runs_automation_recent")

def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        uri = os.environ.get("MONGO_URI", "mongodb://mongo:27017")
        _client = AsyncIOMotorClient(uri)
    return _client

def get_db():
    name = os.environ.get("MONGO_DB", "project_qa")
    return get_client()[name]
