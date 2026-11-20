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

# Um bench de SaaS é identificado pelo FQDN do site (ex.: tenant.example.com).
# Nomes de uma única label continuam aceitos para benches locais legados.
BENCH_RE = re.compile(
    r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
)
DOMAIN_RE = re.compile(
    r"^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
SERVICE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

DEFAULT_CATALOG: dict[str, Any] = {
    "versions": ["v16", "v15", "v15.1", "v14", "version-16", "version-15", "version-14", "develop"],
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

GLOBAL_OPS = {
    "services.start", "services.stop", "services.restart", "fm.migrate", "fm.self.update", "tunnel.up", "tunnel.down"
}

# Sintaxe real do Frappe-Manager 0.20 (entrypoint fmx, flag global -n).
# Mapeamentos podem ser ajustados apos o spike M0 via FREDDO_ARGV_MAP.
DEFAULT_ARGV_MAP: dict[str, list[str]] = {
    "fm.list": ["{fm}", "-n", "list"],
    "fm.info": ["{fm}", "-n", "info", "{bench}"],
    "fm.version": ["{fm}", "--version"],
    "bench.create": [
        "{fm}", "-n", "create", "{bench}", "--environment", "{environment}",
        "--admin-pass", "{admin_pass}", "{aliases}", "{apps}",
    ],
    "app.validate": ["{git}", "ls-remote", "--heads", "--tags", "--refs", "{repository_url}", "{ref}"],
    "app.test": ["{fm}", "-n", "create", "{bench}", "--environment", "dev", "--admin-pass", "{admin_pass}", "{apps}"],
    "app.install": ["{fm}", "-n", "shell", "{bench}", "-c", "{command}"],
    "app.update": ["{fm}", "-n", "shell", "{bench}", "-c", "{command}"],
    "app.uninstall.preview": ["{fm}", "-n", "shell", "{bench}", "-c", "{command}"],
    "app.uninstall": ["{fm}", "-n", "shell", "{bench}", "-c", "{command}"],
    "bench.delete": ["{fm}", "-n", "delete", "{bench}", "--yes"],
    "bench.start": ["{fm}", "-n", "start", "{bench}"],
    "bench.stop": ["{fm}", "-n", "stop", "{bench}"],
    "bench.restart": ["{fm}", "-n", "restart", "{bench}"],
    "bench.reset": ["{fm}", "-n", "reset", "{bench}"],
    "bench.update": ["{fm}", "-n", "update", "{bench}", "--environment", "{environment}"],
    "bench.logs": ["{fm}", "-n", "logs", "{bench}", "--service", "{service}", "--follow"],
    "bench.shell": ["{fm}", "-n", "shell", "{bench}"],
    "ssl.status": ["{fm}", "-n", "ssl", "list"],
    "ssl.issue": ["{fm}", "-n", "ssl", "add", "{bench}", "{domain}"],
    "ssl.renew": ["{fm}", "-n", "ssl", "renew", "{bench}"],
    "ngrok.start": ["{fm}", "-n", "ngrok", "{bench}"],
    "ngrok.stop": ["{fm}", "-n", "ngrok", "{bench}"],
    "services.list": ["{fm}", "-n", "services", "list"],
    "services.start": ["{fm}", "-n", "services", "start", "{service}"],
    "services.stop": ["{fm}", "-n", "services", "stop", "{service}"],
    "services.restart": ["{fm}", "-n", "services", "restart", "{service}"],
    "fm.migrate": ["{fm}", "-n", "migrate", "--auto-proceed"],
    "fm.self.update": ["{fm}", "-n", "self", "update", "--yes"],
    "tunnel.up": [
        "docker",
        "compose",
        "-f",
        str(Path(__file__).resolve().parents[3] / "deploy" / "cloudflared.compose.yml"),
        "up", "-d", "cloudflared",
    ],
    "tunnel.down": [
        "docker",
        "compose",
        "-f",
        str(Path(__file__).resolve().parents[3] / "deploy" / "cloudflared.compose.yml"),
        "down",
    ],
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
    def __init__(self, fm_bin: str = "fm", catalog_path: Path | None = None, state_db_path: Path | None = None) -> None:
        self.fm_bin = fm_bin
        self.state_db_path = state_db_path
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
        app_specs: list[str] = []
        expected_commits: dict[str, str] = {}
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
            release_ids = args.get("app_release_ids")
            if release_ids is not None:
                app_specs, expected_commits = self._resolve_tested_releases(version, release_ids)
            environment = "prod" if str(args.get("environment", "development")).lower() in ("production", "prod") else "dev"
            admin_pass = args.get("admin_pass") or "admin"
            if not isinstance(admin_pass, str) or len(admin_pass) < 8:
                raise ValidationError("senha administrativa deve ter ao menos 8 caracteres")
            aliases = args.get("alias_domains") or []
            if isinstance(aliases, str):
                aliases = [item.strip() for item in aliases.split(",") if item.strip()]
            if not isinstance(aliases, list) or any(not DOMAIN_RE.fullmatch(str(item)) for item in aliases):
                raise ValidationError("alias domains invalidos")
            args = {
                **args,
                "version": version,
                "environment": environment,
                "admin_pass": admin_pass,
                "alias_domains": list(aliases),
            }
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
            domain = args.get("domain") or bench or ""
            if not DOMAIN_RE.fullmatch(str(domain)):
                raise ValidationError("dominio invalido")
            args = {**args, "domain": str(domain)}
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
        if op == "app.validate":
            from ..apps import validate_app_name

            name = validate_app_name(str(args.get("app", "")))
            version = str(args.get("framework_version", ""))
            row = self._release(name, version)
            if not row:
                raise ValidationError("app release inexistente")
            from ..apps import validate_app_ref, validate_repository_url

            url = validate_repository_url(row["repository_url"])
            ref = validate_app_ref(row["ref"])
            if any(ord(char) < 32 for char in url):
                raise ValidationError("URL do repositorio invalida")
            args = {**args, "repository_url": url, "ref": ref}
        if op == "app.test":
            from ..apps import validate_app_name

            name = validate_app_name(str(args.get("app", "")))
            version = str(args.get("framework_version", ""))
            app = self._release(name, version)
            frappe = self._release("frappe", version)
            if (
                not app or not frappe or not app["enabled"] or app["archived"]
                or app["validation_state"] != "passed" or not app["validated_commit"]
                or not frappe["enabled"] or frappe["archived"]
                or frappe["validation_state"] != "passed" or not frappe["validated_commit"]
            ):
                raise ValidationError("release precisa ser validado")
            if not app["enabled"] or app["archived"]:
                raise ValidationError("app desabilitado ou arquivado")
            args = {**args, "app": name, "version": version, "app_url": app["repository_url"], "app_ref": app["ref"], "frappe_url": frappe["repository_url"], "frappe_ref": frappe["ref"], "frappe_commit": frappe["validated_commit"], "validated_commit": app["validated_commit"]}
            if not re.fullmatch(r"freddo-app-test-[a-z][a-z0-9_]{0,19}-[a-f0-9]{8}", str(bench or "")):
                raise ValidationError("nome temporario invalido")
            args.setdefault("admin_pass", os.urandom(24).hex())
        if op in {"app.install", "app.update", "app.uninstall.preview", "app.uninstall"}:
            import shlex

            from ..apps import validate_app_name

            name = validate_app_name(str(args.get("app", "")))
            version = str(args.get("framework_version", ""))
            row = self._release(name, version)
            if not row or not row["enabled"] or row["archived"]:
                raise ValidationError("app release indisponivel")
            if not row["validated_commit"] or row["validation_state"] != "passed" or row["test_state"] != "passed" or row["tested_commit"] != row["validated_commit"]:
                raise ValidationError("app release precisa de validacao e teste atuais")
            site = str(args.get("site", ""))
            if not BENCH_RE.fullmatch(site):
                raise ValidationError("site invalido")
            if op == "app.uninstall" and args.get("confirm") != f"{name}@{bench}":
                raise ValidationError("confirmacao app@bench obrigatoria")
            app = shlex.quote(name)
            site_arg = shlex.quote(site)
            url, ref = shlex.quote(row["repository_url"]), shlex.quote(row["ref"])
            remote = f"git -C apps/{app} remote set-url origin {url}"
            if op == "app.install":
                commit = shlex.quote(str(row["validated_commit"]))
                command = f"bench get-app {url} && {remote} && git -C apps/{app} fetch origin {ref} && git -C apps/{app} checkout {commit} && bench --site {site_arg} install-app {app}"
            elif op == "app.update":
                commit = shlex.quote(str(row["validated_commit"]))
                command = f"bench backup --site {site_arg} --with-files && {remote} && git -C apps/{app} fetch origin {ref} && git -C apps/{app} checkout {commit} && bench --site {site_arg} migrate"
            elif op == "app.uninstall.preview":
                command = f"bench --site {site_arg} uninstall-app {app} --dry-run"
            else:
                command = f"bench backup --site {site_arg} --with-files && bench --site {site_arg} uninstall-app {app} --yes"
            args = {**args, "app": name, "framework_version": version, "command": command}
        if op.startswith("services.") and "service" in args:
            if not SERVICE_RE.fullmatch(str(args["service"])):
                raise ValidationError("servico invalido")
        if op in DESTRUCTIVE_OPS:
            expected = bench if bench is not None else "system"
            if args.get("confirm") != expected:
                raise ValidationError("confirmacao por nome obrigatoria")

        placeholders = set(re.findall(r"\{(\w+)\}", " ".join(self.argv_map[op])))
        vars_: dict[str, str] = {"fm": self.fm_bin, "git": "git", **{k: str(v) for k, v in args.items()}}
        missing = placeholders - set(vars_) - {"aliases"}
        if missing:
            raise ValidationError(f"argumentos ausentes: {', '.join(sorted(missing))}")
        argv: list[str] = []
        for template in self.argv_map[op]:
            if template == "{apps}":
                for app in app_specs or app_list:
                    argv.extend(["--apps", app])
            elif template == "{aliases}":
                aliases = args.get("alias_domains") or []
                if aliases:
                    argv.extend(["--alias-domains", ",".join(str(item) for item in aliases)])
            else:
                argv.append(template.format(**vars_))
        if any("\n" in part or "\x00" in part for part in argv):
            raise ValidationError("argumento invalido")
        if op == "app.validate":
            argv = ["git", "ls-remote", "--heads", "--tags", "--refs", args["repository_url"], args["ref"]]
        elif op == "app.test":
            argv = [self.fm_bin, "-n", "create", str(bench), "--environment", "dev", "--admin-pass", str(args["admin_pass"]), "--apps", f"{args['frappe_url']}:{args['frappe_ref']}", "--apps", f"{args['app_url']}:{args['app_ref']}"]
        elif op.startswith("app.") and "command" in locals():
            argv = [self.fm_bin, "-n", "shell", str(bench), "-c", command]
        else:
            argv = [template.format(**vars_) for template in self.argv_map[op]]
        return Operation(
            name=op,
            argv=argv,
            bench=bench if isinstance(bench, str) else None,
            read=op in READ_OPS,
            timeout=ttl if ttl is not None else timeout,
            destructive=op in DESTRUCTIVE_OPS,
            global_lock=op in GLOBAL_OPS,
            tags={
                **{k: str(args[k]) for k in ("app", "framework_version", "validated_commit", "repository_url", "ref") if k in args},
                **({"expected_commits": json.dumps(expected_commits)} if expected_commits else {}),
            },
        )

    def _release(self, app: str, version: str) -> dict[str, Any] | None:
        if not self.state_db_path or not self.state_db_path.is_file():
            raise ValidationError("banco de estado indisponivel")
        import sqlite3

        try:
            with sqlite3.connect(f"file:{self.state_db_path}?mode=ro", uri=True) as db:
                db.row_factory = sqlite3.Row
                row = db.execute("""SELECT r.*, a.repository_url, a.enabled, a.archived FROM managed_app_release r JOIN managed_app a ON a.name=r.app_name WHERE r.app_name=? AND r.framework_version=? AND r.archived=0""", (app, version)).fetchone()
                return dict(row) if row else None
        except sqlite3.Error as exc:
            raise ValidationError("nao foi possivel ler o catalogo de apps") from exc

    def _resolve_tested_releases(self, version: str, release_ids: Any) -> tuple[list[str], dict[str, str]]:
        if not isinstance(release_ids, list) or len(release_ids) > 50:
            raise ValidationError("selecione releases de apps")
        if not self.state_db_path or not self.state_db_path.is_file():
            raise ValidationError("banco de estado indisponivel")
        import sqlite3

        with sqlite3.connect(f"file:{self.state_db_path}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            frappe = db.execute("""SELECT r.*, a.repository_url, a.enabled, a.archived FROM managed_app_release r JOIN managed_app a ON a.name=r.app_name WHERE r.app_name='frappe' AND r.framework_version=? AND r.archived=0""", (version,)).fetchone()
        if not frappe or not frappe["enabled"] or frappe["archived"] or frappe["validation_state"] != "passed" or not frappe["validated_commit"]:
            raise ValidationError("release base do Frappe precisa ser validada")
        specs = [f"{frappe['repository_url']}:{frappe['ref']}"]
        names = {"frappe"}
        commits = {"frappe": str(frappe["validated_commit"])}
        for release_id in release_ids:
            if not isinstance(release_id, str) or not release_id:
                raise ValidationError("release invalida ou duplicada")
            with sqlite3.connect(f"file:{self.state_db_path}?mode=ro", uri=True) as db:
                db.row_factory = sqlite3.Row
                row = db.execute("""SELECT r.*, a.enabled, a.archived FROM managed_app_release r JOIN managed_app a ON a.name=r.app_name WHERE r.id=? AND r.framework_version=? AND r.archived=0""", (release_id, version)).fetchone()
            if not row or not row["enabled"] or row["archived"] or row["validation_state"] != "passed" or row["test_state"] != "passed" or not row["validated_commit"] or row["tested_commit"] != row["validated_commit"]:
                raise ValidationError("release desabilitada, incompatível ou sem teste atual")
            name = str(row["app_name"])
            if name in names:
                raise ValidationError("release duplicada")
            names.add(name)
            specs.append(f"{row['repository_url']}:{row['ref']}")
            commits[name] = str(row["tested_commit"])
        return specs, commits
