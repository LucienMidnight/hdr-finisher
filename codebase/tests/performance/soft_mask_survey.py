"""How well does a small bitmap stand in for each mask of a project? (Viewport PRD 5.1)

Measurement only; no mask or renderer code is involved beyond calling it.

For every local adjustment the exact mask is the one the export uses
(``compile_geometry_fixed_mask`` on the full-resolution source). The candidate
soft mask is the same expression compiled in source space on a source proxy of
a given long edge, then sampled bilinearly at each output pixel's own source
position, the way a shader would sample one small texture at any zoom.

Reported per mask and per bitmap size:
  * the true difference from the exact mask, in 255ths (PRD 4.2 allows 2), for
    the bitmap rounded to 8 bits and for the same bitmap left unrounded;
  * two things an app could measure without the exact mask, to see whether
    either predicts the true difference: the bitmap against the same mask
    compiled at half its size, and the bitmap's own largest second difference;
  * compile times.

    .venv\\Scripts\\python.exe tests\\performance\\soft_mask_survey.py ^
        --project <file.hdrfinisher> --out output/performance/review/<run>/soft-mask-survey.json

The project and its source are only read.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reference_session import isolate_source_cache, open_reference_session  # noqa: E402

SOFT_LIMIT_LEVELS = 2
BAND_ROWS = 512


def sample_bilinear(bitmap: np.ndarray, column: np.ndarray, row: np.ndarray) -> np.ndarray:
    """Clamp-to-edge bilinear sample of ``bitmap`` at texel-space positions."""
    height, width = bitmap.shape
    column = np.clip(column, 0.0, width - 1.0)
    row = np.clip(row, 0.0, height - 1.0)
    left = np.minimum(column.astype(np.int32), width - 2) if width > 1 else np.zeros(column.shape, np.int32)
    top = np.minimum(row.astype(np.int32), height - 2) if height > 1 else np.zeros(row.shape, np.int32)
    across = (column - left).astype(np.float32)
    down = (row - top).astype(np.float32)
    right = np.minimum(left + 1, width - 1)
    bottom = np.minimum(top + 1, height - 1)
    upper = bitmap[top, left] * (1.0 - across) + bitmap[top, right] * across
    lower = bitmap[bottom, left] * (1.0 - across) + bitmap[bottom, right] * across
    return upper * (1.0 - down) + lower * down


def difference(bitmap: np.ndarray, target: np.ndarray, source_x: np.ndarray, source_y: np.ndarray) -> dict[str, Any]:
    """``bitmap`` sampled at each target pixel's source position, against ``target`` (uint8)."""
    height, width = bitmap.shape
    values = bitmap.astype(np.float32)
    worst = 0.0
    worst_at = (0, 0)
    over = 0
    differing = 0
    histogram = np.zeros(257, dtype=np.int64)
    for start in range(0, target.shape[0], BAND_ROWS):
        band = slice(start, start + BAND_ROWS)
        sampled = sample_bilinear(values, source_x[band] * width - 0.5, source_y[band] * height - 0.5)
        delta = np.abs(sampled - target[band])
        histogram += np.bincount(np.minimum(np.ceil(delta - 1e-4), 256).astype(np.int64).ravel(), minlength=257)
        over += int(np.count_nonzero(delta > SOFT_LIMIT_LEVELS))
        differing += int(np.count_nonzero(delta > 0.5))
        index = int(np.argmax(delta))
        if float(delta.flat[index]) > worst:
            worst = float(delta.flat[index])
            worst_at = (start + index // delta.shape[1], index % delta.shape[1])
    pixels = int(target.size)
    cumulative = np.cumsum(histogram)
    p999 = int(np.searchsorted(cumulative, 0.999 * pixels))
    return {
        "maxLevels": round(worst, 3),
        "p999Levels": p999,
        "pixelsOverSoftLimit": over,
        "fractionOverSoftLimit": round(over / max(1, pixels), 8),
        "pixelsOverHalfLevel": differing,
        "worstPixel": {"x": int(worst_at[1]), "y": int(worst_at[0])},
        "softOk": worst <= SOFT_LIMIT_LEVELS,
    }


def second_difference_bound(bitmap: np.ndarray) -> float:
    """Bilinear interpolation error implied by the bitmap's own curvature, in levels."""
    values = bitmap.astype(np.float32)
    across = np.abs(values[:, 2:] - 2.0 * values[:, 1:-1] + values[:, :-2]).max(initial=0.0)
    down = np.abs(values[2:] - 2.0 * values[1:-1] + values[:-2]).max(initial=0.0)
    return round(float(across + down) / 8.0, 3)


def describe(expression: Any, long_edge: int) -> dict[str, Any]:
    from hdr_finisher.local_adjustments import _luminance_mask_feather_radius, _painted_mask_feather_radius

    if expression.operator != "leaf" or expression.leaf is None:
        return {"kind": expression.operator, "children": len(expression.children)}
    leaf = expression.leaf
    summary: dict[str, Any] = {"kind": leaf.type, "inverted": bool(expression.inverted)}
    if leaf.type == "brush":
        strokes = leaf.strokes
        summary.update({
            "strokes": len(strokes),
            "eraseStrokes": sum(1 for stroke in strokes if stroke.erase),
            "segments": sum(max(0, len(stroke.points) - 1) for stroke in strokes),
            "hardness": sorted({round(float(stroke.hardness), 3) for stroke in strokes}),
            "shiftEdge": float(leaf.mask_shift_edge),
            "feather": float(leaf.mask_feather),
            "featherSigmaNativePixels": round(_painted_mask_feather_radius(leaf.mask_feather) * long_edge, 1),
        })
    elif leaf.type == "luminance_range":
        summary.update({
            "feather": float(leaf.mask_feather),
            "featherSigmaNativePixels": round(_luminance_mask_feather_radius(leaf.mask_feather) * long_edge, 1),
        })
    elif leaf.type == "path":
        summary.update({"feather": float(leaf.feather), "featherMode": leaf.feather_mode,
                        "featherNodes": len(leaf.feather_nodes)})
    elif leaf.type == "linear_gradient":
        summary.update({"fan": float(leaf.gradient_fan), "luma": bool(leaf.gradient_luma_enabled)})
    return summary


def run(project: Path, output: Path, edges: list[int], limit: int | None) -> dict[str, Any]:
    isolate_source_cache(output.parent / "source-cache")
    from hdr_finisher.finishing import apply_geometry
    from hdr_finisher.local_adjustments import (
        compile_geometry_fixed_mask, compile_preview_mask, evaluate_mask, source_coordinate_grid,
        spatial_mask_expression,
    )
    from hdr_finisher.models import GeometryAdjustments

    _store, session = open_reference_session(project)
    geometry = session.adjustments.shared.geometry
    source_height, source_width = session.image.shape[:2]
    long_edge = max(source_width, source_height)

    # Each output pixel's position in the source, through the export's own geometry.
    columns = np.broadcast_to((np.arange(source_width, dtype=np.float32) + 0.5) / source_width, (source_height, source_width))
    rows = np.broadcast_to(((np.arange(source_height, dtype=np.float32) + 0.5) / source_height)[:, None], (source_height, source_width))
    source_x = apply_geometry(np.ascontiguousarray(columns)[..., None], geometry)[..., 0]
    source_y = apply_geometry(np.ascontiguousarray(rows)[..., None], geometry)[..., 0]

    sizes = sorted({edge for edge in edges} | {edge // 2 for edge in edges})
    proxies = {edge: session.render_cache._proxies(edge)[0] for edge in sizes}
    report: dict[str, Any] = {
        "project": str(project),
        "sourceSize": [source_width, source_height],
        "outputSize": [int(source_x.shape[1]), int(source_x.shape[0])],
        "softLimitLevels": SOFT_LIMIT_LEVELS,
        "bitmapLongEdges": edges,
        "proxySizes": {str(edge): [int(proxy.shape[1]), int(proxy.shape[0])] for edge, proxy in proxies.items()},
        "sampling": "source-space bitmap, clamp-to-edge bilinear at each output pixel's source position",
        "masks": [],
    }
    locals_ = [item for item in session.local_adjustments if item.enabled and item.opacity > 0.0]
    for local in locals_[:limit]:
        expression = spatial_mask_expression(local.mask)
        started = time.perf_counter()
        exact = compile_geometry_fixed_mask(session.image, local.mask, geometry, spatial_only=True)
        exact_seconds = time.perf_counter() - started
        entry: dict[str, Any] = {
            "localId": local.id,
            "name": local.name,
            **describe(local.mask, long_edge),
            "exactCompileMs": round(exact_seconds * 1000.0, 1),
            "exactCoverage": round(float(np.count_nonzero(exact)) / exact.size, 5),
            "bitmaps": [],
        }
        compiled: dict[int, np.ndarray] = {}
        compile_ms: dict[int, float] = {}
        for edge in sizes:
            started = time.perf_counter()
            compiled[edge] = compile_preview_mask(proxies[edge], expression, GeometryAdjustments())
            compile_ms[edge] = round((time.perf_counter() - started) * 1000.0, 1)
        for edge in edges:
            bitmap = compiled[edge]
            half = compiled[edge // 2]
            height, width = bitmap.shape
            # The same bitmap before it is rounded to 8 bits, as a float texture would hold it.
            unrounded = evaluate_mask(
                expression, proxies[edge], *source_coordinate_grid(width, height, 0, 0, width, height, GeometryAdjustments()),
                width / max(height, 1),
            ) * np.float32(255.0)
            grid_x = np.broadcast_to((np.arange(width, dtype=np.float32) + 0.5) / width, (height, width))
            grid_y = np.broadcast_to(((np.arange(height, dtype=np.float32) + 0.5) / height)[:, None], (height, width))
            entry["bitmaps"].append({
                "longEdge": edge,
                "size": [int(width), int(height)],
                "bytes": int(bitmap.size),
                "compileMs": compile_ms[edge],
                "halfSizeCompileMs": compile_ms[edge // 2],
                "againstExact": difference(bitmap, exact, source_x, source_y),
                "unroundedAgainstExact": difference(unrounded, exact, source_x, source_y),
                "halfSizeAgainstThis": difference(half, bitmap, grid_x, grid_y),
                "secondDifferenceBoundLevels": second_difference_bound(bitmap),
            })
        report["masks"].append(entry)
        print(f"{entry['name']:<22} {entry['kind']:<16} exact {entry['exactCompileMs']:>8.0f} ms | " + " | ".join(
            f"{item['longEdge']}: max {item['againstExact']['maxLevels']:.2f}"
            f" over {item['againstExact']['pixelsOverSoftLimit']}"
            f", unrounded {item['unroundedAgainstExact']['maxLevels']:.2f}"
            f" (half-size {item['halfSizeAgainstThis']['maxLevels']:.2f},"
            f" curvature {item['secondDifferenceBoundLevels']:.2f}, {item['compileMs']:.0f} ms)"
            for item in entry["bitmaps"]), flush=True)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Small-bitmap stand-in survey for a project's masks")
    parser.add_argument("--project", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--edges", default="1600,3200", help="bitmap long edges, in source pixels")
    parser.add_argument("--limit", type=int, default=None, help="measure only the first N locals")
    arguments = parser.parse_args()
    run(Path(arguments.project).resolve(), Path(arguments.out).resolve(),
        [int(edge) for edge in arguments.edges.split(",") if edge], arguments.limit)
    print(f"Wrote {arguments.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
