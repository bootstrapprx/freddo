"""Configuracao central do freddo-manager.

Todas as opcoes podem ser sobrescritas por variaveis de ambiente com o prefixo
``FREDDO_`` (ex.: ``FREDDO_STATE_DB``). Os caminhos padrao ficam sob
``FREDDO_HOME`` (``~/.local/state/freddo-manager`` por padrao).
"""

from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("freddo.config")

CONFIG_FILENAME = "config.json"


def _default_home() -> Path:
    return Path(os.environ.get("FREDDO_HOME", Path.home() / ".local/state/freddo-manager"))


def config_path(home: Path) -> Path:
    return home.expanduser() / CONFIG_FILENAME


def load_fm_home(home: Path) -> Path | None:
    """Le o FM_HOME persistido no bootstrap/configure, se houver."""
    path = config_path(home)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log.warning("configuracao invalida em %s; ignoring", path)
        return None
    value = data.get("fm_home") if isinstance(data, dict) else None
    if not isinstance(value, str) or not value.strip():
        return None
    return Path(value).expanduser()


def save_fm_home(home: Path, fm_home: Path) -> Path:
    """Persiste o FM_HOME escolhido pelo usuario de forma atomica."""
    target = config_path(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    resolved = Path(fm_home).expanduser()
    try:
        resolved = resolved.resolve()
    except OSError:
        pass
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(json.dumps({"fm_home": str(resolved)}, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(target)
    return resolved


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FREDDO_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    home: Path = Field(default_factory=_default_home)
    state_db: Path | None = None
    telemetry_db: Path | None = None
    executor_socket: Path | None = None
    fm_home: Path = Field(default_factory=lambda: Path.home() / "frappe")
    fm_bin: str = "fmx"  # 'fm' esta deprecado no Frappe-Manager >= 0.20
    container_runtime: Literal["auto", "docker", "podman"] = "auto"
    docker_socket: Path = Path("/var/run/docker.sock")
    podman_socket: Path | None = None

    # API (escuta apenas em loopback; acesso externo via Cloudflare Tunnel/Access)
    api_host: str = "127.0.0.1"
    api_port: int = 8710
    public_origin: str = "http://localhost:5173"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    web_dist: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "web" / "dist")

    # Seguranca
    secret_key_file: Path | None = None
    session_idle_minutes: int = 30
    session_absolute_hours: int = 12
    stepup_minutes: int = 5
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    cloudflare_access_team: str | None = None
    cloudflare_access_aud: str | None = None
    require_cloudflare_jwt: bool = False

    # Cloudflare Tunnel (modo remote-managed via API token)
    cloudflare_api_token: str | None = None
    cloudflare_account_id: str | None = None
    cloudflare_tunnel_name: str = "freddo-manager"
    cloudflare_origin: str = "http://127.0.0.1:8710"

    # Execucao
    embed_executor: bool = True  # desenvolvimento: sobe o executor junto com a API
    executor_uid: int | None = None
    executor_gid: int | None = None
    job_output_limit_bytes: int = 5 * 1024 * 1024
    job_grace_seconds: int = 5
    job_timeouts: dict[str, int] = Field(
        default_factory=lambda: {
            "bench.create": 3600,
            "bench.delete": 900,
            "bench.start": 300,
            "bench.stop": 300,
            "bench.restart": 600,
            "bench.reset": 1800,
            "bench.update": 1800,
            "ssl.issue": 600,
            "ssl.renew": 600,
            "ngrok.start": 300,
            "ngrok.stop": 120,
            "services.action": 600,
            "fm.migrate": 1800,
            "fm.self.update": 900,
        }
    )

    # Telemetria
    collect_interval_seconds: int = 15
    health_interval_seconds: int = 30
    tls_interval_hours: int = 6
    storage_interval_hours: int = 1
    raw_retention_hours: int = 48
    rollup5m_retention_days: int = 30
    rollup1h_retention_days: int = 400
    enable_shell: bool = False

    @field_validator("cloudflare_origin")
    @classmethod
    def _valid_origin(cls, value: str) -> str:
        value = value.rstrip("/")
        if not re.fullmatch(r"https?://(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}", value):
            raise ValueError("cloudflare_origin deve ser http://127.0.0.1:<porta> (origem loopback)")
        return value

    @field_validator(
        "home",
        "state_db",
        "telemetry_db",
        "executor_socket",
        "secret_key_file",
        "web_dist",
        "fm_home",
        "docker_socket",
        "podman_socket",
        mode="before",
    )
    @classmethod
    def _expand_path(cls, value: object) -> object:
        if isinstance(value, str):
            return Path(value).expanduser()
        return value

    def model_post_init(self, __context: object) -> None:
        self.home = self.home.expanduser()
        # Variavel de ambiente, .env e CLI tem precedencia sobre o arquivo salvo.
        if "fm_home" not in self.model_fields_set:
            saved = load_fm_home(self.home)
            if saved is not None:
                self.fm_home = saved
        self.state_db = self.state_db or self.home / "state.db"
        self.telemetry_db = self.telemetry_db or self.home / "telemetria.db"
        self.executor_socket = self.executor_socket or self.home / "executor.sock"
        self.secret_key_file = self.secret_key_file or self.home / "secret.key"
        for path in (self.home, self.state_db.parent, self.telemetry_db.parent, self.executor_socket.parent):
            path.mkdir(parents=True, exist_ok=True)

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.state_db}"

    @property
    def telemetry_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.telemetry_db}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
