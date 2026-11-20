"""Terminal interativa executada somente dentro do Executor."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from freddo_manager.config import Settings
from freddo_manager.executor.allowlist import Allowlist, ValidationError
from freddo_manager.executor.client import ExecutorClient
from freddo_manager.executor.server import ExecutorServer


def test_shell_op_is_allowlisted_without_shell_metacharacters() -> None:
    op = Allowlist("fmx").build("bench.shell", {"bench": "cliente.exemplo.com"})
    assert op.argv == ["fmx", "-n", "shell", "cliente.exemplo.com"]
    with pytest.raises(ValidationError):
        Allowlist("fmx").build("bench.shell", {"bench": "ruim;id"})


def test_peer_gid_must_match_configuration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(home=tmp_path / "state", executor_uid=1000, executor_gid=2000)
    server = ExecutorServer(settings)
    monkeypatch.setattr("freddo_manager.executor.server.peer_credentials", lambda _sock: (1000, 2000))

    class Writer:
        def get_extra_info(self, _name: str) -> object:
            return object()

    assert server._authorized(None, Writer())  # type: ignore[arg-type]
    monkeypatch.setattr("freddo_manager.executor.server.peer_credentials", lambda _sock: (1000, 9999))
    assert not server._authorized(None, Writer())  # type: ignore[arg-type]


async def test_shell_streams_input_output_through_executor(tmp_path: Path) -> None:
    fake_fmx = tmp_path / "fake-fmx"
    fake_fmx.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "print('ready', flush=True)\n"
        "for line in sys.stdin:\n"
        "    print('echo:' + line.strip(), flush=True)\n"
    )
    fake_fmx.chmod(0o755)
    settings = Settings(
        home=tmp_path / "state",
        fm_home=tmp_path / "frappe",
        fm_bin=str(fake_fmx),
        executor_uid=os.getuid(),
        executor_gid=os.getgid(),
    )
    settings.fm_home.mkdir(parents=True, exist_ok=True)
    server = ExecutorServer(settings)
    task = asyncio.create_task(server.start())
    try:
        for _ in range(100):
            if settings.executor_socket.exists():
                break
            await asyncio.sleep(0.01)
        assert settings.executor_socket.exists()

        client = ExecutorClient(settings.executor_socket)
        session = await client.shell("cliente.exemplo.com")
        events = session.events().__aiter__()
        try:
            connected = await asyncio.wait_for(anext(events), timeout=5)
            assert connected["connected"] is True
            ready = await asyncio.wait_for(anext(events), timeout=5)
            assert ready["data"].strip() == "ready"
            await session.send("ping\n")
            echoed = await asyncio.wait_for(anext(events), timeout=5)
            assert echoed["data"].strip() == "echo:ping"
        finally:
            await session.close()
    finally:
        await server.stop()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
