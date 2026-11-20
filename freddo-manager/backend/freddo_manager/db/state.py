"""Banco de estado: credenciais, sessoes, jobs, auditoria, settings e alertas.

O schema segue de perto a Secao 6 da especificacao. Todo acesso passa por
``StateDB``; as conexoes usam WAL para nao bloquear leituras durante escritas.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  totp_secret_enc BLOB,
  created_at INTEGER NOT NULL,
  recovery_codes TEXT
);
CREATE TABLE IF NOT EXISTS passkey (
  id BLOB PRIMARY KEY,
  public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id_hash BLOB PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  stepup_until INTEGER,
  ip TEXT,
  user_agent TEXT,
  revoked INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  bench TEXT,
  args_json TEXT NOT NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  exit_code INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  output_path TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_created ON job(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_bench ON job(bench, created_at DESC);
CREATE TABLE IF NOT EXISTS job_event (
  job_id TEXT NOT NULL REFERENCES job(id),
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  stream TEXT NOT NULL,
  line TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT,
  ip TEXT,
  prev_hash BLOB NOT NULL,
  hash BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS bench_template (
  name TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_setting (
  name TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rule (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  series_selector TEXT NOT NULL,
  op TEXT NOT NULL,
  threshold REAL NOT NULL,
  for_seconds INTEGER NOT NULL,
  channel TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  enabled INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alert_event (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES alert_rule(id),
  series TEXT NOT NULL,
  state TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL
);
CREATE INDEX IF NOT EXISTS idx_alert_event_ts ON alert_event(ts DESC);
CREATE TABLE IF NOT EXISTS login_attempt (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  locked_until INTEGER
);
"""

JOB_STATES = {"queued", "running", "succeeded", "failed", "cancelled", "timed_out"}


