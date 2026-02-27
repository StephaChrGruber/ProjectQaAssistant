from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest.mock import patch

from app.services import runtime_context as rc
from app.settings import settings


class RuntimeContextTests(unittest.TestCase):
    def test_env_mode_alias_remote_slim(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_RUNTIME_MODE": "remote_slim",
                "APP_BACKEND_ORIGIN": "",
                "APP_STORAGE_ENGINE": "mongo",
                "APP_VERSION": "1.2.3",
                "APP_BUILD_SHA": "abc123",
                "DESKTOP_SESSION_ID": "sess-1",
            },
            clear=False,
        ):
            ctx = rc.load_runtime_context()

        self.assertEqual(ctx.mode, "desktop_remote_slim")
        self.assertEqual(ctx.backend_origin, "remote")
        self.assertEqual(ctx.storage_engine, "mongo")
        self.assertEqual(ctx.app_version, "1.2.3")
        self.assertEqual(ctx.build_sha, "abc123")
        self.assertEqual(ctx.desktop_session_id, "sess-1")
        self.assertFalse(bool(ctx.feature_flags.get("local_backend")))

    def test_profile_is_loaded_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = os.path.join(tmp, "runtime-profile.json")
            payload = {
                "mode": "local_fullstack",
                "data_dir": "/tmp/pqa-data",
                "local_ports": {"web": 3131, "backend": 9191, "mongo": 28017},
            }
            with open(profile_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)

            with patch.dict(os.environ, {}, clear=False):
                with patch.object(settings, "RUNTIME_PROFILE_PATH", profile_path):
                    ctx = rc.load_runtime_context()

        self.assertEqual(ctx.mode, "desktop_local_fullstack")
        self.assertEqual(ctx.local_ports.get("web"), 3131)
        self.assertEqual(ctx.local_ports.get("backend"), 9191)
        self.assertEqual(ctx.local_ports.get("mongo"), 28017)
        self.assertEqual(ctx.data_dir, "/tmp/pqa-data")
        self.assertTrue(ctx.profile_loaded)


if __name__ == "__main__":
    unittest.main()

