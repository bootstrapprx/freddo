"""Banco de telemetria: series, amostras brutas e rollups.

Arquivo separado do estado para que a ingestao de metricas nao dispute lock com
jobs e auditoria. A camada de storage fica atras desta classe para permitir
troca futura por TimescaleDB/VictoriaMetrics sem alterar a API.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY,
  metric TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  UNIQUE (metric, labels_json)
);
CREATE TABLE IF NOT EXISTS sample (
  series_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rollup_5m (
  series_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  min REAL,
  max REAL,
  avg REAL,
  p95 REAL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS rollup_1h (
  series_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  min REAL,
  max REAL,
  avg REAL,
  p95 REAL,
  PRIMARY KEY (series_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sample_ts ON sample(ts);
"""


def percentile95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(0.95 * len(ordered)) - 1))
    return ordered[index]


class TelemetryDB:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.executescript(SCHEMA)
            await db.commit()

    @asynccontextmanager
    async def connect(self, *, write: bool = False) -> AsyncIterator[aiosqlite.Connection]:
        db = await aiosqlite.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            yield db
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        finally:
            await db.close()

    async def series_id(self, metric: str, labels: dict[str, str], create: bool = True) -> int | None:
        labels_json = json.dumps(labels, sort_keys=True)
        async with self.connect(write=create) as db:
            row = await (
                await db.execute(
                    "SELECT id FROM series WHERE metric = ? AND labels_json = ?", (metric, labels_json)
                )
            ).fetchone()
            if row:
                return int(row["id"])
            if not create:
                return None
            cursor = await db.execute(
                "INSERT INTO series (metric, labels_json) VALUES (?, ?)", (metric, labels_json)
            )
            return int(cursor.lastrowid or 0)

    async def insert(self, metric: str, labels: dict[str, str], ts: int, value: float) -> None:
        series_id = await self.series_id(metric, labels)
        if series_id is None:
            return
        async with self.connect(write=True) as db:
            await db.execute(
                "INSERT OR REPLACE INTO sample (series_id, ts, value) VALUES (?, ?, ?)",
                (series_id, ts, value),
            )

    async def insert_many(self, points: list[tuple[str, dict[str, str], float]]) -> None:
        """Grava varios pontos com o mesmo timestamp (segundo)."""
        if not points:
            return
        ts = int(time.time())
        async with self.connect(write=True) as db:
            cache: dict[tuple[str, str], int] = {}
            for metric, labels, value in points:
                labels_json = json.dumps(labels, sort_keys=True)
                key = (metric, labels_json)
                series_id = cache.get(key)
                if series_id is None:
                    row = await (
                        await db.execute(
                            "SELECT id FROM series WHERE metric = ? AND labels_json = ?", (metric, labels_json)
                        )
                    ).fetchone()
                    if row:
                        series_id = int(row["id"])
                    else:
                        cursor = await db.execute(
                            "INSERT INTO series (metric, labels_json) VALUES (?, ?)", (metric, labels_json)
                        )
                        series_id = int(cursor.lastrowid or 0)
                    cache[key] = series_id
                await db.execute(
                    "INSERT OR REPLACE INTO sample (series_id, ts, value) VALUES (?, ?, ?)",
                    (series_id, ts, value),
                )

    async def query(
        self,
        metric: str,
        labels: dict[str, str] | None,
        start: int,
        end: int,
        max_points: int = 1000,
    ) -> list[dict[str, Any]]:
        """Escolhe bruto ou rollup conforme a largura da janela (Secao 7)."""
        span = end - start
        table = "sample"
        if span > 14 * 86400:
            table = "rollup_1h"
        elif span > 6 * 3600:
            table = "rollup_5m"
        value_expr = "value" if table == "sample" else "avg"
        query = f"""
            SELECT sr.id, sr.labels_json, {value_expr} AS value, {table}.ts AS ts
            FROM {table} JOIN series sr ON sr.id = {table}.series_id
            WHERE sr.metric = ? AND {table}.ts BETWEEN ? AND ?
            ORDER BY {table}.ts
        """
        params: list[Any] = [metric, start, end]
        async with self.connect() as db:
            rows = list(await (await db.execute(query, params)).fetchall())
        if labels:
            wanted = json.dumps(labels, sort_keys=True)
            rows = [row for row in rows if row["labels_json"] == wanted]
        if len(rows) > max_points:
            step = len(rows) // max_points + 1
            rows = rows[::step]
        return [
            {
                "ts": row["ts"],
                "value": row["value"],
                "labels": json.loads(row["labels_json"]),
                "series_id": row["id"],
            }
            for row in rows
        ]

    async def latest(self, metric: str) -> list[dict[str, Any]]:
        async with self.connect() as db:
            rows = list(
                await (
                    await db.execute(
                        """SELECT sr.id, sr.labels_json, s.value, s.ts FROM sample s
                           JOIN series sr ON sr.id = s.series_id
                           WHERE sr.metric = ? AND s.ts = (
                             SELECT MAX(s2.ts) FROM sample s2 WHERE s2.series_id = s.series_id
                           ) ORDER BY sr.metric, sr.labels_json""",
                        (metric,),
                    )
                ).fetchall()
            )
        return [
            {
                "series_id": row["id"],
                "labels": json.loads(row["labels_json"]),
                "value": row["value"],
                "ts": row["ts"],
            }
            for row in rows
        ]

    async def rollup(self, bucket_seconds: int) -> int:
        table = "rollup_5m" if bucket_seconds == 300 else "rollup_1h"
        async with self.connect(write=True) as db:
            series_rows = list(await (await db.execute("SELECT id FROM series")).fetchall())
            count = 0
            for row in series_rows:
                series_id = int(row["id"])
                buckets: dict[int, list[float]] = {}
                cursor = await db.execute(
                    "SELECT ts, value FROM sample WHERE series_id = ? ORDER BY ts", (series_id,)
                )
                async for sample in cursor:
                    bucket = int(sample["ts"]) // bucket_seconds * bucket_seconds
                    buckets.setdefault(bucket, []).append(float(sample["value"]))
                for bucket, values in buckets.items():
                    await db.execute(
                        f"""INSERT OR REPLACE INTO {table} (series_id, ts, min, max, avg, p95)
                            VALUES (?, ?, ?, ?, ?, ?)""",
                        (
                            series_id,
                            bucket,
                            min(values),
                            max(values),
                            sum(values) / len(values),
                            percentile95(values),
                        ),
                    )
                    count += 1
            return count

    async def prune(self, raw_before: int, rollup5m_before: int, rollup1h_before: int) -> None:
        async with self.connect(write=True) as db:
            await db.execute("DELETE FROM sample WHERE ts < ?", (raw_before,))
            await db.execute("DELETE FROM rollup_5m WHERE ts < ?", (rollup5m_before,))
            await db.execute("DELETE FROM rollup_1h WHERE ts < ?", (rollup1h_before,))

    async def metrics_catalog(self) -> list[str]:
        async with self.connect() as db:
            rows = list(await (await db.execute("SELECT DISTINCT metric FROM series ORDER BY metric")).fetchall())
            return [str(row["metric"]) for row in rows]


def series_fingerprint(metric: str, labels: dict[str, str]) -> str:
    payload = metric + json.dumps(labels, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]
