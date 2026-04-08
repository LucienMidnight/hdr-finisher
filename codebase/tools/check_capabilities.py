from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.capabilities import probe_capabilities


if __name__ == "__main__":
    print(json.dumps({key: value.model_dump() for key, value in probe_capabilities().items()}, indent=2))
