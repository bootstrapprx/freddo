"""Testes da camada de compatibilidade Docker/Podman."""

from __future__ import annotations

from pathlib import Path

import pytest
from freddo_manager.collector.collector import _stats_cpu_percent, _stats_memory_percent
from freddo_manager.config import Settings
from freddo_manager.runtime import ContainerCompat, compose_project, label_map, parse_cli_json, parse_percent


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(home=tmp_path / "state", **overrides)


def test_podman_creates_docker_shim_and_remote_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    podman = tmp_path / "bin" / "podman"
    podman.parent.mkdir()
    podman.touch()
    socket = tmp_path / "podman.sock"
    socket.touch()

    def fake_which(name: str) -> str | None:
        return str(podman) if name == "podman" else None

    monkeypatch.setattr("freddo_manager.runtime.shutil.which", fake_which)
    settings = _settings(tmp_path, container_runtime="podman", podman_socket=socket)
    compat = ContainerCompat(settings)

    assert compat.runtime.kind == "podman"
    assert compat.runtime.cli == "podman"
    assert compat.argv("ps", "--all") == ["podman", "ps", "--all"]
    assert compat.runtime.shim_dir == settings.home / "runtime-bin"
    assert (settings.home / "runtime-bin" / "docker").is_symlink()

    env = compat.env({"PATH": "/usr/bin"})
    assert env["PATH"].startswith(str(settings.home / "runtime-bin"))
    assert env["CONTAINER_HOST"] == f"unix://{socket}"
    assert env["DOCKER_HOST"] == f"unix://{socket}"


def test_auto_prefers_docker_when_socket_is_present(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    docker = tmp_path / "bin" / "docker"
    docker.parent.mkdir()
    docker.touch()
    socket = tmp_path / "docker.sock"
    socket.touch()

    def fake_which(name: str) -> str | None:
        return str(docker) if name == "docker" else None

    monkeypatch.setattr("freddo_manager.runtime.shutil.which", fake_which)
    compat = ContainerCompat(_settings(tmp_path, docker_socket=socket))

    assert compat.runtime.kind == "docker"
    assert compat.runtime.shim_dir is None
    assert "CONTAINER_HOST" not in compat.env({"PATH": "/usr/bin"})


def test_auto_falls_back_to_podman_without_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    podman = tmp_path / "podman"
    podman.touch()

    def fake_which(name: str) -> str | None:
        return str(podman) if name == "podman" else None

    monkeypatch.setattr("freddo_manager.runtime.shutil.which", fake_which)
    settings = _settings(tmp_path, podman_socket=tmp_path / "podman.sock")
    compat = ContainerCompat(settings)

    assert compat.runtime.kind == "podman"
    assert compat.runtime.cli_path == str(podman)
    assert any("socket do podman" in warning for warning in compat.runtime.warnings)


def test_label_and_stats_compatibility() -> None:
    assert compose_project(label_map({"io.podman.compose.project": "producao"})) == "producao"
    assert compose_project(label_map({"com.docker.compose.project": "homologacao"})) == "homologacao"
    assert parse_percent("12.5%") == 12.5
    assert parse_percent(7) == 7.0
    assert _stats_cpu_percent({"AvgCPU": 12.34}) == 12.34
    assert _stats_cpu_percent({"CPUPerc": "4.2%"}) == 4.2
    assert _stats_memory_percent({"MemUsageBytes": 50, "MemLimitBytes": 100}) == 50.0


def test_parse_cli_json_accepts_podman_array_and_docker_lines() -> None:
    assert parse_cli_json('[{"Names": ["db"]}, {"Names": ["web"]}]') == [
        {"Names": ["db"]},
        {"Names": ["web"]},
    ]
    assert parse_cli_json('{"Names": "/db"}\n{"Names": "/web"}') == [
        {"Names": "/db"},
        {"Names": "/web"},
    ]
    assert parse_cli_json("") == []
