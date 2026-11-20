"""Terminal WebSocket (S8): desligado por padrao, step-up e sessao gravada."""

from __future__ import annotations

import asyncio
import hashlib
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
    await websocket.send_json({"type": "connected", "bench": bench})

    try:
        process = await asyncio.create_subprocess_exec(
            state.settings.fm_bin,
            "shell",
            bench,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(state.settings.fm_home),
            env=state.compat.env(),
        )
    except OSError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011)
        return

    async def pump() -> None:
        assert process.stdout
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            text = redact(line.decode("utf-8", "replace"))
            with transcript.open("a") as handle:
                handle.write(text)
            await websocket.send_json({"type": "output", "data": text})

    reader_task = asyncio.create_task(pump())
    deadline = time.monotonic() + 30 * 60
    try:
        while time.monotonic() < deadline:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=5)
            except TimeoutError:
                continue
            import json

            payload = json.loads(message)
            if payload.get("type") != "input":
                continue
            data = str(payload.get("data", ""))
            with transcript.open("a") as handle:
                handle.write(f"$ {redact(data)}\n")
            if process.stdin:
                process.stdin.write(data.encode())
                await process.stdin.drain()
    except WebSocketDisconnect:
        pass
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                process.kill()
        if reader_task:
            reader_task.cancel()
        await state.audit.record("shell.close", target=bench, detail={"transcript": str(transcript)})
        await websocket.close()
