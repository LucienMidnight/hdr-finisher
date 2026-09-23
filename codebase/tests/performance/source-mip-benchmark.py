"""Record cold, memory-warm and disk-warm source mip costs.

Run with ``.venv/Scripts/python tests/performance/source-mip-benchmark.py``.
The synthetic scene-linear source is deterministic; timings are local-machine
observations, while byte counts come from the cache's own accounting.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from time import perf_counter

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from hdr_finisher.render_cache import SourceMipIdentity, SourceMipStore  # noqa: E402


def main() -> None:
    width, height, edge = 4096, 2731, 1024
    yy, xx = np.mgrid[:height, :width]
    image = np.empty((height, width, 3), dtype=np.float32)
    image[:, :, 0] = xx / width * 6 - 0.5
    image[:, :, 1] = yy / height * 4
    image[:, :, 2] = (xx + yy) / (width + height) * 12
    identity = SourceMipIdentity(
        content_key="source-mip-benchmark-v1", byte_size=image.nbytes,
        width=width, height=height, decoder_version="benchmark-decoder",
        color_transform_version="benchmark-color",
    )
    with tempfile.TemporaryDirectory(prefix="hdr-source-mip-benchmark-") as temp:
        store = SourceMipStore(temp)

        def sample(active: SourceMipStore) -> dict:
            started = perf_counter()
            level, hit = active.level(identity, edge, image)
            return {"state": hit, "wall_ms": round((perf_counter() - started) * 1000, 3),
                    "shape": list(level.shape), "output_bytes": level.nbytes}

        cold = sample(store)
        cold["cache"] = store.diagnostics()
        memory = sample(store)
        memory["cache"] = store.diagnostics()
        restarted = SourceMipStore(temp)
        disk = sample(restarted)
        disk["cache"] = restarted.diagnostics()
        assert [cold["state"], memory["state"], disk["state"]] == ["built", "memory", "disk"]
        summary = {
            "fixture": {"width": width, "height": height, "channels": 3,
                        "dtype": "float32", "native_bytes": image.nbytes, "long_edge": edge},
            "cold": cold, "memory_warm": memory, "disk_warm": disk,
        }
        for result in (cold, memory, disk):
            result["cache"].pop("root", None)
        output = ROOT / "output" / "performance" / "source-mip-benchmark.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps({"output": str(output), "cold_ms": cold["wall_ms"],
                          "memory_warm_ms": memory["wall_ms"], "disk_warm_ms": disk["wall_ms"],
                          "memory_bytes": cold["cache"]["memory_bytes"],
                          "disk_bytes": cold["cache"]["disk_bytes"]}, indent=2))


if __name__ == "__main__":
    main()
