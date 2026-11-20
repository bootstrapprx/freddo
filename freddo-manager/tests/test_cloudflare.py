"""Provisionamento Cloudflare com transporte HTTP deterministico (sem rede)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from freddo_manager.cloudflare import (
    API_BASE,
    CloudflareClient,
    CloudflareError,
    TunnelState,
    _normalize_hostname,
)
from freddo_manager.config import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        home=tmp_path / "state",
        cloudflare_api_token="api-token",
        cloudflare_account_id="account-1",
        cloudflare_tunnel_name="freddo-test",
        cloudflare_origin="http://127.0.0.1:8710",
    )


class FakeCloudflare:
    """API minima: tunel, token, zonas, DNS e ingress."""

    def __init__(self) -> None:
        self.tunnels: list[dict[str, Any]] = []
        self.dns: dict[str, dict[str, Any]] = {}
        self.ingress: list[dict[str, Any]] = []
        self.calls: list[tuple[str, str]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.replace("/client/v4", "")
        method = request.method
        self.calls.append((method, path))
        result: Any = None

        if path == "/accounts/account-1/cfd_tunnel" and method == "GET":
            result = self.tunnels
        elif path == "/accounts/account-1/cfd_tunnel" and method == "POST":
            tunnel = {
                "id": "tunnel-1",
                "name": json.loads(request.content)["name"],
                "token": "tunnel-token-abc",
                "status": "inactive",
                "connections": [],
            }
            self.tunnels.append(tunnel)
            result = tunnel
        elif path.startswith("/accounts/account-1/cfd_tunnel/") and path.endswith("/token"):
            result = "tunnel-token-abc"
        elif path.startswith("/accounts/account-1/cfd_tunnel/") and path.endswith("/configurations"):
            self.ingress = json.loads(request.content)["config"]["ingress"]
            result = {"ingress": self.ingress}
        elif path.startswith("/accounts/account-1/cfd_tunnel/"):
            result = self.tunnels[0] if self.tunnels else None
        elif path == "/zones" and method == "GET":
            result = [{"id": "zone-1", "name": "exemplo.com"}]
        elif path == "/zones/zone-1/dns_records" and method == "GET":
            name = request.url.params.get("name", "")
            result = [record for record in self.dns.values() if record["name"] == name]
        elif path == "/zones/zone-1/dns_records" and method == "POST":
            record = json.loads(request.content)
            record["id"] = f"dns-{len(self.dns) + 1}"
            self.dns[record["name"]] = record
            result = record
        elif path.startswith("/zones/zone-1/dns_records/") and method == "PUT":
            record = json.loads(request.content)
            self.dns[record["name"]] = {**record, "id": path.rsplit("/", 1)[1]}
            result = self.dns[record["name"]]
        elif path.startswith("/zones/zone-1/dns_records/") and method == "DELETE":
            for key, record in list(self.dns.items()):
                if record["id"] == path.rsplit("/", 1)[1]:
                    del self.dns[key]
            result = {}
        else:
            return httpx.Response(404, json={"success": False, "errors": [{"message": path}]})

        return httpx.Response(200, json={"success": True, "result": result})


def _client(tmp_path: Path, fake: FakeCloudflare) -> CloudflareClient:
    settings = _settings(tmp_path)
    http = httpx.Client(
        base_url=API_BASE,
        transport=httpx.MockTransport(fake.handler),
        headers={"Authorization": "Bearer api-token", "Content-Type": "application/json"},
    )
    return CloudflareClient(settings, client=http)


def test_tunnel_setup_is_idempotent_and_persists_token(tmp_path: Path) -> None:
    fake = FakeCloudflare()
    client = _client(tmp_path, fake)
    client.ensure_tunnel()
    assert client.state.tunnel_id == "tunnel-1"
    assert client.state.token == "tunnel-token-abc"

    state_file = tmp_path / "state" / "cloudflare.json"
    assert state_file.stat().st_mode & 0o777 == 0o600
    assert "tunnel-token-abc" in state_file.read_text()

    client.ensure_tunnel()
    creates = [call for call in fake.calls if call == ("POST", "/accounts/account-1/cfd_tunnel")]
    assert len(creates) == 1  # reaproveitou o ID em memoria
    client.close()

    restored = _client(tmp_path, fake)
    restored.ensure_tunnel()
    creates = [call for call in fake.calls if call == ("POST", "/accounts/account-1/cfd_tunnel")]
    assert len(creates) == 1  # reaproveitou o ID persistido em disco


def test_route_creates_proxied_cname_and_ingress_with_catchall(tmp_path: Path) -> None:
    fake = FakeCloudflare()
    client = _client(tmp_path, fake)
    client.ensure_tunnel()
    client.add_route("cliente.exemplo.com")

    record = fake.dns["cliente.exemplo.com"]
    assert record["type"] == "CNAME"
    assert record["content"] == "tunnel-1.cfargotunnel.com"
    assert record["proxied"] is True
    assert fake.ingress == [
        {
            "hostname": "cliente.exemplo.com",
            "service": "http://127.0.0.1:8710",
            "originRequest": {},
        },
        {"service": "http_status:404"},
    ]

    client.add_route("cliente.exemplo.com")
    assert len(fake.ingress) == 2  # sem duplicata


def test_sync_removes_stale_routes(tmp_path: Path) -> None:
    fake = FakeCloudflare()
    client = _client(tmp_path, fake)
    client.ensure_tunnel()
    client.add_route("antigo.exemplo.com")
    routes = client.sync_routes(["novo.exemplo.com"])

    assert routes == ["novo.exemplo.com"]
    assert "antigo.exemplo.com" not in fake.dns
    assert fake.ingress[0]["hostname"] == "novo.exemplo.com"
    assert client.state.hostnames == ["novo.exemplo.com"]


def test_invalid_hostname_is_rejected() -> None:
    with pytest.raises(CloudflareError):
        _normalize_hostname("localhost")
    with pytest.raises(CloudflareError):
        _normalize_hostname("evil.com/script")


def test_install_service_uses_token_and_systemctl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeCloudflare()
    client = _client(tmp_path, fake)
    client.ensure_tunnel()
    commands: list[list[str]] = []
    monkeypatch.setattr("freddo_manager.cloudflare.shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr("freddo_manager.cloudflare.subprocess.run", lambda cmd, **kw: commands.append(cmd))
    client.install_service()
    assert commands[0][-4:] == ["/usr/bin/cloudflared", "service", "install", "tunnel-token-abc"]
    assert commands[1][-4:] == ["systemctl", "enable", "--now", "cloudflared"]


def test_state_file_is_private(tmp_path: Path) -> None:
    state = TunnelState(tunnel_id="t", tunnel_name="n", token="s", hostnames=["a.exemplo.com"])
    path = tmp_path / "cloudflare.json"
    state.save(path)
    assert path.stat().st_mode & 0o777 == 0o600
    assert TunnelState.load(path).token == "s"
