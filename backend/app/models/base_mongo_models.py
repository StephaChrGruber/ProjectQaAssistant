from datetime import datetime
from typing import Literal, Optional, Dict, Any
from beanie import Document
from pydantic import Field

Role = Literal["admin", "member", "viewer"]
ConnectorType = Literal["confluence", "jira", "github", "bitbucket", "azure_devops", "local"]
JobStatus = Literal["queued", "running", "succeeded", "failed"]
CustomToolRuntime = Literal["backend_python", "local_typescript"]
CustomToolVersionStatus = Literal["draft", "published", "archived"]
LocalToolJobStatus = Literal["queued", "running", "completed", "failed", "timeout", "cancelled"]

class User(Document):
    email: str
    displayName: Optional[str] = None
    entraObjectId: Optional[str] = None
    isActive: bool = True
    isGlobalAdmin: bool = False
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"

class Group(Document):
    displayName: str
    entraGroupId: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "groups"

class GroupMembership(Document):
    groupId: str
    userId: str
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "group_memberships"
        indexes = [[("groupId", 1), ("userId", 1)]]

class Project(Document):
    key: str
    name: str
    description: Optional[str] = None
    repo_path: Optional[str] = None
    default_branch: str = "main"
    llm_provider: Optional[str] = None  # e.g. "ollama" | "openai"
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_profile_id: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "projects"

class Membership(Document):
    userId: str
    projectId: str
    role: Role
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "memberships"
        indexes = [[("userId", 1), ("projectId", 1)]]

class Connector(Document):
    projectId: str
    type: ConnectorType
    isEnabled: bool = True
    config: Dict[str, Any]
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "connectors"


class LlmProfile(Document):
    name: str
    description: Optional[str] = None
    provider: str  # e.g. "ollama" | "openai"
    base_url: Optional[str] = None
    model: str
    api_key: Optional[str] = None
    isEnabled: bool = True
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "llm_profiles"

class AuditLog(Document):
    userId: Optional[str] = None
    projectId: Optional[str] = None
    action: str
    payload: Dict[str, Any]
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "audit_logs"


class CustomTool(Document):
    projectId: Optional[str] = None  # None => global tool
    name: str
    slug: str
    description: Optional[str] = None
    runtime: CustomToolRuntime = "backend_python"
    isEnabled: bool = True
    readOnly: bool = True
    requireApproval: bool = False
    timeoutSec: int = 45
    rateLimitPerMin: int = 40
    maxRetries: int = 0
    cacheTtlSec: int = 0
    inputSchema: Dict[str, Any] = Field(default_factory=dict)
    outputSchema: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    latestVersion: int = 0
    publishedVersion: Optional[int] = None
    createdBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "custom_tools"
        indexes = [
            [("projectId", 1), ("slug", 1)],
            [("isEnabled", 1), ("projectId", 1)],
        ]


class CustomToolVersion(Document):
    toolId: str
    version: int
    status: CustomToolVersionStatus = "draft"
    code: str
    checksum: str
    changelog: Optional[str] = None
    createdBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "custom_tool_versions"
        indexes = [
            [("toolId", 1), ("version", -1)],
            [("toolId", 1), ("status", 1)],
        ]


class CustomToolAudit(Document):
    toolId: Optional[str] = None
    toolName: Optional[str] = None
    projectId: Optional[str] = None
    chatId: Optional[str] = None
    userId: Optional[str] = None
    action: str
    ok: bool = True
    details: Dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "custom_tool_audit"
        indexes = [
            [("toolId", 1), ("createdAt", -1)],
            [("projectId", 1), ("createdAt", -1)],
            [("chatId", 1), ("createdAt", -1)],
        ]


class LocalToolJob(Document):
    toolId: str
    toolName: str
    projectId: str
    branch: str
    userId: str
    chatId: Optional[str] = None
    runtime: CustomToolRuntime = "local_typescript"
    version: Optional[int] = None
    code: str
    args: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)
    status: LocalToolJobStatus = "queued"
    result: Optional[Any] = None
    error: Optional[str] = None
    claimedBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    expiresAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None

    class Settings:
        name = "local_tool_jobs"
        indexes = [
            [("status", 1), ("userId", 1), ("projectId", 1), ("createdAt", 1)],
            [("status", 1), ("expiresAt", 1)],
            [("chatId", 1), ("createdAt", -1)],
        ]


class ChatToolApproval(Document):
    chatId: str
    toolName: str
    userId: str
    approvedBy: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    expiresAt: datetime

    class Settings:
        name = "chat_tool_approvals"
        indexes = [
            [("chatId", 1), ("toolName", 1), ("userId", 1)],
            [("expiresAt", 1)],
        ]
