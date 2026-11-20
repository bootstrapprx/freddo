"""Testes unitarios de allowlist, seguranca e bancos."""

from __future__ import annotations

import asyncio
import time

import pyotp
import pytest
from freddo_manager.audit import AuditService
from freddo_manager.db.state import StateDB
from freddo_manager.db.telemetry import TelemetryDB, percentile95
from freddo_manager.executor.allowlist import Allowlist, ValidationError
from freddo_manager.security import (
    audit_hash,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    redact,
    verify_password,
    verify_totp,
)


def test_allowlist_argv_is_safe() -> None:
    allowlist = Allowlist("fmx")
    op = allowlist.build("bench.start", {"bench": "producao"})
    assert op.argv == ["fmx", "-n", "start", "producao"]
    assert not any(";" in part or "|" in part or "$(" in part for part in op.argv)


def test_allowlist_rejects_invalid_names_and_apps() -> None:
    allowlist = Allowlist("fmx")
    with pytest.raises(ValidationError):
        allowlist.build("bench.start", {"bench": "nome com espaco"})
    with pytest.raises(ValidationError):
        allowlist.build("bench.create", {"bench": "ok", "apps": ["frappe", "evil-app"]})
    with pytest.raises(ValidationError):
        allowlist.build("unknown.op", {})


def test_destructive_requires_confirmation() -> None:
    allowlist = Allowlist("fmx")
    with pytest.raises(ValidationError):
        allowlist.build("bench.delete", {"bench": "producao"})
    op = allowlist.build("bench.delete", {"bench": "producao", "confirm": "producao"})
    assert "--yes" in op.argv
    global_op = allowlist.build("fm.migrate", {"confirm": "system"})
    assert global_op.global_lock is True


def test_bench_create_expands_apps() -> None:
    op = Allowlist("fmx").build(
        "bench.create", {"bench": "teste", "apps": ["erpnext"], "environment": "production"}
    )
    assert op.argv == [
        "fmx",
        "-n",
        "create",
        "teste",
        "--environment",
        "prod",
        "--apps",
        "frappe",
        "--apps",
        "erpnext",
    ]


def test_password_totp_and_redaction(tmp_path) -> None:
    hashed = hash_password("segredo123")
    assert verify_password(hashed, "segredo123")
    assert not verify_password(hashed, "errado")
    secret = pyotp.random_base32()
    encrypted = encrypt_secret(secret, tmp_path / "secret.key")
    assert decrypt_secret(encrypted, tmp_path / "secret.key") == secret
    assert verify_totp(secret, pyotp.TOTP(secret).now())
    line = "mysql password: supersecreto token=abc123"
    redacted = redact(line)
    assert "supersecreto" not in redacted and "abc123" not in redacted


def test_audit_chain(tmp_path) -> None:
    db = StateDB(tmp_path / "state.db")

    async def run() -> dict:
        await db.initialize()
        audit = AuditService(db)
        await audit.record("test.one", target="a")
        await audit.record("test.two", target="b")
        return await audit.verify()

    assert asyncio.run(run())["ok"] is True
    assert audit_hash(b"\x00" * 32, {"a": 1}) != audit_hash(b"\x00" * 32, {"a": 2})


def test_telemetry_rollup_and_prune(tmp_path) -> None:
    db = TelemetryDB(tmp_path / "telemetry.db")

    async def run() -> tuple[list[dict], int]:
        await db.initialize()
        now = int(time.time())
        for index in range(5):
            await db.insert("host.cpu_percent", {}, now - index, float(index * 10))
        points = await db.query("host.cpu_percent", None, now - 10, now + 1)
        count = await db.rollup(300)
        await db.prune(now + 1, now + 1, now + 1)
        return points, count

    points, count = asyncio.run(run())
    assert len(points) == 5
    assert count == 1
    assert percentile95([1, 2, 3, 4, 5]) == 5
