from __future__ import annotations

import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.exporters import export_sample_hdr_reference


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the HDR Finisher reference AVIF gain-map sample.")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    result = export_sample_hdr_reference(args.output)
    print(result.message)
    if not result.accepted:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
