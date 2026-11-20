"""Execucao de subprocessos com locks, timeout, cancelamento e streaming."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from ..config import Settings
from ..runtime import ContainerCompat
from ..security import redact
from .allowlist import Allowlist, Operation, ValidationError


@dataclass
class RunningJob:
    process: asyncio.subprocess.Process | None = None
    task: asyncio.Task[None] | None = None
    cancelled: bool = False


@dataclass
class ExecutorStats:
    running: int = 0
    finished: int = 0
    by_op: dict[str, int] = field(default_factory=dict)


class JobExecutor:
    def __init__(
        self,
        settings: Settings,
        allowlist: Allowlist | None = None,
        compat: ContainerCompat | None = None,
    ) -> None:
        self.settings = settings
        self.allowlist = allowlist or Allowlist(settings.fm_bin)
        self.compat = compat or ContainerCompat(settings)
        self._bench_locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self._running: dict[str, RunningJob] = {}
        self.stats = ExecutorStats()

    def _lock_for(self, op: Operation) -> asyncio.Lock:
        if op.global_lock:
            return self._global_lock
        if op.bench:
            return self._bench_locks.setdefault(op.bench, asyncio.Lock())
        return self._global_lock

    async def cancel(self, job_id: str) -> bool:
        running = self._running.get(job_id)
        if not running or not running.process:
            return False
        running.cancelled = True
        try:
            running.process.terminate()
        except ProcessLookupError:
            return False
        return True

    async def run(
        self,
        job_id: str,
        op_name: str,
        args: dict[str, Any] | None = None,
        timeout: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Executa uma operacao e gera eventos de streaming.

        O lock e adquirido antes de qualquer output para garantir no maximo um
        job de escrita por bench (ou um job global) por vez.
        """
        try:
            op = self.allowlist.build(op_name, args, timeout or self.settings.job_timeouts.get(op_name, 600))
        except ValidationError as exc:
            yield {"event": "error", "line": str(exc), "exit_code": 2}
            return

        lock = self._lock_for(op)
        yield {"event": "status", "line": "waiting_for_lock"}
        async with lock:
            yield {"event": "status", "line": "started"}
            try:
                async for event in self._run_process(job_id, op):
                    yield event
            except FileNotFoundError as exc:
                yield {
                    "event": "error",
                    "line": f"binario indisponivel: {exc.filename or op.argv[0]}",
                    "exit_code": 127,
                }

    async def _run_process(self, job_id: str, op: Operation) -> AsyncIterator[dict[str, Any]]:
        process = await asyncio.create_subprocess_exec(
            *op.argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self.settings.fm_home),
            env=self.compat.env({**os.environ, "PYTHONUNBUFFERED": "1"}),
        )
        running = RunningJob(process=process)
        self._running[job_id] = running
        self.stats.running += 1
        queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()

        async def pump(stream: asyncio.StreamReader | None, name: str) -> None:
            assert stream is not None
            async for raw in stream:
                await queue.put((name, redact(raw.decode("utf-8", "replace").rstrip("\r\n"))))
            await queue.put(None)

        async def watch_timeout() -> None:
            await asyncio.sleep(op.timeout)
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=self.settings.job_grace_seconds)
                except TimeoutError:
                    process.kill()

        pump_tasks = [
            asyncio.create_task(pump(process.stdout, "stdout")),
            asyncio.create_task(pump(process.stderr, "stderr")),
        ]
        timeout_task = asyncio.create_task(watch_timeout())
        seq = 0
        try:
            pending = len(pump_tasks)
            while pending:
                item = await queue.get()
                if item is None:
                    pending -= 1
                    continue
                stream_name, line = item
                seq += 1
                yield {"event": "line", "seq": seq, "stream": stream_name, "line": line}
            await asyncio.gather(*pump_tasks, return_exceptions=True)
            code = await process.wait()
            if running.cancelled:
                yield {"event": "done", "exit_code": code, "cancelled": True}
            else:
                yield {"event": "done", "exit_code": code}
        finally:
            timeout_task.cancel()
            self._running.pop(job_id, None)
            self.stats.running -= 1
            self.stats.finished += 1
            self.stats.by_op[op.name] = self.stats.by_op.get(op.name, 0) + 1

