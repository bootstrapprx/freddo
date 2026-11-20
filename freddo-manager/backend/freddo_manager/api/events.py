"""Barramento de eventos em memoria para SSE.

A persistencia e a fonte da verdade dos eventos e o banco; o barramento apenas
entrega eventos novos aos clientes conectados. Reconexcao usa Last-Event-ID.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, topic: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        async with self._lock:
            self._subscribers[topic].add(queue)
        return queue

    async def unsubscribe(self, topic: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers[topic].discard(queue)

    async def publish(self, topic: str, event: dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers[topic])
        for queue in subscribers:
            if queue.full():
                continue
            queue.put_nowait(event)

    @staticmethod
    def sse(event: dict[str, Any], topic: str) -> str:
        event_name = event.get("event", "message")
        seq = event.get("seq")
        lines = [f"event: {event_name}"]
        if seq is not None:
            lines.append(f"id: {seq}")
        lines.append("data: " + json.dumps(event, separators=(",", ":"), default=str))
        return "\n".join(lines) + "\n\n"


event_bus = EventBus()
