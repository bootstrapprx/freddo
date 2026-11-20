"""Benches: leitura de estado, operacoes, logs, SSL e ngrok."""

from __future__ import annotations

import asyncio
import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ...security import allowed_stepup
from ..deps import StateDep, StepupAuth, WriteAuth, require_auth, verify_csrf
from ..events import event_bus
from ..read import read
from ..schemas import (
    ActionRequest,
    CreateBenchRequest,
    JobResponse,
    NgrokRequest,
    SslRequest,
    UpdateBenchRequest,
)

router = APIRouter(prefix="/benches", tags=["benches"], dependencies=[Depends(require_auth)])


@router.get("")
async def list_benches(state: StateDep) -> list[dict[str, Any]]:
    try:
        return await read(state, "fm.list")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"state_unavailable: {exc}") from exc


@router.get("/{bench}")
async def get_bench(bench: str, state: StateDep) -> dict[str, Any]:
    try:
        return await read(state, "fm.info", {"bench": bench})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"state_unavailable: {exc}") from exc


@router.post("", status_code=202, dependencies=[Depends(verify_csrf)])
async def create_bench(payload: CreateBenchRequest, state: StateDep) -> JobResponse:
    spec: dict[str, Any] = {}
    if payload.template:
        template = await state.db.get_template(payload.template)
        if not template:
            raise HTTPException(status_code=404, detail="template_not_found")
        spec = json.loads(template["spec_json"])
    admin_password = payload.admin_password or secrets.token_urlsafe(12)
    args = {
        "bench": payload.name,
        "version": payload.version,
        "apps": payload.apps,
        "environment": payload.environment,
        "domain": payload.domain,
        "admin_pass": admin_password,
        "alias_domains": [f"www.{payload.name}"] if "." in payload.name else [],
        **spec,
    }
    job_id, created = await state.jobs.submit(
        "bench.create", args, bench=payload.name, idempotency_key=payload.idempotency_key
    )
    audit_detail = {key: value for key, value in args.items() if key != "admin_pass"}
    await state.audit.record("bench.create", target=payload.name, detail=audit_detail)
    return JobResponse(
        id=job_id,
        kind="bench.create",
        bench=payload.name,
        state="queued",
        created_at=0,
        created_now=created,
        admin_password=admin_password if created else None,
    )


@router.delete("/{bench}", status_code=202, dependencies=[Depends(verify_csrf)])
async def delete_bench(bench: str, payload: ActionRequest, auth: StepupAuth, state: StateDep) -> JobResponse:
    if payload.confirm != bench:
        raise HTTPException(status_code=400, detail="confirmation_required")
    job_id, created = await state.jobs.submit(
        "bench.delete", {"bench": bench, "confirm": bench}, bench=bench, idempotency_key=payload.idempotency_key
    )
    snapshot = await read(state, "fm.info", {"bench": bench})
    await state.audit.record("bench.delete", target=bench, detail={"snapshot": snapshot, "job_id": job_id}, ip=auth.ip)
    return JobResponse(id=job_id, kind="bench.delete", bench=bench, state="queued", created_at=0, created_now=created)


@router.post("/{bench}/actions/{action}", status_code=202, dependencies=[Depends(verify_csrf)])
async def bench_action(
    bench: str, action: str, payload: ActionRequest, auth: WriteAuth, state: StateDep
) -> JobResponse:
    if action not in ("start", "stop", "restart", "reset"):
        raise HTTPException(status_code=404, detail="unknown_action")
    if action == "reset":
        if not allowed_stepup(auth.stepup_until):
            raise HTTPException(status_code=403, detail="stepup_required")
        if payload.confirm != bench:
            raise HTTPException(status_code=400, detail="confirmation_required")
    op = f"bench.{action}"
    args: dict[str, Any] = {"bench": bench}
    if action == "reset":
        args["confirm"] = bench
    job_id, created = await state.jobs.submit(
        op, args, bench=bench, idempotency_key=payload.idempotency_key
    )
    await state.audit.record(f"bench.{action}", target=bench, detail={"job_id": job_id}, ip=auth.ip)
    return JobResponse(id=job_id, kind=op, bench=bench, state="queued", created_at=0, created_now=created)


@router.patch("/{bench}/config", status_code=202, dependencies=[Depends(verify_csrf)])
async def update_bench(bench: str, payload: UpdateBenchRequest, auth: WriteAuth, state: StateDep) -> JobResponse:
    job_id, created = await state.jobs.submit(
        "bench.update",
        {"bench": bench, "config": payload.config},
        bench=bench,
        idempotency_key=payload.idempotency_key,
    )
    await state.audit.record("bench.update", target=bench, detail={"config": payload.config}, ip=auth.ip)
    return JobResponse(id=job_id, kind="bench.update", bench=bench, state="queued", created_at=0, created_now=created)


@router.get("/{bench}/logs")
async def bench_logs(
    bench: str,
    state: StateDep,
    service: str = "all",
    follow: bool = True,
    last_event_id: int | None = Query(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """Stream SSE de logs do bench (Secao 3)."""
    job_id, _ = await state.jobs.submit("bench.logs", {"bench": bench, "service": service}, bench=bench)

    async def stream():
        sent = last_event_id or 0
        queue = await event_bus.subscribe(job_id)
        try:
            for row in await state.db.list_events(job_id, sent):
                sent = int(row["seq"])
                yield event_bus.sse({"event": "line", "seq": sent, "stream": row["stream"], "line": row["line"]}, job_id)
            while follow:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if event.get("seq") is not None and int(event["seq"]) <= sent:
                    continue
                if event.get("seq") is not None:
                    sent = int(event["seq"])
                yield event_bus.sse(event, job_id)
                if event.get("event") in ("done", "job_done"):
                    break
        finally:
            await event_bus.unsubscribe(job_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/{bench}/ssl")
async def ssl_status(bench: str, state: StateDep) -> dict[str, Any]:
    return await read(state, "ssl.status", {"bench": bench})


@router.post("/{bench}/ssl", status_code=202, dependencies=[Depends(verify_csrf)])
async def ssl_action(bench: str, payload: SslRequest, auth: WriteAuth, state: StateDep) -> JobResponse:
    op = f"ssl.{payload.operation}"
    args: dict[str, Any] = {"bench": bench, "domain": payload.domain or bench}
    job_id, created = await state.jobs.submit(op, args, bench=bench, idempotency_key=payload.idempotency_key)
    await state.audit.record(op, target=bench, detail={"domain": args["domain"]}, ip=auth.ip)
    return JobResponse(id=job_id, kind=op, bench=bench, state="queued", created_at=0, created_now=created)


@router.post("/{bench}/ngrok", status_code=202, dependencies=[Depends(verify_csrf)])
async def ngrok_action(bench: str, payload: NgrokRequest, auth: StepupAuth, state: StateDep) -> JobResponse:
    if payload.action == "start" and payload.confirm != bench:
        raise HTTPException(status_code=400, detail="confirmation_required")
    op = f"ngrok.{payload.action}"
    args = {"bench": bench, "ttl": payload.ttl, "confirm": bench}
    job_id, created = await state.jobs.submit(op, args, bench=bench, idempotency_key=payload.idempotency_key)
    await state.audit.record(op, target=bench, detail={"ttl": payload.ttl}, ip=auth.ip)
    return JobResponse(id=job_id, kind=op, bench=bench, state="queued", created_at=0, created_now=created)
