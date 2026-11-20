"""Primitivas de seguranca: senha, TOTP, sessoes, CSRF, redacao e auditoria."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path
from typing import Any

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

SESSION_COOKIE = "freddo_session"
CSRF_COOKIE = "freddo_csrf"
CSRF_HEADER = "x-csrf-token"

# Padroes que nunca devem chegar ao banco de jobs ou aos logs (S9).
_REDACTORS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"]?([^\s'\"]+)"), r"\1=***REDACTED***"),
    (re.compile(r"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL), "[PRIVATE KEY]"),
    (re.compile(r"\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b"), "[TOKEN]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[JWT]"),
]


def load_or_create_key(path: Path) -> bytes:
    if path.exists():
        return path.read_bytes()
    key = Fernet.generate_key()
    path.write_bytes(key)
    path.chmod(0o600)
    return key


def _fernet(path: Path) -> Fernet:
    return Fernet(load_or_create_key(path))


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def encrypt_secret(secret: str, key_path: Path) -> bytes:
    return _fernet(key_path).encrypt(secret.encode())


def decrypt_secret(encrypted: bytes, key_path: Path) -> str:
    return _fernet(key_path).decrypt(encrypted).decode()


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account: str = "freddo") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name="freddo-manager")


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


def generate_recovery_codes(count: int = 8) -> list[str]:
    return [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode()).hexdigest()


def new_session_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).digest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_valid(header: str | None, cookie: str | None) -> bool:
    return bool(header and cookie and hmac.compare_digest(header, cookie))


def redact(line: str) -> str:
    result = line
    for pattern, replacement in _REDACTORS:
        result = pattern.sub(replacement, result)
    return result


def audit_hash(prev_hash: bytes, payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(prev_hash + body).digest()


def allowed_stepup(stepup_until: int | None) -> bool:
    import time

    return bool(stepup_until and stepup_until > int(time.time()))


def derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=480_000)
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))
