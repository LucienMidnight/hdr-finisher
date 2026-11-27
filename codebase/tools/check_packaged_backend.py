"""Probe an installed POSIX sidecar with a real parent and an isolated profile."""

import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tempfile
from urllib.request import urlopen


def main(executable, version):
    executable = Path(executable).resolve()
    with tempfile.TemporaryDirectory(prefix="hdr-finisher-package-check-") as profile:
        with subprocess.Popen(
            [executable, "--desktop-sidecar", "--parent-pid", str(os.getpid())],
            cwd=executable.parent,
            env={
                **os.environ,
                "HDR_FINISHER_DESKTOP_SECRET": secrets.token_urlsafe(32),
                "HDR_FINISHER_DESKTOP_CONTROL_SECRET": secrets.token_urlsafe(32),
                "HDR_FINISHER_APP_DATA_DIR": profile,
            },
            stdout=subprocess.PIPE,
            text=True,
            start_new_session=True,
        ) as backend:
            try:
                for line in backend.stdout:
                    print(line, end="", flush=True)
                    if not line.startswith("HDR_FINISHER_READY "):
                        continue
                    ready = json.loads(line.split(" ", 1)[1])
                    if ready["backend_version"] != version:
                        raise SystemExit(f"Backend reported {ready['backend_version']}, expected {version}")
                    with urlopen(ready["health_url"], timeout=10) as response:
                        if json.load(response)["status"] != "ok":
                            raise SystemExit("Packaged backend failed its health check")
                    return
                raise SystemExit(f"Packaged backend exited before readiness ({backend.wait()})")
            finally:
                if backend.poll() is None:
                    backend.send_signal(signal.SIGINT)
                    try:
                        backend.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(backend.pid, signal.SIGKILL)
                        backend.wait()


if __name__ == "__main__":
    main(*sys.argv[1:])
