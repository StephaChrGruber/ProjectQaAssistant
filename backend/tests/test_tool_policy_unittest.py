from __future__ import annotations

import unittest

from app.routes.ask_agent_tool_policy import extract_tool_policy, merge_tool_policies


class ToolPolicyTests(unittest.TestCase):
    def test_extract_tool_policy_includes_new_safety_flags(self) -> None:
        project = {
            "extra": {
                "tooling": {
                    "tool_policy": {
                        "allowed_tools": ["repo_grep"],
                        "dry_run": True,
                        "require_approval_for_write_tools": True,
                    }
                }
            }
        }
        out = extract_tool_policy(project)
        self.assertEqual(out.get("allowed_tools"), ["repo_grep"])
        self.assertTrue(bool(out.get("dry_run")))
        self.assertTrue(bool(out.get("require_approval_for_write_tools")))

    def test_merge_tool_policies_combines_new_flags(self) -> None:
        base = {"dry_run": False, "require_approval_for_write_tools": True}
        chat = {"dry_run": True, "require_approval_for_write_tools": False}
        out = merge_tool_policies(base, chat)
        self.assertTrue(bool(out.get("dry_run")))
        self.assertTrue(bool(out.get("require_approval_for_write_tools")))


if __name__ == "__main__":
    unittest.main()
