from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol


class NotificationRepository(Protocol):
    async def insert_notification(self, doc: dict[str, Any]) -> str: ...

    async def get_notification_by_id(self, notification_id: str) -> dict[str, Any] | None: ...

    async def get_notification_for_user(self, notification_id: str, user_ids: list[str]) -> dict[str, Any] | None: ...

    async def list_notifications(
        self,
        *,
        user_ids: list[str],
        project_id: str | None,
        include_dismissed: bool,
        limit: int,
    ) -> list[dict[str, Any]]: ...

    async def count_unread_notifications(self, *, user_ids: list[str], project_id: str | None = None) -> int: ...

    async def update_notification_by_id(self, notification_id: str, update_doc: dict[str, Any]) -> None: ...

    async def update_notifications_many(self, query: dict[str, Any], update_doc: dict[str, Any]) -> int: ...


class LocalToolJobRepository(Protocol):
    async def claim_next_local_job(
        self,
        *,
        user_id: str,
        now: datetime,
        claim_token: str,
        project_id: str | None,
    ) -> dict[str, Any] | None: ...

    async def get_local_job_for_user(
        self,
        *,
        job_id: str,
        user_id: str,
        claim_id: str | None = None,
    ) -> dict[str, Any] | None: ...

    async def mark_local_job_completed(
        self,
        *,
        job_id: str,
        result: Any,
        now: datetime,
    ) -> None: ...

    async def mark_local_job_failed(
        self,
        *,
        job_id: str,
        error: str,
        now: datetime,
    ) -> None: ...


class GlobalChatRepository(Protocol):
    async def ensure_chat_envelope(
        self,
        *,
        chat_id: str,
        user: str,
        title: str,
        active_context_key: str | None,
        now: datetime,
    ) -> dict[str, Any] | None: ...

    async def get_chat_envelope(self, *, chat_id: str, projection: dict[str, int] | None = None) -> dict[str, Any] | None: ...

    async def set_chat_active_context(self, *, chat_id: str, active_context_key: str | None, now: datetime) -> None: ...

    async def append_message(self, *, doc: dict[str, Any]) -> dict[str, Any]: ...

    async def touch_chat_after_message(self, *, chat_id: str, now: datetime, content: str) -> None: ...

    async def list_messages(
        self,
        *,
        chat_id: str,
        context_key: str | None = None,
        is_pinned: bool | None = None,
        before_id: str | None = None,
        limit: int = 120,
        descending: bool = True,
    ) -> list[dict[str, Any]]: ...

    async def get_message(self, *, chat_id: str, message_id: str) -> dict[str, Any] | None: ...

    async def set_message_pin_state(
        self,
        *,
        chat_id: str,
        message_id: str,
        is_pinned: bool,
        pin_source: str,
    ) -> None: ...

    async def list_context_summaries(self, *, chat_id: str, limit: int = 300) -> list[dict[str, Any]]: ...

    async def get_context_config(
        self,
        *,
        chat_id: str,
        user: str,
        context_key: str,
    ) -> dict[str, Any] | None: ...

    async def upsert_context_config(
        self,
        *,
        chat_id: str,
        user: str,
        context_key: str,
        project_id: str,
        branch: str,
        patch: dict[str, Any],
        now: datetime,
    ) -> dict[str, Any] | None: ...

    async def list_context_configs(
        self,
        *,
        chat_id: str,
        user: str,
        limit: int = 300,
    ) -> list[dict[str, Any]]: ...

    async def find_legacy_chat(
        self,
        *,
        chat_id: str,
        project_id: str | None = None,
        branch: str | None = None,
        user: str | None = None,
        projection: dict[str, Any] | None = None,
        fallback_to_chat_id: bool = False,
    ) -> dict[str, Any] | None: ...

    async def set_legacy_pending_user_question(
        self,
        *,
        chat_id: str,
        project_id: str,
        payload: dict[str, Any],
        now: datetime,
    ) -> bool: ...


