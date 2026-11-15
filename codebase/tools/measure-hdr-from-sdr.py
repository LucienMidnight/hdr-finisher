import argparse
import gc
import json
from pathlib import Path
import sys
from time import perf_counter

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))

from hdr_finisher.adjustments import _linear_luma, apply_adjustments
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.hdr_from_sdr import fit_hdr_from_sdr, hdr_comparison_pixels
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.preview import downsample_image
from lib.machine_settings import settings


def ramps():
    colours = np.array([[1, 1, 1], [1, .15, .12], [1, .85, .12], [.15, 1, .15],
                        [.12, .85, 1], [.12, .25, 1], [1, .12, .8]], dtype=np.float32)
    colours /= _linear_luma(colours)[:, None]
    values = .0324 * np.exp2(np.arange(-10, 8 + 1 / 64, 1 / 64, dtype=np.float32))
    return linear_srgb_to_acescg(colours[:, None, :] * values[None, :, None])


def transition_metrics(adjustments):
    source = ramps()
    pixels = apply_adjustments(source, adjustments, PreviewKind.HDR, include_grain=False,
                               color_context=RenderColorContext(203))
    luma = _linear_luma(hdr_comparison_pixels(pixels, 203))
    steps = np.diff(luma, axis=1)
    visible = (luma[:, :-1] >= .005) & (luma[:, 1:] >= .005)
    jumps = np.abs(np.diff(np.log2(np.maximum(luma, 1e-6)), axis=1))[visible]
    reversals = int(np.count_nonzero(steps < -1e-6))
    maximum = float(np.max(jumps)) if jumps.size else 0.
    return dict(reversals=reversals, maximum_adjacent_ev=maximum,
                adjacent_ev_minimum_luma=.005,
                flat_steps=int(np.count_nonzero(np.abs(steps) <= 1e-6)),
                passed=bool(np.all(np.isfinite(pixels)) and reversals == 0 and maximum <= .1))


def measure(source, name, stock, *, authored=False):
    adjustments = AdjustmentState()
    adjustments.sdr.exposure = -.15
    adjustments.sdr.shadows = 10
    adjustments.sdr.midtones = 8
    adjustments.sdr.saturation = .08
    adjustments.sdr.color_grading.midtones.hue = 220
    adjustments.sdr.color_grading.midtones.saturation = 4
    adjustments.sdr.film_look.film_stock = stock
    adjustments.sdr.film_look.look_strength = 50
    reference = None
    if authored:
        reference = np.clip(np.broadcast_to(np.array([.25, .35, .55], dtype=np.float32), source.shape), 0, 1)
    before = adjustments.model_dump_json()
    started = perf_counter()
    try:
        proposal = fit_hdr_from_sdr(source, adjustments, [], sdr_reference=reference)
        transition = transition_metrics(proposal.adjustments)
        row = dict(status="body_pass" if proposal.body_accepted else "refused", metrics=proposal.metrics,
                   transition=transition, qualified=False, message=proposal.message,
                   recipe=proposal.adjustments.hdr.model_dump(mode="json"))
    except ValueError as error:
        row = dict(status="refused", message=str(error), qualified=False)
    assert adjustments.model_dump_json() == before
    row.update(source=name, stock=stock, authored=authored, seconds=perf_counter() - started)
    print(json.dumps({key: value for key, value in row.items() if key != "recipe"}), flush=True)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="output/review/n5-start-hdr/measurements.json")
    parser.add_argument("--synthetic-only", action="store_true")
    args = parser.parse_args()
    names = ["synthetic"] if args.synthetic_only else ["synthetic", "A7R00619.ARW", "DSC00264.ARW",
                                                       "IMG_3129.CR2", "IMG_0790.CR2", "IMG_7723.CR3"]
    rows = []
    for name in names:
        if name == "synthetic":
            source = ramps()
        else:
            source = load_image(Path(settings()["photosRoot"]) / "HDR Test Images" / name,
                                library_edge=512, analyze_hdr=False)[0]
            source = downsample_image(source, 256)
        for stock in ("none", "kodak_portra_400"):
            rows.append(measure(source, name, stock))
        del source
        gc.collect()
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(dict(machine="MacBook Neo / A18 Pro / 8 GB", edge=256,
                                           conditions="synthetic dense ramps; RAW decode <=512 then <=256; CPU; grain excluded",
                                           rows=rows), indent=2) + "\n")


if __name__ == "__main__":
    main()
