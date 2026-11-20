"""Servicos globais, versao/atualizacao do fm e informacoes do painel."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..deps import StateDep, WriteAuth, require_auth, verify_csrf
from ..read import read
from ..schemas import JobResponse, MigrateRequest, SelfUpdateRequest, ServiceActionRequest

router = APIRouter(tags=["system"], dependencies=[Depends(require_auth)])


@router.get("/system")
async def system_info(state: StateDep) -> dict[str, Any]:
    return state.to_public_dict()


@router.get("/services")
async def list_services(state: StateDep) -> list[dict[str, Any]]:
    try:
        return await read(state, "services.list")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"state_unavailable: {exc}") from exc


@router.post("/services/{service}/actions/{action}", status_code=202, dependencies=[Depends(verify_csrf)])
async def service_action(
    service: str, action: str, payload: ServiceActionRequest, auth: WriteAuth, state: StateDep
) -> JobResponse:
    if action not in ("start", "stop", "restart") or payload.service != service:
        raise HTTPException(status_code=400, detail="invalid_action")
    op = f"services.{action}"
    job_id, created = await state.jobs.submit(op, {"service": service}, idempotency_key=payload.idempotency_key)
    await state.audit.record(op, target=service, detail={"job_id": job_id}, ip=auth.ip)
    return JobResponse(id=job_id, kind=op, bench=None, state="queued", created_at=0, created_now=created)


@router.get("/system/fm")
async def fm_version(state: StateDep) -> dict[str, Any]:
    try:
        return await read(state, "fm.version")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"fm_unavailable: {exc}") from exc


@router.post("/system/fm/update", status_code=202, dependencies=[Depends(verify_csrf)])
async def fm_update(payload: SelfUpdateRequest, auth: WriteAuth, state: StateDep) -> JobResponse:
    from ...security import allowed_stepup

    if not allowed_stepup(auth.stepup_until):
        raise HTTPException(status_code=403, detail="stepup_required")
    if not payload.backup_confirmed:
        raise HTTPException(status_code=400, detail="backup_confirmation_required")
    job_id, created = await state.jobs.submit("fm.self.update", {"confirm": "system"})
    await state.audit.record("fm.self.update", target="system", ip=auth.ip)
    return JobResponse(id=job_id, kind="fm.self.update", bench=None, state="queued", created_at=0, created_now=created)


@router.post("/system/fm/migrate", status_code=202, dependencies=[Depends(verify_csrf)])
async def fm_migrate(payload: MigrateRequest, auth: WriteAuth, state: StateDep) -> JobResponse:
    from ...security import allowed_stepup

    if not allowed_stepup(auth.stepup_until):
        raise HTTPException(status_code=403, detail="stepup_required")
    if not payload.backup_confirmed:
        raise HTTPException(status_code=400, detail="backup_confirmation_required")
    job_id, created = await state.jobs.submit("fm.migrate", {"confirm": "system"})
    await state.audit.record("fm.migrate", target="system", ip=auth.ip)
    return JobResponse(id=job_id, kind="fm.migrate", bench=None, state="queued", created_at=0, created_now=created)
