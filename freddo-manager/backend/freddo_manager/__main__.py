"""CLI operacional: bootstrap, serve, executor, collector e auditoria."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import logging
import os
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
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
