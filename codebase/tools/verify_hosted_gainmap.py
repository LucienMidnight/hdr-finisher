from __future__ import annotations

import argparse
import json
from pathlib import Path

from hdr_finisher.hosting_probe import probe_hosted_url


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare an exported gain-map image with bytes delivered by a hosting pipeline."
    )
    parser.add_argument("original", type=Path, help="Local JPEG Ultra HDR or AVIF gain-map export")
    parser.add_argument("urls", nargs="+", help="Direct or transformed delivery URLs")
    parser.add_argument(
        "--format",
        choices=("auto", "jpeg_ultrahdr", "avif_gain_map"),
        default="auto",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    results = [
        probe_hosted_url(
            url,
            original=args.original,
            format_name=args.format,
            timeout=args.timeout,
        )
        for url in args.urls
    ]
    print(json.dumps(results, indent=2))
    return 0 if all(item.get("gain_map_preserved") for item in results) else 2


if __name__ == "__main__":
    raise SystemExit(main())
