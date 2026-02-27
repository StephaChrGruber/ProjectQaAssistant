from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.runtime import router as runtime_router
from app.services.runtime_state import mark_failed, mark_ready, mark_starting


class RuntimeRoutesTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(runtime_router)
        self.client = TestClient(app)
        mark_starting()

    def tearDown(self) -> None:
        mark_starting()

    def test_live_endpoint_is_available(self) -> None:
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body.get("status"), "alive")
        self.assertIn("runtime_status", body)

    def test_ready_endpoint_returns_503_until_ready(self) -> None:
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)

        mark_ready()
        response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(bool(body.get("ready")))

    def test_runtime_info_includes_failure_state(self) -> None:
        mark_failed("db init failed")
        response = self.client.get("/runtime/info")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body.get("runtime_status"), "failed")
        self.assertEqual(body.get("last_error"), "db init failed")


if __name__ == "__main__":
    unittest.main()

