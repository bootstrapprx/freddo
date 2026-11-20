"""Protocolo JSON em linhas sobre Unix socket.

Requests:  {"id","cmd":"read"|"run"|"cancel"|"ping"|"stats","op","args","job_id"}
Responses: {"id","type":"data"|"event"|"error"|"done","payload"}
"""

from __future__ import annotations

import asyncio
import json
from typing import Any


async def write_message(writer: asyncio.StreamWriter, message: dict[str, Any]) -> None:
    writer.write((json.dumps(message, separators=(",", ":"), default=str) + "\n").encode())
    await writer.drain()


async def read_message(reader: asyncio.StreamReader) -> dict[str, Any] | None:
    line = await reader.readline()
    if not line:
        return None
    return json.loads(line.decode())
