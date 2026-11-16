"""Probe option-B output tails without changing the renderer, recipes or gates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

os.environ.setdefault("HDR_CPU_THREADS", "2")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import colour
import numpy as np

from hdr_finisher.adjustments import (
    SDR_SCENE_TO_DISPLAY_SCALE,
    _acescg_luma,
    apply_adjustments,
    apply_sdr_output_highlight_compression,
)
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.sdr_match import (
    _highlight_order_is_safe,
    _quality_metrics,
    build_sdr_match_target,
)


def lab(image):
    space = colour.RGB_COLOURSPACES["sRGB"]
    return colour.XYZ_to_Lab(np.asarray(image, dtype=float) @ space.matrix_RGB_to_XYZ.T, space.whitepoint)


def body_pass(quality):
    return (
        quality.p95_oklab_error <= .050
        and quality.median_oklab_error <= .015
        and quality.median_luma_error <= .010
        and quality.p95_luma_error <= .030
    )


def frame_metrics(hdr, target, candidate, raised):
    highlights = _acescg_luma(hdr) * SDR_SCENE_TO_DISPLAY_SCALE > .9
    quality = _quality_metrics(target, candidate, ~highlights)
    errors = colour.difference.delta_E_CIE2000(lab(target), lab(candidate))
    white_before = np.mean(candidate @ np.array([.2126, .7152, .0722]) >= .999)
    white_after = np.mean(raised @ np.array([.2126, .7152, .0722]) >= .999)
    return {
        "body": quality.model_dump(),
        "body_pass": body_pass(quality),
        "order_pass": _highlight_order_is_safe(hdr, candidate),
        "white_growth_points": float(100 * (white_after - white_before)),
        "white_growth_pass": bool(white_after - white_before <= .01),
        "whole_p95": float(np.percentile(errors, 95)),
        "highlight_p95": float(np.percentile(errors[highlights], 95)) if np.any(highlights) else None,
    }


def measure(hdr, target, candidate, raised, patch_count):
    if (patch_count not in (176, 224) or np.prod(hdr.shape[:-1]) != patch_count
            or hdr.shape != target.shape or candidate.shape != target.shape or raised.shape != target.shape):
        raise ValueError("Expected aligned original 176/224-patch trial frames.")
    quality = _quality_metrics(target, candidate, _acescg_luma(hdr) * SDR_SCENE_TO_DISPLAY_SCALE <= .9)
    errors = colour.difference.delta_E_CIE2000(lab(target), lab(candidate)).reshape(-1)
    families = (patch_count - 8) // 24
    grouped = errors[:families * 24].reshape(families, 3, 8)
    white_before = np.mean(candidate @ np.array([.2126, .7152, .0722]) >= .999)
    white_after = np.mean(raised @ np.array([.2126, .7152, .0722]) >= .999)
    names = ["denim", "indigo", "cyan", "red", "green", "magenta", "skin", "bt2020_blue", "bt2020_green"][:families]
    percentiles = np.percentile(grouped[:, :, 5:8], 95, axis=1)
    return {
        "body": quality.model_dump(),
        "body_pass": body_pass(quality),
        "order_pass": _highlight_order_is_safe(hdr, candidate),
        "white_growth_points": float(100 * (white_after - white_before)),
        "white_growth_pass": bool(white_after - white_before <= .01),
        "bright_family_stop_p95_max": float(np.max(percentiles)),
        "bright_family_stop_p95": {name: {str(stop): float(percentiles[index, stop - 1]) for stop in range(1, 4)}
                                   for index, name in enumerate(names)},
        "whole_p95": float(np.percentile(errors, 95)),
    }


def fixed_luma_gamut(image):
    luma = np.clip(image @ np.array([.2126, .7152, .0722]), 0, 1)[..., None]
    chroma = image - luma
    positive = np.divide(1 - luma, chroma, out=np.full_like(image, np.inf), where=chroma > 0)
    negative = np.divide(-luma, chroma, out=np.full_like(image, np.inf), where=chroma < 0)
    strength = np.minimum(1, np.min(np.minimum(positive, negative), axis=-1, keepdims=True))
    return np.clip(luma + strength * chroma, 0, 1).astype(np.float32)


def finish(placed, state, gamut, exposure=0, saturation=1):
    scaled = placed * np.float32(2 ** exposure)
    if saturation != 1:
        luma = (scaled @ np.array([.2126, .7152, .0722], dtype=np.float32))[..., None]
        scaled = luma + np.float32(saturation) * (scaled - luma)
    mapped = apply_sdr_output_highlight_compression(scaled, state)
    if gamut == "adaptive":
        return mapped
    from hdr_finisher.adjustments import _compress_sdr_highlights

    return fixed_luma_gamut(_compress_sdr_highlights(scaled, state.sdr))


def baseline(fixtures, sources):
    stocks = [("none", 0)] + [(stock, strength) for stock in
              ["kodak_portra_400", "kodak_ektar_100", "fujifilm_velvia_100"] for strength in [50, 100]]
    rows = []
    for population in ["chart176", "chart224", "A7R00619.ARW", "DSC00264.ARW", "IMG_3129.CR2", "IMG_0790.CR2", "IMG_7723.CR3"]:
        cases = json.loads((fixtures / f"{population}-cases.json").read_text())
        for stock, strength in stocks:
            case = next(case for case in cases if case["stock"] == stock and case["strength"] == strength)
            name = f"{population}-{stock}-{strength}"
            archive_path = fixtures / f"{population if population.startswith('chart') else 'chart176'}-{stock}-{strength}-gpu.npz"
            with np.load(archive_path) as archive:
                state = AdjustmentState.model_validate_json(str(archive["adjustments"]))
                source = archive["source"]
            if not population.startswith("chart"):
                with np.load(sources / f"{population}.npz") as archive:
                    source = archive["source"]
            common = apply_adjustments(source, state, PreviewKind.HDR, include_grain=False,
                                       include_output_highlight_compression=False, apply_output_clamp=False,
                                       color_context=RenderColorContext(203))
            hdr = apply_adjustments(source, state, PreviewKind.HDR, include_grain=False, color_context=RenderColorContext(203))
            target = build_sdr_match_target(hdr)
            tail = AdjustmentState()
            tail.sdr.highlight_compression_mode = case["body"]["mode"]
            tail.sdr.highlight_compression_start_percent = case["body"]["start"]
            tail.sdr.highlight_compression_softness = 100
            placed = acescg_to_linear_srgb(common) * np.float32(SDR_SCENE_TO_DISPLAY_SCALE)
            candidate = finish(placed, tail, "adaptive")
            raised = finish(placed, tail, "adaptive", .5)
            measured = measure(hdr, target, candidate, raised, source.shape[0] * source.shape[1]) if population.startswith("chart") else frame_metrics(hdr, target, candidate, raised)
            rows.append(dict(case=name, hdr_exact=bool(np.array_equal(hdr, np.maximum(common, 0))),
                             mode=tail.sdr.highlight_compression_mode, start=tail.sdr.highlight_compression_start_percent,
                             target_order_pass=_highlight_order_is_safe(hdr, target), **measured))
        print(population, "baseline complete", flush=True)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=ROOT / "output/review/film-equal-input-trial-2026-11-16")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--population", choices=["chart176", "chart224"], default="chart176")
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--sources", type=Path, default=ROOT / "output/review/m1-all-colours/reduced-sources")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    provenance = dict(revision=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                      script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                      backend_sha256={name: hashlib.sha256((ROOT / "backend/hdr_finisher" / name).read_bytes()).hexdigest()
                                      for name in ["adjustments.py", "sdr_match.py", "sdr_gamut.py", "color.py", "models.py"]})
    if args.baseline:
        rows = baseline(args.fixtures, args.sources)
        inputs = sorted(args.fixtures.glob("*-cases.json")) + sorted(args.fixtures.glob("chart*-gpu.npz")) + sorted(args.sources.glob("*.npz"))
        result = dict(**provenance, input_sha256={str(filename): hashlib.sha256(filename.read_bytes()).hexdigest() for filename in inputs},
                      rows=rows, totals={key: sum(row[key] for row in rows) for key in
                                       ["body_pass", "order_pass", "white_growth_pass", "target_order_pass", "hdr_exact"]})
        (args.output / "baseline.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        print(result["totals"], flush=True)
        return
    rows = []
    files = sorted(args.fixtures.glob(f"{args.population}-*-gpu.npz"))
    if len(files) != 7:
        raise ValueError("The seven original trial chart fixtures are required.")
    for filename in files:
        with np.load(filename) as archive:
            common = archive["common"]
            hdr = archive["hdr"]
        target = build_sdr_match_target(hdr)
        placed = acescg_to_linear_srgb(common) * np.float32(SDR_SCENE_TO_DISPLAY_SCALE)
        best = {}
        passing = []
        count = 0
        for gamut in ["adaptive", "fixed_luma"]:
            for mode in ["soft_ceiling", "fixed_cap", "peak_fit", "clip"]:
                for start in ([90] if mode == "clip" else [10, 30, 50, 70, 80, 85, 90, 92, 95, 97, 99]):
                    for exposure, saturation in [(exposure, saturation) for exposure in [-.25, -.10, 0, .10, .25]
                                                for saturation in [.5, .75, .9, 1, 1.1, 1.25]]:
                        state = AdjustmentState()
                        state.sdr.highlight_compression_mode = mode
                        state.sdr.highlight_compression_start_percent = start
                        state.sdr.highlight_compression_softness = 100
                        candidate = finish(placed, state, gamut, exposure, saturation)
                        raised = finish(placed, state, gamut, exposure + .5, saturation)
                        measured = measure(hdr, target, candidate, raised, hdr.shape[0] * hdr.shape[1])
                        count += 1
                        row = dict(gamut=gamut, mode=mode, start=start, exposure=exposure, saturation=saturation, **measured)
                        for requirement, safe in [
                            ("body", measured["body_pass"]),
                            ("body_order", measured["body_pass"] and measured["order_pass"]),
                            ("body_order_growth", measured["body_pass"] and measured["order_pass"] and measured["white_growth_pass"]),
                        ]:
                            if safe and (requirement not in best or measured["bright_family_stop_p95_max"] < best[requirement]["bright_family_stop_p95_max"]):
                                best[requirement] = row
                        if measured["body_pass"] and measured["order_pass"] and measured["white_growth_pass"] and measured["bright_family_stop_p95_max"] <= 3:
                            passing.append(row)
        rows.append(dict(fixture=filename.name, fixture_sha256=hashlib.sha256(filename.read_bytes()).hexdigest(), candidates=count, best=best, passing=passing))
        print(filename.name, json.dumps({key: value["bright_family_stop_p95_max"] for key, value in best.items()}), "passing", len(passing), flush=True)
    result = dict(**provenance, population=args.population, rows=rows)
    (args.output / f"{args.population}.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
