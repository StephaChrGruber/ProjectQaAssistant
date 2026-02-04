from datetime import datetime
from typing import Literal, Optional, Dict, Any
from beanie import Document
from pydantic import Field

Role = Literal["admin", "member", "viewer"]
ConnectorType = Literal["confluence", "jira", "github"]
JobStatus = Literal["queued", "running", "succeeded", "failed"]

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

class AuditLog(Document):
    userId: Optional[str] = None
    projectId: Optional[str] = None
    action: str
    payload: Dict[str, Any]
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "audit_logs"
