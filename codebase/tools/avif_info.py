from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.avif_info import inspect_avif


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect AVIF metadata with the bundled avifdec binary.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path)
    args = parser.parse_args()

    info = inspect_avif(args.path)
    text = json.dumps(info, indent=2)
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
