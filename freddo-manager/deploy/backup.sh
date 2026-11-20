#!/usr/bin/env bash
# Backup consistente dos bancos SQLite via API online backup (nao copiar arquivos abertos).
set -euo pipefail

FREDDO_HOME="${FREDDO_HOME:-/var/lib/freddo-manager}"
DEST_ROOT="${1:-/var/backups/freddo-manager}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST_ROOT" "$DEST"

python3 - "$FREDDO_HOME" "$DEST" <<'PY'
import os
import shutil
import sqlite3
import sys
from pathlib import Path

home = Path(sys.argv[1])
dest = Path(sys.argv[2])
for name in ("state.db", "telemetria.db"):
    source = home / name
    if not source.exists():
        print(f"aviso: {source} nao existe", file=sys.stderr)
        continue
    target = dest / name
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src:
        with sqlite3.connect(target) as dst:
            src.backup(dst)
    os.chmod(target, 0o600)
    print(f"ok: {target}")

secret = home / "secret.key"
if secret.exists():
    target = dest / "secret.key"
    shutil.copy2(secret, target)
    os.chmod(target, 0o600)
    print(f"ok: {target} (guarde este arquivo FORA do host)")
PY

FREDDO_MANAGER_BIN="${FREDDO_MANAGER_BIN:-freddo-manager}"
if command -v "$FREDDO_MANAGER_BIN" >/dev/null 2>&1; then
  FREDDO_HOME="$FREDDO_HOME" "$FREDDO_MANAGER_BIN" verify-audit > "$DEST/audit-verify.json" || true
  chmod 600 "$DEST/audit-verify.json"
fi

tar -czf "$DEST_ROOT/freddo-manager-$STAMP.tar.gz" -C "$DEST_ROOT" "$STAMP"
chmod 600 "$DEST_ROOT/freddo-manager-$STAMP.tar.gz"
echo "Backup concluido: $DEST_ROOT/freddo-manager-$STAMP.tar.gz"
