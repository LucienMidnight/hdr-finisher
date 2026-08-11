from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from time import perf_counter
from typing import Callable, TypeVar

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from hdr_finisher.adjustments import apply_adjustments  # noqa: E402
from hdr_finisher.loader import load_image  # noqa: E402
from hdr_finisher.models import AdjustmentState, PreviewKind, ScopeMode  # noqa: E402
from hdr_finisher.preview import downsample_image  # noqa: E402
from hdr_finisher.render_cache import SessionRenderCache  # noqa: E402
from hdr_finisher.scopes import build_scope_from_processed  # noqa: E402


T = TypeVar("T")


def measure(operation: Callable[[], T], repetitions: int) -> tuple[T, dict[str, float | int]]:
    values: list[float] = []
    result: T | None = None
    for _ in range(repetitions):
        started = perf_counter()
        result = operation()
        values.append((perf_counter() - started) * 1000.0)
    assert result is not None
    ordered = sorted(values)
    return result, {
        "samples": len(values),
        "median_ms": ordered[len(ordered) // 2],
        "p95_ms": ordered[min(len(ordered) - 1, int((len(ordered) - 1) * 0.95))],
        "max_ms": ordered[-1],
    }


def profile(path: Path, repetitions: int, long_edge: int) -> dict[str, object]:
    started = perf_counter()
    image, descriptor, metadata, analysis, sdr_reference = load_image(path)
    load_ms = (perf_counter() - started) * 1000.0
    adjustments = AdjustmentState()

    proxy_started = perf_counter()
    proxy = np.ascontiguousarray(downsample_image(image, long_edge), dtype=np.float32)
    proxy_ms = (perf_counter() - proxy_started) * 1000.0
    sdr_proxy = (
        np.ascontiguousarray(downsample_image(sdr_reference, long_edge), dtype=np.float32)
        if sdr_reference is not None
        else None
    )

    processed, adjustment_timing = measure(
        lambda: apply_adjustments(proxy, adjustments, PreviewKind.HDR, sdr_reference_image=sdr_proxy),
        repetitions,
    )
    modes: dict[str, object] = {}
    for mode in (ScopeMode.HISTOGRAM, ScopeMode.WAVEFORM):
        scope, compute_timing = measure(
            lambda selected=mode: build_scope_from_processed(
                processed,
                PreviewKind.HDR,
                mode=selected,
                bins=128 if selected == ScopeMode.HISTOGRAM else 192,
                waveform_columns=384,
                max_nits=4000,
            ),
            repetitions,
        )
        encoded, serialization_timing = measure(scope.model_dump_json, repetitions)
        modes[mode.value] = {
            "compute": compute_timing,
            "serialization": serialization_timing,
            "json_bytes": len(encoded.encode("utf-8")),
            "peak_value": scope.peak_value,
        }

    cache = SessionRenderCache(image=image, sdr_reference_image=sdr_reference)
    cold_started = perf_counter()
    cache.scope_result(adjustments, PreviewKind.HDR, long_edge, "histogram", 128, 384)
    cache_cold_ms = (perf_counter() - cold_started) * 1000.0
    _cached, cache_warm = measure(
        lambda: cache.scope_result(adjustments, PreviewKind.HDR, long_edge, "histogram", 128, 384),
        repetitions,
    )

    return {
        "input": str(path),
        "input_bytes": path.stat().st_size,
        "dimensions": [descriptor.width, descriptor.height],
        "classification": analysis.classification.value,
        "load_ms": load_ms,
        "proxy_generation_ms": proxy_ms,
        "proxy_shape": list(proxy.shape),
        "adjustments": adjustment_timing,
        "scopes": modes,
        "cache_cold_ms": cache_cold_ms,
        "cache_warm": cache_warm,
        "cache": cache.diagnostics(),
        "source_metadata_keys": sorted(metadata.keys()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Profile backend scope phases independently.")
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--repetitions", type=int, default=10)
    parser.add_argument("--long-edge", type=int, default=768)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = {
        "schema_version": 1,
        "repetitions": args.repetitions,
        "long_edge": args.long_edge,
        "results": [profile(path.resolve(), args.repetitions, args.long_edge) for path in args.inputs],
    }
    payload = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(f"{payload}\n", encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
