"""Autenticacao de usuario unico: senha + TOTP, step-up, logout e CSRF."""

from __future__ import annotations

import hashlib
import json
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ...security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    decrypt_secret,
    encrypt_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_password,
    hash_recovery_code,
    new_csrf_token,
    new_session_token,
    totp_provisioning_uri,
    verify_password,
    verify_totp,
)
from ..deps import StateDep, WriteAuth, _client_ip, verify_cloudflare_access, verify_csrf
from ..schemas import BootstrapRequest, LoginRequest, StepupRequest

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
    bootstrap = await state.db.get_setting("bootstrap_token")
    return {
        "bootstrap_required": credential is None,
        "bootstrap_available": bool(bootstrap and bootstrap.get("expires_at", 0) > int(time.time())),
        "totp_required": bool(credential and credential["totp_secret_enc"]),
    }


@router.post("/bootstrap", dependencies=[Depends(verify_csrf)])
async def bootstrap(payload: BootstrapRequest, state: StateDep) -> Response:
    if await state.db.get_credential() is not None:
        raise HTTPException(status_code=409, detail="already_bootstrapped")
    bootstrap = await state.db.get_setting("bootstrap_token")
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    if (
        not bootstrap
        or bootstrap.get("expires_at", 0) <= int(time.time())
        or not secrets.compare_digest(bootstrap.get("hash", ""), token_hash)
    ):
        raise HTTPException(status_code=401, detail="invalid_or_expired_bootstrap_token")
    secret = generate_totp_secret()
    codes = generate_recovery_codes()
    consumed = await state.db.consume_bootstrap_token(
        token_hash,
        hash_password(payload.password),
        encrypt_secret(secret, state.settings.secret_key_file),
        [hash_recovery_code(code) for code in codes],
    )
    if not consumed:
        raise HTTPException(status_code=401, detail="invalid_or_expired_bootstrap_token")
    await state.audit.record("credential.bootstrap", actor="local", target="credential")
    return JSONResponse(
        {
            "ok": True,
            "totp_secret": secret,
            "totp_uri": totp_provisioning_uri(secret),
            "recovery_codes": codes,
        },
        headers={"Cache-Control": "no-store"},
    )


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
