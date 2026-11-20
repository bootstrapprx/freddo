"""Testes da configuracao persistida da raiz de benches."""

from __future__ import annotations

import sys
from collections.abc import Generator
from pathlib import Path
from types import SimpleNamespace

import pytest
from freddo_manager import __main__ as cli
from freddo_manager.config import Settings, get_settings, load_fm_home, save_fm_home


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_fm_home_persistido_e_env_tem_precedencia(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FREDDO_FM_HOME", raising=False)
    home = tmp_path / "state"

    saved = save_fm_home(home, Path("~/frappe"))

    assert saved == Path.home() / "frappe"
    assert load_fm_home(home) == saved
    assert Settings(home=home).fm_home == saved

    monkeypatch.setenv("FREDDO_FM_HOME", "/srv/benches-do-servidor")
    assert Settings(home=home).fm_home == Path("/srv/benches-do-servidor")


def test_configure_explicito_persiste(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "state"
    monkeypatch.setenv("FREDDO_HOME", str(home))
    monkeypatch.setattr(sys, "argv", ["freddo-manager", "configure", "--fm-home", "/srv/fm"])

    assert cli.main() == 0
    assert load_fm_home(home) == Path("/srv/fm")


def test_configure_solicita_caminho_quando_interativo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "state"
    monkeypatch.setenv("FREDDO_HOME", str(home))
    monkeypatch.setattr(sys, "argv", ["freddo-manager", "configure"])
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr("builtins.input", lambda prompt: "/srv/benches")

    assert cli.main() == 0
    assert load_fm_home(home) == Path("/srv/benches")
