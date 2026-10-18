"""Time the CPU work the GPU route still needs: open the RAW, read its metadata
and unpack the sensor mosaic (no demosaic). Reports cold-ish and warm runs.

Usage: python unpack_time.py <photo> [...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np

CODEBASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(CODEBASE / "backend"))
from hdr_finisher import raw_import  # noqa: E402


def unpack(path):
    import rawpy
    started = perf_counter()
    with rawpy.imread(str(path)) as raw:
        opened = perf_counter()
        metadata = raw_import._camera_linear_metadata_from_libraw(raw)
        mosaic = np.array(raw.raw_image_visible, dtype="<u2", order="C", copy=True)  # LibRaw frees its buffer on close
        done = perf_counter()
    return {"open_s": opened - started, "unpack_s": done - opened, "total_s": done - started,
            "megapixels": mosaic.size / 1e6, "bytes": mosaic.nbytes, "pattern": metadata.raw_pattern.shape}


if __name__ == "__main__":
    for argument in sys.argv[1:]:
        runs = [unpack(Path(argument)) for _ in range(3)]
        print(json.dumps({"photo": Path(argument).name, "megapixels": round(runs[0]["megapixels"], 1),
                          "first_s": round(runs[0]["total_s"], 3),
                          "warm_s": round(min(r["total_s"] for r in runs[1:]), 3),
                          "warm_open_s": round(min(r["open_s"] for r in runs[1:]), 3)}))
