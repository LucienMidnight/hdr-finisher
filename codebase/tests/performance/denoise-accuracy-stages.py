"""Isolate denoise order and grade amplification on a saved project; read only."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher import denoise_adaptive as da
from hdr_finisher.adjustments import apply_fixed_source_adjustments
from hdr_finisher.models import PreviewKind
from hdr_finisher.projects import open_project
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sessions import SessionStore
from hdr_finisher.exporters import _denoised_export_source

difference = runpy.run_path(str(Path(__file__).with_name("denoise-intermediate-parity.py")))["difference"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("output/performance/denoise-accuracy-stages.json"))
    parser.add_argument("--fractions", type=float, nargs="+", default=[.25, .5, .75])
    args = parser.parse_args()
    project_digest = hashlib.sha256(args.project.read_bytes()).digest()
    session = open_project(SessionStore(), args.project)
    adjustments = session.adjustments.model_copy(deep=True)
    lane = session.denoise.hdr
    controls = da.AdaptiveControls(**lane.controls.model_dump())
    lane.enabled = True
    lane.analysis.algorithm_version = da.ALGORITHM_VERSION
    exported = _denoised_export_source(session, PreviewKind.HDR)
    export_cache = SessionRenderCache(exported, None, color_context=session.color_context)
    direct_cache = SessionRenderCache(session.image, None, color_context=session.color_context)
    native = max(session.image.shape[:2])
    rows = []
    for fraction in args.fractions:
        edge = round(native * fraction)
        raw, *_ = session.render_cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        direct, *_ = direct_cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        reference, *_ = export_cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        model = da.estimate_adaptive_model(session.image if edge >= native else raw)
        filtered = da.resolve_adaptive(raw, model, controls)
        grade = lambda image: apply_fixed_source_adjustments(image, adjustments, PreviewKind.HDR,
            include_grain=False, include_output_highlight_compression=False,
            color_context=session.color_context, source_pixel_scale=edge/native)
        row = {"edge": edge, "sourceCacheVsFresh": difference(raw, direct),
            "rawPreviewVsExport": difference(filtered, reference),
            "gradedPreviewVsExport": difference(grade(filtered), grade(reference)),
            "rawWithoutDenoiseVsExport": difference(raw, reference),
            "rawPreviewRemoval": difference(filtered, raw), "model": model.as_dict(),
            "controls": lane.controls.model_dump()}
        # Denoise before geometry at this resolution isolates geometry ordering.
        source, _ = session.render_cache.source_proxy(PreviewKind.HDR, edge)
        source_model = da.estimate_adaptive_model(source)
        source_filtered = da.resolve_adaptive(source, source_model, controls)
        source_cache = SessionRenderCache(source_filtered, None, color_context=session.color_context)
        before_geometry, *_ = source_cache.geometry_source_proxy(PreviewKind.HDR, edge, adjustments)
        row["rawDenoiseBeforeGeometryVsExport"] = difference(before_geometry, reference)
        rows.append(row)
        print(json.dumps(row), flush=True)
    assert hashlib.sha256(args.project.read_bytes()).digest() == project_digest, "Saved project changed during the diagnostic."
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"project": str(args.project), "results": rows}, indent=2)+"\n", encoding="utf-8")

if __name__ == "__main__":
    main()
