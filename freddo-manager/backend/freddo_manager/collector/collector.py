"""Coletor periodico: host, containers (Docker ou Podman), health HTTP, TLS e storage.

Projeto para <2% de CPU: amostragem simples, sem dependencias de rede obrigatorias.
Todas as series vem de host, runtime ou sondagens reais.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import ssl
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import psutil

from ..config import Settings
from ..db.state import StateDB
from ..db.telemetry import TelemetryDB
from ..fm.adapter import FmAdapter
from ..runtime import (
    ContainerCompat,
    compose_project,
    container_id,
    container_name,
    label_map,
    parse_cli_json,
    parse_percent,
)
from .alerts import AlertEvaluator

log = logging.getLogger("freddo.collector")


class Collector:
    def __init__(
        self,
        settings: Settings,
        telemetry: TelemetryDB,
        state_db: StateDB,
        compat: ContainerCompat | None = None,
    ) -> None:
        self.settings = settings
        self.telemetry = telemetry
        self.state_db = state_db
        self.compat = compat or ContainerCompat(settings)
        self.fm = FmAdapter(settings, compat=self.compat)
        self.alerts = AlertEvaluator(state_db, telemetry)
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._tick = 0

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run_forever(), name="telemetry-collector")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def run_forever(self) -> None:
        interval = max(5, self.settings.collect_interval_seconds)
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                await self.collect_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("falha na coleta de telemetria")
            elapsed = time.monotonic() - started
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=max(1, interval - elapsed))
            except TimeoutError:
                pass
            self._tick += 1
            if self._tick % max(1, 300 // interval) == 0:
                try:
                    await self.telemetry.rollup(300)
                except Exception:
                    log.exception("falha no rollup 5m")
            if self._tick % max(1, 3600 // interval) == 0:
                try:
                    await self.telemetry.rollup(3600)
                    now = int(time.time())
                    await self.telemetry.prune(
                        now - self.settings.raw_retention_hours * 3600,
                        now - self.settings.rollup5m_retention_days * 86400,
                        now - self.settings.rollup1h_retention_days * 86400,
                    )
                except Exception:
                    log.exception("falha no rollup/prune 1h")

    async def collect_once(self) -> None:
        points: list[tuple[str, dict[str, str], float]] = []
        points.extend(_host_points())
        points.extend(await self._container_points())
        await self.telemetry.insert_many(points)

        if self._tick % max(1, self.settings.health_interval_seconds // max(5, self.settings.collect_interval_seconds)) == 0:
            await self._health_points()
        if self._tick % max(1, self.settings.tls_interval_hours * 3600 // max(5, self.settings.collect_interval_seconds)) == 0:
            await self._tls_points()
        if self._tick % max(1, self.settings.storage_interval_hours * 3600 // max(5, self.settings.collect_interval_seconds)) == 0:
            await self._storage_points()
        try:
            await self.alerts.evaluate()
        except Exception:
            log.exception("falha na avaliacao de alertas")

    async def _run_cli_json(self, argv: list[str], timeout: int = 15) -> list[dict[str, Any]]:
        """Executa `docker`/`podman` com --format json fora do loop de eventos."""

        def run() -> list[dict[str, Any]]:
            result = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env=self.compat.env(),
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or f"exit {result.returncode}")
            return parse_cli_json(result.stdout)

        return await asyncio.to_thread(run)

    async def _container_points(self) -> list[tuple[str, dict[str, str], float]]:
        try:
            containers = await self._run_cli_json(self.compat.argv("ps", "--all", "--format", "json"))
        except Exception as exc:
            log.debug("telemetria de containers indisponivel: %s", exc)
            return []

        points: list[tuple[str, dict[str, str], float]] = []
        for container in containers:
            labels = label_map(container.get("Labels"))
            bench = compose_project(labels)
            cid = container_id(container)
            name = container_name(container)
            if not bench or not cid or not name:
                continue
            try:
                samples = await self._run_cli_json(
                    self.compat.argv("stats", "--no-stream", "--format", "json", cid)
                )
            except Exception:
                continue
            sample = samples[0] if samples else {}
            cpu = _stats_cpu_percent(sample)
            memory = _stats_memory_percent(sample)
            labels_points = {"bench": bench, "container": name}
            points.append(("container.cpu_percent", labels_points, cpu))
            points.append(("container.memory_percent", labels_points, memory))
            points.append(
                (
                    "container.restarts",
                    labels_points,
                    float(container.get("RestartCount") or sample.get("RestartCount") or 0),
                )
            )
        return points

    async def _health_points(self) -> None:
        benches = await self.fm.list_benches()
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            for bench in benches:
                if bench["status"] != "running":
                    continue
                domain = bench.get("domain")
                if not domain:
                    continue
                url = f"https://{domain}/api/method/ping"
                started = time.monotonic()
                available = 0.0
                try:
                    response = await client.get(url)
                    available = 1.0 if response.status_code < 500 else 0.0
                except httpx.HTTPError:
                    pass
                latency = (time.monotonic() - started) * 1000
                labels = {"bench": bench["name"], "site": str(domain)}
                await self.telemetry.insert_many(
                    [
                        ("site.available", labels, available),
                        ("site.latency_ms", labels, round(latency, 2)),
                    ]
                )

    async def _tls_points(self) -> None:
        for bench in await self.fm.list_benches():
            domain = bench.get("domain")
            if not domain:
                continue
            days = await _days_until_expiry(str(domain))
            if days is not None:
                await self.telemetry.insert_many(
                    [("tls.days_until_expiry", {"bench": bench["name"], "domain": domain}, float(days))]
                )

    async def _storage_points(self) -> None:
        for bench in await self.fm.list_benches():
            path = bench.get("path")
            if not path or not Path(str(path)).exists():
                continue
            try:
                total = sum(
                    entry.stat().st_size
                    for entry in Path(str(path)).rglob("*")
                    if entry.is_file()
                )
                await self.telemetry.insert_many(
                    [("bench.storage_bytes", {"bench": bench["name"]}, float(total))]
                )
            except OSError:
                continue


def _host_points() -> list[tuple[str, dict[str, str], float]]:
    points = [
        ("host.cpu_percent", {}, psutil.cpu_percent(interval=None)),
        ("host.memory_percent", {}, psutil.virtual_memory().percent),
        ("host.swap_percent", {}, psutil.swap_memory().percent),
        ("host.load1", {}, os.getloadavg()[0] if hasattr(os, "getloadavg") else 0.0),
    ]
    for partition in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(partition.mountpoint)
        except OSError:
            continue
        points.append(
            ("host.disk_used_percent", {"mount": partition.mountpoint}, usage.percent)
        )
    disk_io = psutil.disk_io_counters()
    if disk_io:
        points.append(("host.disk_io_bytes", {}, float(disk_io.read_bytes + disk_io.write_bytes)))
    net_io = psutil.net_io_counters()
    if net_io:
        points.append(("host.net_io_bytes", {}, float(net_io.bytes_sent + net_io.bytes_recv)))
    return points


def _stats_cpu_percent(stats: dict[str, Any]) -> float:
    """Docker expoe `CPUPerc`; Podman tambem `AvgCPU` (numerico)."""
    for key in ("CPUPerc", "AvgCPU", "cpu_percent"):
        value = parse_percent(stats.get(key))
        if value:
            return round(value, 2)
    try:
        cpu_stats = stats["cpu_stats"]
        precpu = stats["precpu_stats"]
        cpu_delta = cpu_stats["cpu_usage"]["total_usage"] - precpu["cpu_usage"]["total_usage"]
        system_delta = cpu_stats["system_cpu_usage"] - precpu["system_cpu_usage"]
        cores = len(cpu_stats["cpu_usage"].get("percpu_usage") or [1])
        return round(cpu_delta / system_delta * cores * 100, 2) if system_delta > 0 else 0.0
    except (KeyError, TypeError, ZeroDivisionError):
        return 0.0


def _stats_memory_percent(stats: dict[str, Any]) -> float:
    value = parse_percent(stats.get("MemPerc") or stats.get("memory_percent"))
    if value:
        return round(value, 2)
    try:
        return round(stats["MemUsageBytes"] / stats["MemLimitBytes"] * 100, 2)
    except (KeyError, TypeError, ZeroDivisionError):
        return 0.0


async def _days_until_expiry(host: str) -> int | None:
    def check() -> int | None:
        context = ssl.create_default_context()
        try:
            with socket.create_connection((host, 443), timeout=4) as sock:
                with context.wrap_socket(sock, server_hostname=host) as tls:
                    cert = tls.getpeercert()
        except (OSError, ssl.SSLError):
            return None
        expiry = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=UTC)
        return max(0, (expiry - datetime.now(UTC)).days)

    return await asyncio.to_thread(check)
