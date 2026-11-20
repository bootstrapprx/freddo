"""Leituras de estado via Executor, unica fonte autoritativa."""

from __future__ import annotations

from typing import Any

from .state import AppState


async def read(state: AppState, op: str, args: dict[str, Any] | None = None) -> Any:
    return await state.executor.read(op, args or {})
