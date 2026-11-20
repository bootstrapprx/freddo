"""Servidor do Executor: Unix socket com verificacao SO_PEERCRED (S7)."""

from __future__ import annotations

import asyncio
import ctypes
import json
import logging
import os
import signal
import socket
import sys
import threading

from ..config import Settings
from ..fm.adapter import FmAdapter
from ..runtime import ContainerCompat
from ..security import redact
from .allowlist import Allowlist, ValidationError
from .protocol import read_message, write_message
from .runner import JobExecutor

log = logging.getLogger("freddo.executor")


class Ucred(ctypes.Structure):
    _fields_ = [("pid", ctypes.c_int32), ("uid", ctypes.c_uint32), ("gid", ctypes.c_uint32)]


def peer_credentials(sock: socket.socket) -> tuple[int, int] | None:
    """Retorna (uid, gid) do processo conectado via SO_PEERCRED."""
    if not sys.platform.startswith("linux"):
        return None
    try:
        buffer = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, ctypes.sizeof(Ucred))
        ucred = Ucred.from_buffer_copy(buffer)
        return int(ucred.uid), int(ucred.gid)
    except OSError:
        return None


class ExecutorServer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.allowlist = Allowlist(settings.fm_bin, state_db_path=settings.state_db)
        self.compat = ContainerCompat(settings)
        self.executor = JobExecutor(settings, self.allowlist, self.compat)
        self.fm = FmAdapter(settings, self.executor, self.allowlist, self.compat)
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        socket_path = self.settings.executor_socket
        socket_path.parent.mkdir(parents=True, exist_ok=True)
        socket_path.unlink(missing_ok=True)
        self._server = await asyncio.start_unix_server(self._handle, path=str(socket_path))
        if self.settings.executor_gid is not None:
            os.chown(socket_path, -1, self.settings.executor_gid)
        os.chmod(socket_path, 0o660)
        log.info("executor ouvindo em %s", socket_path)
        async with self._server:
            await self._server.serve_forever()

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        self.settings.executor_socket.unlink(missing_ok=True)

    def _authorized(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bool:
        sock = writer.get_extra_info("socket")
        creds = peer_credentials(sock) if sock else None
        if creds is None:
            if self.settings.executor_uid is not None:
                log.warning("SO_PEERCRED indisponivel; conexao recusada por politica")
                return False
            return True
        uid, gid = creds
        expected_uid = self.settings.executor_uid or os.getuid()
        if uid != expected_uid:
            log.warning("conexao recusada: uid %d != %d", uid, expected_uid)
            return False
        if self.settings.executor_gid is not None and gid != self.settings.executor_gid:
            log.warning("conexao recusada: gid %d != %d", gid, self.settings.executor_gid)
            return False
        return True

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        request_id = "?"
        try:
            if not self._authorized(reader, writer):
                await write_message(writer, {"id": "?", "type": "error", "payload": "unauthorized"})
                return
            while True:
                message = await read_message(reader)
                if message is None:
                    return
                request_id = str(message.get("id", "?"))
                cmd = message.get("cmd")
                if cmd == "ping":
                    await write_message(writer, {"id": request_id, "type": "data", "payload": {"ok": True}})
                elif cmd == "stats":
                    await write_message(
                        writer,
                        {
                            "id": request_id,
                            "type": "data",
                            "payload": {
                                "running": self.executor.stats.running,
                                "finished": self.executor.stats.finished,
                                "by_op": self.executor.stats.by_op,
                            },
                        },
                    )
                elif cmd == "read":
                    await self._handle_read(request_id, message, writer)
                elif cmd == "run":
                    await self._handle_run(request_id, message, writer)
                elif cmd == "shell":
                    await self._handle_shell(request_id, message, reader, writer)
                elif cmd == "cancel":
                    ok = await self.executor.cancel(str(message.get("job_id", "")))
                    await write_message(writer, {"id": request_id, "type": "data", "payload": {"cancelled": ok}})
                else:
                    await write_message(writer, {"id": request_id, "type": "error", "payload": "unknown_cmd"})
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            log.warning("mensagem invalida: %s", exc)
        except (ConnectionResetError, BrokenPipeError):
            pass
        except Exception:
            log.exception("falha no executor")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionResetError, BrokenPipeError):
                pass

    async def _handle_read(
        self, request_id: str, message: dict[str, object], writer: asyncio.StreamWriter
    ) -> None:
        op = str(message.get("op", ""))
        args = message.get("args") or {}
        try:
            result = await self.fm.execute_read(op, args if isinstance(args, dict) else {})
            await write_message(writer, {"id": request_id, "type": "data", "payload": result})
        except ValidationError as exc:
            await write_message(writer, {"id": request_id, "type": "error", "payload": str(exc)})

    async def _handle_run(
        self, request_id: str, message: dict[str, object], writer: asyncio.StreamWriter
    ) -> None:
        job_id = str(message.get("job_id", ""))
        op = str(message.get("op", ""))
        args = message.get("args") or {}
        if not job_id or not op.startswith(("bench.", "ssl.", "ngrok.", "services.", "fm.", "tunnel.", "app.")):
            await write_message(writer, {"id": request_id, "type": "error", "payload": "invalid_job"})
            return
        try:
            async for event in self.executor.run(
                job_id, op, args if isinstance(args, dict) else {}, int(message.get("timeout") or 0) or None
            ):
                await write_message(writer, {"id": request_id, "type": "event", "payload": event})
        except Exception as exc:
            log.exception("job %s falhou", job_id)
            await write_message(
                writer, {"id": request_id, "type": "event", "payload": {"event": "error", "line": str(exc)}}
            )
        await write_message(writer, {"id": request_id, "type": "done", "payload": {"job_id": job_id}})


    async def _handle_shell(
        self,
        request_id: str,
        message: dict[str, object],
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Sessao interativa: o fmx roda apenas aqui, nunca no processo da API."""
        bench = str(message.get("bench", ""))
        try:
            op = self.allowlist.build("bench.shell", {"bench": bench}, timeout=1800)
        except ValidationError as exc:
            await write_message(writer, {"id": request_id, "type": "error", "payload": str(exc)})
            return
        try:
            process = await asyncio.create_subprocess_exec(
                *op.argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(self.settings.fm_home),
                env=self.compat.env({**os.environ, "PYTHONUNBUFFERED": "1"}),
            )
        except OSError as exc:
            await write_message(writer, {"id": request_id, "type": "error", "payload": str(exc)})
            return

        await write_message(
            writer, {"id": request_id, "type": "data", "payload": {"connected": True, "bench": bench}}
        )

        async def pump() -> None:
            assert process.stdout is not None
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                await write_message(
                    writer,
                    {
                        "id": request_id,
                        "type": "event",
                        "payload": {"event": "output", "data": redact(line.decode("utf-8", "replace"))},
                    },
                )
            code = await process.wait()
            await write_message(
                writer,
                {
                    "id": request_id,
                    "type": "event",
                    "payload": {"event": "exit", "exit_code": code},
                },
            )
            await write_message(
                writer, {"id": request_id, "type": "done", "payload": {"bench": bench, "exit_code": code}}
            )

        pump_task = asyncio.create_task(pump())
        try:
            while not pump_task.done():
                incoming_task = asyncio.create_task(read_message(reader))
                done, _pending = await asyncio.wait(
                    {pump_task, incoming_task}, return_when=asyncio.FIRST_COMPLETED
                )
                if pump_task in done:
                    incoming_task.cancel()
                    break
                incoming = incoming_task.result()
                if incoming is None:
                    break
                command = incoming.get("cmd")
                if command == "shell_input" and process.stdin is not None:
                    process.stdin.write(str(incoming.get("data", "")).encode())
                    await process.stdin.drain()
                elif command == "shell_close":
                    break
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=self.settings.job_grace_seconds)
                except TimeoutError:
                    process.kill()
                    await process.wait()
            pump_task.cancel()
            await asyncio.gather(pump_task, return_exceptions=True)


def install_signal_handlers(server: ExecutorServer) -> None:
    if threading.current_thread() is not threading.main_thread():
        return
    loop = asyncio.get_running_loop()

    def stop() -> None:
        asyncio.create_task(server.stop())

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop)
        except NotImplementedError:
            pass


async def run_executor(settings: Settings, *, install_handlers: bool = True) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    server = ExecutorServer(settings)
    # Quando embutido na API, o uvicorn ja possui os handlers de SIGTERM/SIGINT.
    if install_handlers:
        install_signal_handlers(server)
    await server.start()
