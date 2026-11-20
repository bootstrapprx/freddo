"""Leitura de estado: runtime de containers + arquivos do fm (Secao 1.1).

O painel nunca replica o estado de forma autoritativa: cada GET consulta o
runtime detectado (labels Compose, ``<runtime> ps --format json``) e os
arquivos de cada bench. Sem fmx/runtime, as leituras falham em vez de inventar
dados.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from ..config import Settings
from ..executor.allowlist import Allowlist, ValidationError
from ..executor.runner import JobExecutor
from ..runtime import ContainerCompat, compose_project, container_name, label_map, parse_cli_json


class FmAdapter:
    def __init__(
        self,
        settings: Settings,
        executor: JobExecutor | None = None,
        allowlist: Allowlist | None = None,
        compat: ContainerCompat | None = None,
    ):
        self.settings = settings
        self.executor = executor
        self.allowlist = allowlist or Allowlist(settings.fm_bin)
        self.compat = compat or ContainerCompat(settings)

    async def _run(self, argv: list[str], timeout: int = 10) -> str:
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.settings.fm_home),
                env=self.compat.env(),
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            if process.returncode not in (0, None):
                raise RuntimeError(stderr.decode("utf-8", "replace").strip() or f"exit {process.returncode}")
            out = stdout.decode("utf-8", "replace")
            # fmx escreve `--version` na stderr; outras assessoras usam stdout.
            return out or stderr.decode("utf-8", "replace")
        except FileNotFoundError as exc:
            raise RuntimeError(f"binario indisponivel: {argv[0]}") from exc

    @staticmethod
    def _parse_possibly_json(text: str) -> Any:
        text = text.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    async def execute_read(self, op: str, args: dict[str, Any]) -> Any:
        if op == "fm.list":
            return await self.list_benches()
        if op == "fm.info":
            return await self.bench_info(str(args.get("bench", "")))
        if op == "fm.version":
            text = await self._run([self.settings.fm_bin, "--version"])
            return {"version": text.strip()}
        if op == "services.list":
            return await self.services()
        if op == "ssl.status":
            bench = str(args.get("bench", ""))
            info = await self.bench_info(bench)
            return {"bench": bench, "certificates": info.get("certificates", [])}
        raise ValidationError(f"operacao de leitura desconhecida: {op}")

    async def list_benches(self) -> list[dict[str, Any]]:
        compose = await self._compose_ps()
        benches = await self._benches_from_disk()
        for bench in benches:
            bench["services"] = compose.get(bench["name"], bench.get("services", []))
            running = [svc for svc in bench.get("services", []) if svc.get("state") == "running"]
            bench["status"] = "running" if running else "stopped"
        return benches

    async def bench_info(self, name: str) -> dict[str, Any]:
        if not name:
            raise ValidationError("bench obrigatorio")
        allowlist = self.allowlist.build("fm.info", {"bench": name})
        text = await self._run(allowlist.argv)
        parsed = self._parse_possibly_json(text)
        if isinstance(parsed, dict):
            if not parsed.get("sites"):
                parsed["sites"] = _sites_from_disk(self.settings.fm_home / name, parsed.get("domain"))
            parsed["site_ready"] = bool(parsed["sites"])
            return parsed
        return {"bench": name, "sites": [], "site_ready": False, "raw": str(parsed or "")[:8000]}

    async def services(self) -> list[dict[str, Any]]:
        text = await self._run(self.compat.argv("ps", "--format", "json"))
        return [
            {
                "name": container_name(item),
                "state": item.get("State", "unknown"),
                "image": item.get("Image"),
            }
            for item in parse_cli_json(text)
        ]

    async def _compose_ps(self) -> dict[str, list[dict[str, Any]]]:
        """Descobre projetos Compose via `ps` + labels (compose ls nao existe no podman-compose)."""
        text = await self._run(self.compat.argv("ps", "--all", "--format", "json"), timeout=20)
        result: dict[str, list[dict[str, Any]]] = {}
        for item in parse_cli_json(text):
            project = compose_project(label_map(item.get("Labels")))
            if not project:
                continue
            result.setdefault(
                str(project),
                [],
            ).append(
                {
                    "name": container_name(item),
                    "state": str(item.get("State") or item.get("Status") or "").lower(),
                }
            )
        return result

    async def _benches_from_disk(self) -> list[dict[str, Any]]:
        root = self.settings.fm_home
        if not root.exists():
            return []
        benches: list[dict[str, Any]] = []
        for entry in sorted(root.iterdir()):
            if not entry.is_dir():
                continue
            compose = next(
                (entry / name for name in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml") if (entry / name).exists()),
                None,
            )
            if compose is None:
                continue
            try:
                raw = compose.read_text()
            except OSError:
                continue
            labels = _compose_labels(raw)
            config_file = entry / "site_config.json"
            config = {}
            if config_file.exists():
                try:
                    config = json.loads(config_file.read_text())
                except (OSError, json.JSONDecodeError):
                    config = {}
            domain = _compose_label(labels, "frappe.domain") or config.get("domain")
            benches.append(
                {
                    "name": compose_project(labels) or entry.name,
                    "status": "unknown",
                    "version": _compose_label(labels, "frappe.version") or config.get("frappe_version"),
                    "apps": (_compose_label(labels, "frappe.apps") or "").split(",")
                    if _compose_label(labels, "frappe.apps")
                    else [],
                    "domain": domain,
                    "environment": _compose_label(labels, "frappe.environment", "development"),
                    "services": [],
                    "sites": _sites_from_disk(entry, domain),
                    "created_at": int(entry.stat().st_mtime),
                    "path": str(entry),
                }
            )
        return benches


def _sites_from_disk(bench_dir: Path, domain: str | None) -> list[str]:
    """Sites efetivos criados pelo fmx, lidos de `workspace/frappe-bench/sites`."""
    sites_root = bench_dir / "workspace" / "frappe-bench" / "sites"
    sites: list[str] = []
    if sites_root.is_dir():
        for candidate in sorted(sites_root.iterdir()):
            if candidate.is_dir() and (candidate / "site_config.json").is_file():
                sites.append(candidate.name)
    if not sites and domain:
        return [str(domain)]
    return sites


def _compose_label(labels: dict[str, str], key: str, default: str = "") -> str:
    return labels.get(key, default)


def _compose_labels(raw: str) -> dict[str, str]:
    """Extrai labels simples de um compose file sem dependencias externas."""
    labels: dict[str, str] = {}
    in_labels = False
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("labels:"):
            in_labels = True
            inline = stripped[len("labels:") :].strip()
            if inline.startswith("{") and inline.endswith("}"):
                for part in inline[1:-1].split(","):
                    if "=" in part:
                        key, value = part.split("=", 1)
                        labels[key.strip()] = value.strip().strip("\"'")
                in_labels = False
            continue
        if in_labels:
            if not stripped or stripped.startswith("#"):
                continue
            if not line.startswith((" ", "\t")) and not stripped.startswith("-"):
                in_labels = False
                continue
            item = stripped.lstrip("- ").strip()
            if "=" in item:
                key, value = item.split("=", 1)
                labels[key.strip()] = value.strip().strip("\"'")
    return labels
