from __future__ import annotations

import asyncio
import unittest
from pydantic import BaseModel

from app.rag.tool_runtime import ToolContext, ToolRuntime, ToolSpec


class _EmptyReq(BaseModel):
    pass


class _WriteReq(BaseModel):
    project_id: str


class ToolRuntimeSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rt = ToolRuntime()

        async def read_handler(_payload: _EmptyReq):
            return {"ok": True}

        async def write_handler(_payload: _WriteReq):
            return {"changed": True}

        self.rt.register(
            ToolSpec(
                name="read_tool",
                description="read",
                model=_EmptyReq,
                handler=read_handler,
                read_only=True,
            )
        )
        self.rt.register(
            ToolSpec(
                name="write_tool",
                description="write",
                model=_WriteReq,
                handler=write_handler,
                read_only=False,
            )
        )

        async def _allow_without_capability_db(_name: str, _spec: ToolSpec, _ctx: ToolContext):
            # Keep unit tests hermetic: policy behavior is what we validate here.
            return True, ""

        self.rt._tool_capability_allowed = _allow_without_capability_db  # type: ignore[method-assign]

    def _run(self, coro):
        return asyncio.run(coro)

    def test_dry_run_skips_write_execution(self) -> None:
        ctx = ToolContext(
            project_id="p1",
            branch="main",
            user_id="u1",
            policy={"dry_run": True},
        )
        out = self._run(self.rt.execute("write_tool", {}, ctx))
        self.assertTrue(out.ok)
        self.assertIsInstance(out.result, dict)
        self.assertTrue(bool((out.result or {}).get("dry_run")))
        self.assertTrue(bool((out.result or {}).get("skipped")))

    def test_require_approval_blocks_write_without_approval(self) -> None:
        ctx = ToolContext(
            project_id="p1",
            branch="main",
            user_id="u1",
            policy={"require_approval_for_write_tools": True},
        )
        out = self._run(self.rt.execute("write_tool", {}, ctx))
        self.assertFalse(out.ok)
        self.assertEqual((out.error or {}).code if out.error else None, "forbidden")
        self.assertEqual(((out.error.details if out.error else {}) or {}).get("reason"), "write_approval_required")

    def test_require_approval_allows_when_approved(self) -> None:
        ctx = ToolContext(
            project_id="p1",
            branch="main",
            user_id="u1",
            policy={
                "require_approval_for_write_tools": True,
                "approved_tools": ["write_tool"],
            },
        )
        out = self._run(self.rt.execute("write_tool", {}, ctx))
        self.assertTrue(out.ok)


if __name__ == "__main__":
    unittest.main()
