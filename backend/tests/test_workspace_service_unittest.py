from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import workspace as ws


class WorkspaceServiceTests(unittest.TestCase):
    def _run(self, coro):
        return asyncio.run(coro)

    def test_read_file_local_binary_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "assets" / "logo.bin"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"\x00\x01\x02\x03\x04")

            async def _project_doc(_project_id: str):
                return {"_id": "p1", "repo_path": str(root), "default_branch": "main"}

            with patch.object(ws, "_project_doc", _project_doc):
                out = self._run(
                    ws.read_file(
                        project_id="p1",
                        branch="main",
                        user_id="u1",
                        chat_id="c1",
                        path="assets/logo.bin",
                    )
                )

            self.assertTrue(bool(out.get("read_only")))
            self.assertEqual(out.get("read_only_reason"), "binary_file")

    def test_read_file_local_large_preview_then_full(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "large.txt"
            text = "a" * (ws.READONLY_LARGE_FILE_BYTES + 1024)
            target.write_text(text, encoding="utf-8")

            async def _project_doc(_project_id: str):
                return {"_id": "p1", "repo_path": str(root), "default_branch": "main"}

            with patch.object(ws, "_project_doc", _project_doc):
                preview = self._run(
                    ws.read_file(
                        project_id="p1",
                        branch="main",
                        user_id="u1",
                        chat_id="c1",
                        path="large.txt",
                        max_chars=600000,
                        allow_large=False,
                    )
                )
                full = self._run(
                    ws.read_file(
                        project_id="p1",
                        branch="main",
                        user_id="u1",
                        chat_id="c1",
                        path="large.txt",
                        max_chars=600000,
                        allow_large=True,
                    )
                )

            self.assertTrue(bool(preview.get("read_only")))
            self.assertEqual(preview.get("read_only_reason"), "large_file")
            self.assertIn("preview: file is large", str(preview.get("content") or ""))
            self.assertFalse(bool(full.get("read_only")))

    def test_write_file_conflict_marker(self) -> None:
        async def _read_file(**_kwargs):
            return {
                "mode": "local",
                "content": "hello",
                "content_hash": "server-hash",
                "read_only": False,
            }

        with patch.object(ws, "read_file", _read_file):
            with self.assertRaises(ws.WorkspaceError) as exc:
                self._run(
                    ws.write_file(
                        project_id="p1",
                        branch="main",
                        user_id="u1",
                        chat_id="c1",
                        path="README.md",
                        content="next",
                        expected_hash="client-hash",
                    )
                )
        self.assertTrue(str(exc.exception).startswith("conflict:"))

    def test_remote_write_uses_fallback_branch_for_github(self) -> None:
        calls: list[str] = []

        async def _github_write_file(config, *, path: str, content: str, branch: str, user_id: str):
            calls.append(branch)
            if branch.startswith("feature"):
                raise ws._RemoteBranchNotFound("missing")
            return {"branch": branch, "web_url": "https://example", "commit_id": "abc123"}

        remote = {"type": "github", "config": {"owner": "o", "repo": "r", "token": "t"}}
        with patch.object(ws, "_github_write_file", _github_write_file):
            out = self._run(
                ws._remote_write_file(
                    remote,
                    path="docs/file.md",
                    content="hello",
                    requested_branch="feature/test",
                    user_id="u1",
                )
            )

        self.assertIn("main", calls)
        self.assertEqual(out.get("resolved_ref"), "main")

    def test_remote_write_dispatch_bitbucket(self) -> None:
        async def _bitbucket_write_file(config, *, path: str, content: str, branch: str, user_id: str):
            return {"branch": branch, "web_url": "https://bitbucket.org/x/y", "commit_id": "bb1"}

        remote = {"type": "bitbucket", "config": {"workspace": "x", "repo_slug": "y"}}
        with patch.object(ws, "_bitbucket_write_file", _bitbucket_write_file):
            out = self._run(
                ws._remote_write_file(
                    remote,
                    path="src/a.ts",
                    content="const x = 1\n",
                    requested_branch="main",
                    user_id="u1",
                )
            )
        self.assertEqual(out.get("resolved_ref"), "main")
        self.assertEqual(out.get("commit_id"), "bb1")

    def test_remote_write_dispatch_azure(self) -> None:
        async def _azure_write_file(config, *, path: str, content: str, branch: str, user_id: str):
            return {"branch": branch, "web_url": "https://dev.azure.com/org/p/_git/r", "commit_id": "az1"}

        remote = {"type": "azure_devops", "config": {"organization": "org", "project": "p", "repository": "r"}}
        with patch.object(ws, "_azure_write_file", _azure_write_file):
            out = self._run(
                ws._remote_write_file(
                    remote,
                    path="src/a.ts",
                    content="const x = 1\n",
                    requested_branch="main",
                    user_id="u1",
                )
            )
        self.assertEqual(out.get("resolved_ref"), "main")
        self.assertEqual(out.get("commit_id"), "az1")


if __name__ == "__main__":
    unittest.main()
