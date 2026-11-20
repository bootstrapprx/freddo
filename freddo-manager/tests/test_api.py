"""Testes de ponta a ponta da API com fmx/runtime substituidos por doubles."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from .conftest import PASSWORD, authenticate


def wait_job(client: TestClient, job_id: str, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}")
        assert response.status_code == 200, response.text
        job = response.json()
        if job["state"] in ("succeeded", "failed", "cancelled", "timed_out"):
            return job
        time.sleep(0.05)
    raise AssertionError("job nao finalizou no tempo esperado")


def test_security_headers(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_health_and_login_flow(client: TestClient) -> None:
    assert client.get("/api/v1/health").json()["status"] == "ok"
    assert client.get("/api/v1/benches").status_code == 401
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    wrong = client.post(
        "/api/v1/auth/login",
        json={"password": "errada", "totp": "000000"},
        headers={"x-csrf-token": csrf},
    )
    assert wrong.status_code == 401
    authenticate(client)
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200 and me.json()["authenticated"] is True


def test_benches_and_jobs(client: TestClient) -> None:
    authenticate(client)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    benches = client.get("/api/v1/benches")
    assert benches.status_code == 200
    assert {bench["name"] for bench in benches.json()} >= {"producao", "sandbox"}

    created = client.post(
        "/api/v1/benches",
        json={"name": "novo-bench", "version": "v15", "apps": ["erpnext"]},
        headers={"x-csrf-token": csrf},
    )
    assert created.status_code == 202, created.text
    assert len(created.json()["admin_password"]) >= 8
    job = wait_job(client, created.json()["id"])
    assert job["state"] == "succeeded", job
    assert any("compose pull" in event["line"] for event in job["events"])

    idem = client.post(
        "/api/v1/benches",
        json={"name": "novo-bench", "idempotency_key": "chave-unica"},
        headers={"x-csrf-token": csrf},
    )
    again = client.post(
        "/api/v1/benches",
        json={"name": "novo-bench", "idempotency_key": "chave-unica"},
        headers={"x-csrf-token": csrf},
    )
    assert idem.json()["id"] == again.json()["id"]
    assert again.json()["created_now"] is False


def test_action_requires_stepup_and_confirmation(client: TestClient) -> None:
    authenticate(client)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    denied = client.post(
        "/api/v1/benches/producao/actions/reset",
        json={"action": "reset", "confirm": "producao"},
        headers={"x-csrf-token": csrf},
    )
    assert denied.status_code == 403 and denied.json()["code"] == "stepup_required"

    started = client.post(
        "/api/v1/benches/producao/actions/start",
        json={"action": "start"},
        headers={"x-csrf-token": csrf},
    )
    assert started.status_code == 202
    assert wait_job(client, started.json()["id"])["state"] == "succeeded"


def test_templates_alerts_audit_and_telemetry(client: TestClient) -> None:
    authenticate(client)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]

    template = client.post(
        "/api/v1/templates",
        json={"name": "padrao", "spec": {"version": "v15", "apps": ["frappe", "erpnext"]}},
        headers={"x-csrf-token": csrf},
    )
    assert template.status_code == 201
    assert client.get("/api/v1/templates").json()[0]["name"] == "padrao"

    rule = client.post(
        "/api/v1/alerts/rules",
        json={
            "name": "disco",
            "series_selector": "host.disk_used_percent{mount=/}",
            "op": "gt",
            "threshold": 85,
            "for_seconds": 600,
            "channel": "webhook",
        },
        headers={"x-csrf-token": csrf},
    )
    assert rule.status_code == 201
    assert any(item["name"] == "disco" for item in client.get("/api/v1/alerts/rules").json())

    audit = client.get("/api/v1/audit")
    assert audit.status_code == 200 and len(audit.json()) >= 1
    assert client.get("/api/v1/audit/verify").json()["ok"] is True

    overview = client.get("/api/v1/telemetry/overview")
    assert overview.status_code == 200
    assert overview.json()["benches"]["total"] == 3

    query = client.get("/api/v1/telemetry/query", params={"metric": "host.cpu_percent"})
    assert query.status_code == 200 and query.json()["metric"] == "host.cpu_percent"


def test_no_totp_login_and_password_stepup(no_totp_client: TestClient) -> None:
    client = no_totp_client
    setup = client.get("/api/v1/auth/setup").json()
    assert setup["bootstrap_required"] is False
    assert setup["totp_required"] is False

    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"password": PASSWORD},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/auth/me").json()["totp_required"] is False

    payload = {"action": "reset", "confirm": "producao"}
    denied = client.post(
        "/api/v1/benches/producao/actions/reset",
        json=payload,
        headers={"x-csrf-token": csrf},
    )
    assert denied.status_code == 403 and denied.json()["code"] == "stepup_required"

    stepup = client.post(
        "/api/v1/auth/stepup",
        json={"password": PASSWORD},
        headers={"x-csrf-token": csrf},
    )
    assert stepup.status_code == 200, stepup.text

    allowed = client.post(
        "/api/v1/benches/producao/actions/reset",
        json=payload,
        headers={"x-csrf-token": csrf},
    )
    assert allowed.status_code == 202, allowed.text
    assert wait_job(client, allowed.json()["id"])["state"] == "succeeded"


def test_csrf_is_enforced(client: TestClient) -> None:
    authenticate(client)
    response = client.post(
        "/api/v1/benches",
        json={"name": "sem-csrf"},
    )
    assert response.status_code == 403 and response.json()["code"] == "invalid_csrf"
