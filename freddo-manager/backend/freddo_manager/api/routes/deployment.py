"""Configuracao local do tunnel e dominios permitidos para deploy."""

from __future__ import annotations

import grp
import os
import secrets
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import StateDep, WriteAuth, require_auth, verify_csrf
from ..schemas import CreateSiteRequest, DeploymentDomainsRequest, JobResponse, TunnelTokenRequest

router = APIRouter(prefix="/deployment", tags=["deployment"], dependencies=[Depends(require_auth)])
TOKEN_FILE = "cloudflared.env"
TOKEN_GROUP = "freddo-tunnel"


def _token_path(state) -> Path:
    return state.settings.home / "cloudflared" / TOKEN_FILE


def _write_token(state, token: str) -> None:
    path = _token_path(state)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        group_id = grp.getgrnam(TOKEN_GROUP).gr_gid
    except KeyError:
        group_id = None
    fd, temporary = tempfile.mkstemp(prefix=".cloudflared-", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(f"TUNNEL_TOKEN={token}\n")
            stream.flush()
            os.fsync(stream.fileno())
            if group_id is not None:
                os.fchown(stream.fileno(), -1, group_id)
                os.fchmod(stream.fileno(), 0o640)
            else:
                os.fchmod(stream.fileno(), 0o600)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _job_response(job_id: str, kind: str, created: bool) -> JobResponse:
    return JobResponse(
        id=job_id,
        kind=kind,
        bench=None,
        state="queued",
        created_at=0,
        created_now=created,
    )


@router.get("/config")
async def get_deployment_config(state: StateDep) -> dict:
    return {
        "domains": await state.db.get_setting("deployment_domains", ["kodoo.online", "kalkulisto.com.br"]),
        "tunnel_configured": _token_path(state).is_file(),
    }


@router.put("/domains", dependencies=[Depends(verify_csrf)])
async def set_deployment_domains(payload: DeploymentDomainsRequest, auth: WriteAuth, state: StateDep) -> dict:
    await state.db.set_setting("deployment_domains", payload.domains)
    await state.audit.record(
        "deployment.domains.update", target="sites", detail={"domains": payload.domains}, ip=auth.ip
    )
    return {"domains": payload.domains}


@router.put("/tunnel-token", status_code=204, dependencies=[Depends(verify_csrf)])
async def set_tunnel_token(payload: TunnelTokenRequest, auth: WriteAuth, state: StateDep) -> Response:
    _write_token(state, payload.token)
    await state.audit.record("deployment.tunnel.token", target="cloudflared", detail={"configured": True}, ip=auth.ip)
    return Response(status_code=204)


@router.delete("/tunnel-token", status_code=204, dependencies=[Depends(verify_csrf)])
async def delete_tunnel_token(auth: WriteAuth, state: StateDep) -> Response:
    token_path = _token_path(state)
    if not token_path.is_file():
        raise HTTPException(status_code=404, detail="tunnel_token_not_configured")
    job_id, _ = await state.jobs.submit("tunnel.down", {})
    task = state.jobs.tasks.get(job_id)
    if task:
        await task
    job = await state.db.get_job(job_id)
    if not job or job["state"] != "succeeded":
        raise HTTPException(status_code=503, detail="tunnel_disconnect_failed")
    token_path.unlink(missing_ok=True)
    await state.audit.record("deployment.tunnel.token", target="cloudflared", detail={"configured": False}, ip=auth.ip)
    return Response(status_code=204)


@router.post("/tunnel/connect", status_code=202, dependencies=[Depends(verify_csrf)])
async def connect_tunnel(auth: WriteAuth, state: StateDep) -> JobResponse:
    if not _token_path(state).is_file():
        raise HTTPException(status_code=409, detail="tunnel_token_not_configured")
    job_id, created = await state.jobs.submit("tunnel.up", {})
    await state.audit.record("deployment.tunnel.connect", target="cloudflared", detail={"job_id": job_id}, ip=auth.ip)
    return _job_response(job_id, "tunnel.up", created)


@router.post("/tunnel/disconnect", status_code=202, dependencies=[Depends(verify_csrf)])
async def disconnect_tunnel(auth: WriteAuth, state: StateDep) -> JobResponse:
    job_id, created = await state.jobs.submit("tunnel.down", {})
    await state.audit.record("deployment.tunnel.disconnect", target="cloudflared", detail={"job_id": job_id}, ip=auth.ip)
    return _job_response(job_id, "tunnel.down", created)


@router.post("/sites", status_code=202, dependencies=[Depends(verify_csrf)])
async def create_site(payload: CreateSiteRequest, auth: WriteAuth, state: StateDep) -> JobResponse:
    domains = await state.db.get_setting("deployment_domains", ["kodoo.online", "kalkulisto.com.br"])
    if payload.base_domain not in domains:
        raise HTTPException(status_code=400, detail="domain_not_configured")
    if not _token_path(state).is_file():
        raise HTTPException(status_code=409, detail="tunnel_token_not_configured")

    hostname = f"{payload.label}.{payload.base_domain}"
    admin_password = secrets.token_urlsafe(12)
    args = {
        "bench": hostname,
        "version": payload.version,
        "apps": payload.apps,
        "environment": payload.environment,
        "domain": hostname,
        "admin_pass": admin_password,
        "alias_domains": [],
    }
    job_id, created = await state.jobs.submit(
        "bench.create", args, bench=hostname, idempotency_key=payload.idempotency_key
    )
    await state.audit.record(
        "bench.create",
        target=hostname,
        detail={
            "version": payload.version,
            "apps": payload.apps,
            "environment": payload.environment,
            "domain": hostname,
            "job_id": job_id,
        },
        ip=auth.ip,
    )
    return JobResponse(
        id=job_id,
        kind="bench.create",
        bench=hostname,
        state="queued",
        created_at=0,
        created_now=created,
        admin_password=admin_password if created else None,
    )
