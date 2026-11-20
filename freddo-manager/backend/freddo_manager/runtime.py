"""Compatibilidade de runtime de containers (Docker ou Podman).

O Frappe-Manager chama literalmente ``docker`` (inclusive ``docker compose``) e
verifica a existencia do grupo ``docker``. Em hosts Podman isso quebra mesmo com
o CLI instalado. Esta camada:

* detecta o runtime (``auto``, ``docker`` ou ``podman``);
* cria um shim ``docker -> podman`` em ``FREDDO_HOME/runtime-bin`` e o injeta no
  PATH dos subprocessos do Executor;
* exporta ``CONTAINER_HOST``/``DOCKER_HOST`` para o socket do Podman, fazendo o
  ``docker version --format json`` do fm enxergar a secao ``Server`` e nao
  exigir o grupo ``docker``;
* fornece o prefixo de argv usado pelas leituras de estado e telemetria.

Nenhuma chamada usa shell: o shim e um symlink e os argv permanecem listas.
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Settings

CONTAINER_LABEL_KEYS = (
    "com.docker.compose.project",
    "io.podman.compose.project",
    "io.podman.compose.service",
)


def label_map(value: Any) -> dict[str, str]:
    """Normaliza o campo Labels de `docker/ps` e `podman/ps`."""
    if isinstance(value, dict):
        return {str(key): str(val) for key, val in value.items()}
    if isinstance(value, str):
        labels: dict[str, str] = {}
        for part in value.split(","):
            if "=" in part:
                key, label_value = part.split("=", 1)
                labels[key.strip()] = label_value.strip()
        return labels
    return {}


def compose_project(labels: dict[str, str]) -> str | None:
    for key in CONTAINER_LABEL_KEYS[:2]:
        if labels.get(key):
            return str(labels[key])
    return None


def container_name(item: dict[str, Any]) -> str:
    names = item.get("Names") or item.get("Name") or item.get("names") or ""
    if isinstance(names, list):
        names = names[0] if names else ""
    return str(names).split(",")[0].strip().lstrip("/")


def parse_cli_json(text: str) -> list[dict[str, Any]]:
    """Aceita tanto o array do Podman quanto o JSON Lines do Docker."""
    output = text.strip()
    if not output:
        return []
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return [json.loads(line) for line in output.splitlines() if line.strip()]
    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    return [parsed] if isinstance(parsed, dict) else []


def container_id(item: dict[str, Any]) -> str:
    return str(item.get("ID") or item.get("Id") or item.get("id") or "")


def parse_percent(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip().rstrip("%"))
    except (TypeError, ValueError):
        return 0.0


def _socket_from_env(value: str | None) -> Path | None:
    if not value:
        return None
    value = value.removeprefix("unix://")
    if not value:
        return None
    return Path(value).expanduser()


def _podman_socket(settings: Settings) -> Path | None:
    if settings.podman_socket is not None:
        return settings.podman_socket.expanduser()

    candidates: list[Path | None] = [
        _socket_from_env(os.environ.get("CONTAINER_HOST")),
        _socket_from_env(os.environ.get("DOCKER_HOST")),
    ]
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        candidates.append(Path(xdg) / "podman" / "podman.sock")
    candidates.extend(
        [
            Path(f"/run/user/{os.getuid()}/podman/podman.sock"),
            Path("/run/podman/podman.sock"),
        ]
    )
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    return next((candidate for candidate in candidates if candidate), None)


@dataclass
class ContainerRuntime:
    kind: str
    cli: str
    cli_path: str | None
    socket: Path | None
    warnings: list[str] = field(default_factory=list)
    shim_dir: Path | None = None

    @property
    def available(self) -> bool:
        return bool(self.cli_path)

    def public_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "cli": self.cli,
            "available": self.available,
            "cli_path": self.cli_path,
            "socket": str(self.socket) if self.socket else None,
            "socket_ready": bool(self.socket and self.socket.exists()),
            "shim_dir": str(self.shim_dir) if self.shim_dir else None,
            "warnings": list(self.warnings),
        }


def detect_container_runtime(settings: Settings) -> ContainerRuntime:
    """Resolve o runtime sem exigir servico ativo (seguro no arranque da API)."""
    choice = (settings.container_runtime or "auto").lower()
    docker_path = shutil.which("docker")
    podman_path = shutil.which("podman")
    docker_socket = settings.docker_socket.expanduser()
    podman_socket = _podman_socket(settings)
    warnings: list[str] = []

    if choice == "podman":
        kind, cli, cli_path, socket = "podman", "podman", podman_path, podman_socket
        if not podman_path:
            warnings.append("podman nao encontrado no PATH")
        if not socket or not socket.exists():
            warnings.append(f"socket do podman indisponivel: {socket or 'nao configurado'}")
    elif choice == "docker":
        kind, cli, cli_path, socket = "docker", "docker", docker_path, docker_socket
        if not docker_path:
            warnings.append("docker nao encontrado no PATH")
        if not socket.exists():
            warnings.append(f"socket do docker indisponivel: {socket}")
    elif choice == "auto":
        if docker_path and docker_socket.exists():
            kind, cli, cli_path, socket = "docker", "docker", docker_path, docker_socket
        elif podman_path:
            kind, cli, cli_path, socket = "podman", "podman", podman_path, podman_socket
            if not socket or not socket.exists():
                warnings.append(f"socket do podman indisponivel: {socket or 'nao configurado'}")
        elif docker_path:
            kind, cli, cli_path, socket = "docker", "docker", docker_path, docker_socket
            warnings.append(f"socket do docker indisponivel: {socket}")
        else:
            kind, cli, cli_path, socket = "docker", "docker", None, docker_socket
            warnings.append("nem docker nem podman encontrados no PATH")
    else:  # validado pelo Pydantic; defesa em profundidade
        raise ValueError(f"container_runtime invalido: {choice}")

    return ContainerRuntime(
        kind=kind,
        cli=cli,
        cli_path=cli_path,
        socket=socket,
        warnings=warnings,
    )


class ContainerCompat:
    """Estado reutilizavel do runtime: shim, argv e ambiente dos subprocessos."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = detect_container_runtime(settings)
        self.runtime.shim_dir = (
            self._ensure_shim() if self.runtime.kind == "podman" and self.runtime.cli_path else None
        )
        if self.runtime.shim_dir is None and self.runtime.kind == "podman":
            self.runtime.warnings.append("shim docker->podman nao criado; fmx pode nao encontrar docker")

    def _link(self, name: str, target: Path) -> bool:
        link = self.settings.home / "runtime-bin" / name
        if link.is_symlink() or link.exists():
            try:
                if link.is_symlink() and link.resolve() == target:
                    return True
                link.unlink()
            except OSError:
                return False
        try:
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(target)
            return True
        except OSError:
            return False

    def _ensure_shim(self) -> Path | None:
        assert self.runtime.cli_path is not None
        shim_dir = self.settings.home / "runtime-bin"
        if not self._link("docker", Path(self.runtime.cli_path).resolve()):
            return None
        compose = shutil.which("podman-compose")
        if compose:
            self._link("docker-compose", Path(compose).resolve())
        return shim_dir

    def argv(self, *parts: str) -> list[str]:
        return [self.runtime.cli, *parts]

    def env(self, base: dict[str, str] | None = None) -> dict[str, str]:
        env = dict(base if base is not None else os.environ)
        # fmx 0.20 usa FRAPPE_MANAGER_HOME para localizar a raiz dos benches.
        env["FRAPPE_MANAGER_HOME"] = str(self.settings.fm_home)
        if self.runtime.kind != "podman":
            return env
        if self.runtime.socket is not None:
            uri = f"unix://{self.runtime.socket}"
            env["CONTAINER_HOST"] = uri
            env["DOCKER_HOST"] = uri
        if self.runtime.shim_dir is not None:
            env["PATH"] = f"{self.runtime.shim_dir}{os.pathsep}{env.get('PATH', '')}"
        return env

    def public_dict(self) -> dict[str, Any]:
        return self.runtime.public_dict()
