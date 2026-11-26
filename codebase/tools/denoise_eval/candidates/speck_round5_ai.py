"""Make the matching Bayer AI reference in bounded, disposable frame storage."""
import argparse
import json
from pathlib import Path
import tempfile
from time import perf_counter
from types import SimpleNamespace

import numpy as np
import rawpy

from hdr_finisher import raw_import
from tools.denoise_eval import canon_ladder as canon, colour_speck_marks as marks, marking_page as marking
from tools.denoise_eval.candidates import ai_highlights as ai
from tools.denoise_eval.candidates.ai_highlights_measure import disk_copy, release_pages
from tools.denoise_eval.candidates.rawnind import RawNIND
from tools.denoise_eval.colour_speck_trials import check_source


def build(request, model_root, result, scratch):
    started = perf_counter()
    source = check_source(request["file"], request["source_sha256"])
    with rawpy.imread(str(source)) as raw:
        info = raw_import._camera_linear_metadata_from_libraw(raw)
        matrix = raw_import._ahd_lab_matrix(raw)
        sensor = raw.raw_image_visible.copy()
        white = raw.white_level
    camera = ai.camera_develop(sensor, info, matrix)
    anchor = float(camera.mean(dtype=np.float64))
    off = disk_copy(scratch, "off", ai.to_scene(camera, info))
    del camera
    normalized = ai.model_sensor(sensor, info, white)
    neural = np.memmap(scratch / "neural.f32", mode="w+", dtype=np.float32, shape=off.shape)
    md = dict(cfa=info.raw_channel_to_rgb[info.raw_pattern].tolist(),
              white_balance=info.as_shot_wb.tolist(), camera_to_acescg=info.camera_to_acescg.tolist(),
              exposure_stops=0.)
    adapter = RawNIND("bayer", model_root=model_root)
    state = adapter.prepare(normalized, md, destination=neural, camera_anchor_mean=anchor)
    if state.fallback:
        raise ValueError(state.fallback)
    model = adapter.state_description(state)
    neural.flush()
    del normalized, state, adapter
    off, neural = release_pages(off, neural)

    clip_ratio = ai.sensor_clip_ratio(sensor, info)
    raw_import._apply_raw_highlight_reconstruction(
        SimpleNamespace(raw_image_visible=sensor), info, ai.settings())
    camera = ai.camera_develop(sensor, info, matrix)
    del sensor
    normal = disk_copy(scratch, "normal", ai.to_scene(camera, info))
    del camera
    changed = np.empty(clip_ratio.shape, bool)
    for top in range(0, clip_ratio.shape[0], 128):
        strip = slice(top, top+128)
        changed[strip] = ai.reconstruction_support(normal[strip], off[strip])
    del off
    weight = ai.protect_weight(clip_ratio, changed=changed)
    del clip_ratio, changed
    normal, neural = release_pages(normal, neural)
    neural = np.memmap(neural.filename, mode="r+", dtype=neural.dtype, shape=neural.shape)
    for top in range(0, weight.shape[0], 128):
        strip = slice(top, top+128)
        neural[strip] = ai.region_blend(neural[strip], normal[strip], weight[strip])
    seconds = perf_counter() - started
    del normal, weight

    # Save only small scene crops with the same padding used by the mark scores.
    areas = {}
    points = request["points"]
    for area in request["areas"]:
        rect = marks.rectangle(area, *request["resolution"], 16)
        patch = marks.crop(neural, rect)
        areas[area["id"]] = patch.copy()
        shown = marks.display_axes(patch, request["lift_ev"])
        for point in points:
            if point["area_id"] == area["id"]:
                x, y = point["peak_xy"]
                point["results"]["ai"] = canon.site_scores(shown, x-rect[0], y-rect[1])
    del neural
    np.savez(result / "ai-crops.npz", **areas)
    scores = [p["results"]["ai"] for p in points]
    (result / "ai-scores.json").write_text(marking.json_text(dict(scores=scores, seconds=seconds, model=model)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request", type=Path)
    parser.add_argument("model_root", type=Path)
    args = parser.parse_args()
    result = args.request.parent
    request = json.loads(args.request.read_text())
    with tempfile.TemporaryDirectory(prefix="buffers-", dir=result) as scratch:
        build(request, args.model_root, result, Path(scratch))


if __name__ == "__main__":
    main()
