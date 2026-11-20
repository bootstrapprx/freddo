"""Modelos de request/response da API."""

from __future__ import annotations

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
