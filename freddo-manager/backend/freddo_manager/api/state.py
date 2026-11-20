"""Estado da aplicacao (singleton por processo) e servico de jobs."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from ulid import ULID

from ..audit import AuditService
from ..config import Settings, get_settings
from ..db.state import StateDB
from ..db.telemetry import TelemetryDB
from ..executor.client import ExecutorClient, ExecutorUnavailable
from ..runtime import ContainerCompat
from .events import event_bus

log = logging.getLogger("freddo.api")


@dataclass
class AuthContext:
    session_hash: bytes
    ip: str
    user_agent: str
    stepup_until: int | None
    created_at: int


class JobService:
    def __init__(self, db: StateDB, executor: ExecutorClient) -> None:
        self.db = db
        self.executor = executor
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.bus = event_bus

    async def recover(self) -> list[str]:
        return await self.db.recover_orphaned_jobs()

    async def submit(
        self,
        kind: str,
        args: dict[str, Any],
        bench: str | None = None,
        idempotency_key: str | None = None,
    ) -> tuple[str, bool]:
        """Cria um job. Retorna (job_id, criado_agora)."""
        if idempotency_key:
            existing = await self.db.get_job_by_idempotency(idempotency_key)
            if existing:
                return str(existing["id"]), False
        job_id = str(ULID())
        created_at = int(time.time())
        await self.db.insert_job(
            {
                "id": job_id,
                "kind": kind,
                "bench": bench,
                "args_json": json.dumps(args, sort_keys=True),
                "state": "queued",
                "idempotency_key": idempotency_key,
                "created_at": created_at,
            }
        )
        task = asyncio.create_task(self._run(job_id, kind, args), name=f"job-{job_id}")
        self.tasks[job_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(job_id, None))
        return job_id, True

    async def _run(self, job_id: str, kind: str, args: dict[str, Any]) -> None:
        await self.db.update_job(job_id, state="running", started_at=int(time.time()))
        exit_code = 1
        final_state = "failed"
        error: str | None = None
        try:
            async for event in self.executor.run(job_id, kind, args):
                event_name = event.get("event")
                if event_name == "line":
                    seq = int(event.get("seq") or await self.db.next_event_seq(job_id))
                    line = str(event.get("line", ""))
                    await self.db.append_event(job_id, seq, str(event.get("stream", "stdout")), line)
                    await self.bus.publish(job_id, {"event": "line", "seq": seq, **event})
                elif event_name in ("status", "error"):
                    await self.bus.publish(job_id, event)
                    if event_name == "error":
                        error = str(event.get("line"))
                elif event_name == "done":
                    exit_code = int(event.get("exit_code") or 0)
                    final_state = "cancelled" if event.get("cancelled") else (
                        "succeeded" if exit_code == 0 else "failed"
                    )
            # Eventos de status nao sao persistidos, mas precisam de sequencia no SSE.
        except ExecutorUnavailable as exc:
            error = str(exc)
            final_state = "failed"
            exit_code = 1
            await self.bus.publish(job_id, {"event": "error", "line": error})
        except asyncio.CancelledError:
            final_state = "cancelled"
            error = "cancelled"
            raise
        except Exception as exc:  # pragma: no cover - defesa em profundidade
            log.exception("job %s falhou inesperadamente", job_id)
            error = str(exc)
            final_state = "failed"
        finally:
            await self.db.update_job(
                job_id,
                state=final_state,
                exit_code=exit_code,
                error=error,
                finished_at=int(time.time()),
            )
            await self.bus.publish(
                job_id,
                {"event": "job_done", "state": final_state, "exit_code": exit_code, "error": error},
            )

    async def cancel(self, job_id: str) -> bool:
        job = await self.db.get_job(job_id)
        if not job or job["state"] not in ("queued", "running"):
            return False
        ok = await self.executor.cancel(job_id)
        if ok:
            await self.db.update_job(job_id, state="cancelled", finished_at=int(time.time()))
        return ok


@dataclass
class AppState:
    settings: Settings
    db: StateDB
    telemetry: TelemetryDB
    executor: ExecutorClient
    audit: AuditService
    jobs: JobService
    compat: ContainerCompat = field(init=False)
    collector: Any = None
    startup_errors: list[str] = field(default_factory=list)

    @classmethod
    def create(cls, settings: Settings | None = None) -> AppState:
        settings = settings or get_settings()
        db = StateDB(settings.state_db)
        telemetry = TelemetryDB(settings.telemetry_db)
        executor = ExecutorClient(settings.executor_socket)
        state = cls(
            settings=settings,
            db=db,
            telemetry=telemetry,
            executor=executor,
            audit=AuditService(db),
            jobs=JobService(db, executor),
        )
        state.compat = ContainerCompat(settings)
        return state

    async def initialize(self) -> None:
        await self.db.initialize()
        await self.telemetry.initialize()
        await self.jobs.recover()
        try:
            await self.executor.ping()
        except ExecutorUnavailable as exc:
            self.startup_errors.append(f"executor indisponivel: {exc}")
            log.warning("%s", exc)

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "shell_enabled": self.settings.enable_shell,
            "executor_ok": not any("executor" in e for e in self.startup_errors),
            "container_runtime": self.compat.public_dict(),
            "startup_errors": self.startup_errors,
        }


_app_state: AppState | None = None


def set_app_state(state: AppState) -> None:
    global _app_state
    _app_state = state


def get_app_state() -> AppState:
    if _app_state is None:
        raise RuntimeError("estado da aplicacao nao inicializado")
    return _app_state
