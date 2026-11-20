"""Servico de auditoria append-only encadeada por hash (S10)."""

from __future__ import annotations

import json
import time
from typing import Any

from .db.state import StateDB
from .security import audit_hash


class AuditService:
    def __init__(self, db: StateDB) -> None:
        self.db = db

    async def record(
        self,
        action: str,
        actor: str = "freddo",
        target: str | None = None,
        detail: dict[str, Any] | None = None,
        ip: str | None = None,
    ) -> int:
        prev = await self.db.last_audit_hash()
        payload = {
            "ts": int(time.time()),
            "actor": actor,
            "action": action,
            "target": target,
            "detail": detail or {},
            "ip": ip,
        }
        entry_hash = audit_hash(prev, payload)
        return await self.db.append_audit(
            actor=actor,
            action=action,
            target=target,
            detail=detail,
            ip=ip,
            prev_hash=prev,
            entry_hash=entry_hash,
        )

    async def verify(self) -> dict[str, Any]:
        async with self.db.connect() as db:
            rows = list(await (await db.execute("SELECT * FROM audit_log ORDER BY id")).fetchall())
        prev = b"\x00" * 32
        for row in rows:
            payload = {
                "ts": row["ts"],
                "actor": row["actor"],
                "action": row["action"],
                "target": row["target"],
                "detail": json.loads(row["detail_json"] or "{}"),
                "ip": row["ip"],
            }
            expected = audit_hash(prev, payload)
            if bytes(row["prev_hash"]) != prev or bytes(row["hash"]) != expected:
                return {"ok": False, "broken_at": row["id"], "entries": len(rows)}
            prev = bytes(row["hash"])
        return {"ok": True, "entries": len(rows)}
