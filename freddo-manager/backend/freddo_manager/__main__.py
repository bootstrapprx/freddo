"""CLI operacional: bootstrap, serve, executor, collector e auditoria."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

from .audit import AuditService
from .config import Settings, get_settings, load_fm_home, save_fm_home
from .db.state import StateDB
from .db.telemetry import TelemetryDB
from .security import (
    encrypt_secret,
    generate_recovery_codes,
    generate_totp_secret,
    hash_password,
    hash_recovery_code,
    totp_provisioning_uri,
)


def _configure_fm_home(settings: Settings, explicit: str | None = None) -> Path:
    """Solicita (ou recebe) a raiz dos benches e persiste a escolha."""
    current = Path(explicit).expanduser() if explicit else settings.fm_home
    if explicit is None and sys.stdin.isatty():
        answer = input(f"Caminho dos benches do Frappe-Manager [{current}]: ").strip()
        if answer:
            current = Path(answer)
    elif explicit is None:
        print(
            f"Entrada nao interativa: usando {current}. "
            "Execute 'freddo-manager configure' para escolher outro caminho.",
            file=sys.stderr,
        )
    path = save_fm_home(settings.home, current)
    settings.fm_home = path
    print(f"FM_HOME: {path}")
    return path


def _ensure_fm_home(settings: Settings, explicit: str | None = None) -> Path:
    """No bootstrap/serve, so poe a perguntar se ainda nao ha escolha salva."""
    if explicit or os.environ.get("FREDDO_FM_HOME") or load_fm_home(settings.home):
        return settings.fm_home
    return _configure_fm_home(settings)


def _bootstrap(
    settings: Settings,
    password: str | None,
    no_totp: bool,
    force: bool = False,
    fm_home: str | None = None,
) -> int:
    _ensure_fm_home(settings, fm_home)
    db = StateDB(settings.state_db)

    async def run() -> None:
        await db.initialize()
        existing = await db.get_credential()
        if existing and not force:
            print("Credencial ja existe. Use --force para substituir.", file=sys.stderr)
            raise SystemExit(1)
        secret = None if no_totp else generate_totp_secret()
        codes = generate_recovery_codes() if not no_totp else []
        await db.set_credential(
            hash_password(password or getpass.getpass("Senha: ")),
            encrypt_secret(secret, settings.secret_key_file) if secret else None,
            [hash_recovery_code(code) for code in codes],
        )
        audit = AuditService(db)
        await audit.record("credential.bootstrap", actor="local", target="credential")
        print("Credencial criada com sucesso.")
        if secret:
            print("\nTOTP (adicione ao seu autenticador):")
            print(totp_provisioning_uri(secret))
            print("\nCodigos de recuperacao (guarde FORA do host):")
            for code in codes:
                print(f"  {code}")
        print(f"\nBanco de estado: {settings.state_db}")
        print(f"FM_HOME: {settings.fm_home}")

    asyncio.run(run())
    return 0


def _serve(settings: Settings, host: str, port: int, reload: bool, fm_home: str | None = None) -> int:
    import uvicorn

    _ensure_fm_home(settings, fm_home)
    uvicorn.run(
        "freddo_manager.api.app:create_app",
        factory=True,
        host=host or settings.api_host,
        port=port or settings.api_port,
        reload=reload,
        log_level="info",
        access_log=False,
    )
    return 0


def _audit_verify(settings: Settings) -> int:
    db = StateDB(settings.state_db)

    async def run() -> dict:
        await db.initialize()
        return await AuditService(db).verify()

    result = asyncio.run(run())
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 2


def _show_catalog(settings: Settings) -> int:
    from .executor.allowlist import DEFAULT_ARGV_MAP

    print(f"binario fm: {settings.fm_bin}\nFM_HOME: {settings.fm_home}\n")
    for op, argv in DEFAULT_ARGV_MAP.items():
        print(f"{op:20} {' '.join(argv)}")
    return 0


def _show_runtime(settings: Settings) -> int:
    from .runtime import ContainerCompat

    compat = ContainerCompat(settings)
    print(json.dumps(compat.public_dict(), indent=2, default=str))
    return 0


def _bench_hostnames(settings: Settings) -> list[str]:
    """Dominios reais dos benches existentes, sem dados sinteticos."""
    from .fm.adapter import FmAdapter

    return [str(bench["domain"]) for bench in asyncio.run(FmAdapter(settings).list_benches()) if bench.get("domain")]


def _cloudflare_command(settings: Settings, action: str, hostname: str | None) -> int:
    from .cloudflare import CloudflareClient, CloudflareError

    try:
        with CloudflareClient(settings) as client:
            if action == "setup":
                client.ensure_tunnel()
                client.install_service()
                hostnames = client.sync_routes(_bench_hostnames(settings))
                print(json.dumps({"tunnel": client.state.tunnel_id, "routes": hostnames}, indent=2))
            elif action == "status":
                print(json.dumps(client.status(), indent=2))
            elif action == "add":
                if not hostname:
                    raise CloudflareError("hostname obrigatorio")
                client.add_route(hostname)
                print(f"rota publicada: {hostname}")
            elif action == "remove":
                if not hostname:
                    raise CloudflareError("hostname obrigatorio")
                client.remove_route(hostname)
                print(f"rota removida: {hostname}")
            elif action == "sync":
                print(json.dumps({"routes": client.sync_routes(_bench_hostnames(settings))}, indent=2))
    except (CloudflareError, subprocess.CalledProcessError, OSError) as exc:
        print(f"erro cloudflare: {exc}", file=sys.stderr)
        return 2
    return 0


def _saas_deploy(
    settings: Settings,
    hostname: str,
    apps: list[str],
    admin_password: str | None,
    environment: str,
    route: bool,
) -> int:
    """Cria o bench/site efetivo via Executor e publica a rota no tunel."""
    import secrets
    import uuid

    from .cloudflare import CloudflareClient, CloudflareError, _normalize_hostname
    from .executor.allowlist import ValidationError
    from .executor.runner import JobExecutor

    try:
        hostname = _normalize_hostname(hostname)
    except CloudflareError as exc:
        print(f"erro no deploy: {exc}", file=sys.stderr)
        return 2
    password = admin_password or secrets.token_urlsafe(12)
    args = {
        "bench": hostname,
        "version": "v15",
        "apps": apps,
        "environment": environment,
        "domain": hostname,
        "admin_pass": password,
        "alias_domains": [f"www.{hostname}"],
    }
    executor = JobExecutor(settings)

    async def run() -> int:
        code = 1
        async for event in executor.run(f"cli-{uuid.uuid4().hex}", "bench.create", args):
            if event["event"] == "line":
                print(event["line"])
            elif event["event"] == "error":
                print(f"erro: {event['line']}", file=sys.stderr)
                code = int(event.get("exit_code", 2))
            elif event["event"] == "done":
                code = int(event["exit_code"])
        return code

    try:
        code = asyncio.run(run())
    except (OSError, ValidationError) as exc:
        print(f"erro no deploy: {exc}", file=sys.stderr)
        return 2
    if code != 0:
        print("Deploy do bench falhou; nenhuma rota publicada.", file=sys.stderr)
        return code
    if route:
        try:
            with CloudflareClient(settings) as client:
                client.ensure_tunnel()
                client.add_route(hostname)
        except (CloudflareError, OSError) as exc:
            print(f"bench criado, mas falha ao publicar rota: {exc}", file=sys.stderr)
            return 2
    print(f"\nSite: https://{hostname}")
    print(f"Senha admin do site (guarde agora; nao sera exibida novamente): {password}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="freddo-manager", description="Console web para Frappe-Manager")
    parser.add_argument("--version", action="version", version="freddo-manager 0.1.0")
    sub = parser.add_subparsers(dest="command", required=True)

    p_bootstrap = sub.add_parser("bootstrap", help="cria a credencial unica e o TOTP")
    p_bootstrap.add_argument("--password", help="senha (omitido para digitar com seguranca)")
    p_bootstrap.add_argument("--no-totp", action="store_true", help="nao exigir segundo fator (nao recomendado)")
    p_bootstrap.add_argument("--force", action="store_true", help="substitui a credencial existente")
    p_bootstrap.add_argument("--fm-home", help="raiz dos benches (persistida; omitido para solicitar)")

    p_configure = sub.add_parser("configure", help="define/solicita a raiz dos benches")
    p_configure.add_argument("--fm-home", help="caminho absoluto (omitido para solicitar)")

    p_serve = sub.add_parser("serve", help="sobe API + executor (modo desenvolvimento)")
    p_serve.add_argument("--host", default="")
    p_serve.add_argument("--port", type=int, default=0)
    p_serve.add_argument("--reload", action="store_true")
    p_serve.add_argument("--fm-home", help="raiz dos benches (persistida)")

    sub.add_parser("executor", help="sobe apenas o Executor (systemd)")
    sub.add_parser("collector", help="sobe apenas o coletor (systemd)")
    sub.add_parser("verify-audit", help="verifica a cadeia do audit log")
    sub.add_parser("catalog", help="mostra o mapa de comandos allowlistados")
    sub.add_parser("runtime", help="mostra o runtime de containers detectado (Docker/Podman)")

    p_cf = sub.add_parser("cloudflare", help="provisiona Cloudflare Tunnel, DNS e ingress")
    p_cf_sub = p_cf.add_subparsers(dest="cloudflare_action", required=True)
    p_cf_sub.add_parser("setup", help="cria/recupera o tunel, instala o servico e sincroniza rotas")
    p_cf_sub.add_parser("status", help="mostra o estado real do tunel")
    p_cf_sub.add_parser("sync", help="ajusta rotas aos benches existentes")
    for cf_action in ("add", "remove"):
        p_cf_route = p_cf_sub.add_parser(cf_action, help=f"{cf_action} rota publica")
        p_cf_route.add_argument("hostname", help="FQDN publico do site")

    p_saas = sub.add_parser("saas", help="deploy de SaaS (bench + site + rota)")
    p_saas_sub = p_saas.add_subparsers(dest="saas_action", required=True)
    p_deploy = p_saas_sub.add_parser("deploy", help="cria bench/site e publica no Cloudflare Tunnel")
    p_deploy.add_argument("hostname", help="FQDN publico do site (ex.: cliente.exemplo.com)")
    p_deploy.add_argument("--apps", nargs="+", default=["erpnext"], help="apps adicionais (frappe e implicito)")
    p_deploy.add_argument("--admin-password", help="senha admin do site (gerada e exibida se omitida)")
    p_deploy.add_argument("--environment", default="production", help="production ou development")
    p_deploy.add_argument("--no-route", action="store_true", help="nao publicar rota no tunel")

    args = parser.parse_args()
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.command == "bootstrap":
        return _bootstrap(settings, args.password, args.no_totp, args.force, args.fm_home)
    if args.command == "configure":
        _configure_fm_home(settings, args.fm_home)
        return 0
    if args.command == "serve":
        return _serve(settings, args.host, args.port, args.reload, args.fm_home)
    if args.command == "executor":
        from .executor.server import run_executor

        asyncio.run(run_executor(settings))
        return 0
    if args.command == "collector":
        from .collector.collector import Collector
        from .runtime import ContainerCompat

        compat = ContainerCompat(settings)
        collector = Collector(settings, TelemetryDB(settings.telemetry_db), StateDB(settings.state_db), compat)

        async def run() -> None:
            await collector.telemetry.initialize()
            await collector.state_db.initialize()
            await collector.run_forever()

        try:
            asyncio.run(run())
        except KeyboardInterrupt:
            pass
        return 0
    if args.command == "verify-audit":
        return _audit_verify(settings)
    if args.command == "catalog":
        return _show_catalog(settings)
    if args.command == "runtime":
        return _show_runtime(settings)
    if args.command == "cloudflare":
        return _cloudflare_command(settings, args.cloudflare_action, getattr(args, "hostname", None))
    if args.command == "saas":
        if args.saas_action == "deploy":
            return _saas_deploy(
                settings,
                args.hostname,
                args.apps,
                args.admin_password,
                args.environment,
                not args.no_route,
            )
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
