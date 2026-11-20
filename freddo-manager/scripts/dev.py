"""Sobe API e Vite juntos e encerra ambos com seguranca (Ctrl-C/SIGTERM)."""

from __future__ import annotations

import signal
import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: dev.py <freddo-manager> <diretorio web>", file=sys.stderr)
        return 2

    freddo_bin = sys.argv[1]
    web_dir = Path(sys.argv[2])
    processes = [
        subprocess.Popen([freddo_bin, "serve"]),
        subprocess.Popen(
            [str(web_dir / "node_modules/.bin/vite"), str(web_dir), "--host", "127.0.0.1", "--strictPort"],
            cwd=web_dir,
        ),
    ]

    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        while not stopping and all(process.poll() is None for process in processes):
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass

    interrupted = stopping
    codes = [process.poll() for process in processes]
    stop()
    if interrupted:
        return 0
    return next((code for code in codes if code not in (None, 0)), 0)


if __name__ == "__main__":
    raise SystemExit(main())
