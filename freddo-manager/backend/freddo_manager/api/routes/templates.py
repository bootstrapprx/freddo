"""Templates de bench (reprodutibilidade)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from ..deps import StateDep, require_auth, verify_csrf
from ..schemas import TemplateRequest

router = APIRouter(prefix="/templates", tags=["templates"], dependencies=[Depends(require_auth)])


def _template_dict(row) -> dict:
    return {"name": row["name"], "spec": json.loads(row["spec_json"]), "updated_at": row["updated_at"]}


@router.get("")
async def list_templates(state: StateDep) -> list[dict]:
    return [_template_dict(row) for row in await state.db.list_templates()]


@router.get("/{name}")
async def get_template(name: str, state: StateDep) -> dict:
    row = await state.db.get_template(name)
    if not row:
        raise HTTPException(status_code=404, detail="template_not_found")
    return _template_dict(row)


@router.post("", status_code=201, dependencies=[Depends(verify_csrf)])
async def save_template(payload: TemplateRequest, state: StateDep) -> dict:
    await state.db.save_template(payload.name, payload.spec)
    await state.audit.record("template.save", target=payload.name, detail=payload.spec)
    return {"name": payload.name, "spec": payload.spec}


@router.delete("/{name}", dependencies=[Depends(verify_csrf)])
async def delete_template(name: str, state: StateDep) -> dict:
    if not await state.db.delete_template(name):
        raise HTTPException(status_code=404, detail="template_not_found")
    await state.audit.record("template.delete", target=name)
    return {"deleted": True}
