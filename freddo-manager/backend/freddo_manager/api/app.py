"""Aplicacao FastAPI: /api/v1, erros no formato {code, message, details}."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..collector.collector import Collector
from ..config import Settings, get_settings
from ..executor.server import run_executor
from .routes import alerts, audit, auth, benches, jobs, shell, system, telemetry, templates
from .state import AppState, set_app_state

log = logging.getLogger("freddo.api")


def error_response(code: str, message: str, details: dict | None = None, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "details": details},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    state = AppState.create(settings)
    collector = Collector(settings, state.telemetry, state.db, state.compat)
    state.collector = collector

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        set_app_state(state)
        await state.initialize()
        collector.start()
        executor_task: asyncio.Task[None] | None = None
        if settings.embed_executor:
            executor_task = asyncio.create_task(
                run_executor(settings, install_handlers=False), name="embedded-executor"
            )
            for _ in range(40):
                if settings.executor_socket.exists():
                    break
                await asyncio.sleep(0.05)
            try:
                await state.executor.ping()
                state.startup_errors = [e for e in state.startup_errors if "executor" not in e]
            except Exception:
                pass
        yield
        # Jobs podem ainda estar gravando eventos quando o cliente de teste (ou o
        # uvicorn) fecha o loop. Cancela e espera antes de desligar o executor.
        for task in list(state.jobs.tasks.values()):
            task.cancel()
        if state.jobs.tasks:
            await asyncio.gather(*list(state.jobs.tasks.values()), return_exceptions=True)
        await collector.stop()
        if executor_task:
            executor_task.cancel()
            try:
                await executor_task
            except asyncio.CancelledError:
                pass

    app = FastAPI(
        title="freddo-manager",
        version="0.1.0",
        description="Console web de host unico para Frappe-Manager (fmx)",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if settings.public_origin.startswith("https://"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "request_error"
        return error_response(detail, detail, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            "validation_error",
            "dados invalidos",
            {"errors": [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]},
            status_code=422,
        )

    @app.get("/api/v1/health", tags=["system"])
    async def health() -> dict:
        return {"status": "ok", **state.to_public_dict()}

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(benches.router, prefix="/api/v1")
    app.include_router(jobs.router, prefix="/api/v1")
    app.include_router(telemetry.router, prefix="/api/v1")
    app.include_router(alerts.router, prefix="/api/v1")
    app.include_router(templates.router, prefix="/api/v1")
    app.include_router(audit.router, prefix="/api/v1")
    app.include_router(system.router, prefix="/api/v1")
    app.include_router(shell.router, prefix="/api/v1")
    app.state.freddo = state

    web_dist = Path(settings.web_dist)
    if web_dist.is_dir():
        # Registrado por ultimo para nao sombrear /api/v1.
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")

    return app
