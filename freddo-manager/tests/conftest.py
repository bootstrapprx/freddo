"""Fixtures compartilhadas: settings temporarios, doubles de fmx e cliente HTTP."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Generator
from pathlib import Path
from typing import Any

import pyotp
import pytest
from fastapi.testclient import TestClient
from freddo_manager.api.app import create_app
from freddo_manager.collector.collector import Collector
from freddo_manager.config import Settings
from freddo_manager.db.state import StateDB
from freddo_manager.executor.allowlist import ValidationError
from freddo_manager.executor.runner import JobExecutor
from freddo_manager.fm.adapter import FmAdapter
from freddo_manager.security import (
    encrypt_secret,
    hash_password,
    hash_recovery_code,
)

PASSWORD = "SenhaForte!2026"
TOTP_SECRET = pyotp.random_base32()

TEST_BENCHES: list[dict[str, Any]] = [
    {
        "name": "producao",
        "status": "running",
        "version": "v15",
        "apps": ["frappe", "erpnext", "hrms"],
        "domain": "erp.exemplo.com",
        "environment": "production",
        "services": [{"name": "frappe", "state": "running"}],
        "sites": ["erp.exemplo.com"],
        "created_at": 1_700_000_000,
    },
    {
        "name": "homologacao",
        "status": "running",
        "version": "v15",
        "apps": ["frappe", "erpnext"],
        "domain": "homolog.exemplo.com",
        "environment": "staging",
        "services": [{"name": "frappe", "state": "running"}],
        "sites": ["homolog.exemplo.com"],
        "created_at": 1_700_000_000,
    },
    {
        "name": "sandbox",
        "status": "stopped",
        "version": "v14",
        "apps": ["frappe"],
        "domain": None,
        "environment": "development",
        "services": [],
        "sites": [],
        "created_at": 1_700_000_000,
    },
]


def _bench_info(name: str) -> dict[str, Any]:
    for bench in TEST_BENCHES:
        if bench["name"] == name:
            return {
                **bench,
                "certificates": [
                    {"domain": bench["domain"], "expires_in_days": 42, "issuer": "Let's Encrypt"}
                ]
                if bench["domain"]
                else [],
                "config": {"apps": bench["apps"], "version": bench["version"]},
            }
    raise ValidationError("bench nao encontrado")


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitui fmx/runtime por doubles; testes nunca tocam rede externa."""

    async def list_benches(self: FmAdapter) -> list[dict[str, Any]]:
        return [dict(bench) for bench in TEST_BENCHES]

    async def bench_info(self: FmAdapter, name: str) -> dict[str, Any]:
        return _bench_info(name)

    async def execute_read(self: FmAdapter, op: str, args: dict[str, Any]) -> Any:
        if op == "fm.list":
            return await list_benches(self)
        if op == "fm.info":
            return _bench_info(str(args.get("bench", "")))
        if op == "fm.version":
            return {"version": "0.20.0-test"}
        if op == "services.list":
            return [{"name": "global-db", "state": "running", "image": "mariadb:10.6"}]
        if op == "ssl.status":
            return {"bench": args.get("bench", ""), "certificates": []}
        raise ValidationError(f"operacao de leitura desconhecida: {op}")

    async def run_process(self: JobExecutor, job_id: str, op: Any) -> AsyncIterator[dict[str, Any]]:
        lines = {
            "bench.create": [
                f"Criando bench {op.bench}...",
                "podman compose pull: ok",
                "frappe init: ok",
                "bench pronto",
            ],
            "bench.delete": [f"Removendo bench {op.bench}...", "bench removido"],
            "bench.reset": [f"Resetando bench {op.bench}...", "reset concluido"],
        }.get(op.name, [f"fmx {' '.join(op.argv[1:])}", "concluido"])
        for index, line in enumerate(lines, 1):
            yield {"event": "line", "seq": index, "stream": "stdout", "line": line}
        yield {"event": "done", "exit_code": 0}

    async def noop(self: Collector) -> None:
        return None

    async def no_points(self: Collector) -> list[tuple[str, dict[str, str], float]]:
        return []

    monkeypatch.setattr(FmAdapter, "list_benches", list_benches)
    monkeypatch.setattr(FmAdapter, "bench_info", bench_info)
    monkeypatch.setattr(FmAdapter, "execute_read", execute_read)
    monkeypatch.setattr(JobExecutor, "_run_process", run_process)
    monkeypatch.setattr(Collector, "_container_points", no_points)
    monkeypatch.setattr(Collector, "_health_points", noop)
    monkeypatch.setattr(Collector, "_tls_points", noop)
    monkeypatch.setattr(Collector, "_storage_points", noop)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        home=tmp_path / "state",
        embed_executor=True,
        api_host="127.0.0.1",
        public_origin="http://testserver",
        cors_origins=["http://testserver"],
        login_max_attempts=3,
    )


@pytest.fixture
def bootstrap(settings: Settings) -> Generator[Settings, None, None]:
    db = StateDB(settings.state_db)

    async def run() -> None:
        await db.initialize()
        await db.set_credential(
            hash_password(PASSWORD),
            encrypt_secret(TOTP_SECRET, settings.secret_key_file),
            [hash_recovery_code("aaaaaa-bbbbbb")],
        )

    asyncio.run(run())
    yield settings


@pytest.fixture
def client(bootstrap: Settings) -> Generator[TestClient, None, None]:
    app = create_app(bootstrap)
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture
def no_totp_client(settings: Settings) -> Generator[TestClient, None, None]:
    """Cliente com credencial criada via `bootstrap --no-totp`."""
    db = StateDB(settings.state_db)

    async def run() -> None:
        await db.initialize()
        await db.set_credential(hash_password(PASSWORD), None, [])

    asyncio.run(run())
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


def authenticate(client: TestClient, password: str = PASSWORD, code: str | None = None) -> str:
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/v1/auth/login",
        json={"password": password, "totp": code or pyotp.TOTP(TOTP_SECRET).now()},
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200, response.text
    return csrf
