"""Autenticacao de usuario unico: senha + TOTP, step-up, logout e CSRF."""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ...security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    decrypt_secret,
    hash_recovery_code,
    new_csrf_token,
    new_session_token,
    verify_password,
    verify_totp,
)
from ..deps import StateDep, WriteAuth, _client_ip, verify_cloudflare_access, verify_csrf
from ..schemas import LoginRequest, StepupRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _cookie_kwargs(state) -> dict:
    return {
        "httponly": True,
        "secure": state.settings.public_origin.startswith("https"),
        "samesite": "strict",
        "path": "/",
    }


@router.get("/csrf")
async def csrf_token(state: StateDep) -> Response:
    token = new_csrf_token()
    response = JSONResponse({"csrf_token": token})
    response.set_cookie(CSRF_COOKIE, token, httponly=False, samesite="strict", path="/")
    return response


@router.get("/setup")
async def setup(state: StateDep) -> dict:
    """Estado publico de bootstrap/TOTP para a tela de login (sem autenticacao)."""
    credential = await state.db.get_credential()
    return {
        "bootstrap_required": credential is None,
        "totp_required": bool(credential and credential["totp_secret_enc"]),
    }


@router.get("/me")
async def me(auth: WriteAuth, state: StateDep) -> dict:
    credential = await state.db.get_credential()
    return {
        "authenticated": True,
        "stepup_until": auth.stepup_until,
        "session_created_at": auth.created_at,
        "totp_required": bool(credential and credential["totp_secret_enc"]),
    }


@router.post("/login", dependencies=[Depends(verify_csrf)])
async def login(payload: LoginRequest, request: Request, state: StateDep) -> Response:
    await verify_cloudflare_access(request, state)
    ip = _client_ip(request)
    attempt = await state.db.login_attempt(ip)
    if attempt and attempt["locked_until"] and attempt["locked_until"] > int(time.time()):
        raise HTTPException(status_code=429, detail="too_many_attempts")

    credential = await state.db.get_credential()
    if credential is None:
        raise HTTPException(status_code=503, detail="not_bootstrapped")

    if not verify_password(credential["password_hash"], payload.password):
        failures = await state.db.record_login_failure(ip, None)
        if failures >= state.settings.login_max_attempts:
            async with state.db.connect(write=True) as db:
                await db.execute(
                    "UPDATE login_attempt SET locked_until = ? WHERE ip = ?",
                    (int(time.time()) + state.settings.login_lockout_minutes * 60, ip),
                )
            raise HTTPException(status_code=429, detail="too_many_attempts")
        raise HTTPException(status_code=401, detail="invalid_credentials")

    secret_enc = credential["totp_secret_enc"]
    if secret_enc:
        if payload.totp:
            secret = decrypt_secret(bytes(secret_enc), state.settings.secret_key_file)
            if not verify_totp(secret, payload.totp):
                raise HTTPException(status_code=401, detail="invalid_totp")
        elif payload.recovery_code:
            codes = json.loads(credential["recovery_codes"] or "[]")
            hashed = hash_recovery_code(payload.recovery_code)
            if hashed not in codes:
                raise HTTPException(status_code=401, detail="invalid_recovery_code")
            codes.remove(hashed)
            async with state.db.connect(write=True) as db:
                await db.execute(
                    "UPDATE credential SET recovery_codes = ? WHERE id = 1", (json.dumps(codes),)
                )
        else:
            raise HTTPException(status_code=401, detail="second_factor_required")

    await state.db.clear_login_failures(ip)
    token, id_hash = new_session_token()
    await state.db.create_session(id_hash, ip, request.headers.get("user-agent", ""))
    await state.audit.record("auth.login", actor="freddo", target="session", ip=ip)
    response = JSONResponse({"ok": True, "authenticated": True})
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=state.settings.session_absolute_hours * 3600,
        **_cookie_kwargs(state),
    )
    return response


@router.post("/stepup", dependencies=[Depends(verify_csrf)])
async def stepup(payload: StepupRequest, auth: WriteAuth, state: StateDep) -> dict:
    credential = await state.db.get_credential()
    if not credential:
        raise HTTPException(status_code=503, detail="not_bootstrapped")

    secret_enc = credential["totp_secret_enc"]
    if secret_enc:
        if not payload.totp or not verify_totp(
            decrypt_secret(bytes(secret_enc), state.settings.secret_key_file), payload.totp
        ):
            raise HTTPException(status_code=401, detail="invalid_totp")
        method = "totp"
    else:
        # Bootstrap com --no-totp: a senha volta a ser o segundo fator do step-up.
        if not payload.password or not verify_password(credential["password_hash"], payload.password):
            raise HTTPException(status_code=401, detail="invalid_credentials")
        method = "password"

    until = int(time.time()) + state.settings.stepup_minutes * 60
    await state.db.touch_session(auth.session_hash, stepup_until=until)
    await state.audit.record(f"auth.stepup.{method}", actor="freddo", target="session", ip=auth.ip)
    return {"stepup_until": until}


@router.post("/logout", dependencies=[Depends(verify_csrf)])
async def logout(auth: WriteAuth, state: StateDep) -> Response:
    await state.db.revoke_session(auth.session_hash)
    await state.audit.record("auth.logout", actor="freddo", target="session", ip=auth.ip)
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
