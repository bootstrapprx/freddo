"""Regras e eventos de alertas."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..deps import StateDep, require_auth, verify_csrf
from ..schemas import AlertRuleRequest

router = APIRouter(prefix="/alerts", tags=["alerts"], dependencies=[Depends(require_auth)])


def _rule_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "series_selector": row["series_selector"],
        "op": row["op"],
        "threshold": row["threshold"],
        "for_seconds": row["for_seconds"],
        "channel": row["channel"],
        "severity": row["severity"],
        "enabled": bool(row["enabled"]),
    }


@router.get("/rules")
async def list_rules(state: StateDep) -> list[dict]:
    return [_rule_dict(row) for row in await state.db.list_rules()]


@router.post("/rules", status_code=201, dependencies=[Depends(verify_csrf)])
async def create_rule(payload: AlertRuleRequest, state: StateDep) -> dict:
    rule_id = await state.db.save_rule(payload.model_dump())
    await state.audit.record("alert_rule.create", target=str(rule_id), detail=payload.model_dump())
    return {**payload.model_dump(), "id": rule_id}


@router.put("/rules/{rule_id}", dependencies=[Depends(verify_csrf)])
async def update_rule(rule_id: int, payload: AlertRuleRequest, state: StateDep) -> dict:
    if not await state.db.get_rule(rule_id):
        raise HTTPException(status_code=404, detail="rule_not_found")
    await state.db.save_rule(payload.model_dump(), rule_id)
    await state.audit.record("alert_rule.update", target=str(rule_id), detail=payload.model_dump())
    return {**payload.model_dump(), "id": rule_id}


@router.delete("/rules/{rule_id}", dependencies=[Depends(verify_csrf)])
async def delete_rule(rule_id: int, state: StateDep) -> dict:
    if not await state.db.delete_rule(rule_id):
        raise HTTPException(status_code=404, detail="rule_not_found")
    await state.audit.record("alert_rule.delete", target=str(rule_id))
    return {"deleted": True}


@router.get("/events")
async def list_events(state: StateDep, limit: int = 100) -> list[dict]:
    return [
        {
            "id": row["id"],
            "rule_id": row["rule_id"],
            "series": row["series"],
            "state": row["state"],
            "ts": row["ts"],
            "value": row["value"],
        }
        for row in await state.db.list_alert_events(limit)
    ]
