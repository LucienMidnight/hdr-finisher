"""Compare reused intermediate HDR models against fresh models and export.
Run with .venv/Scripts/python.exe tests/performance/denoise-intermediate-parity.py
Add --project PATH to read the saved 42 MP example without modifying it.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import time
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher import denoise_adaptive as da
from hdr_finisher.adjustments import apply_adjustments, apply_fixed_source_adjustments
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.projects import open_project
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sessions import SessionStore
from hdr_finisher.exporters import _denoised_export_source
from hdr_finisher.finishing import _resize_lanczos


def difference(actual, reference):
    # ACEScg luminance. Avoid relative error at black and excluded geometry edges.
    weights = np.array([0.27222872, 0.67408177, 0.05368952], dtype=np.float32)
    a = actual[..., :3] @ weights
    b = reference[..., :3] @ weights
    margin = min(8, min(a.shape) // 10)
    a, b = a[margin:-margin, margin:-margin], b[margin:-margin, margin:-margin]
    valid = b > max(1e-5, float(np.median(b)) * 0.01)
    error = np.abs(a[valid] - b[valid]) / b[valid]
    return {"p99Percent": float(np.quantile(error, 0.99) * 100),
            "medianPercent": float(np.median(error) * 100), "pixels": int(error.size)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path)
    parser.add_argument("--model-base", choices=["first-view", "source"], default="first-view")
    parser.add_argument("--aligned-only", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("output/performance/denoise-intermediate-parity.json"))
    args = parser.parse_args()
    if args.project:
        session = open_project(SessionStore(), args.project)
        image, adjustments, cache = session.image, session.adjustments.model_copy(deep=True), session.render_cache
        lane = session.denoise.hdr
        c = lane.controls
        controls = da.AdaptiveControls(amount=c.amount, luminance=c.luminance, color_noise=c.color_noise,
            detail_recovery=c.detail_recovery, finest_noise=c.finest_noise, fine_noise=c.fine_noise,
            medium_noise=c.medium_noise, coarse_noise=c.coarse_noise)
        # Enable Adaptive only in this disposable in-memory session.
        lane.enabled = True
        lane.analysis.algorithm_version = da.ALGORITHM_VERSION
        exported_source = _denoised_export_source(session, PreviewKind.HDR)
        context = session.color_context
    else:
        rng = np.random.default_rng(20261004)
        y, x = np.mgrid[:1600, :2400].astype(np.float32)
        base = 0.04 + x / 2400 * .5 + y / 1600 * .2
        base += ((x // 120 + y // 100) % 2) * .08
        clean = np.stack([base, base * .9, base * .8], axis=-1)
        image = (clean + rng.standard_normal(clean.shape) * np.sqrt(clean * .001 + .0001)).astype(np.float32)
        adjustments = AdjustmentState()
        cache = SessionRenderCache(image, None)
        context = cache.color_context
        controls = da.AdaptiveControls()
        exported_source = da.resolve_adaptive(image, da.estimate_adaptive_model(image), controls)
    export_cache = SessionRenderCache(exported_source, None, color_context=context)
    initial = adjustments.shared.geometry.model_copy(deep=True)
    native = max(image.shape[:2])
    edges = [round(native * fraction) for fraction in (.25, .5, .75)]
    models = {}
    for edge in edges:
        if args.model_base == "source":
            proxy, _ = cache.source_proxy(PreviewKind.HDR, edge)
        else:
            proxy, *_ = cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        models[edge] = da.estimate_adaptive_model(proxy)
    geometries = {
        "initial": initial,
        "straighten": initial.model_copy(update={"straighten_angle": 7.0}),
        "strong perspective": GeometryAdjustments(perspective_horizontal=30, perspective_vertical=-20, perspective_rotate=5),
        "quarter turn and crop": GeometryAdjustments(rotation=90, crop={"x": .12, "y": .08, "width": .65, "height": .75}),
    }
    results = []
    for name, geometry in geometries.items():
        adjustments.shared.geometry = geometry
        # Export's actual order: denoise native source, then geometry and grade.
        reference = None if args.aligned_only else apply_adjustments(exported_source, adjustments, PreviewKind.HDR,
            include_grain=False, include_output_highlight_compression=False, color_context=context)
        for edge in edges:
            started = time.perf_counter()
            proxy, *_ = cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
            reused = da.resolve_adaptive(proxy, models[edge], controls)
            fresh = da.resolve_adaptive(proxy, da.estimate_adaptive_model(proxy), controls)
            grade = lambda value: apply_fixed_source_adjustments(value, adjustments, PreviewKind.HDR,
                include_grain=False, include_output_highlight_compression=False,
                color_context=context, source_pixel_scale=edge/native)
            preview = grade(reused)
            old = grade(fresh)
            expected = None if reference is None else _resize_lanczos(reference, preview.shape[1], preview.shape[0])
            # Separate denoise differences from resolution-dependent geometry
            # rounding/grade order. Sample the actual denoised export source
            # through exactly the preview's geometry and scale for alignment.
            aligned, *_ = export_cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
            aligned = grade(aligned)
            row = {"geometry": name, "edge": edge, "reusedVsFresh": difference(preview, old),
                   "reusedVsAlignedExportSource": difference(preview, aligned),
                   "freshVsAlignedExportSource": difference(old, aligned),
                   "reusedVsFullExport": None if expected is None else difference(preview, expected),
                   "freshVsFullExport": None if expected is None else difference(old, expected),
                   "seconds": time.perf_counter() - started}
            results.append(row)
            print(json.dumps(row), flush=True)
        del reference
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"project": str(args.project), "native": native, "modelBase": args.model_base,
        "reference": "native denoise -> geometry -> saved global grade; grain/compression/locals excluded; full-export reference uses Lanczos resize; aligned-source reference uses preview sampling",
        "results": results}, indent=2) + "\n", encoding="utf-8")
    assert max(row["reusedVsFresh"]["p99Percent"] for row in results) <= 2.5
    assert max(row["reusedVsAlignedExportSource"]["p99Percent"] for row in results) <= 2.5


if __name__ == "__main__":
    main()