class StateDB:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = asyncio.Lock()

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA foreign_keys=ON")
            await db.executescript(SCHEMA)
            await db.execute(
                "INSERT OR IGNORE INTO app_setting (name, value_json) VALUES (?, ?)",
                ("deployment_domains", json.dumps(["kodoo.online", "kalkulisto.com.br"])),
            )
            await db.commit()

    @asynccontextmanager
    async def connect(self, *, write: bool = False) -> AsyncIterator[aiosqlite.Connection]:
        db = await aiosqlite.connect(self.path)
        db.row_factory = sqlite3.Row
        await db.execute("PRAGMA foreign_keys=ON")
        if write:
            await self._write_lock.acquire()
        try:
            yield db
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        finally:
            await db.close()
            if write:
                self._write_lock.release()

    # ---- credential / session -------------------------------------------------
    async def get_credential(self) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (await db.execute("SELECT * FROM credential WHERE id = 1")).fetchone()

    async def set_credential(
        self,
        password_hash: str,
        totp_secret_enc: bytes | None,
        recovery_codes: list[str] | None = None,
    ) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                """INSERT INTO credential (id, password_hash, totp_secret_enc, created_at, recovery_codes)
                   VALUES (1, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash,
                     totp_secret_enc = excluded.totp_secret_enc,
                     recovery_codes = excluded.recovery_codes""",
                (
                    password_hash,
                    totp_secret_enc,
                    int(time.time()),
                    json.dumps(recovery_codes or []),
                ),
            )

    async def consume_bootstrap_token(
        self,
        token_hash: str,
        password_hash: str,
        totp_secret_enc: bytes,
        recovery_codes: list[str],
    ) -> bool:
        async with self.connect(write=True) as db:
            row = await (await db.execute(
                "SELECT value_json FROM app_setting WHERE name = 'bootstrap_token'"
            )).fetchone()
            credential = await (await db.execute("SELECT 1 FROM credential WHERE id = 1")).fetchone()
            if not row or credential:
                return False
            token = json.loads(row["value_json"])
            if token.get("expires_at", 0) <= int(time.time()) or not hmac.compare_digest(
                token.get("hash", ""), token_hash
            ):
                return False
            await db.execute(
                """INSERT INTO credential (id, password_hash, totp_secret_enc, created_at, recovery_codes)
                   VALUES (1, ?, ?, ?, ?)""",
                (password_hash, totp_secret_enc, int(time.time()), json.dumps(recovery_codes)),
            )
            await db.execute("DELETE FROM app_setting WHERE name = 'bootstrap_token'")
            return True

    async def create_session(
        self, id_hash: bytes, ip: str | None, user_agent: str | None
    ) -> None:
        now = int(time.time())
        async with self.connect(write=True) as db:
            await db.execute(
                "INSERT INTO session (id_hash, created_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
                (id_hash, now, now, ip, user_agent),
            )

    async def get_session(self, id_hash: bytes) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (
                await db.execute("SELECT * FROM session WHERE id_hash = ? AND revoked = 0", (id_hash,))
            ).fetchone()

    async def touch_session(self, id_hash: bytes, stepup_until: int | None = None) -> None:
        async with self.connect(write=True) as db:
            if stepup_until is not None:
                await db.execute(
                    "UPDATE session SET last_seen = ?, stepup_until = ? WHERE id_hash = ?",
                    (int(time.time()), stepup_until, id_hash),
                )
            else:
                await db.execute(
                    "UPDATE session SET last_seen = ? WHERE id_hash = ?", (int(time.time()), id_hash)
                )

    async def revoke_session(self, id_hash: bytes) -> None:
        async with self.connect(write=True) as db:
            await db.execute("UPDATE session SET revoked = 1 WHERE id_hash = ?", (id_hash,))

    # ---- jobs -----------------------------------------------------------------
    async def insert_job(self, job: dict[str, Any]) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                """INSERT INTO job (id, kind, bench, args_json, state, idempotency_key, created_at)
                   VALUES (:id, :kind, :bench, :args_json, :state, :idempotency_key, :created_at)""",
                job,
            )

    async def get_job(self, job_id: str) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (await db.execute("SELECT * FROM job WHERE id = ?", (job_id,))).fetchone()

    async def get_job_by_idempotency(self, key: str) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (
                await db.execute("SELECT * FROM job WHERE idempotency_key = ?", (key,))
            ).fetchone()

    async def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        sets = ", ".join(f"{key} = ?" for key in fields)
        async with self.connect(write=True) as db:
            await db.execute(f"UPDATE job SET {sets} WHERE id = ?", (*fields.values(), job_id))

    async def list_jobs(
        self, limit: int = 50, bench: str | None = None, state: str | None = None
    ) -> list[sqlite3.Row]:
        query = "SELECT * FROM job WHERE 1=1"
        params: list[Any] = []
        if bench:
            query += " AND bench = ?"
            params.append(bench)
        if state:
            query += " AND state = ?"
            params.append(state)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        async with self.connect() as db:
            return list(await (await db.execute(query, params)).fetchall())

    async def append_event(self, job_id: str, seq: int, stream: str, line: str) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                "INSERT OR IGNORE INTO job_event (job_id, seq, ts, stream, line) VALUES (?, ?, ?, ?, ?)",
                (job_id, seq, int(time.time() * 1000), stream, line),
            )

    async def list_events(self, job_id: str, after_seq: int = 0) -> list[sqlite3.Row]:
        async with self.connect() as db:
            return list(
                await (
                    await db.execute(
                        "SELECT * FROM job_event WHERE job_id = ? AND seq > ? ORDER BY seq",
                        (job_id, after_seq),
                    )
                ).fetchall()
            )

    async def next_event_seq(self, job_id: str) -> int:
        async with self.connect() as db:
            row = await (
                await db.execute("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM job_event WHERE job_id = ?", (job_id,))
            ).fetchone()
            return int(row["seq"])

    async def recover_orphaned_jobs(self) -> list[str]:
        async with self.connect(write=True) as db:
            rows = await (
                await db.execute("SELECT id FROM job WHERE state IN ('queued', 'running')")
            ).fetchall()
            ids = [row["id"] for row in rows]
            for job_id in ids:
                await db.execute(
                    "UPDATE job SET state = 'failed', error = 'executor_restart', finished_at = ? WHERE id = ?",
                    (int(time.time()), job_id),
                )
            return ids

    # ---- templates / alerts / audit ------------------------------------------
    async def get_setting(self, name: str, default: Any = None) -> Any:
        async with self.connect() as db:
            row = await (await db.execute("SELECT value_json FROM app_setting WHERE name = ?", (name,))).fetchone()
        return json.loads(row["value_json"]) if row else default

    async def set_setting(self, name: str, value: Any) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                "INSERT INTO app_setting (name, value_json) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json",
                (name, json.dumps(value, sort_keys=True)),
            )

    async def list_templates(self) -> list[sqlite3.Row]:
        async with self.connect() as db:
            return list(await (await db.execute("SELECT * FROM bench_template ORDER BY name")).fetchall())

    async def get_template(self, name: str) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (await db.execute("SELECT * FROM bench_template WHERE name = ?", (name,))).fetchone()

    async def save_template(self, name: str, spec: dict[str, Any]) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                """INSERT INTO bench_template (name, spec_json, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(name) DO UPDATE SET spec_json = excluded.spec_json,
                     updated_at = excluded.updated_at""",
                (name, json.dumps(spec), int(time.time())),
            )

    async def delete_template(self, name: str) -> bool:
        async with self.connect(write=True) as db:
            cursor = await db.execute("DELETE FROM bench_template WHERE name = ?", (name,))
            return cursor.rowcount > 0

    async def list_rules(self, enabled_only: bool = False) -> list[sqlite3.Row]:
        query = "SELECT * FROM alert_rule"
        if enabled_only:
            query += " WHERE enabled = 1"
        query += " ORDER BY id"
        async with self.connect() as db:
            return list(await (await db.execute(query)).fetchall())

    async def get_rule(self, rule_id: int) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (await db.execute("SELECT * FROM alert_rule WHERE id = ?", (rule_id,))).fetchone()

    async def save_rule(self, rule: dict[str, Any], rule_id: int | None = None) -> int:
        fields = (
            "name",
            "series_selector",
            "op",
            "threshold",
            "for_seconds",
            "channel",
            "severity",
            "enabled",
        )
        async with self.connect(write=True) as db:
            if rule_id is None:
                cursor = await db.execute(
                    f"INSERT INTO alert_rule ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
                    tuple(rule.get(key) for key in fields),
                )
                return int(cursor.lastrowid or 0)
            await db.execute(
                f"UPDATE alert_rule SET {', '.join(f'{key} = ?' for key in fields)} WHERE id = ?",
                (*(rule.get(key) for key in fields), rule_id),
            )
            return rule_id

    async def delete_rule(self, rule_id: int) -> bool:
        async with self.connect(write=True) as db:
            cursor = await db.execute("DELETE FROM alert_rule WHERE id = ?", (rule_id,))
            return cursor.rowcount > 0

    async def record_alert_event(
        self, rule_id: int, series: str, state_: str, value: float | None
    ) -> None:
        async with self.connect(write=True) as db:
            await db.execute(
                "INSERT INTO alert_event (rule_id, series, state, ts, value) VALUES (?, ?, ?, ?, ?)",
                (rule_id, series, state_, int(time.time()), value),
            )

    async def list_alert_events(self, limit: int = 100) -> list[sqlite3.Row]:
        async with self.connect() as db:
            return list(
                await (await db.execute("SELECT * FROM alert_event ORDER BY ts DESC LIMIT ?", (limit,))).fetchall()
            )

    async def last_alert_state(self, rule_id: int, series: str) -> str | None:
        async with self.connect() as db:
            row = await (
                await db.execute(
                    "SELECT state FROM alert_event WHERE rule_id = ? AND series = ? ORDER BY ts DESC LIMIT 1",
                    (rule_id, series),
                )
            ).fetchone()
            return row["state"] if row else None

    async def append_audit(
        self,
        actor: str,
        action: str,
        target: str | None,
        detail: dict[str, Any] | None,
        ip: str | None,
        prev_hash: bytes,
        entry_hash: bytes,
    ) -> int:
        async with self.connect(write=True) as db:
            cursor = await db.execute(
                """INSERT INTO audit_log (ts, actor, action, target, detail_json, ip, prev_hash, hash)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    int(time.time()),
                    actor,
                    action,
                    target,
                    json.dumps(detail, sort_keys=True) if detail else None,
                    ip,
                    prev_hash,
                    entry_hash,
                ),
            )
            return int(cursor.lastrowid or 0)

    async def last_audit_hash(self) -> bytes:
        async with self.connect() as db:
            row = await (await db.execute("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")).fetchone()
            return bytes(row["hash"]) if row else b"\x00" * 32

    async def list_audit(self, limit: int = 100) -> list[sqlite3.Row]:
        async with self.connect() as db:
            return list(
                await (await db.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))).fetchall()
            )

    async def record_login_failure(self, ip: str, locked_until: int | None) -> int:
        async with self.connect(write=True) as db:
            await db.execute(
                """INSERT INTO login_attempt (ip, failures, locked_until) VALUES (?, 1, ?)
                   ON CONFLICT(ip) DO UPDATE SET failures = failures + 1,
                     locked_until = CASE WHEN ? THEN excluded.locked_until ELSE login_attempt.locked_until END""",
                (ip, locked_until, bool(locked_until)),
            )
            row = await (await db.execute("SELECT failures FROM login_attempt WHERE ip = ?", (ip,))).fetchone()
            return int(row["failures"])

    async def clear_login_failures(self, ip: str) -> None:
        async with self.connect(write=True) as db:
            await db.execute("DELETE FROM login_attempt WHERE ip = ?", (ip,))

    async def login_attempt(self, ip: str) -> sqlite3.Row | None:
        async with self.connect() as db:
            return await (await db.execute("SELECT * FROM login_attempt WHERE ip = ?", (ip,))).fetchone()
