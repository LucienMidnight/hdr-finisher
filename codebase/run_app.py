from __future__ import annotations

import sys
from pathlib import Path

if sys.version_info < (3, 12):
    raise SystemExit("HDR Finisher requires Python 3.12 or newer.")

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.main import run


if __name__ == "__main__":
    run()
