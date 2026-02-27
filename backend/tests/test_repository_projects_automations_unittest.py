from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.repositories.mongo_automations import MongoAutomationRepository
from app.repositories.mongo_projects import MongoProjectTelemetryRepository


def _matches(row: dict, query: dict) -> bool:
    for key, expected in (query or {}).items():
        if isinstance(expected, dict):
            if "$in" in expected:
                values = list(expected.get("$in") or [])
                if row.get(key) not in values:
                    return False
                continue
        if row.get(key) != expected:
            return False
    return True


class _FakeCursor:
    def __init__(self, rows: list[dict]):
        self.rows = list(rows)
        self.limit_value: int | None = None
        self.sort_calls: list[tuple[str, int]] = []

    def sort(self, key, direction=None):  # noqa: ANN001
        if isinstance(key, list):
            for item in key:
                self.sort_calls.append((str(item[0]), int(item[1])))
        else:
            self.sort_calls.append((str(key), int(direction or 1)))
        for sort_key, sort_dir in reversed(self.sort_calls):
            self.rows.sort(
                key=lambda r: (r.get(sort_key) is None, r.get(sort_key)),
                reverse=sort_dir < 0,
            )
        return self

    def limit(self, value: int):
        self.limit_value = int(value)
        return self

    async def to_list(self, length: int):
        return list(self.rows)[: int(length)]


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _DeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = int(deleted_count)


class _FakeCollection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = [dict(row) for row in list(rows or [])]
        self.last_find_query: dict | None = None
        self.last_find_projection: dict | None = None
        self.last_aggregate_pipeline: list[dict] | None = None
        self.last_cursor: _FakeCursor | None = None
        self.aggregate_rows: list[dict] = []

    def find(self, query: dict, projection: dict | None = None):
        self.last_find_query = dict(query or {})
        self.last_find_projection = dict(projection or {})
        filtered = [row for row in self.rows if _matches(row, query or {})]
        self.last_cursor = _FakeCursor(filtered)
        return self.last_cursor

    def aggregate(self, pipeline: list[dict]):
        self.last_aggregate_pipeline = list(pipeline or [])
        self.last_cursor = _FakeCursor(list(self.aggregate_rows))
        return self.last_cursor

    async def find_one(self, query: dict, projection: dict | None = None, sort=None):
        _ = projection
        matches = [row for row in self.rows if _matches(row, query or {})]
        if sort:
            for sort_key, sort_dir in reversed(list(sort)):
                matches.sort(key=lambda r: r.get(sort_key), reverse=int(sort_dir) < 0)
        return dict(matches[0]) if matches else None

    async def insert_one(self, doc: dict):
        row = dict(doc)
        if row.get("_id") is None:
            row["_id"] = ObjectId()
        self.rows.append(row)
        return _InsertResult(row["_id"])

    async def update_one(self, query: dict, update_doc: dict):
        for idx, row in enumerate(self.rows):
            if not _matches(row, query or {}):
                continue
            patch = dict((update_doc or {}).get("$set") or {})
            self.rows[idx] = {**row, **patch}
            return

    async def delete_one(self, query: dict):
        for idx, row in enumerate(self.rows):
            if _matches(row, query or {}):
                self.rows.pop(idx)
                return _DeleteResult(1)
        return _DeleteResult(0)

    async def delete_many(self, query: dict):
        kept: list[dict] = []
        deleted = 0
        for row in self.rows:
            if _matches(row, query or {}):
                deleted += 1
                continue
            kept.append(row)
        self.rows = kept
        return _DeleteResult(deleted)


class _FakeDb:
    def __init__(self, collections: dict[str, _FakeCollection]):
        self.collections = collections

    def __getitem__(self, name: str) -> _FakeCollection:
        return self.collections[name]


class ProjectsAndAutomationsRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_project_telemetry_repository_limits_and_queries(self):
        now = datetime.now(timezone.utc)
        tool_events = _FakeCollection(
            rows=[
                {"project_id": "p1", "tool": "a", "created_at": now - timedelta(minutes=2)},
                {"project_id": "p1", "tool": "b", "created_at": now - timedelta(minutes=1)},
            ]
        )
        tool_events.aggregate_rows = [{"_id": "repo_grep", "calls": 4}]
        chats = _FakeCollection(rows=[{"project_id": "p1", "chat_id": "c1"}, {"project_id": "p1", "chat_id": "c2"}])
        db = _FakeDb({"tool_events": tool_events, "chats": chats})
        repo = MongoProjectTelemetryRepository(db)

        rows = await repo.list_tool_events(query={"project_id": "p1"}, limit=999999)
        self.assertEqual(len(rows), 2)
        assert tool_events.last_cursor is not None
        self.assertEqual(tool_events.last_cursor.limit_value, 5000)
        self.assertIn(("created_at", -1), tool_events.last_cursor.sort_calls)

        agg = await repo.aggregate_tool_events(pipeline=[{"$match": {"project_id": "p1"}}], limit=500)
        self.assertEqual(len(agg), 1)
        self.assertEqual(agg[0]["_id"], "repo_grep")

        chat_rows = await repo.list_chats(query={"project_id": "p1"}, limit=999999)
        self.assertEqual(len(chat_rows), 2)
        assert chats.last_cursor is not None
        self.assertEqual(chats.last_cursor.limit_value, 10000)

    async def test_automation_repository_crud_paths(self):
        now = datetime.now(timezone.utc)
        presets = _FakeCollection()
        versions = _FakeCollection()
        automations = _FakeCollection()
        runs = _FakeCollection(
            rows=[
                {"_id": ObjectId(), "project_id": "p1", "automation_id": "a1", "started_at": now - timedelta(minutes=2)},
                {"_id": ObjectId(), "project_id": "p1", "automation_id": "a2", "started_at": now - timedelta(minutes=1)},
            ]
        )
        chats = _FakeCollection(
            rows=[
                {"_id": ObjectId(), "project_id": "p1", "chat_id": "chat-old", "updated_at": now - timedelta(minutes=5)},
                {"_id": ObjectId(), "project_id": "p1", "chat_id": "chat-new", "updated_at": now},
            ]
        )
        db = _FakeDb(
            {
                "automation_presets": presets,
                "automation_preset_versions": versions,
                "automations": automations,
                "automation_runs": runs,
                "chats": chats,
            }
        )
        repo = MongoAutomationRepository(db)

        preset_row = await repo.insert_preset(doc={"project_id": "p1", "name": "Preset 1", "updated_at": now})
        assert preset_row is not None
        preset_id = str(preset_row["_id"])
        found_preset = await repo.find_preset(project_id="p1", preset_id=preset_id)
        self.assertIsNotNone(found_preset)

        updated_preset = await repo.update_preset_by_id(preset_id=preset_id, patch={"name": "Preset 1B"})
        assert updated_preset is not None
        self.assertEqual(updated_preset["name"], "Preset 1B")

        version_row = await repo.insert_preset_version(doc={"project_id": "p1", "preset_id": preset_id, "created_at": now})
        self.assertIsNotNone(version_row)
        version_id = str(version_row["_id"])
        version_found = await repo.find_preset_version(project_id="p1", preset_id=preset_id, version_id=version_id)
        self.assertIsNotNone(version_found)
        listed_versions = await repo.list_preset_versions(project_id="p1", preset_id=preset_id, limit=120)
        self.assertEqual(len(listed_versions), 1)

        auto_row = await repo.insert_automation(
            doc={"project_id": "p1", "name": "Auto 1", "enabled": True, "updated_at": now}
        )
        assert auto_row is not None
        auto_id = str(auto_row["_id"])
        self.assertIsNotNone(await repo.find_automation(project_id="p1", automation_id=auto_id))

        await repo.update_automation_by_id(automation_id=auto_id, patch={"enabled": False})
        enabled_only = await repo.list_automations(project_id="p1", include_disabled=False, limit=50)
        self.assertEqual(len(enabled_only), 0)
        all_items = await repo.list_automations(project_id="p1", include_disabled=True, limit=50)
        self.assertEqual(len(all_items), 1)

        run_rows = await repo.list_automation_runs(project_id="p1", automation_id="a2", limit=100)
        self.assertEqual(len(run_rows), 1)
        self.assertEqual(run_rows[0]["automation_id"], "a2")

        latest_chat = await repo.find_latest_chat_for_project(project_id="p1")
        assert latest_chat is not None
        self.assertEqual(latest_chat["chat_id"], "chat-new")

        deleted_presets = await repo.delete_preset_by_id(preset_id=preset_id)
        self.assertEqual(deleted_presets, 1)
        deleted_runs = await repo.delete_automation_runs(project_id="p1", automation_id="a1")
        self.assertEqual(deleted_runs, 1)
        deleted_automation = await repo.delete_automation_by_id(automation_id=auto_id)
        self.assertEqual(deleted_automation, 1)


if __name__ == "__main__":
    unittest.main()
