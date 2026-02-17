from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

Role = Literal["user", "assistant", "tool", "system"]

class ChatMessage(BaseModel):
    role: Role
    content: str
    ts: datetime = Field(default_factory=datetime.utcnow)
    meta: dict | None = None

class ChatDoc(BaseModel):
    chat_id: str
    project_id: str
    branch: str
    user: str
    messages: list[ChatMessage] = Field(default_factory=list)
    memory_summary: dict | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class AppendReq(BaseModel):
    role: Role
    content: str

class ChatResponse(BaseModel):
    chat_id: str
    project_id: str
    branch: str
    user: str
    messages: list[ChatMessage]
    memory_summary: dict | None = None
    created_at: datetime
    updated_at: datetime
