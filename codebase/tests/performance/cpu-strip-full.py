"""Measure CPU Full through the bounded strip path on a real source.

PRD Phase 4 exit gate: *"CPU Full executes through a bounded path on the
reference CPU-only configuration."* The deterministic suite proves the strip
path is exact and that its plan is bounded; this harness is the part that has
to happen on a real 42 MP image, at Full, with the numbers recorded rather than
modelled.

    codebase/.venv/Scripts/python.exe tests/performance/cpu-strip-full.py \
        --source local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr

Writes `output/performance/cpu-strip-full.json`, which is an ignored path.
Pass `--skip-whole-frame` on a host that cannot hold the unbounded comparison;
the report then says so instead of quietly omitting it.
"""

from __future__ import annotations

import argparse
import json
import sys
import tracemalloc
from pathlib import Path
from time import perf_counter

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from hdr_finisher.adjustments import apply_adjustments  # noqa: E402
from hdr_finisher.cpu_strips import (  # noqa: E402
    StripCancelled,
    plan_strips,
    render_in_strips,
)
from hdr_finisher.loader import load_image  # noqa: E402
from hdr_finisher.models import AdjustmentState, PreviewKind, ToneEqualizerNode  # noqa: E402

MEGABYTE = 1024 * 1024


def graded_state() -> AdjustmentState:
    """A non-neutral grade, so the comparison exercises real tone mapping.

    Matches the spirit of the GPU Direct/Tiled corpus: an identity transform
    would agree whatever the implementation did.
    """
    state = AdjustmentState()
    state.hdr.exposure = 0.85
    state.hdr.contrast = 0.18
    state.hdr.saturation = 12.0
    state.hdr.white_balance_kelvin = 5200
    state.hdr.gain = 0.2
    state.hdr.tone_equalizer_section_enabled = True
    state.hdr.tone_equalizer_nodes = [
        ToneEqualizerNode(input_ev=index - 6, adjustment_ev=value)
        for index, value in enumerate([0.4, 0.2, 0.0, -0.3, 0.5, 0.1, 0.0, -0.2, 0.3, 0.0, 0.1, 0.0, -0.4])
    ]
    state.hdr.highlight_section_enabled = True
    state.hdr.highlight_compression_mode = "peak_fit"
    state.sdr.exposure = -0.3
    state.sdr.contrast = 0.25
    return state


def measured(label, call):
    tracemalloc.start()
    tracemalloc.reset_peak()
    started = perf_counter()
    result = call()
    elapsed = perf_counter() - started
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    print(f"  {label}: {elapsed:.2f} s, peak {peak / MEGABYTE:.1f} MB")
    return result, {"seconds": round(elapsed, 3), "peak_bytes": int(peak)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--kind", default="hdr", choices=["hdr", "sdr"])
    parser.add_argument("--budgets-mb", default="16,48,128")
    parser.add_argument("--skip-whole-frame", action="store_true")
    parser.add_argument(
        "--out", default=str(ROOT / "output" / "performance" / "cpu-strip-full.json")
    )
    arguments = parser.parse_args()

    source_path = Path(arguments.source)
    if not source_path.is_absolute():
        source_path = ROOT / source_path
    kind = PreviewKind(arguments.kind)
    state = graded_state()

    print(f"Loading {source_path.name}")
    image, descriptor, _metadata, _context, sdr_reference = load_image(source_path)
    height, width = image.shape[:2]
    long_edge = max(width, height)
    megapixels = width * height / 1_000_000
    print(f"  {width} x {height} = {megapixels:.1f} MP, Full long edge {long_edge}")

    report: dict[str, object] = {
        "source": {
            "path": str(source_path),
            "filename": source_path.name,
            "width": width,
            "height": height,
            "megapixels": round(megapixels, 2),
            "full_long_edge": long_edge,
            "source_bytes": int(image.nbytes),
            "descriptor": descriptor.color_space if hasattr(descriptor, "color_space") else None,
        },
        "lane": kind.value,
        "runs": [],
    }

    whole_frame = None
    if arguments.skip_whole_frame:
        report["whole_frame"] = {"skipped": True}
        print("  whole-frame comparison skipped by request")
    else:
        print("Whole-frame reference at Full")
        whole_frame, stats = measured(
            "whole frame",
            lambda: apply_adjustments(image, state, kind, sdr_reference_image=sdr_reference),
        )
        report["whole_frame"] = {"skipped": False, **stats}

    for budget_mb in [int(value) for value in arguments.budgets_mb.split(",")]:
        budget = budget_mb * MEGABYTE
        plan = plan_strips(width, height, budget_bytes=budget)
        print(f"Bounded strips at Full, budget {budget_mb} MB ({plan.strip_count} strips of {plan.strip_rows} rows)")
        (result, strip_report), stats = measured(
            f"budget {budget_mb} MB",
            lambda: render_in_strips(
                image,
                state,
                kind,
                sdr_reference_image=sdr_reference,
                long_edge=long_edge,
                budget_bytes=budget,
            ),
        )
        strip_report.measured_peak_transient_bytes = max(
            0, int(stats["peak_bytes"]) - strip_report.plan.output_bytes
        )
        entry = {"budget_bytes": budget, **stats, **strip_report.payload()}
        if whole_frame is not None:
            delta = float(np.max(np.abs(result.astype(np.float64) - whole_frame.astype(np.float64))))
            differing = int(np.count_nonzero(result != whole_frame))
            entry["max_channel_delta"] = delta
            entry["differing_samples"] = differing
            entry["total_samples"] = int(result.size)
            print(f"    max delta {delta}, differing {differing} / {result.size}")
        del result
        report["runs"].append(entry)

    print("Cancellation after three strips")
    calls = {"count": 0}

    def is_current() -> bool:
        calls["count"] += 1
        return calls["count"] <= 3

    started = perf_counter()
    cancelled_at = None
    try:
        render_in_strips(
            image,
            state,
            kind,
            sdr_reference_image=sdr_reference,
            long_edge=long_edge,
            budget_bytes=48 * MEGABYTE,
            is_current=is_current,
        )
    except StripCancelled:
        cancelled_at = calls["count"]
    cancel_seconds = perf_counter() - started
    full_plan = plan_strips(width, height, budget_bytes=48 * MEGABYTE)
    report["cancellation"] = {
        "cancelled": cancelled_at is not None,
        "checks_before_stop": cancelled_at,
        "strip_count": full_plan.strip_count,
        "seconds": round(cancel_seconds, 3),
    }
    print(f"  stopped after {cancelled_at} checks of {full_plan.strip_count} strips in {cancel_seconds:.2f} s")

    destination = Path(arguments.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
