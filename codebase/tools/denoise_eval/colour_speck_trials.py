"""Render fixed-area colour trials or time the same kernels at native size."""
import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
from shutil import rmtree
import subprocess
import tempfile
from time import perf_counter

import cv2
import numpy as np
from PIL import ImageFile

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.color import acescg_to_linear_srgb
from tools.denoise_eval import colour_speck_features as features
from tools.denoise_eval import colour_speck_marks as marks
from tools.denoise_eval import marking_page as marking
from tools.denoise_eval.candidates import colour_speck as candidate
from tools.lib.test_photos import manifest_files, photo_root, sha256

COLUMNS = {"noisy": "Noisy", "baseline": "Today + Even out ×2.5",
           "a_after": "A · Wide colour after Denoise", "a_before": "A · Wide colour before Denoise",
           "b": "B · Brightness-guided colour"}
WEIGHTS = np.ones(2, np.float32)
TIMING_SOURCES = ("IMG_0790.CR2", "DSC04375.ARW")
ATTRIBUTION = marks.OUTPUT.parent / "colour-speck-attribution.json"


def check_source(name, identity):
    path = photo_root() / name
    if sha256(path) != identity:
        raise ValueError(f"Wrong original: {name}")
    return path


def area_views(image, flip, areas):
    scene = marking.sensor_view(image, flip)
    return {area["id"]: marking.extract(scene, area) for area in areas}


def save_views(images, photo, crops, column):
    marking.save_crops(images, photo, {key: acescg_to_linear_srgb(value)
                                      for key, value in crops.items()}, column)


def build_candidate(name, tamed, baseline, model):
    if name == "b":
        return candidate.native_b(tamed, model)
    return candidate.native_a(tamed, baseline, model, WEIGHTS, before=name == "a_before")


def detail_change(baseline, changed, ev):
    """Whole-area colour/edge screen. Feature-specific checks are separate."""
    y_base, y_test = baseline @ candidate.LUMA, changed @ candidate.LUMA
    luma_error = float(np.max(np.abs(y_base-y_test)))
    if not np.allclose(y_base, y_test, rtol=2e-6, atol=2e-7):
        raise AssertionError(f"Changed AP1 luminance (max {luma_error})")
    base, test = (marks.display_axes(rgb, ev)[..., 1:] for rgb in (baseline, changed))
    smooth = cv2.GaussianBlur(base, (9, 9), 1.8)
    other = cv2.GaussianBlur(test, (9, 9), 1.8)
    # Strong coherent colour (top tenth, above low-colour floor) and colour
    # edges on the lightly smoothed display, evaluated using the baseline mask.
    colour = np.linalg.norm(smooth, axis=-1)
    colour_mask = colour >= max(np.quantile(colour, .9), .015)
    edge = lambda plane: np.hypot(cv2.Sobel(plane, -1, 1, 0, scale=.125),
                                  cv2.Sobel(plane, -1, 0, 1, scale=.125))
    strong_edges = np.linalg.norm(edge(smooth), axis=-1)
    edge_mask = strong_edges >= max(np.quantile(strong_edges, .95), .007)
    return dict(
        max_luma_error=luma_error,
        strong_colour_retained=float(np.linalg.norm(other[colour_mask], axis=-1).sum() /
                                     colour[colour_mask].sum()) if colour_mask.any() else None,
        strongest_colour_edges_retained=float(np.linalg.norm(edge(other)[edge_mask], axis=-1).sum() /
                                              strong_edges[edge_mask].sum()) if edge_mask.any() else None,
        display_colour_change_p99=float(np.quantile(np.linalg.norm(test-base, axis=-1), .99)),
    )


def measure_marks(full, flip, width, height, areas, ev, known, slot, result, *, compare=False):
    scene = marking.sensor_view(full, flip)
    for area in areas:
        group = [row for row in known if row["mark"]["area_id"] == area["id"]]
        if not group:
            continue
        rect = marks.rectangle(area, width, height, 16)
        shown = marks.display_axes(marks.crop(scene, rect), ev)
        for row in group:
            x, y = row["peak_xy"]
            values = marks.readings(shown, x-rect[0], y-rect[1],
                                    np.array(row["colour_direction"]), row["luma_sign"])
            if compare:
                before = row["stages"]["baseline"]
                fields = ("luma", "green_magenta", "red_blue", "colour_score", "luma_score")
                if any(abs(values[key]-before[key]) > 1e-5 for key in fields):
                    raise AssertionError(f"Full marking baseline differs at {row['mark']} stop to check alignment")
            key = (row["mark"]["area_id"], row["mark"]["sensor_x"], row["mark"]["sensor_y"])
            result[key][slot] = values


