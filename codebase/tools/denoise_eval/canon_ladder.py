"""Generate the local Canon review and measure all ladder steps on the native frame."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from time import perf_counter

import cv2
import numpy as np
from PIL import Image, ImageFile
import rawpy

from hdr_finisher import denoise_adaptive as adaptive, raw_import
from hdr_finisher.color import acescg_to_linear_srgb
from tools.denoise_eval import colour_speck_marks as marks, marking_page as marking
from tools.denoise_eval.candidates import ai_highlights, canon_ladder as ladder, colour_speck as colour
from tools.denoise_eval.candidates.rawnind import RawNIND
from tools.denoise_eval.colour_speck_trials import check_source
from tools.lib.test_photos import manifest_files, sha256

PHOTO = "IMG_0790.CR2"
OUTPUT = marking.OUTPUT.parent / "canon-ladder"
AREA_ORDER = ("S1", "S2", "D1", "D2", "D3", "D4")
METHODS = {"even": "Even keep", "stronger": "Stronger Denoise",
           "band-pits": "Fill pits inside Denoise", "after-pits": "Fill pits after Denoise",
           "smooth": "Whole-image smoothing"}
PROBLEMS = {"dark_pits": "Dark pits", "colour_specks": "Colour specks", "blotchy_colour": "Blotchy colour"}
REFERENCE = {"noisy": "Noisy", "baseline": "Baseline · Denoise + Even out ×2.5", "ai": "RawNIND Bayer AI"}
PATCH_SIZE = 48
JPEG_QUALITY = 88


def trial_label(trial):
    if trial.method == "even":
        return ("Average the amount kept within 6 pixels",
                "Average the amount kept within 18 pixels",
                "Keep the same share everywhere in each band",
                "Remove both bands completely")[trial.step - 1]
    if trial.method == "stronger":
        multiplier = ladder.NOISE_MULTIPLIERS[trial.step - 1]
        return f"Treat noise in both bands as {multiplier:g}× stronger"
    if trial.method == "smooth":
        sigma = ladder.SMOOTHING_SIGMAS[trial.step - 1]
        return f"Soften every pixel after Denoise with a {sigma}-pixel blur"
    threshold = ladder.PIT_THRESHOLDS[trial.step - 1]
    text = f"Start lifting pits {threshold:g}× deeper than nearby grain"
    if trial.target == "both":
        multiplier = ladder.NOISE_MULTIPLIERS[(0, 1, 3)[trial.step - 1]]
        text += f" and treat colour noise as {multiplier:g}× stronger"
    return text


def inputs():
    photos, feedback = marks.inputs()
    areas = {area["id"]: area for area in photos[PHOTO]}
    answers = {row["area_id"]: row["worst_problem"] for row in feedback["answers"] if row["file"] == PHOTO}
    fixed = [dict(areas[key], problem=answers[key], problem_label=PROBLEMS[answers[key]], images={}, patches={})
             for key in AREA_ORDER]
    points = [row for row in feedback["marks"] if row["file"] == PHOTO]
    if len(points) != 38:
        raise ValueError(f"Expected 38 Canon marks, found {len(points)}")
    identity = next(row["sha256"] for row in manifest_files() if row["name"] == PHOTO)
    return check_source(PHOTO, identity), identity, fixed, points


def save_views(folder, scene, areas, points, ev, key):
    for area in areas:
        pixels = marking.display_pixels(acescg_to_linear_srgb(marking.extract(scene, area)), ev)
        if pixels.shape[:2] != (area["size"], area["size"]):
            raise ValueError(f"Unexpected clipped Canon crop {area['id']}")
        dest = f"images/{area['id']}-{key}.jpg"
        Image.fromarray(pixels).save(folder / dest, quality=JPEG_QUALITY, subsampling=0, optimize=True)
        area["images"][key] = dest
        # Keep the pixels being judged at 6× exactly as rendered. Store one
        # lossless sprite per crop, in the original mark order.
        left, top = area["sensor_xy"]
        patches = []
        for point in points:
            if point["area_id"] == area["id"]:
                x = np.clip(point["sensor_x"] - left - PATCH_SIZE // 2, 0, area["size"] - PATCH_SIZE)
                y = np.clip(point["sensor_y"] - top - PATCH_SIZE // 2, 0, area["size"] - PATCH_SIZE)
                patches.append(pixels[y:y+PATCH_SIZE, x:x+PATCH_SIZE])
        if not patches:
            centre = (area["size"] - PATCH_SIZE) // 2
            patches.append(pixels[centre:centre+PATCH_SIZE, centre:centre+PATCH_SIZE])
        patch_path = f"images/{area['id']}-{key}-marks.webp"
        Image.fromarray(np.concatenate(patches)).save(folder / patch_path, lossless=True, method=3)
        area["patches"][key] = patch_path


def area_peaks(baseline, areas, points, size, ev):
    readings = []
    for area in areas:
        rect = marks.rectangle(area, *size, 16)
        shown = marks.display_axes(marks.crop(baseline, rect), ev)
        left, top = rect[:2]
        for point in points:
            if point["area_id"] != area["id"]:
                continue
            x, y = marks.locate(shown, point["sensor_x"]-left, point["sensor_y"]-top)
            readings.append(dict(point, peak_xy=[x+left, y+top], results={}))
    return readings


def site_scores(shown, x, y):
    reference, samples = marks.ring(shown, x, y)
    delta = shown[y, x] - reference
    # A new hue cannot pass by having a small projection on the old hue.
    direction = delta[1:] / max(float(np.linalg.norm(delta[1:])), 1e-12)
    chroma = (samples[:, 1:] - reference[1:]) @ direction
    grain = np.maximum(
        [np.median(np.abs(samples[:, 0] - reference[0])), np.median(np.abs(chroma))],
        marks.DISPLAY_FLOOR / 1.4826,
    ) * 1.4826
    colour_distance = float(np.linalg.norm(delta[1:]))
    return dict(luma=float(delta[0]), colour=colour_distance,
                luma_grain=float(grain[0]), colour_grain=float(grain[1]),
                luma_score=float(abs(delta[0])/grain[0]), colour_score=float(colour_distance/grain[1]))


def score_views(scene, areas, points, size, ev, key):
    for area in areas:
        rect = marks.rectangle(area, *size, 16)
        shown = marks.display_axes(marks.crop(scene, rect), ev)
        for point in points:
            if point["area_id"] == area["id"]:
                x, y = point["peak_xy"]
                point["results"][key] = site_scores(shown, x-rect[0], y-rect[1])


def check_channels(baseline, changed, areas, trial):
    for area in areas:
        before, after = (marking.extract(scene, area) for scene in (baseline, changed))
        if trial.target == "colour":
            np.testing.assert_allclose(after @ colour.LUMA, before @ colour.LUMA, rtol=2e-6, atol=2e-7)
        if trial.target == "brightness":
            chroma = adaptive.OPPONENT[1:].T
            np.testing.assert_allclose(after @ chroma, before @ chroma, rtol=2e-6, atol=2e-7)


def ai_reference(folder, area_file, model_root):
    start = perf_counter()
    path, _, areas, _ = inputs()
    area_data = json.loads(area_file.read_text())
    for area in areas:
        area["visible_xyxy"] = marking.bounds_for(area, *area_data["sensor_wh"])
    with rawpy.imread(str(path)) as raw:
        info = raw_import._camera_linear_metadata_from_libraw(raw)
        matrix = raw_import._ahd_lab_matrix(raw)
        sensor = raw.raw_image_visible.copy()
        white = raw.white_level
    adapter = RawNIND("bayer", model_root=model_root)
    combined = ai_highlights.combine(sensor, info, matrix, white, model=adapter)
    render_seconds = perf_counter() - start
    points = area_data["points"]
    save_views(folder, combined.image, areas, points, area_data["lift_ev"], "ai")
    score_views(combined.image, areas, points, area_data["sensor_wh"], area_data["lift_ev"], "ai")
    record = dict(images={area["id"]: area["images"]["ai"] for area in areas},
                  patches={area["id"]: area["patches"]["ai"] for area in areas},
                  scores=[point["results"]["ai"] for point in points], seconds=render_seconds,
                  description=adapter.description(), diagnostics=combined.diagnostics)
    (folder / "ai.json").write_text(marking.json_text(record))


def run_ai(folder, photo, points, model_root):
    ai_input = folder / "ai-input.json"
    positions = [{**point, "results": {}} for point in points]
    ai_input.write_text(marking.json_text(dict(sensor_wh=photo["sensor_wh"], lift_ev=photo["lift_ev"], points=positions)))
    guard_file = folder / "ai-guard.json"
    result = subprocess.run(
        [sys.executable, "-m", "tools.denoise_eval.candidates.guard", "--receipt", str(guard_file),
         "--seconds", "180", "--", sys.executable, "-m", "tools.denoise_eval.canon_ladder",
         "--ai-child", str(ai_input), "--model-root", str(model_root)], check=False,
    )
    ai_input.unlink()
    guard = json.loads(guard_file.read_text())
    guard_file.unlink()
    if result.returncode:
        for image in list(folder.glob("images/*-ai.jpg")) + list(folder.glob("images/*-ai-marks.webp")):
            image.unlink()
        return {"status": "unavailable", "guard": guard}
    receipt = folder / "ai.json"
    data = json.loads(receipt.read_text())
    receipt.unlink()
    for area in photo["areas"]:
        area["images"]["ai"] = data["images"][area["id"]]
        area["patches"]["ai"] = data["patches"][area["id"]]
    for point, score in zip(points, data.pop("scores"), strict=True):
        point["results"]["ai"] = score
    return dict(data, status="complete", guard=guard)


def data_summary(points, steps):
    result = {}
    for key in steps:
        if not all(key in point["results"] for point in points):
            continue
        result[key] = {}
        for area in ("all", *AREA_ORDER):
            group = [point for point in points if area in ("all", point["area_id"])]
            luma_count = colour_count = both_count = new_both = original_pit_count = 0
            for point in group:
                row = point["results"][key]
                luma = row["luma_score"] <= 2
                chroma = row["colour_score"] <= 2
                luma_count += luma
                colour_count += chroma
                both_count += luma and chroma
                before = point["results"]["baseline"]
                new_both += luma and chroma and max(before["luma_score"], before["colour_score"]) > 2
                original_pit_count += before["luma_score"] > 2 and before["luma"] < 0 and luma
            result[key][area] = dict(marks=len(group), brightness=luma_count, colour=colour_count,
                                     both=both_count, newly_both=new_both, original_pit_cleared=original_pit_count)
    return result


def render(folder, model_root, repeats):
    path, identity, areas, original_points = inputs()
    (folder / "images").mkdir()
    noisy, flip, width, height, ev, small = marks.develop_inputs(path, areas)
    size = (width, height)
    for area in areas:
        area["visible_xyxy"] = marking.bounds_for(area, *size)
    save_views(folder, marking.sensor_view(noisy, flip), areas, original_points, ev, "noisy")
    thumbnail = "images/canon-context.webp"
    small = marking.sensor_view(small, flip)
    Image.fromarray(marking.display_pixels(acescg_to_linear_srgb(small), ev)).save(
        folder / thumbnail, lossless=True)
    del noisy
    photo = dict(file=PHOTO, sensor_wh=size, thumbnail=thumbnail, lift_ev=ev, areas=areas)
    start = perf_counter()
    tamed, diagnostic = marking.develop(path, cleanup=True)
    develop_seconds = perf_counter() - start
    start = perf_counter()
    model = adaptive.estimate_adaptive_model(tamed, workers=1)
    model_seconds = perf_counter() - start
    start = perf_counter()
    baseline = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
    baseline_times = [perf_counter() - start]
    base_view = marking.sensor_view(baseline, flip)
    points = area_peaks(base_view, areas, original_points, size, ev)
    save_views(folder, base_view, areas, original_points, ev, "baseline")
    score_views(base_view, areas, points, size, ev, "baseline")

    candidates = list(ladder.trials())
    measured = {trial.key: [] for trial in candidates}
    calibration_times = []
    for iteration in range(repeats):
        start = perf_counter()
        calibration = ladder.even_calibration(tamed, model)
        calibration_times.append(perf_counter() - start)
        for trial in candidates if iteration % 2 == 0 else reversed(candidates):
            start = perf_counter()
            result = ladder.resolve(tamed, baseline, model, trial, calibration)
            elapsed = perf_counter() - start
            measured[trial.key].append(elapsed)
            print(f"Run {iteration + 1}, {trial.key}: {elapsed:.2f} s", flush=True)
            if not iteration:
                view = marking.sensor_view(result, flip)
                check_channels(base_view, view, areas, trial)
                save_views(folder, view, areas, original_points, ev, trial.key)
                score_views(view, areas, points, size, ev, trial.key)
                del view
            del result
        if iteration:
            start = perf_counter()
            comparison = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
            baseline_times.append(perf_counter() - start)
            del comparison
    del tamed, baseline, base_view
    ai = run_ai(folder, photo, points, model_root) if model_root else {"status": "omitted (no model supplied)"}
    steps = [{"key": t.key, "method": t.method, "target": t.target, "step": t.step,
              "description": trial_label(t)} for t in candidates]
    manifest = dict(photo=photo, marks=original_points, steps=steps, methods=METHODS, references=REFERENCE,
                    patch_size=PATCH_SIZE,
                    ai_status=ai["status"], area_hash=sha256(marking.AREAS), marks_hash=sha256(marks.MARKS))
    template = Path(__file__).with_name("canon_ladder_page.html").read_text()
    styling = marking.PAGE.split("<style>", 1)[1].split("</style>", 1)[0]
    embedded = marking.json_text(manifest).replace("<", "\\u003c")
    (folder / "index.html").write_text(template.replace("/* MARKING_STYLE */", styling)
                                       .replace("/* REVIEW_DATA */", embedded), encoding="utf-8")
    receipt = dict(base_commit=subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                   source_sha256=identity, pixels=width*height, lift_ev=ev,
                   model=model.as_dict(), controls=asdict(marking.CONTROLS), tamed=diagnostic["tamed"],
                   marks=points, counts=data_summary(points, ("baseline", "ai", *measured)),
                   native_seconds=dict(develop=develop_seconds, model=model_seconds, baseline=baseline_times,
                                       even_calibration=calibration_times, steps=measured), ai=ai)
    (folder / "metrics.json").write_text(marking.json_text(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, help="Directory containing the pinned model_bayer.onnx")
    parser.add_argument("--ai-child", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--repeats", type=int, default=2, choices=(1, 2, 3))
    args = parser.parse_args()
    cv2.setNumThreads(1)
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 2 * 1024 * 1024)
    if args.ai_child:
        ai_reference(args.ai_child.parent, args.ai_child, args.model_root)
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="canon-ladder-", dir=OUTPUT.parent) as scratch:
        folder = Path(scratch)
        render(folder, args.model_root, args.repeats)
        total = sum(file.stat().st_size for file in folder.rglob("*") if file.is_file())
        if total >= marking.MAX_BYTES:
            raise ValueError(f"Review exceeds 20 MB ({total:,} bytes)")
        OUTPUT.mkdir(exist_ok=True)
        old_images = OUTPUT / "images"
        if old_images.is_dir():
            shutil.rmtree(old_images)
        for item in folder.iterdir():
            item.replace(OUTPUT / item.name)
    print(f"Six Canon areas, {total:,} bytes. {OUTPUT / 'index.html'}", flush=True)


if __name__ == "__main__":
    main()
