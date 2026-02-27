from __future__ import annotations

from dataclasses import dataclass

from ..db import get_db
from .interfaces import (
    AccessPolicyRepository,
    AutomationRepository,
    ChatTaskRepository,
    GlobalChatRepository,
    LocalToolJobRepository,
    NotificationRepository,
    ProjectTelemetryRepository,
)
from .mongo_automations import MongoAutomationRepository
from .mongo_chat import MongoGlobalChatRepository
from .mongo_projects import MongoProjectTelemetryRepository
from .mongo_runtime import (
    MongoAccessPolicyRepository,
    MongoChatTaskRepository,
    MongoLocalToolJobRepository,
    MongoNotificationRepository,
)


@dataclass(frozen=True)
class RepositoryFactory:
    notifications: NotificationRepository
    local_tool_jobs: LocalToolJobRepository
    global_chat: GlobalChatRepository
    access_policy: AccessPolicyRepository
    chat_tasks: ChatTaskRepository
    project_telemetry: ProjectTelemetryRepository
    automations: AutomationRepository


def repository_factory(db=None) -> RepositoryFactory:
    target_db = db or get_db()
    return RepositoryFactory(
        notifications=MongoNotificationRepository(target_db),
        local_tool_jobs=MongoLocalToolJobRepository(target_db),
        global_chat=MongoGlobalChatRepository(target_db),
        access_policy=MongoAccessPolicyRepository(target_db),
        chat_tasks=MongoChatTaskRepository(target_db),
        project_telemetry=MongoProjectTelemetryRepository(target_db),
        automations=MongoAutomationRepository(target_db),
    )
