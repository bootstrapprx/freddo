"""Terminal WebSocket (S8): desligado por padrao, step-up e sessao gravada.

O `fmx shell` roda no Executor (allowlist + SO_PEERCRED). A API apenas repassa
entrada/saida ao navegador e grava o transcript — ela nao invoca o runtime.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...executor.client import ExecutorUnavailable
from ...security import SESSION_COOKIE, allowed_stepup, redact
from ..state import get_app_state

router = APIRouter(tags=["shell"])


@router.websocket("/benches/{bench}/shell")
async def shell(websocket: WebSocket, bench: str) -> None:
    state = get_app_state()
    await websocket.accept()
    if not state.settings.enable_shell:
        await websocket.send_json({"type": "error", "message": "shell_disabled"})
        await websocket.close(code=4403)
        return

    token = websocket.cookies.get(SESSION_COOKIE)
    if not token:
        await websocket.send_json({"type": "error", "message": "unauthorized"})
        await websocket.close(code=4401)
        return
    session = await state.db.get_session(hashlib.sha256(token.encode()).digest())
    now = int(time.time())
    if (
        not session
        or now > session["last_seen"] + state.settings.session_idle_minutes * 60
        or not allowed_stepup(session["stepup_until"])
    ):
        await websocket.send_json({"type": "error", "message": "stepup_required"})
        await websocket.close(code=4401)
        return

    session_dir = state.settings.home / "sessions"
    session_dir.mkdir(parents=True, exist_ok=True)
    transcript = session_dir / f"{bench}-{int(time.time())}.log"
    await state.audit.record("shell.open", target=bench, detail={"transcript": str(transcript)})

    try:
        shell_session = await state.executor.shell(bench)
    except ExecutorUnavailable as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011)
        return

    await websocket.send_json({"type": "connected", "bench": bench})

    async def read_input() -> None:
        while True:
            message = await websocket.receive_text()
            payload = json.loads(message)
            if payload.get("type") != "input":
                continue
            data = str(payload.get("data", ""))
            with transcript.open("a") as handle:
                handle.write(f"$ {redact(data)}\n")
            await shell_session.send(data)

    reader_task = asyncio.create_task(read_input())
    try:
        async for event in shell_session.events():
            data = event.get("data")
            if data:
                text = redact(str(data))
                with transcript.open("a") as handle:
                    handle.write(text)
                await websocket.send_json({"type": "output", "data": text})
    except WebSocketDisconnect:
        pass
    except (ExecutorUnavailable, OSError):
        pass
    finally:
        reader_task.cancel()
        await asyncio.gather(reader_task, return_exceptions=True)
        await shell_session.close()
        await state.audit.record("shell.close", target=bench, detail={"transcript": str(transcript)})
        await websocket.close()
