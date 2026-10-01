"""Random masks: when can one small bitmap stand in for the exact mask? (Viewport PRD 5.1)

Measurement only. For each random brush, gradient or path mask this compiles

  * the exact mask, as the export does, on a full-resolution frame, and
  * the small bitmap the backend serves for a Fit-sized view,

samples the bitmap bilinearly at every full-resolution pixel, as the renderer
does, and records the largest difference in 255ths beside the things the app
could know without the exact mask: the mask's settings and how sharply the
bitmap itself bends (its largest second difference). The soft-mask rule in
``hdr_finisher.mask_softness`` is calibrated against, and tested by, this.

    .venv\\Scripts\\python.exe tests\\performance\\soft_mask_fuzz.py ^
        --out output/performance/review/<run>/soft-mask-fuzz.json --count 240
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from soft_mask_survey import difference  # noqa: E402


def random_brush(rng: np.random.Generator, kind: str) -> dict[str, Any]:
    strokes = []
    count = int(rng.integers(1, 9))
    for index in range(count):
        points = []
        x, y = rng.uniform(0.05, 0.95), rng.uniform(0.05, 0.95)
        for _ in range(int(rng.choice([1, 1, 2, 6, 20, 60]))):
            points.append({"x": float(np.clip(x, 0, 1)), "y": float(np.clip(y, 0, 1)),
                           "pressure": float(rng.choice([1.0, 1.0, rng.uniform(0.3, 1.0)]))})
            x += rng.normal(0, 0.03)
            y += rng.normal(0, 0.03)
        strokes.append({
            "points": points,
            "radius": float(rng.choice([rng.uniform(0.003, 0.02), rng.uniform(0.02, 0.1)])),
            "hardness": float(rng.choice([0.0, 0.5, 0.75, 0.9, 1.0, rng.uniform(0, 1)])),
            "flow": float(rng.choice([1.0, 1.0, rng.uniform(0.1, 1.0)])),
            "opacity": float(rng.choice([1.0, 1.0, rng.uniform(0.2, 1.0)])),
            "erase": bool(index > 0 and kind == "brush-erase" and rng.random() < 0.6),
        })
    leaf: dict[str, Any] = {"type": "brush", "strokes": strokes}
    if kind != "brush-plain":
        leaf["mask_feather"] = float(rng.choice([0.001, 0.003, 0.005, 0.0085, 0.02, 0.05, rng.uniform(0.0005, 0.05)]))
    if kind == "brush-shift":
        leaf["mask_shift_edge"] = float(rng.choice([-1, 1]) * rng.uniform(0.002, 0.03))
    return leaf


def random_gradient(rng: np.random.Generator) -> dict[str, Any]:
    start = rng.uniform(0.02, 0.98, size=2)
    length = float(rng.choice([rng.uniform(0.004, 0.05), rng.uniform(0.05, 0.6)]))
    angle = rng.uniform(0, 2 * math.pi)
    end = np.clip(start + length * np.array([math.cos(angle), math.sin(angle)]), 0.0, 1.0)
    first = float(rng.uniform(0.05, 0.6))
    return {
        "type": "linear_gradient",
        "start": {"x": float(start[0]), "y": float(start[1])},
        "end": {"x": float(end[0]), "y": float(end[1])},
        "gradient_midpoint_1": first,
        "gradient_midpoint_2": float(rng.uniform(first + 0.05, 0.97)),
        "gradient_fan": float(rng.choice([0.0, 0.0, rng.uniform(-1, 1)])),
    }


def random_path(rng: np.random.Generator) -> dict[str, Any]:
    center = rng.uniform(0.25, 0.75, size=2)
    count = int(rng.integers(3, 9))
    angles = np.sort(rng.uniform(0, 2 * math.pi, size=count))
    nodes = []
    for angle in angles:
        radius = rng.uniform(0.05, 0.22)
        nodes.append({"x": float(np.clip(center[0] + radius * math.cos(angle), 0.01, 0.99)),
                      "y": float(np.clip(center[1] + radius * math.sin(angle), 0.01, 0.99)),
                      "node_type": "sharp"})
    return {
        "type": "path",
        "nodes": nodes,
        "feather": float(rng.choice([0.0, 0.004, 0.01, 0.02, 0.05, rng.uniform(0.002, 0.1)])),
        "feather_softness": float(rng.choice([0.0, 1.0, rng.uniform(0, 1)])),
        "feather_mode": str(rng.choice(["symmetric", "outer_boundary"])),
    }


def random_geometry(rng: np.random.Generator) -> dict[str, Any]:
    if rng.random() < 0.55:
        return {}
    width, height = rng.uniform(0.4, 0.95), rng.uniform(0.4, 0.95)
    return {
        "crop": {"x": float(rng.uniform(0, 1 - width)), "y": float(rng.uniform(0, 1 - height)),
                 "width": float(width), "height": float(height)},
        "flip_horizontal": bool(rng.random() < 0.2),
        "rotation": int(rng.choice([0, 0, 0, 90])),
    }


def measure(leaf: dict[str, Any], inverted: bool, geometry_fields: dict[str, Any], image: np.ndarray,
            proxies: dict[int, np.ndarray]) -> dict[str, Any] | None:
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.mask_softness import bitmap_frame_rect, mask_facts, soft_mask_verdict
    from hdr_finisher.models import GeometryAdjustments, MaskExpression
    from hdr_finisher.preview import downsample_image

    try:
        expression = MaskExpression.model_validate({"leaf": leaf, "inverted": inverted})
    except ValueError:
        return None  # a random path that crosses itself is not a mask the app accepts
    geometry = GeometryAdjustments.model_validate(geometry_fields)
    started = time.perf_counter()
    exact = compile_geometry_fixed_mask(image, expression, geometry, spatial_only=True)
    exact_ms = (time.perf_counter() - started) * 1000.0
    if not exact.any() or exact.min() == exact.max():
        return None  # nothing to compare: the mask is empty or flat in this frame
    height, width = exact.shape
    grid_x = np.broadcast_to((np.arange(width, dtype=np.float32) + 0.5) / width, (height, width))
    grid_y = np.broadcast_to(((np.arange(height, dtype=np.float32) + 0.5) / height)[:, None], (height, width))
    entry: dict[str, Any] = {
        "leaf": leaf["type"],
        "inverted": inverted,
        "geometry": geometry_fields,
        "outputSize": [int(width), int(height)],
        "exactMs": round(exact_ms, 1),
        "bitmaps": [],
    }
    for edge, proxy in proxies.items():
        started = time.perf_counter()
        bitmap = downsample_image(compile_geometry_fixed_mask(proxy, expression, geometry, spatial_only=True), edge)
        bitmap_ms = (time.perf_counter() - started) * 1000.0
        started = time.perf_counter()
        rect = bitmap_frame_rect(image.shape[1], image.shape[0], proxy.shape[1], proxy.shape[0], geometry)
        verdict = soft_mask_verdict(expression, bitmap, proxy.shape[1], proxy.shape[0], rect=rect)
        bend_ms = (time.perf_counter() - started) * 1000.0
        # The renderer stretches the bitmap over the rectangle it is told.
        origin_x, origin_y, extent_x, extent_y = rect or (0.0, 0.0, 1.0, 1.0)
        placed_x = (grid_x - np.float32(origin_x)) / np.float32(extent_x)
        placed_y = (grid_y - np.float32(origin_y)) / np.float32(extent_y)
        entry["bitmaps"].append({
            "longEdge": edge,
            "size": [int(bitmap.shape[1]), int(bitmap.shape[0])],
            "compileMs": round(bitmap_ms, 1),
            "bendLevels": verdict.terms.get("bend"),
            "verdict": {"soft": verdict.soft, "estimate": verdict.estimate, "reason": verdict.reason, "terms": verdict.terms},
            "bendMs": round(bend_ms, 2),
            "facts": mask_facts(expression, proxy.shape[1], proxy.shape[0]),
            "frameRect": list(rect) if rect else None,
            "againstExact": difference(bitmap, exact, placed_x, placed_y),
        })
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description="Soft-mask fuzz against the exact compile")
    parser.add_argument("--out", required=True)
    parser.add_argument("--count", type=int, default=240)
    parser.add_argument("--seed", type=int, default=20261001)
    parser.add_argument("--size", default="7200x4800")
    parser.add_argument("--edges", default="1600,2000")
    arguments = parser.parse_args()
    from hdr_finisher.preview import downsample_image

    width, height = (int(value) for value in arguments.size.split("x"))
    image = np.zeros((height, width, 3), dtype=np.float32)
    proxies = {int(edge): downsample_image(image, int(edge)) for edge in arguments.edges.split(",")}
    rng = np.random.default_rng(arguments.seed)
    kinds = ["brush-feather"] * 4 + ["brush-erase"] * 3 + ["brush-shift"] * 1 + ["brush-plain"] * 3 \
        + ["gradient"] * 2 + ["path"] * 3
    output = Path(arguments.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"sourceSize": [width, height], "seed": arguments.seed, "masks": []}
    attempts = 0
    while len(report["masks"]) < arguments.count and attempts < arguments.count * 3:
        attempts += 1
        kind = kinds[int(rng.integers(len(kinds)))]
        leaf = random_gradient(rng) if kind == "gradient" else random_path(rng) if kind == "path" else random_brush(rng, kind)
        entry = measure(leaf, bool(rng.random() < 0.15), random_geometry(rng), image, proxies)
        if entry is None:
            continue
        entry["kind"] = kind
        entry["settings"] = {key: value for key, value in leaf.items() if key not in {"strokes", "nodes"}}
        report["masks"].append(entry)
        first = entry["bitmaps"][0]
        print(f"{len(report['masks']):>4} {kind:<14} true {first['againstExact']['maxLevels']:>7.2f}"
              f" estimate {first['verdict']['estimate']:>7.2f} {first['verdict']['reason']:<12} {json.dumps(first['verdict']['terms'])}", flush=True)
        if len(report["masks"]) % 20 == 0:
            output.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    output.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {output} ({len(report['masks'])} masks, {attempts} attempts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
