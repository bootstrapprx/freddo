"""Dependencias de autenticacao, CSRF e validacao do Cloudflare Access."""

from __future__ import annotations

import hashlib
import logging
import time
from typing import Annotated
from urllib.parse import urlparse

import jwt
from fastapi import Depends, Header, HTTPException, Request

from ..security import CSRF_HEADER, SESSION_COOKIE, allowed_stepup, csrf_valid
from .state import AppState, AuthContext, get_app_state

log = logging.getLogger("freddo.deps")

StateDep = Annotated[AppState, Depends(get_app_state)]


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def verify_cloudflare_access(request: Request, state: AppState) -> None:
    """Defesa em profundidade (S1): valida o JWT do Cloudflare Access quando exigido."""
    if not state.settings.require_cloudflare_jwt:
        return
    token = request.headers.get("cf-access-jwt-assertion")
    team = state.settings.cloudflare_access_team
    if not token or not team:
        raise HTTPException(status_code=401, detail="cloudflare_access_required")
    jwks_url = f"https://{team}.cloudflareaccess.com/cdn-cgi/access/certs"
    try:
        client = jwt.PyJWKClient(jwks_url)
        signing_key = client.get_signing_key_from_jwt(token)
        jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=state.settings.cloudflare_access_aud,
            options={"verify_aud": bool(state.settings.cloudflare_access_aud)},
        )
    except Exception as exc:
        log.warning("JWT do Cloudflare Access invalido: %s", exc)
        raise HTTPException(status_code=401, detail="invalid_access_token") from exc


async def optional_auth(request: Request, state: StateDep) -> AuthContext | None:
    await verify_cloudflare_access(request, state)
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    id_hash = hashlib.sha256(token.encode()).digest()
    session = await state.db.get_session(id_hash)
    if not session:
        return None
    now = int(time.time())
    idle_limit = session["last_seen"] + state.settings.session_idle_minutes * 60
    absolute_limit = session["created_at"] + state.settings.session_absolute_hours * 3600
    if now > min(idle_limit, absolute_limit):
        await state.db.revoke_session(id_hash)
        return None
    await state.db.touch_session(id_hash)
    return AuthContext(
        session_hash=id_hash,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        stepup_until=session["stepup_until"],
        created_at=session["created_at"],
    )


async def require_auth(request: Request, auth: Annotated[AuthContext | None, Depends(optional_auth)]) -> AuthContext:
    if auth is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    return auth


async def require_stepup(auth: Annotated[AuthContext, Depends(require_auth)], state: StateDep) -> AuthContext:
    if not allowed_stepup(auth.stepup_until):
        raise HTTPException(status_code=403, detail="stepup_required")
    return auth


def check_origin(request: Request, state: AppState) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return  # clientes nativos/CLI podem nao enviar Origin
    allowed = {state.settings.public_origin.rstrip("/"), str(request.base_url).rstrip("/")}
    allowed.update(origin_.rstrip("/") for origin_ in state.settings.cors_origins)
    if urlparse(origin).netloc and origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="invalid_origin")


async def verify_csrf(
    request: Request,
    state: StateDep,
    csrf_header: Annotated[str | None, Header(alias=CSRF_HEADER)] = None,
) -> None:
    check_origin(request, state)
    if not csrf_valid(csrf_header, request.cookies.get("freddo_csrf")):
        raise HTTPException(status_code=403, detail="invalid_csrf")


WriteAuth = Annotated[AuthContext, Depends(require_auth)]
StepupAuth = Annotated[AuthContext, Depends(require_stepup)]
Csrf = Annotated[None, Depends(verify_csrf)]
