from __future__ import annotations

import unittest
from datetime import datetime, timezone

from bson import ObjectId

from app.repositories.mongo_runtime import (
    MongoAccessPolicyRepository,
    MongoChatTaskRepository,
    MongoNotificationRepository,
)


class _FakeCursor:
    def __init__(self, rows: list[dict]):
        self._rows = list(rows)
        self.sort_calls: list[tuple[str, int]] = []
        self.limit_value: int | None = None

    def sort(self, key, direction=None):  # noqa: ANN001
        if isinstance(key, list):
            self.sort_calls.extend((str(k), int(v)) for k, v in key)
        else:
            self.sort_calls.append((str(key), int(direction or 1)))
        return self

    def limit(self, value: int):
        self.limit_value = int(value)
        return self

    async def to_list(self, length: int):
        return list(self._rows)[: int(length)]


class _FakeCollection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = list(rows or [])
        self.last_find_query: dict | None = None
        self.last_find_projection: dict | None = None
        self.last_update_query: dict | None = None
        self.last_update_doc: dict | None = None
        self.last_update_upsert: bool | None = None
        self.last_delete_query: dict | None = None
        self.last_count_query: dict | None = None
        self.count_result: int = len(self.rows)
        self.cursor = _FakeCursor(self.rows)

    def find(self, query: dict, projection: dict | None = None):
        self.last_find_query = dict(query)
        self.last_find_projection = dict(projection or {})
        self.cursor = _FakeCursor(self.rows)
        return self.cursor

    async def update_one(self, query: dict, update_doc: dict, upsert: bool = False):
        self.last_update_query = dict(query)
        self.last_update_doc = dict(update_doc)
        self.last_update_upsert = bool(upsert)

    async def delete_many(self, query: dict):
        self.last_delete_query = dict(query)

    async def find_one(self, query: dict):
        for row in self.rows:
            if row.get("_id") == query.get("_id"):
                return dict(row)
        return None

    async def count_documents(self, query: dict):
        self.last_count_query = dict(query)
        return int(self.count_result)


class _FakeDb:
    def __init__(self, collections: dict[str, _FakeCollection]):
        self._collections = collections

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collections[name]


class RuntimeRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_active_tool_approvals_scopes_context_with_legacy(self):
        approvals = _FakeCollection(rows=[{"toolName": "git_fetch", "approved": True}])
        db = _FakeDb({"chat_tool_approvals": approvals})
        repo = MongoAccessPolicyRepository(db)

        rows = await repo.list_active_tool_approvals(
            chat_id="global::user@local",
            now=datetime.now(timezone.utc),
            context_key="project::main",
            include_legacy_when_context_set=True,
            limit=120,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["toolName"], "git_fetch")
        assert approvals.last_find_query is not None
        self.assertIn("$or", approvals.last_find_query)
        self.assertEqual(approvals.last_find_query["chatId"], "global::user@local")

    async def test_upsert_and_revoke_tool_approval_respect_context(self):
        approvals = _FakeCollection()
        db = _FakeDb({"chat_tool_approvals": approvals})
        repo = MongoAccessPolicyRepository(db)
        now = datetime.now(timezone.utc)

        await repo.upsert_tool_approval(
            chat_id="global::user@local",
            tool_name="generate_project_docs",
            user_id="stephan@local",
            approved_by="stephan@local",
            created_at=now,
            expires_at=now,
            context_key="69a01::main",
        )
        assert approvals.last_update_query is not None
        assert approvals.last_update_doc is not None
        self.assertEqual(approvals.last_update_query.get("contextKey"), "69a01::main")
        self.assertEqual(approvals.last_update_doc["$set"].get("contextKey"), "69a01::main")
        self.assertTrue(bool(approvals.last_update_upsert))

        await repo.revoke_tool_approval(
            chat_id="global::user@local",
            tool_name="generate_project_docs",
            user_id="stephan@local",
            context_key="69a01::main",
        )
        assert approvals.last_delete_query is not None
        self.assertEqual(approvals.last_delete_query.get("contextKey"), "69a01::main")

    async def test_chat_task_repository_limits_and_updates(self):
        task_id = str(ObjectId())
        tasks = _FakeCollection(
            rows=[
                {
                    "_id": ObjectId(task_id),
                    "title": "T1",
                    "updated_at": "2026-02-27T00:00:00Z",
                }
            ]
        )
        db = _FakeDb({"chat_tasks": tasks})
        repo = MongoChatTaskRepository(db)

        rows = await repo.list_chat_tasks(query={"chat_id": "global::u"}, limit=9999)
        self.assertEqual(len(rows), 1)
        self.assertEqual(tasks.cursor.limit_value, 500)
        self.assertIn(("updated_at", -1), tasks.cursor.sort_calls)

        row = await repo.update_chat_task_by_id(task_id=task_id, patch={"status": "done"})
        self.assertIsNotNone(row)
        self.assertEqual(row["title"], "T1")
        assert tasks.last_update_query is not None
        self.assertEqual(str(tasks.last_update_query["_id"]), task_id)
        self.assertEqual(tasks.last_update_doc, {"$set": {"status": "done"}})

        invalid = await repo.update_chat_task_by_id(task_id="not-an-object-id", patch={"status": "open"})
        self.assertIsNone(invalid)

    async def test_notification_repository_counts_unread(self):
        notifications = _FakeCollection(rows=[{"_id": ObjectId()}, {"_id": ObjectId()}])
        notifications.count_result = 7
        db = _FakeDb({"notifications": notifications})
        repo = MongoNotificationRepository(db)

        count = await repo.count_unread_notifications(user_ids=["stephan@local"], project_id="p1")
        self.assertEqual(count, 7)
        assert notifications.last_count_query is not None
        self.assertEqual(notifications.last_count_query["user_id"], {"$in": ["stephan@local"]})
        self.assertEqual(notifications.last_count_query["project_id"], "p1")
        self.assertEqual(notifications.last_count_query["dismissed"], {"$ne": True})


if __name__ == "__main__":
    unittest.main()
