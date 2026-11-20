"""Allowlist de operacoes e construcao de argv (S6).

Nenhum argumento passa por shell. O nome do bench e validado por regex, apps e
versoes contra o catalogo, e cada operacao mapeia para um template de argv. A
tabela pode ser sobrescrita por ``FREDDO_ARGV_MAP`` (JSON) apos o spike M0.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BENCH_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
SERVICE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

DEFAULT_CATALOG: dict[str, Any] = {
    "versions": ["v15", "v15.1", "v14", "version-15", "version-14", "develop"],
    "apps": [
        "frappe",
        "erpnext",
        "hrms",
        "frappe_dashboard",
        "insights",
        "press",
        "frappe-ui",
    ],
}

# Operacoes de leitura nao entram na fila; todas as demais sao jobs.
READ_OPS = {"fm.list", "fm.info", "ssl.status", "services.list", "fm.version"}

DESTRUCTIVE_OPS = {
    "bench.delete",
    "bench.reset",
    "ngrok.start",
    "fm.migrate",
    "fm.self.update",
}

GLOBAL_OPS = {"services.start", "services.stop", "services.restart", "fm.migrate", "fm.self.update"}

# Sintaxe real do Frappe-Manager 0.20 (entrypoint fmx, flag global -n).
# Mapeamentos podem ser ajustados apos o spike M0 via FREDDO_ARGV_MAP.
DEFAULT_ARGV_MAP: dict[str, list[str]] = {
    "fm.list": ["{fm}", "-n", "list"],
    "fm.info": ["{fm}", "-n", "info", "{bench}"],
    "fm.version": ["{fm}", "--version"],
    "bench.create": ["{fm}", "-n", "create", "{bench}", "--environment", "{environment}", "{apps}"],
    "bench.delete": ["{fm}", "-n", "delete", "{bench}", "--yes"],
    "bench.start": ["{fm}", "-n", "start", "{bench}"],
    "bench.stop": ["{fm}", "-n", "stop", "{bench}"],
    "bench.restart": ["{fm}", "-n", "restart", "{bench}"],
    "bench.reset": ["{fm}", "-n", "reset", "{bench}"],
    "bench.update": ["{fm}", "-n", "update", "{bench}", "--environment", "{environment}"],
    "bench.logs": ["{fm}", "-n", "logs", "{bench}", "--service", "{service}", "--follow"],
    "ssl.status": ["{fm}", "-n", "ssl", "list"],
    "ssl.issue": ["{fm}", "-n", "ssl", "add", "{bench}"],
    "ssl.renew": ["{fm}", "-n", "ssl", "renew", "{bench}"],
    "ngrok.start": ["{fm}", "-n", "ngrok", "{bench}"],
    "ngrok.stop": ["{fm}", "-n", "ngrok", "{bench}"],
    "services.list": ["{fm}", "-n", "services", "list"],
    "services.start": ["{fm}", "-n", "services", "start", "{service}"],
    "services.stop": ["{fm}", "-n", "services", "stop", "{service}"],
    "services.restart": ["{fm}", "-n", "services", "restart", "{service}"],
    "fm.migrate": ["{fm}", "-n", "migrate", "--auto-proceed"],
    "fm.self.update": ["{fm}", "-n", "self", "update", "--yes"],
}


class ValidationError(ValueError):
    pass


@dataclass
class Operation:
    name: str
    argv: list[str]
    bench: str | None = None
    read: bool = False
    timeout: int = 600
    destructive: bool = False
    global_lock: bool = False
    tags: dict[str, str] = field(default_factory=dict)


class Allowlist:
    def __init__(self, fm_bin: str = "fm", catalog_path: Path | None = None) -> None:
        self.fm_bin = fm_bin
        self.catalog = self._load_catalog(catalog_path)
        override = os.environ.get("FREDDO_ARGV_MAP")
        self.argv_map = json.loads(Path(override).read_text()) if override else dict(DEFAULT_ARGV_MAP)

    @staticmethod
    def _load_catalog(path: Path | None) -> dict[str, Any]:
        candidate = path
        env_path = os.environ.get("FREDDO_CATALOG")
        if candidate is None and env_path:
            candidate = Path(env_path)
        if candidate is not None and candidate.is_file():
            data = json.loads(candidate.read_text())
            return {**DEFAULT_CATALOG, **data}
        return dict(DEFAULT_CATALOG)

    def is_allowed(self, op: str) -> bool:
        return op in self.argv_map

    def build(self, op: str, args: dict[str, Any] | None = None, timeout: int = 600) -> Operation:
        args = dict(args or {})
        if op not in self.argv_map:
            raise ValidationError(f"operacao nao permitida: {op}")
        bench = args.get("bench")
        if bench is not None:
            if not isinstance(bench, str) or not BENCH_RE.fullmatch(bench):
                raise ValidationError("nome de bench invalido")
        app_list: list[str] = []
        if op == "bench.create":
            version = args.get("version", "v15")
            apps = args.get("apps", ["frappe", "erpnext"])
            if version not in self.catalog["versions"]:
                raise ValidationError(f"versao nao permitida: {version}")
            if not isinstance(apps, list) or not apps or any(a not in self.catalog["apps"] for a in apps):
                raise ValidationError("apps nao permitidos")
            if "frappe" not in apps:
                apps = ["frappe", *apps]
            app_list = list(apps)
            environment = "prod" if str(args.get("environment", "development")).lower() in ("production", "prod") else "dev"
            args = {**args, "version": version, "environment": environment}
        if op == "bench.update":
            config = args.get("config", {})
            if not isinstance(config, dict):
                raise ValidationError("config deve ser um objeto")
            allowed_keys = {"apps", "version", "environment", "domain", "developer_mode"}
            if set(config) - allowed_keys:
                raise ValidationError("campos de config nao permitidos")
            environment = "prod" if str(config.get("environment", "development")).lower() in ("production", "prod") else "dev"
            args = {**args, "environment": environment}
        if op == "ssl.issue":
            domain = args.get("domain", "")
            if not re.fullmatch(r"(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+", str(domain)):
                raise ValidationError("dominio invalido")
        ttl: int | None = None
        if op == "ngrok.start":
            ttl = int(args.get("ttl", 3600))
            if ttl < 60 or ttl > 86400:
                raise ValidationError("ttl deve estar entre 60 e 86400 segundos")
            args = {**args, "ttl": ttl}
        if op == "bench.logs":
            service = args.get("service", "all")
            if not SERVICE_RE.fullmatch(str(service)) and service != "all":
                raise ValidationError("servico invalido")
            args = {**args, "service": service}
        if op.startswith("services.") and "service" in args:
            if not SERVICE_RE.fullmatch(str(args["service"])):
                raise ValidationError("servico invalido")
        if op in DESTRUCTIVE_OPS:
            expected = bench if bench is not None else "system"
            if args.get("confirm") != expected:
                raise ValidationError("confirmacao por nome obrigatoria")

        placeholders = set(re.findall(r"\{(\w+)\}", " ".join(self.argv_map[op])))
        vars_: dict[str, str] = {"fm": self.fm_bin, **{k: str(v) for k, v in args.items()}}
        missing = placeholders - set(vars_)
        if missing:
            raise ValidationError(f"argumentos ausentes: {', '.join(sorted(missing))}")
        argv: list[str] = []
        for template in self.argv_map[op]:
            if template == "{apps}":
                for app in app_list:
                    argv.extend(["--apps", app])
            else:
                argv.append(template.format(**vars_))
        if any("\n" in part or "\x00" in part for part in argv):
            raise ValidationError("argumento invalido")
        return Operation(
            name=op,
            argv=argv,
            bench=bench if isinstance(bench, str) else None,
            read=op in READ_OPS,
            timeout=ttl if ttl is not None else timeout,
            destructive=op in DESTRUCTIVE_OPS,
            global_lock=op in GLOBAL_OPS,
        )
