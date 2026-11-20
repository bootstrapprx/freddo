"""Execucao de subprocessos com locks, timeout, cancelamento e streaming."""

from __future__ import annotations

import asyncio
import os
import re
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
        self.allowlist = allowlist or Allowlist(settings.fm_bin, state_db_path=settings.state_db)
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
                if op_name.startswith("app."):
                    async for event in self._run_app(job_id, op, args or {}):
                        yield event
                    return
                if op_name == "bench.create" and "expected_commits" in op.tags:
                    async for event in self._run_deploy_create(job_id, op):
                        yield event
                    return
                async for event in self._run_process(job_id, op):
                    yield event
            except FileNotFoundError as exc:
                yield {
                    "event": "error",
                    "line": f"binario indisponivel: {exc.filename or op.argv[0]}",
                    "exit_code": 127,
                }

    async def _run_app(self, job_id: str, op: Operation, args: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        seq = 0

        async def command(argv: list[str], timeout: int) -> AsyncIterator[dict[str, Any]]:
            nonlocal seq
            child = Operation(op.name, argv, bench=op.bench, timeout=timeout, global_lock=op.global_lock)
            async for event in self._run_process(job_id, child):
                if event.get("event") == "line":
                    seq += 1
                    yield {**event, "seq": seq}
                else:
                    yield event

        if op.name == "app.validate":
            commit = None
            error = None
            try:
                async for event in command(op.argv, 30):
                    if event.get("event") == "line":
                        match = re.fullmatch(r"([0-9a-fA-F]{40,64})\trefs/(?:heads|tags)/(.+)", str(event.get("line", "")))
                        if match and match.group(2) == op.tags["ref"]:
                            commit = match.group(1).lower()
                        yield event
                    elif event.get("event") != "done":
                        yield event
            except OSError as exc:
                error = f"git_unavailable: {exc.filename or 'git'}"
            from ..db.state import StateDB
            current = await StateDB(self.settings.state_db).record_app_validation(
                op.tags["app"], op.tags["framework_version"], op.tags["repository_url"], op.tags["ref"],
                "passed" if commit else "failed", commit, None if commit else error or "branch_or_tag_not_found",
            )
            if not current:
                commit = None
                yield {"event": "error", "line": "app_release_changed_during_validation", "exit_code": 1}
            yield {"event": "done", "exit_code": 0 if commit else 1 if error is None else 127}
            return

        if op.name == "app.test":
            from ..db.state import StateDB
            app, version, commit = op.tags["app"], op.tags["framework_version"], op.tags["validated_commit"]
            temp = str(op.bench)
            create_argv = [self.settings.fm_bin, "-n", "create", temp, "--environment", "dev", "--admin-pass", str(args["admin_pass"]), "--apps", f"{args['frappe_url']}:{args['frappe_ref']}", "--apps", f"{args['app_url']}:{args['app_ref']}"]
            state, summary = "failed", "test_failed"
            try:
                create_ok = False
                async for event in command(create_argv, 3600):
                    if event.get("event") == "line":
                        yield event
                    elif event.get("event") == "done":
                        create_ok = int(event.get("exit_code", 1)) == 0
                if not create_ok:
                    raise RuntimeError("temporary_bench_create_failed")
                for package, expected in ((app, commit), ("frappe", args["frappe_commit"])):
                    actual = None
                    verify_argv = [
                        self.settings.fm_bin, "-n", "shell", temp, "-c",
                        f"git -C apps/{package} rev-parse HEAD",
                    ]
                    async for event in command(verify_argv, 60):
                        if event.get("event") == "line":
                            match = re.fullmatch(r"[0-9a-fA-F]{40,64}", str(event.get("line", "")).strip())
                            if match:
                                actual = match.group(0).lower()
                            yield event
                    if actual != expected:
                        raise RuntimeError(f"{package}_ref_moved_during_test")
                test_argv = [self.settings.fm_bin, "-n", "shell", temp, "-c", f"bench run-tests --app {app}"]
                test_ok = False
                async for event in command(test_argv, 7200):
                    if event.get("event") == "line":
                        yield event
                    elif event.get("event") == "done":
                        test_ok = int(event.get("exit_code", 1)) == 0
                if not test_ok:
                    raise RuntimeError("app_test_failed")
                state, summary = "passed", "app_tests_passed"
            except (RuntimeError, FileNotFoundError) as exc:
                summary = str(exc)[:300]
                seq += 1
                yield {"event": "line", "seq": seq, "stream": "stderr", "line": summary}
            finally:
                cleanup_ok = False
                try:
                    async for event in command([self.settings.fm_bin, "-n", "delete", temp, "--yes"], 900):
                        if event.get("event") == "line":
                            yield event
                        elif event.get("event") == "done":
                            cleanup_ok = int(event.get("exit_code", 1)) == 0
                except (FileNotFoundError, OSError):
                    cleanup_ok = False
                if not cleanup_ok:
                    state, summary = "failed", "temporary_bench_cleanup_failed"
                current = await StateDB(self.settings.state_db).record_app_test_result(
                    app, version, args["app_url"], args["app_ref"], commit, state, job_id, summary
                )
                if not current:
                    state, summary = "failed", "app_release_changed_during_test"
            yield {"event": "done", "exit_code": 0 if state == "passed" else 1}
            return

        async for event in command(op.argv, op.timeout):
            yield event

    async def _run_deploy_create(self, job_id: str, op: Operation) -> AsyncIterator[dict[str, Any]]:
        import json

        seq = 0
        created = False
        async for event in self._run_process(job_id, op):
            if event.get("event") == "line":
                seq += 1
                yield {**event, "seq": seq}
            elif event.get("event") == "done":
                created = int(event.get("exit_code", 1)) == 0
                if event.get("cancelled"):
                    created = False
        code = 0 if created else 1
        expected = json.loads(op.tags["expected_commits"])
        if created:
            for app, commit in expected.items():
                argv = [self.settings.fm_bin, "-n", "shell", str(op.bench), "-c", f"git -C apps/{app} rev-parse HEAD"]
                actual = None
                child = Operation(op.name, argv, bench=op.bench, timeout=60)
                async for event in self._run_process(job_id, child):
                    if event.get("event") == "line":
                        seq += 1
                        match = re.fullmatch(r"[0-9a-fA-F]{40,64}", str(event.get("line", "")).strip())
                        if match:
                            actual = match.group(0).lower()
                        yield {**event, "seq": seq}
                if actual != commit:
                    code = 1
                    break
        cleanup_ok = True
        if created and code:
            try:
                cleanup = Operation(op.name, [self.settings.fm_bin, "-n", "delete", str(op.bench), "--yes"], bench=op.bench, timeout=900)
                async for event in self._run_process(job_id, cleanup):
                    if event.get("event") == "line":
                        seq += 1
                        yield {**event, "seq": seq}
                    elif event.get("event") == "done":
                        cleanup_ok = int(event.get("exit_code", 1)) == 0
            except FileNotFoundError:
                cleanup_ok = False
        if code:
            seq += 1
            detail = "deployed_app_commit_mismatch" if created else "bench_create_failed"
            if created:
                detail += "; " + ("bench removed" if cleanup_ok else "bench cleanup failed")
            yield {"event": "line", "seq": seq, "stream": "stderr", "line": detail}
        yield {"event": "done", "exit_code": code}

    async def _run_process(self, job_id: str, op: Operation) -> AsyncIterator[dict[str, Any]]:
        process = await asyncio.create_subprocess_exec(
            *op.argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self.settings.fm_home),
            env=self.compat.env({
                **os.environ,
                "FREDDO_HOME": str(self.settings.home),
                "PYTHONUNBUFFERED": "1",
                **({"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo"} if op.name == "app.validate" else {}),
            }),
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