class AccessPolicyRepository(Protocol):
    async def find_project_doc(
        self,
        project_id_or_key: str,
        projection: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None: ...

    async def find_user_by_email(self, email: str) -> dict[str, Any] | None: ...

    async def find_user_by_id(self, user_id: str) -> dict[str, Any] | None: ...

    async def find_membership_role(self, *, user_id: str, project_id: str) -> str | None: ...

    async def list_enabled_connectors(
        self,
        *,
        project_id: str,
        types: list[str] | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]: ...

    async def find_enabled_connector(
        self,
        *,
        project_id: str,
        connector_type: str,
    ) -> dict[str, Any] | None: ...

    async def update_project_fields(
        self,
        *,
        project_id_or_key: str,
        patch: dict[str, Any],
    ) -> int: ...

    async def update_project_fields_by_id(self, *, project_id: str, patch: dict[str, Any]) -> int: ...

    async def update_connector_fields(
        self,
        *,
        project_id: str,
        connector_type: str,
        patch: dict[str, Any],
    ) -> int: ...

    async def list_active_tool_approvals(
        self,
        *,
        chat_id: str,
        now: datetime,
        context_key: str | None = None,
        include_legacy_when_context_set: bool = True,
        limit: int = 400,
    ) -> list[dict[str, Any]]: ...

    async def upsert_tool_approval(
        self,
        *,
        chat_id: str,
        tool_name: str,
        user_id: str,
        approved_by: str,
        created_at: datetime,
        expires_at: datetime,
        context_key: str | None = None,
    ) -> None: ...

    async def revoke_tool_approval(
        self,
        *,
        chat_id: str,
        tool_name: str,
        user_id: str,
        context_key: str | None = None,
    ) -> None: ...


class ChatTaskRepository(Protocol):
    async def list_chat_tasks(self, *, query: dict[str, Any], limit: int) -> list[dict[str, Any]]: ...

    async def create_chat_task(self, *, doc: dict[str, Any]) -> dict[str, Any] | None: ...

    async def find_chat_task(
        self,
        *,
        query: dict[str, Any],
        sort: list[tuple[str, int]] | None = None,
    ) -> dict[str, Any] | None: ...

    async def update_chat_task_by_id(self, *, task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None: ...


class ProjectTelemetryRepository(Protocol):
    async def list_tool_events(
        self,
        *,
        query: dict[str, Any],
        projection: dict[str, Any] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]: ...

    async def aggregate_tool_events(self, *, pipeline: list[dict[str, Any]], limit: int = 500) -> list[dict[str, Any]]: ...

    async def list_chats(
        self,
        *,
        query: dict[str, Any],
        projection: dict[str, Any] | None = None,
        limit: int = 5000,
    ) -> list[dict[str, Any]]: ...


class AutomationRepository(Protocol):
    async def list_presets(self, *, project_id: str, limit: int = 200) -> list[dict[str, Any]]: ...

    async def insert_preset(self, *, doc: dict[str, Any]) -> dict[str, Any] | None: ...

    async def find_preset(self, *, project_id: str, preset_id: str) -> dict[str, Any] | None: ...

    async def update_preset_by_id(self, *, preset_id: str, patch: dict[str, Any]) -> dict[str, Any] | None: ...

    async def delete_preset_by_id(self, *, preset_id: str) -> int: ...

    async def insert_preset_version(self, *, doc: dict[str, Any]) -> dict[str, Any] | None: ...

    async def list_preset_versions(self, *, project_id: str, preset_id: str, limit: int = 100) -> list[dict[str, Any]]: ...

    async def find_preset_version(
        self,
        *,
        project_id: str,
        preset_id: str,
        version_id: str,
    ) -> dict[str, Any] | None: ...

    async def list_automations(
        self,
        *,
        project_id: str,
        include_disabled: bool,
        limit: int = 200,
    ) -> list[dict[str, Any]]: ...

    async def find_automation(self, *, project_id: str, automation_id: str) -> dict[str, Any] | None: ...

    async def insert_automation(self, *, doc: dict[str, Any]) -> dict[str, Any] | None: ...

    async def update_automation_by_id(
        self,
        *,
        automation_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any] | None: ...

    async def delete_automation_by_id(self, *, automation_id: str) -> int: ...

    async def delete_automation_runs(self, *, project_id: str, automation_id: str) -> int: ...

    async def list_automation_runs(
        self,
        *,
        project_id: str,
        automation_id: str | None,
        limit: int = 120,
    ) -> list[dict[str, Any]]: ...

    async def find_latest_chat_for_project(self, *, project_id: str) -> dict[str, Any] | None: ...

    async def append_chat_message(
        self,
        *,
        project_id: str,
        chat_id: str,
        msg: dict[str, Any],
        updated_at: datetime,
        preview: str,
    ) -> int: ...

    async def set_pending_user_question(
        self,
        *,
        project_id: str,
        chat_id: str,
        payload: dict[str, Any],
        updated_at: datetime,
    ) -> int: ...

    async def set_chat_title(
        self,
        *,
        project_id: str,
        chat_id: str,
        title: str,
        updated_at: datetime,
    ) -> int: ...

    async def insert_ingestion_run(self, *, doc: dict[str, Any]) -> None: ...

    async def upsert_state_value(
        self,
        *,
        project_id: str,
        key: str,
        value: Any,
        updated_at: datetime,
        updated_by: str,
    ) -> None: ...

    async def find_automation_by_name(self, *, project_id: str, name: str) -> dict[str, Any] | None: ...

    async def insert_automation_run(self, *, doc: dict[str, Any]) -> dict[str, Any] | None: ...

    async def list_enabled_event_automations(
        self,
        *,
        project_id: str,
        event_type: str,
        limit: int = 500,
    ) -> list[dict[str, Any]]: ...

    async def list_due_scheduled_automations(self, *, now: datetime, limit: int = 20) -> list[dict[str, Any]]: ...
