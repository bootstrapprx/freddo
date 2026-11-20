"""Jobs: historico, detalhe, stream SSE e cancelamento."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..deps import StateDep, require_auth, verify_csrf
from ..events import event_bus
from ..schemas import job_to_dict

router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(require_auth)])


@router.get("")
async def list_jobs(
    state: StateDep,
    limit: int = Query(default=50, le=500),
    bench: str | None = None,
    state_filter: str | None = Query(default=None, alias="state"),
) -> list[dict]:
    rows = await state.db.list_jobs(limit=limit, bench=bench, state=state_filter)
    return [job_to_dict(row) for row in rows]


@router.get("/{job_id}")
async def get_job(job_id: str, state: StateDep) -> dict:
    row = await state.db.get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="job_not_found")
    result = job_to_dict(row)
    result["events"] = [
        {"seq": event["seq"], "ts": event["ts"], "stream": event["stream"], "line": event["line"]}
        for event in await state.db.list_events(job_id)
    ]
    return result


@router.get("/{job_id}/events")
async def job_events(
    job_id: str,
    state: StateDep,
    last_event_id: int | None = Query(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    job = await state.db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")

    async def stream():
        sent = last_event_id or 0
        queue = await event_bus.subscribe(job_id)
        try:
            for row in await state.db.list_events(job_id, sent):
                sent = int(row["seq"])
                yield event_bus.sse(
                    {"event": "line", "seq": sent, "stream": row["stream"], "line": row["line"]}, job_id
                )
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                seq = event.get("seq")
                if seq is not None:
                    if int(seq) <= sent:
                        continue
                    sent = int(seq)
                yield event_bus.sse(event, job_id)
                if event.get("event") in ("done", "job_done"):
                    return
        finally:
            await event_bus.unsubscribe(job_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/{job_id}/cancel", dependencies=[Depends(verify_csrf)])
async def cancel_job(job_id: str, state: StateDep) -> dict:
    ok = await state.jobs.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=409, detail="job_not_cancellable")
    return {"cancelled": True}
