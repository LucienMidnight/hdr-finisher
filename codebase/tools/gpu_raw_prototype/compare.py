"""Compare the GPU RAW prototype with Grade's CPU development.

For each prepared photo: the full-source measurements, then finished SDR and
HDR pictures at the Library sizes (640 and 2560 px), each rendered from its own
development with its own starting grade, exactly as Library thumbnails render.
Colour difference uses the project's perceptual helper (Delta E 2000 for SDR,
Delta E ITP for HDR; agreed limits mean < 1.0, p99.9 <= 3.0).

Usage: python compare.py <prepared name> [...]   (writes summary.json per photo)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

CODEBASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(CODEBASE / "backend"))

from hdr_finisher.adjustments import (  # noqa: E402
    apply_adjustments, apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression)
from hdr_finisher.color_context import RenderColorContext  # noqa: E402
from hdr_finisher.delivery_colour import compare_finished_pixels  # noqa: E402
from hdr_finisher.import_defaults import starting_adjustments  # noqa: E402
from hdr_finisher.models import HDRAnalysis, PreviewKind  # noqa: E402

ROOT = CODEBASE / "output" / "gpu-raw-prototype"


def orient(image, flip):
    if flip == 3:
        return image[::-1, ::-1]
    if flip == 6:
        return np.rot90(image, k=-1)
    if flip == 5:
        return np.rot90(image, k=1)
    return image


def finished(pixels, analysis):
    adjustments = starting_adjustments(analysis)
    adjustments.hdr.highlight_compression_target_nits = 1000
    context = RenderColorContext(203)
    out = {}
    for kind in (PreviewKind.SDR, PreviewKind.HDR):
        image = apply_adjustments(pixels, adjustments, kind, include_grain=True,
                                  include_output_highlight_compression=False, color_context=context)
        out[kind.value.lower()] = (apply_hdr_output_highlight_compression(image, adjustments, color_context=context)
                                   if kind == PreviewKind.HDR else apply_sdr_output_highlight_compression(image, adjustments))
    return out


def compare(name: str) -> dict:
    folder = ROOT / name
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    report = json.loads((folder / "gpu.json").read_text(encoding="utf-8"))
    cpu = np.load(folder / "cpu.npz")
    cpu_analysis = HDRAnalysis.model_validate(json.loads(str(cpu["analysis"])))
    sh, sw = report["sampleShape"]
    samples = np.fromfile(folder / "gpu_samples.bin", dtype="<f4").reshape(sh, sw, 3)
    peaks = report["peaks"]
    gpu_analysis = cpu_analysis.model_copy(update={
        "peak_linear": peaks["peak"], "robust_peak_linear": float(np.quantile(samples[..., 1], 0.9999)),
        "peak_luma_linear": peaks["peak_luma"], "robust_peak_luma_linear": float(np.quantile(samples[..., 0], 0.9999)),
        "peak_bt2020_linear": peaks["peak_bt2020"], "robust_peak_bt2020_linear": float(np.quantile(samples[..., 2], 0.9999)),
    })
    measures = {}
    for field in ("peak_linear", "robust_peak_linear", "peak_luma_linear", "robust_peak_luma_linear",
                  "peak_bt2020_linear", "robust_peak_bt2020_linear"):
        a, b = getattr(cpu_analysis, field), getattr(gpu_analysis, field)
        measures[field] = {"cpu": a, "gpu": b, "relative": (b - a) / a if a else None}
    result = {"photo": meta["name"], "flip": meta["flip"], "measures": measures, "pictures": {}}
    for edge in ("640", "2560"):
        rh, rw = report["reduced"][edge]
        gpu = np.fromfile(folder / f"gpu_{edge}.bin", dtype="<f4").reshape(3, rh, rw).transpose(1, 2, 0)
        gpu = np.ascontiguousarray(orient(gpu, meta["flip"]))
        ref = cpu[f"reduced_{edge}"].astype(np.float32)
        if gpu.shape != ref.shape:
            result["pictures"][edge] = {"error": f"shape {gpu.shape} vs CPU {ref.shape}"}
            continue
        scene = np.abs(gpu - ref)
        a, b = finished(ref, cpu_analysis), finished(gpu, gpu_analysis)
        entry = {"scene_linear_max_abs": float(scene.max()), "scene_linear_mean_abs": float(scene.mean())}
        for lane in ("sdr", "hdr"):
            difference = compare_finished_pixels(a[lane], b[lane], lane)
            entry[lane] = {"metric": difference.metric, "mean": round(difference.mean, 4),
                           "p999": round(difference.p999, 4), "passed": difference.passed}
        if edge == "640":
            np.save(folder / "finished_cpu_sdr_640.npy", a["sdr"]); np.save(folder / "finished_gpu_sdr_640.npy", b["sdr"])
        result["pictures"][edge] = entry
    runs = report["runs"]
    warm = [r for r in runs[1:] if not r.get("unsynced")]
    result["gpu_ms"] = {"warm_synced_total": [round(r["total_ms"]) for r in warm],
                        "unsynced_total": [round(r["total_ms"]) for r in runs if r.get("unsynced")],
                        "warm_stages": warm[-1]["stages"] if warm else None}
    result["cpu_s"] = json.loads(str(cpu["timings"]))
    result["highlights"] = {"clipped_per_rgb": report["clipped"], "chroma": report["chroma"]}
    (folder / "summary.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


if __name__ == "__main__":
    for argument in sys.argv[1:]:
        summary = compare(argument)
        print(json.dumps({"photo": summary["photo"], "pictures": summary["pictures"],
                          "peaks": {k: v["relative"] for k, v in summary["measures"].items()},
                          "gpu_ms": summary["gpu_ms"]["unsynced_total"], "cpu_s": round(summary["cpu_s"]["total_s"], 2)}))
