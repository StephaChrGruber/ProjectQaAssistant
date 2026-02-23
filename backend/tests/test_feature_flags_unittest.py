from __future__ import annotations

import unittest

from app.services.feature_flags import (
    DEFAULT_FEATURE_FLAGS,
    normalize_feature_flags,
    project_feature_flags,
)


class FeatureFlagsTests(unittest.TestCase):
    def test_normalize_feature_flags_uses_defaults(self) -> None:
        out = normalize_feature_flags({})
        self.assertEqual(out, DEFAULT_FEATURE_FLAGS)

    def test_normalize_feature_flags_coerces_values(self) -> None:
        out = normalize_feature_flags(
            {
                "enable_audit_events": "false",
                "enable_connector_health": "1",
                "enable_memory_controls": 0,
                "dry_run_tools_default": "yes",
                "require_approval_for_write_tools": "off",
            }
        )
        self.assertEqual(out["enable_audit_events"], False)
        self.assertEqual(out["enable_connector_health"], True)
        self.assertEqual(out["enable_memory_controls"], False)
        self.assertEqual(out["dry_run_tools_default"], True)
        self.assertEqual(out["require_approval_for_write_tools"], False)

    def test_project_feature_flags_reads_from_project_extra(self) -> None:
        project = {
            "extra": {
                "feature_flags": {
                    "dry_run_tools_default": True,
                }
            }
        }
        out = project_feature_flags(project)
        self.assertTrue(out["dry_run_tools_default"])
        self.assertEqual(out["enable_audit_events"], DEFAULT_FEATURE_FLAGS["enable_audit_events"])


if __name__ == "__main__":
    unittest.main()
