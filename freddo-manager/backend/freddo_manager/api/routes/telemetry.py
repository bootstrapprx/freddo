"""Telemetria: consulta de series e resumo do dashboard."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, Query

from ..deps import StateDep, require_auth
from ..read import read

router = APIRouter(prefix="/telemetry", tags=["telemetry"], dependencies=[Depends(require_auth)])


@router.get("/query")
async def query(
    state: StateDep,
    metric: str,
    labels: str | None = None,
    from_: int | None = Query(default=None, alias="from"),
    to: int | None = Query(default=None, alias="to"),
    step: int | None = None,
) -> dict[str, Any]:
    end = to or int(time.time())
    start = from_ or end - 6 * 3600
    parsed_labels = json.loads(labels) if labels else None
    points = await state.telemetry.query(metric, parsed_labels, start, end)
    if step and step > 1:
        points = points[::step]
    return {"metric": metric, "from": start, "to": end, "points": points}


@router.get("/metrics")
async def metrics(state: StateDep) -> list[str]:
    return await state.telemetry.metrics_catalog()


@router.get("/overview")
async def overview(state: StateDep) -> dict[str, Any]:
    metrics_of_interest = [
        "host.cpu_percent",
        "host.memory_percent",
        "host.disk_used_percent",
        "host.load1",
        "container.cpu_percent",
        "container.memory_percent",
        "site.available",
        "site.latency_ms",
        "tls.days_until_expiry",
    ]
    latest: dict[str, list[dict[str, Any]]] = {}
    for metric in metrics_of_interest:
        latest[metric] = await state.telemetry.latest(metric)

    try:
        benches = await read(state, "fm.list")
        bench_count = len(benches) if isinstance(benches, list) else 0
        running = sum(1 for b in benches if b.get("status") == "running") if isinstance(benches, list) else 0
    except Exception:
        bench_count, running = 0, 0

    def first(metric: str) -> float | None:
        rows = latest.get(metric) or []
        return float(rows[0]["value"]) if rows else None

    return {
        "host": {
            "cpu_percent": first("host.cpu_percent"),
            "memory_percent": first("host.memory_percent"),
            "disk_used_percent": first("host.disk_used_percent"),
            "load1": first("host.load1"),
        },
        "containers": {
            "cpu_percent": first("container.cpu_percent"),
            "memory_percent": first("container.memory_percent"),
        },
        "sites": {
            "available": first("site.available"),
            "latency_ms": first("site.latency_ms"),
        },
        "benches": {"total": bench_count, "running": running},
        "series": latest,
        "generated_at": int(time.time()),
    }
