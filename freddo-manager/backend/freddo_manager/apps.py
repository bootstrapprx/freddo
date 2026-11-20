"""Catalogo persistido de apps e releases Frappe."""

from __future__ import annotations

import ipaddress
import re
from typing import Any
from urllib.parse import urlsplit

from .db.state import StateDB

APP_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
APP_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
FRAMEWORK_VERSIONS = {"v14", "v15", "v16", "develop"}
SCP_GIT_URL_RE = re.compile(r"^git@([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+)$")


def _validate_host(host: str) -> None:
    host = host.lower()
    if host in {"localhost", "metadata.google.internal"} or host.endswith((".localhost", ".local")):
        raise ValueError("repositorio local nao permitido")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ValueError("IP local ou reservado nao permitido")
    if not address and ("." not in host or all(part.isdigit() for part in host.split("."))):
        raise ValueError("host do repositorio invalido")


def validate_app_name(value: str) -> str:
    value = value.strip().lower()
    if not APP_NAME_RE.fullmatch(value):
        raise ValueError("nome deve ser um identificador Python")
    return value


def validate_app_ref(value: str) -> str:
    value = value.strip()
    if not APP_REF_RE.fullmatch(value) or ".." in value or "//" in value or value.endswith("/"):
        raise ValueError("branch/tag invalido")
    return value


def validate_repository_url(value: str) -> str:
    value = value.strip()
    scp_match = SCP_GIT_URL_RE.fullmatch(value)
    if scp_match:
        host, path = scp_match.groups()
        _validate_host(host)
        if not path.endswith(".git") or ".." in path.split("/"):
            raise ValueError("URL SSH do repositorio invalida")
        return f"git@{host.lower()}:{path}"
    parts = urlsplit(value)
    if parts.scheme not in {"https", "ssh"} or not parts.hostname or parts.password:
        raise ValueError("URL deve usar HTTPS ou SSH, sem credenciais embutidas")
    if parts.query or parts.fragment:
        raise ValueError("URL nao pode conter token, query ou fragmento")
    if (parts.scheme == "https" and parts.username) or (parts.scheme == "ssh" and parts.username not in {None, "git"}):
        raise ValueError("URL nao pode conter credenciais embutidas")
    host = parts.hostname.lower()
    _validate_host(host)
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError("porta da URL invalida") from exc
    if port not in ({None, 443} if parts.scheme == "https" else {None, 22}):
        raise ValueError("porta da URL nao permitida")
    if not parts.path.endswith(".git") or ".." in parts.path.split("/"):
        raise ValueError("URL deve apontar para um repositorio Git")
    return value


class AppRegistry:
    def __init__(self, db: StateDB) -> None:
        self.db = db

    async def list_apps(self, include_archived: bool = False) -> list[dict[str, Any]]:
        return await self.db.list_managed_apps(include_archived)

    async def get_app(self, name: str) -> dict[str, Any] | None:
        return await self.db.get_managed_app(validate_app_name(name))

    async def get_release(self, app: str, frappe_version: str) -> dict[str, Any] | None:
        if frappe_version not in FRAMEWORK_VERSIONS:
            raise ValueError("versao Frappe nao suportada")
        return await self.db.get_managed_release(validate_app_name(app), frappe_version)

    async def save_app(
        self, name: str, title: str, repository_url: str, enabled: bool = True
    ) -> None:
        await self.db.save_managed_app(
            validate_app_name(name), title.strip(), validate_repository_url(repository_url), enabled
        )

    async def save_release(self, app: str, frappe_version: str, ref: str) -> None:
        if frappe_version not in FRAMEWORK_VERSIONS:
            raise ValueError("versao Frappe nao suportada")
        await self.db.save_managed_release(
            validate_app_name(app), frappe_version, validate_app_ref(ref)
        )

    async def archive_app(self, name: str) -> bool:
        return await self.db.archive_managed_app(validate_app_name(name))

    async def record_validation(
        self,
        app: str,
        frappe_version: str,
        expected_url: str,
        expected_ref: str,
        state: str,
        commit: str | None,
        error: str | None,
    ) -> bool:
        if state not in {"passed", "failed"}:
            raise ValueError("validation state invalido")
        return await self.db.record_app_validation(
            validate_app_name(app), frappe_version, expected_url, expected_ref, state, commit, error
        )

    async def record_test_result(
        self,
        app: str,
        frappe_version: str,
        expected_url: str,
        expected_ref: str,
        commit: str,
        state: str,
        job_id: str,
        summary: str | None,
    ) -> bool:
        if state not in {"running", "passed", "failed"}:
            raise ValueError("test state invalido")
        return await self.db.record_app_test_result(
            validate_app_name(app), frappe_version, expected_url, expected_ref, commit, state, job_id, summary
        )
