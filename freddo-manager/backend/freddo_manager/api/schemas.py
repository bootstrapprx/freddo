"""Modelos de request/response da API."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from ..executor.allowlist import BENCH_RE


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)
    totp: str | None = None
    recovery_code: str | None = None


class BootstrapRequest(BaseModel):
    token: str = Field(min_length=20, max_length=128)
    password: str = Field(min_length=12, max_length=1024)


class StepupRequest(BaseModel):
    totp: str | None = None
    password: str | None = None


class BenchName(BaseModel):
    bench: str

    @field_validator("bench")
    @classmethod
    def _valid(cls, value: str) -> str:
        if not BENCH_RE.fullmatch(value):
            raise ValueError("nome de bench invalido")
        return value


class CreateBenchRequest(BaseModel):
    name: str
    version: str = "v15"
    apps: list[str] = Field(default_factory=lambda: ["frappe", "erpnext"])
    template: str | None = None
    environment: str = "development"
    domain: str | None = None
    admin_password: str | None = Field(default=None, min_length=8)
    idempotency_key: str | None = None

    @field_validator("name")
    @classmethod
    def _valid(cls, value: str) -> str:
        if not BENCH_RE.fullmatch(value):
            raise ValueError("nome de bench invalido")
        return value


class ActionRequest(BaseModel):
    action: Literal["start", "stop", "restart", "reset"]
    confirm: str | None = None
    idempotency_key: str | None = None


class UpdateBenchRequest(BaseModel):
    config: dict[str, Any]
    idempotency_key: str | None = None


class SslRequest(BaseModel):
    operation: Literal["issue", "renew"] = "issue"
    domain: str | None = None
    idempotency_key: str | None = None


class NgrokRequest(BaseModel):
    action: Literal["start", "stop"] = "start"
    ttl: int = 3600
    confirm: str | None = None
    idempotency_key: str | None = None


class ServiceActionRequest(BaseModel):
    action: Literal["start", "stop", "restart"]
    service: str
    idempotency_key: str | None = None


class MigrateRequest(BaseModel):
    backup_confirmed: bool = False
    confirm: str | None = None


class SelfUpdateRequest(BaseModel):
    backup_confirmed: bool = False
    confirm: str | None = None


class TemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    spec: dict[str, Any]


class DeploymentDomainsRequest(BaseModel):
    domains: list[str] = Field(min_length=1, max_length=20)

    @field_validator("domains")
    @classmethod
    def _valid_domains(cls, values: list[str]) -> list[str]:
        from ..executor.allowlist import DOMAIN_RE

        domains = [value.strip().lower().rstrip(".") for value in values]
        if any(not DOMAIN_RE.fullmatch(value) for value in domains):
            raise ValueError("dominios base invalidos")
        if len(set(domains)) != len(domains):
            raise ValueError("dominios duplicados")
        return domains


class TunnelTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4096)

    @field_validator("token")
    @classmethod
    def _valid_token(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9+/_.=-]+", value):
            raise ValueError("token deve ser uma unica linha valida")
        return value


class CreateSiteRequest(BaseModel):
    label: str = Field(min_length=1, max_length=63)
    base_domain: str
    version: str = "v15"
    apps: list[str] = Field(default_factory=lambda: ["erpnext"], min_length=1)
    environment: Literal["development", "staging", "production"] = "production"
    idempotency_key: str | None = None

    @field_validator("label")
    @classmethod
    def _valid_label(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", value):
            raise ValueError("label de site invalido")
        return value

    @field_validator("base_domain")
    @classmethod
    def _valid_base_domain(cls, value: str) -> str:
        from ..executor.allowlist import DOMAIN_RE

        value = value.strip().lower().rstrip(".")
        if not DOMAIN_RE.fullmatch(value):
            raise ValueError("dominio base invalido")
        return value


class AlertRuleRequest(BaseModel):
    name: str
    series_selector: str
    op: Literal["gt", "gte", "lt", "lte", "eq"] = "gt"
    threshold: float
    for_seconds: int = Field(default=600, ge=0)
    channel: str = "webhook"
    severity: Literal["info", "warning", "critical"] = "warning"
    enabled: bool = True


class JobResponse(BaseModel):
    id: str
    kind: str
    bench: str | None
    state: str
    created_at: int
    started_at: int | None = None
    finished_at: int | None = None
    exit_code: int | None = None
    error: str | None = None
    created_now: bool = True
    admin_password: str | None = None


def job_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "bench": row["bench"],
        "state": row["state"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "exit_code": row["exit_code"],
        "error": row["error"],
    }
