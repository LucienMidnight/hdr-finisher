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

from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, BrushStroke, LocalAdjustment, MaskExpression, MaskLeaf, MaskPoint, PreviewKind
from hdr_finisher.preview import downsample_image
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.sdr_local_match import LocalMatchRefused, fit_local_sdr
from lib.machine_settings import settings


def measure(source, name, mask_type, stock):
    adjustments = AdjustmentState()
    adjustments.sdr.exposure = -.15
    for lane in (adjustments.hdr, adjustments.sdr):
        lane.film_look.film_stock = stock
        lane.film_look.look_strength = 50
    leaf = MaskLeaf(type=mask_type, **({"start": MaskPoint(x=.1, y=.5), "end": MaskPoint(x=.9, y=.5)}
                                     if mask_type == "linear_gradient" else {}))
    if mask_type == "brush":
        leaf.strokes = [BrushStroke(points=[MaskPoint(x=.3, y=.5), MaskPoint(x=.7, y=.5)], radius=.25)]
    if mask_type == "hue_range":
        leaf.hue_center = 250
        leaf.hue_width = 100
        leaf.saturation_floor = .02
    local = LocalAdjustment(name=f"{mask_type} change", mask=MaskExpression(leaf=leaf))
    local.hdr_grade.exposure = .2
    local.hdr_grade.saturation = .06
    other = LocalAdjustment(name="Overlapping SDR edit")
    other.sdr_grade.exposure = -.1
    stack = [local, other]
    cache = SessionRenderCache(source, None)
    masks = {lane.value: {item.id: cache.compiled_local_mask(adjustments, item, 256, spatial_only=True, lane=lane)
                         for item in stack} for lane in (PreviewKind.HDR, PreviewKind.SDR)}
    before = [adjustments.model_dump(), [item.model_dump() for item in stack]]
    started = perf_counter()
    try:
        result = fit_local_sdr(source, adjustments, stack, local.id, masks=masks)
        record = dict(status="matched" if result.grade else "no-op", metrics=result.metrics, message=result.message)
    except LocalMatchRefused as error:
        record = dict(status="refused", metrics=error.metrics, message=str(error))
    assert before == [adjustments.model_dump(), [item.model_dump() for item in stack]]
    record.update(source=name, mask=mask_type, stock=stock, seconds=perf_counter() - started)
    print(json.dumps(record), flush=True)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="output/review/n4-local-match/measurements.json")
    args = parser.parse_args()
    values = np.linspace(.004, .3, 96, dtype=np.float32)
    source = np.tile(values[None, :, None], (64, 1, 3))
    source[:, :32] *= [1., .7, .4]
    source[:, 32:64] *= [.4, .7, 1.]
    rows = []
    for name in ("synthetic", "DSC00264.ARW", "IMG_3129.CR2"):
        if name != "synthetic":
            source = load_image(Path(settings()["photosRoot"]) / "HDR Test Images" / name,
                                library_edge=512, analyze_hdr=False)[0]
            source = downsample_image(source, 256)
        for mask_type in ("linear_gradient", "brush", "hue_range"):
            for stock in ("none", "kodak_portra_400"):
                rows.append(measure(source, name, mask_type, stock))
        del source
        gc.collect()
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
