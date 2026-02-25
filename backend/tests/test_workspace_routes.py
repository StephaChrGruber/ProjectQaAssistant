from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.workspace import router as workspace_router
from app.services.workspace import WorkspaceError


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(workspace_router)
    return TestClient(app)


class WorkspaceRouteTests(unittest.TestCase):
    def test_workspace_file_write_conflict_returns_409(self) -> None:
        client = _client()
        with patch(
            "app.routes.workspace.write_file",
            new=AsyncMock(side_effect=WorkspaceError("conflict:file_changed_since_load")),
        ):
            resp = client.post(
                "/projects/p1/workspace/file/write",
                headers={"X-Dev-User": "dev@local"},
                json={"branch": "main", "path": "README.md", "content": "x"},
            )
        self.assertEqual(resp.status_code, 409)
        self.assertIn("conflict:file_changed_since_load", resp.text)

    def test_workspace_patch_apply_conflict_returns_409(self) -> None:
        client = _client()
        out = {
            "applied": [],
            "conflicts": [{"path": "README.md", "reason": "hash_mismatch"}],
            "applied_count": 0,
            "conflict_count": 1,
            "ok": False,
        }
        with patch("app.routes.workspace.apply_patch", new=AsyncMock(return_value=out)):
            resp = client.post(
                "/projects/p1/workspace/patch/apply",
                headers={"X-Dev-User": "dev@local"},
                json={"branch": "main", "patch": {"files": [{"path": "README.md"}]}, "selection": []},
            )
        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body["detail"]["conflict_count"], 1)

    def test_workspace_patch_apply_ok_returns_200(self) -> None:
        client = _client()
        out = {
            "applied": [{"path": "README.md"}],
            "conflicts": [],
            "applied_count": 1,
            "conflict_count": 0,
            "ok": True,
        }
        with patch("app.routes.workspace.apply_patch", new=AsyncMock(return_value=out)):
            resp = client.post(
                "/projects/p1/workspace/patch/apply",
                headers={"X-Dev-User": "dev@local"},
                json={"branch": "main", "patch": {"files": [{"path": "README.md"}]}, "selection": []},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])


if __name__ == "__main__":
    unittest.main()
