"""Cliente do Executor usado pela API (nunca toca Docker diretamente)."""

from __future__ import annotations

import asyncio
import itertools
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from .protocol import read_message, write_message

COUNTER = itertools.count(1)


class ExecutorUnavailable(RuntimeError):
    pass


class ExecutorClient:
    def __init__(self, socket_path: str | Path, timeout: float = 30.0) -> None:
        self.socket_path = Path(socket_path)
        self.timeout = timeout

    @property
    def _id(self) -> str:
        return f"req-{next(COUNTER)}"

    async def _connect(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        if not self.socket_path.exists():
            raise ExecutorUnavailable(f"socket do executor ausente: {self.socket_path}")
        try:
            return await asyncio.wait_for(
                asyncio.open_unix_connection(str(self.socket_path)), timeout=self.timeout
            )
        except (TimeoutError, OSError) as exc:
            raise ExecutorUnavailable(str(exc)) from exc

    async def ping(self) -> bool:
        reader, writer = await self._connect()
        try:
            request_id = self._id
            await write_message(writer, {"id": request_id, "cmd": "ping"})
            message = await asyncio.wait_for(read_message(reader), timeout=5)
            return bool(message and message.get("type") == "data" and message["payload"].get("ok"))
        finally:
            writer.close()
            await writer.wait_closed()

    async def stats(self) -> dict[str, Any]:
        return await self.command("stats")

    async def command(self, cmd: str, **payload: Any) -> Any:
        reader, writer = await self._connect()
        try:
            request_id = self._id
            await write_message(writer, {"id": request_id, "cmd": cmd, **payload})
            message = await asyncio.wait_for(read_message(reader), timeout=self.timeout)
            if not message:
                raise ExecutorUnavailable(" executor fechou a conexao")
            if message.get("type") == "error":
                raise ExecutorUnavailable(str(message.get("payload")))
            return message.get("payload")
        finally:
            writer.close()
            await writer.wait_closed()

    async def read(self, op: str, args: dict[str, Any] | None = None) -> Any:
        result = await self.command("read", op=op, args=args or {})
        if isinstance(result, dict) and "error" in result:
            raise ExecutorUnavailable(str(result["error"]))
        return result

    async def run(
        self, job_id: str, op: str, args: dict[str, Any] | None = None, timeout: int | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        reader, writer = await self._connect()
        request_id = self._id
        try:
            await write_message(
                writer,
                {
                    "id": request_id,
                    "cmd": "run",
                    "job_id": job_id,
                    "op": op,
                    "args": args or {},
                    "timeout": timeout,
                },
            )
            while True:
                message = await read_message(reader)
                if message is None:
                    raise ExecutorUnavailable("executor fechou a conexao durante o job")
                if message.get("type") == "error":
                    yield {"event": "error", "line": str(message.get("payload"))}
                    return
                if message.get("type") == "done":
                    return
                if message.get("type") == "event":
                    yield message["payload"]
        finally:
            writer.close()
            await writer.wait_closed()

    async def cancel(self, job_id: str) -> bool:
        result = await self.command("cancel", job_id=job_id)
        return bool(result and result.get("cancelled"))
