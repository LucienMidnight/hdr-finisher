"""Used by tests/library-gpu-raw.js: compare GPU-developed Library pictures
with Grade's CPU development of the same photos. Prints one JSON line."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from hdr_finisher.adjustments import (  # noqa: E402
    apply_adjustments, apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression)
from hdr_finisher.color_context import RenderColorContext  # noqa: E402
from hdr_finisher.delivery_colour import compare_finished_pixels  # noqa: E402
from hdr_finisher.library_pictures import decode_picture  # noqa: E402
from hdr_finisher.models import AdjustmentState, PreviewKind  # noqa: E402


def finished(pixels, adjustments):
    """Render exactly as Library thumbnails do."""
    adjustments = AdjustmentState.model_validate(adjustments)
    adjustments.hdr.highlight_compression_target_nits = 1000
    context = RenderColorContext(203)
    out = {}
    for kind in (PreviewKind.SDR, PreviewKind.HDR):
        image = apply_adjustments(pixels, adjustments, kind, include_grain=True,
                                  include_output_highlight_compression=False, color_context=context)
        out[kind.value] = (apply_hdr_output_highlight_compression(image, adjustments, color_context=context)
                           if kind == PreviewKind.HDR else apply_sdr_output_highlight_compression(image, adjustments))
    return out


def main(result_path: str) -> None:
    result = json.loads(Path(result_path).read_text(encoding="utf-8"))
    pictures = Path(result["location"]) / "library-pictures"
    photos = []
    for row in result["rows"]:
        with np.load(pictures / (row["key"] + ".npz"), allow_pickle=False) as stored:
            gpu = stored["pixels"].astype(np.float32)
            gpu_meta = json.loads(str(stored["metadata"]))
        started = perf_counter()
        cpu, _reference, cpu_meta = decode_picture(Path(row["path"]), 640, "grade-thumbnail")
        cpu_s = perf_counter() - started
        entry = {"photo": Path(row["path"]).name, "cpu_development_s": round(cpu_s, 2),
                 "lens_correction_applied": gpu_meta.get("lens_correction_applied")}
        if gpu.shape != cpu.shape:
            entry.update(sdr={"passed": False, "mean": None, "p999": None, "error": f"{gpu.shape} vs {cpu.shape}"}, hdr={"passed": False})
            photos.append(entry)
            continue
        a, b = finished(cpu, cpu_meta["starting_look"]), finished(gpu, gpu_meta["adjustments"])
        for lane in ("sdr", "hdr"):
            difference = compare_finished_pixels(a[lane], b[lane], lane)
            entry[lane] = {"mean": round(difference.mean, 4), "p999": round(difference.p999, 4), "passed": difference.passed}
        photos.append(entry)
    print(json.dumps({"photos": photos}))


if __name__ == "__main__":
    main(sys.argv[1])
