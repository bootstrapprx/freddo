"""Consulta e verificacao de integridade do audit log."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query

from ..deps import StateDep, require_auth

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(require_auth)])


def _audit_dict(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "ts": row["ts"],
        "actor": row["actor"],
        "action": row["action"],
        "target": row["target"],
        "detail": json.loads(row["detail_json"] or "{}"),
        "ip": row["ip"],
    }


@router.get("")
async def list_audit(state: StateDep, limit: int = Query(default=100, le=1000)) -> list[dict]:
    return [_audit_dict(row) for row in await state.db.list_audit(limit)]


@router.get("/verify")
async def verify_audit(state: StateDep) -> dict:
    return await state.audit.verify()