def render(folder, attributed):
    area_set, saved = marks.inputs()
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    if attributed["area_hash"] != sha256(marking.AREAS) or attributed["marks_hash"] != sha256(marks.MARKS):
        raise ValueError("Attribution came from different input files")
    images = folder / "images"
    images.mkdir()
    manifest = dict(columns=COLUMNS, area_hash=attributed["area_hash"], photos=[])
    receipt = dict(commit=subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                   noise_measurement=adaptive.MEASUREMENT_VERSION, controls=asdict(marking.CONTROLS),
                   jpeg_quality=marking.JPEG_QUALITY,
                   area_hash=attributed["area_hash"], marks_hash=attributed["marks_hash"], photos={})
    for name, fixed in area_set.items():
        print(f"Rendering {name} ({len(fixed)} areas)", flush=True)
        path = check_source(name, identities[name])
        noisy, flip, w, h, ev, small = marks.develop_inputs(path, fixed)
        photo = dict(file=name, sensor_wh=[w, h], lift_ev=ev, areas=[])
        manifest["photos"].append(photo)
        known = attributed["photos"][name]["marks"]
        if (w, h) != tuple(attributed["photos"][name]["size"]) or ev != attributed["photos"][name]["lift"]:
            raise AssertionError("Input geometry or lift changed")
        for area in fixed:
            group = [m for m in saved["marks"] if m["file"] == name and m["area_id"] == area["id"]]
            photo["areas"].append(dict(area, visible_xyxy=marks.rectangle(area, w, h), images={},
                                       marks=[[m["sensor_x"], m["sensor_y"]] for m in group]))
        areas = photo["areas"]
        thumb = f"{name}-whole.jpg"
        marking.save_jpeg(marking.display_pixels(acescg_to_linear_srgb(marking.sensor_view(small, flip)), ev),
                          images / thumb)
        photo["thumbnail"] = f"images/{thumb}"
        save_views(images, photo, area_views(noisy, flip, areas), "noisy")
        del noisy

        tamed, diagnostic = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        baseline = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
        baseline_views = area_views(baseline, flip, areas)
        save_views(images, photo, baseline_views, "baseline")
        measured = {(row["mark"]["area_id"], row["mark"]["sensor_x"], row["mark"]["sensor_y"]): {}
                    for row in known}
        measure_marks(baseline, flip, w, h, areas, ev, known, "baseline", measured, compare=True)
        by_area = {area["id"]: {} for area in areas}
        photo_receipt = receipt["photos"][name] = dict(sha256=identities[name], model=model.as_dict(),
                                                       tamed_sensor_pixels=diagnostic["tamed"],
                                                       lift_ev=ev, areas=by_area,
                                                       marks=[dict(area=key[0], xy=key[1:], results=value)
                                                              for key, value in measured.items()])
        for name_candidate in ("a_after", "a_before", "b"):
            output = build_candidate(name_candidate, tamed, baseline, model)
            views = area_views(output, flip, areas)
            save_views(images, photo, views, name_candidate)
            for area in areas:
                key = area["id"]
                by_area[key][name_candidate] = detail_change(baseline_views[key], views[key], ev)
            measure_marks(output, flip, w, h, areas, ev, known, name_candidate, measured)
            del views, output
        del tamed, baseline, baseline_views
    template = Path(__file__).with_name("colour_trials_page.html").read_text(encoding="utf-8")
    styling = marking.PAGE.split("<style>", 1)[1].split("</style>", 1)[0]
    embedded = marking.json_text(manifest).replace("<", "\\u003c")
    (folder / "index.html").write_text(template.replace("/* MARKING_STYLE */", styling)
                                       .replace("/* REVIEW_DATA */", embedded), encoding="utf-8")
    (folder / "metrics.json").write_text(marking.json_text(receipt), encoding="utf-8")
    (folder / "features.json").write_text(marking.json_text(features.measure(folder)), encoding="utf-8")


def review(attribution):
    attributed = json.loads(attribution.read_text())
    marks.OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="colour-trials-", dir=marks.OUTPUT.parent) as scratch:
        folder = Path(scratch)
        # Each trial keeps all crops at native size and 4:4:4 JPEG.
        marking.JPEG_QUALITY = 85
        render(folder, attributed)
        size = sum(file.stat().st_size for file in folder.rglob("*") if file.is_file())
        if size >= marking.MAX_BYTES:
            raise ValueError(f"Review exceeds 20 MB ({size:,} bytes)")
        marks.OUTPUT.mkdir(exist_ok=True)
        old_images = marks.OUTPUT / "images"
        if old_images.is_dir():
            rmtree(old_images)
        for item in folder.iterdir():
            item.replace(marks.OUTPUT / item.name)
    print(f"54 areas, {size:,} bytes. {marks.OUTPUT / 'index.html'}", flush=True)


def benchmark(output, repeats):
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    receipt = dict(cpu_threads=os.environ.get("HDR_CPU_THREADS"), repeat_count=repeats, sources={})
    for name in TIMING_SOURCES:
        path = check_source(name, identities[name])
        tamed, _ = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        # Warm the common resolve before the paired runs.
        warm = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
        del warm
        source = receipt["sources"][name] = dict(pixels=int(np.prod(tamed.shape[:2])), sha256=identities[name],
                                                runs=[])
        for iteration in range(repeats):
            order = ("baseline", "a_after", "b", "a_before")
            if iteration % 2:
                order = order[::-1]
            for kind in order:
                start = perf_counter()
                before = start
                if kind == "baseline":
                    result = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
                elif kind == "b":
                    result = candidate.native_b(tamed, model)
                else:
                    # Both A placements need today's resolve. The pre placement
                    # uses it to keep exactly the same luminance after a second resolve.
                    full = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
                    before = perf_counter()
                    result = build_candidate(kind, tamed, full, model)
                    del full
                end = perf_counter()
                values = dict(iteration=iteration, method=kind, seconds=end-start,
                              last_stage_seconds=end-before)
                source["runs"].append(values)
                print(name, values, flush=True)
                del result
        del tamed
    output.parent.mkdir(exist_ok=True, parents=True)
    output.write_text(marking.json_text(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attribution", type=Path, default=ATTRIBUTION)
    parser.add_argument("--timing", type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 2 * 1024 * 1024)
    if args.timing:
        benchmark(args.timing, args.repeats)
    else:
        review(args.attribution)


if __name__ == "__main__":
    main()
