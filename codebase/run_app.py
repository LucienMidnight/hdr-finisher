from __future__ import annotations

import argparse
import sys
from pathlib import Path

if sys.version_info < (3, 12):
    raise SystemExit("HDR Finisher requires Python 3.12 or newer.")

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.launcher import run, run_desktop_sidecar


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--desktop-sidecar", action="store_true")
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()
    if args.desktop_sidecar:
        if args.parent_pid <= 0:
            parser.error("--parent-pid is required for the desktop sidecar")
        run_desktop_sidecar(args.parent_pid)
    else:
        run()
