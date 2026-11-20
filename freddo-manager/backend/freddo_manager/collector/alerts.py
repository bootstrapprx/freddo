"""Avaliacao de regras de alerta com deduplicacao firing/resolved."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from ..db.state import StateDB
from ..db.telemetry import TelemetryDB

log = logging.getLogger("freddo.alerts")

SELECTOR_RE = re.compile(r"^([a-zA-Z0-9_.-]+)(?:\{(.*)\})?$")

OPS = {
    "gt": lambda value, threshold: value > threshold,
    "gte": lambda value, threshold: value >= threshold,
    "lt": lambda value, threshold: value < threshold,
    "lte": lambda value, threshold: value <= threshold,
    "eq": lambda value, threshold: value == threshold,
}


def parse_selector(selector: str) -> tuple[str, dict[str, str]]:
    match = SELECTOR_RE.match(selector.strip())
    if not match:
        raise ValueError(f"seletor invalido: {selector}")
    metric = match.group(1)
    labels: dict[str, str] = {}
    if match.group(2):
        for part in match.group(2).split(","):
            if "=" in part:
                key, value = part.split("=", 1)
                labels[key.strip()] = value.strip().strip("\"'")
    return metric, labels


class AlertEvaluator:
    def __init__(self, state_db: StateDB, telemetry: TelemetryDB) -> None:
        self.state_db = state_db
        self.telemetry = telemetry

    async def evaluate(self) -> list[dict[str, Any]]:
        changes: list[dict[str, Any]] = []
        for rule in await self.state_db.list_rules(enabled_only=True):
            try:
                metric, labels = parse_selector(rule["series_selector"])
            except ValueError:
                continue
            now = int(__import__("time").time())
            points = await self.telemetry.query(
                metric, labels or None, now - max(rule["for_seconds"], 300), now
            )
            by_series: dict[str, list[float]] = {}
            for point in points:
                key = json.dumps(point["labels"], sort_keys=True)
                by_series.setdefault(key, []).append(float(point["value"]))
            compare = OPS.get(rule["op"], OPS["gt"])
            for series, values in by_series.items():
                if not values:
                    continue
                value = values[-1]
                breached = all(compare(item, rule["threshold"]) for item in values)
                previous = await self.state_db.last_alert_state(rule["id"], series)
                desired = "firing" if breached else "resolved"
                if previous == desired:
                    continue
                await self.state_db.record_alert_event(rule["id"], series, desired, value)
                changes.append(
                    {
                        "rule": rule["name"],
                        "series": series,
                        "state": desired,
                        "value": value,
                        "channel": rule["channel"],
                        "severity": rule["severity"],
                    }
                )
                await self.notify(changes[-1])
        return changes

    async def notify(self, event: dict[str, Any]) -> None:
        channel = event["channel"]
        message = (
            f"[{event['severity'].upper()}] {event['rule']} {event['state']} — "
            f"{event['series']} = {event['value']:.2f}"
        )
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                if channel == "telegram":
                    token = os.environ.get("FREDDO_TELEGRAM_TOKEN")
                    chat = os.environ.get("FREDDO_TELEGRAM_CHAT")
                    if token and chat:
                        await client.post(
                            f"https://api.telegram.org/bot{token}/sendMessage",
                            json={"chat_id": chat, "text": message},
                        )
                elif channel == "email":
                    webhook = os.environ.get("FREDDO_ALERT_WEBHOOK_URL")
                    if webhook:
                        await client.post(webhook, json={"text": message, **event})
                elif channel == "webhook":
                    webhook = os.environ.get("FREDDO_ALERT_WEBHOOK_URL")
                    if webhook:
                        await client.post(webhook, json=event)
        except httpx.HTTPError as exc:
            log.warning("falha ao notificar alerta: %s", exc)
