"""Provisionamento idempotente de Cloudflare Tunnel para deploy SaaS.

Usa o modo remote-managed (token): o API token so cliente Cloudflare e o token
do tunel fica em ``$FREDDO_HOME/cloudflare.json`` com permissao 0600. Nenhuma
chave e escrita no repositorio ou em arquivos de unit.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Self

import httpx

from .config import Settings

log = logging.getLogger("freddo.cloudflare")

API_BASE = "https://api.cloudflare.com/client/v4"


class CloudflareError(RuntimeError):
    pass


def _normalize_hostname(hostname: str) -> str:
    from .executor.allowlist import DOMAIN_RE

    value = hostname.lower().rstrip(".")
    if not DOMAIN_RE.fullmatch(value):
        raise CloudflareError(f"hostname publico invalido: {hostname}")
    return value


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


@dataclass
class TunnelState:
    tunnel_id: str | None = None
    tunnel_name: str | None = None
    token: str | None = None
    hostnames: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> TunnelState:
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CloudflareError(f"estado do tunel invalido em {path}: {exc}") from exc
        return cls(
            tunnel_id=data.get("tunnel_id"),
            tunnel_name=data.get("tunnel_name"),
            token=data.get("token"),
            hostnames=list(data.get("hostnames") or []),
        )

    def save(self, path: Path) -> None:
        _atomic_json(
            path,
            {
                "tunnel_id": self.tunnel_id,
                "tunnel_name": self.tunnel_name,
                "token": self.token,
                "hostnames": sorted(set(self.hostnames)),
            },
        )


class CloudflareClient:
    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.Client | None = None,
        state: TunnelState | None = None,
    ) -> None:
        if not settings.cloudflare_api_token:
            raise CloudflareError("FREDDO_CLOUDFLARE_API_TOKEN nao configurado")
        if not settings.cloudflare_account_id:
            raise CloudflareError("FREDDO_CLOUDFLARE_ACCOUNT_ID nao configurado")
        self.settings = settings
        self.state_path = settings.home / "cloudflare.json"
        self.state = state or TunnelState.load(self.state_path)
        self._client = client or httpx.Client(
            base_url=API_BASE,
            headers={
                "Authorization": f"Bearer {settings.cloudflare_api_token}",
                "Content-Type": "application/json",
            },
            timeout=30,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._client.request(method, path, **kwargs)
        try:
            body = response.json()
        except ValueError as exc:
            raise CloudflareError(f"resposta invalida da Cloudflare ({response.status_code})") from exc
        if response.status_code >= 400 or not body.get("success", False):
            errors = body.get("errors") or [{"message": response.text[:200]}]
            messages = "; ".join(str(item.get("message", item)) for item in errors)
            raise CloudflareError(f"Cloudflare {response.status_code}: {messages}")
        return body.get("result")

    def _save(self) -> None:
        self.state.save(self.state_path)

    # ---- tunnel ---------------------------------------------------------------
    def _tunnel_by_name(self, name: str) -> dict[str, Any] | None:
        tunnels = self._request("GET", f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel") or []
        for tunnel in tunnels:
            if tunnel.get("name") == name and not tunnel.get("deleted_at"):
                return tunnel
        return None

    def ensure_tunnel(self) -> dict[str, Any]:
        name = self.settings.cloudflare_tunnel_name
        tunnel: dict[str, Any] | None = None
        if self.state.tunnel_id:
            try:
                tunnel = self._request(
                    "GET", f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel/{self.state.tunnel_id}"
                )
            except CloudflareError:
                tunnel = None
        if tunnel is None:
            tunnel = self._tunnel_by_name(name)
        if tunnel is None:
            tunnel = self._request(
                "POST",
                f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel",
                json={"name": name, "config_src": "cloudflare"},
            )
        token = tunnel.get("token")
        if not token:
            token = self._request(
                "GET", f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel/{tunnel['id']}/token"
            )
        self.state.tunnel_id = str(tunnel["id"])
        self.state.tunnel_name = name
        self.state.token = token
        self._save()
        log.info("tunel %s (%s) pronto", name, self.state.tunnel_id)
        return tunnel

    def status(self) -> dict[str, Any]:
        if not self.state.tunnel_id:
            return {"configured": False}
        tunnel = self._request(
            "GET", f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel/{self.state.tunnel_id}"
        )
        return {
            "configured": True,
            "id": tunnel.get("id"),
            "name": tunnel.get("name"),
            "status": tunnel.get("status"),
            "connections": len(tunnel.get("connections") or []),
            "hostnames": sorted(set(self.state.hostnames)),
        }

    # ---- DNS ------------------------------------------------------------------
    def _zone_for(self, hostname: str) -> dict[str, Any]:
        zones = self._request("GET", "/zones", params={"per_page": 100}) or []
        matches = [
            zone
            for zone in zones
            if hostname == zone.get("name", "") or hostname.endswith("." + str(zone.get("name", "")))
        ]
        if not matches:
            raise CloudflareError(f"zona Cloudflare nao encontrada para {hostname}")
        return max(matches, key=lambda zone: len(str(zone.get("name", ""))))

    def ensure_dns(self, hostname: str) -> None:
        if not self.state.tunnel_id:
            raise CloudflareError("tunel nao inicializado; rode 'cloudflare setup'")
        zone = self._zone_for(hostname)
        target = f"{self.state.tunnel_id}.cfargotunnel.com"
        existing = self._request(
            "GET",
            f"/zones/{zone['id']}/dns_records",
            params={"name": hostname, "type": "CNAME", "per_page": 100},
        ) or []
        for record in existing:
            if record.get("name") == hostname:
                if record.get("content") != target or not record.get("proxied", True):
                    self._request(
                        "PUT",
                        f"/zones/{zone['id']}/dns_records/{record['id']}",
                        json={
                            "type": "CNAME",
                            "name": hostname,
                            "content": target,
                            "proxied": True,
                        },
                    )
                return
        self._request(
            "POST",
            f"/zones/{zone['id']}/dns_records",
            json={"type": "CNAME", "name": hostname, "content": target, "proxied": True},
        )

    def remove_dns(self, hostname: str) -> None:
        zone = self._zone_for(hostname)
        existing = self._request(
            "GET",
            f"/zones/{zone['id']}/dns_records",
            params={"name": hostname, "type": "CNAME", "per_page": 100},
        ) or []
        for record in existing:
            if record.get("name") == hostname:
                self._request("DELETE", f"/zones/{zone['id']}/dns_records/{record['id']}")

    # ---- ingress --------------------------------------------------------------
    def _write_ingress(self) -> None:
        if not self.state.tunnel_id:
            raise CloudflareError("tunel nao inicializado; rode 'cloudflare setup'")
        ingress = [
            {"hostname": hostname, "service": self.settings.cloudflare_origin, "originRequest": {}}
            for hostname in sorted(set(self.state.hostnames))
        ]
        ingress.append({"service": "http_status:404"})
        self._request(
            "PUT",
            f"/accounts/{self.settings.cloudflare_account_id}/cfd_tunnel/{self.state.tunnel_id}/configurations",
            json={"config": {"ingress": ingress}},
        )

    def add_route(self, hostname: str) -> None:
        hostname = _normalize_hostname(hostname)
        if hostname not in self.state.hostnames:
            self.state.hostnames.append(hostname)
        self.ensure_dns(hostname)
        self._write_ingress()
        self._save()
        log.info("rota %s -> %s publicada", hostname, self.settings.cloudflare_origin)

    def remove_route(self, hostname: str) -> None:
        hostname = _normalize_hostname(hostname)
        if hostname in self.state.hostnames:
            self.state.hostnames.remove(hostname)
        self.remove_dns(hostname)
        self._write_ingress()
        self._save()

    def sync_routes(self, hostnames: list[str]) -> list[str]:
        """Ajusta as rotas ao estado real dos benches (remove rotas obsoletas)."""
        desired = {item.lower().rstrip(".") for item in hostnames if item}
        current = set(self.state.hostnames)
        for stale in sorted(current - desired):
            self.remove_route(stale)
        for hostname in sorted(desired - current):
            self.add_route(hostname)
        return sorted(desired)

    # ---- service --------------------------------------------------------------
    def install_service(self) -> None:
        if not self.state.token:
            raise CloudflareError("token do tunel ausente; rode 'cloudflare setup'")
        binary = shutil.which("cloudflared")
        if binary is None:
            raise CloudflareError("cloudflared nao encontrado no PATH")
        prefix: list[str] = []
        if hasattr(os, "geteuid") and os.geteuid() != 0:
            sudo = shutil.which("sudo")
            if sudo is None:
                raise CloudflareError("sudo necessario para instalar o servico cloudflared")
            prefix = [sudo, "-n"]
        subprocess.run([*prefix, binary, "service", "install", self.state.token], check=True)
        subprocess.run([*prefix, "systemctl", "enable", "--now", "cloudflared"], check=True)
        log.info("servico cloudflared instalado e ativo")
