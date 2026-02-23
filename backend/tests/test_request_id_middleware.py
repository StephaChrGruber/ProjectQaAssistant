from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.request_id import RequestIdMiddleware


def test_request_id_is_generated_when_missing() -> None:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"ok": "true"}

    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("x-request-id")


def test_request_id_header_is_propagated() -> None:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"ok": "true"}

    client = TestClient(app)
    response = client.get("/health", headers={"x-request-id": "req-123"})
    assert response.status_code == 200
    assert response.headers.get("x-request-id") == "req-123"

