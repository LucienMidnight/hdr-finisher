"""Build the Round 5 photo reviews, mark scores and native CPU timing receipts."""
import argparse
from collections import defaultdict
from html import escape
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import cv2
import numpy as np
from PIL import Image

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.color import acescg_to_linear_srgb
from tools.denoise_eval import canon_ladder as canon, colour_speck_marks as marks
from tools.denoise_eval import even_keep_round4 as round4, marking_page as marking
from tools.denoise_eval.candidates import even_keep_round4 as even
from tools.denoise_eval.candidates import speck_round5 as trial
from tools.denoise_eval.colour_speck_trials import check_source
from tools.lib.test_photos import manifest_files

OUTPUT = round4.OUTPUT.with_name("round5")
PORTRAIT = "_DSC7970.ARW"
TIMING_SOURCES = (canon.PHOTO, PORTRAIT)
PORTRAIT_ORDER = ("S1", "S2", "D1", "D2", "D3")
PORTRAIT_SPOTS = {"S1": (0, 4, 8), "D2": (0, 5, 10), "D3": (0, 2, 4)}
PORTRAIT_UNMARKED = {"S2": ((168, 205), (331, 327)), "D1": ((238, 221), (305, 305))}
BASE = "Even keep brightness 18 px"
LAST_ROUND = "Green/magenta channel balance (strong)"
NAMES = {
    "noisy": "Noisy",
    "baseline": round4.TODAY,
    "ai": "AI Denoise (reference)",
    "even": BASE,
}
PASSES = {
    "balance": LAST_ROUND,
    "colour-gentle": "Relative colour cleanup (gentle)",
    "colour-strong": "Relative colour cleanup (strong)",
    "colour-broad": "Relative colour cleanup (large splotches)",
    "heal": "Nearby patch healing",
    "average": "Whole-area patch averaging",
}
NAMES.update({key: f"{BASE} + {label}" for key, label in PASSES.items()})
PAGE_STYLE = """
html { background: var(--viewer); color: var(--text); }
body { margin: 16px; font-family: var(--font-body); font-size: var(--font-size-md);
       line-height: var(--line-height-normal); }
h1 { font-size: var(--page-title-font-size); font-weight: var(--font-weight-semibold); }
h2 { font-size: var(--font-size-2xl); font-weight: var(--font-weight-semibold);
     margin-block: 40px 4px; padding-block-start: 16px; border-block-start: 1px solid var(--border); }
p { color: var(--body); }
a { color: var(--accent-strong); }
.line { display: flex; flex-wrap: nowrap; gap: 12px; overflow-x: auto; padding-block-end: 8px; }
.tile { flex: 0 0 288px; background: var(--panel); border: 1px solid var(--border); padding: 8px; }
.label { min-height: 3.6em; margin-block-end: 6px; font-size: var(--font-size-sm);
         font-weight: var(--font-weight-medium); }
.crop { display: block; width: 256px; height: 256px; margin-inline: auto; }
.marks { display: flex; justify-content: center; gap: 4px; margin-block-start: 6px; }
figure { margin: 0; }
.marks img { display: block; width: 96px; height: 96px; image-rendering: pixelated; }
figcaption { color: var(--muted); font-size: var(--font-size-xs); text-align: center; }
"""


def grain_matched(tamed, model):
    fit = even.calibrate_brightness(tamed, model, (18,))
    return even.resolve(tamed, model, 18, calibration=fit)


def apply(frame, model, key):
    if key == "balance":
        return even.native_colour(frame, model, "balance", 1.)
    if "+" in key:
        first, second = key.split("+")
        return trial.native(trial.native(frame, first), second)
    return trial.native(frame, key)


def spot_path(area, key, index=None):
    suffix = "" if index is None else f"-{index}"
    return f"images/{area['photo']}/{area['id']}-{key}{suffix}.webp"


def ai_crop_path(area):
    return f"images/canon/{area['id']}-ai.jpg" if area["photo"] == "canon" else spot_path(area, "ai")


def save_view(folder, area, key, pixels, spots):
    Image.fromarray(pixels).save(folder / spot_path(area, key), quality=90, method=4)
    size = round4.PATCH
    for index, (x, y, _) in enumerate(spots, 1):
        left, top = [int(np.clip(p-size//2, 0, area["size"]-size)) for p in (x, y)]
        patch = pixels[top:top+size, left:left+size]
        Image.fromarray(patch).save(folder / spot_path(area, key, index), lossless=True)


def load_ai(folder, prior, areas, points, spots, identity, size, ev):
    if prior is None or not (prior / "canon.json").is_file():
        return False
    receipt = json.loads((prior / "canon.json").read_text())
    stamp = round4.stamp()
    keys = ("area_sha256", "marks_sha256", "controls", "measurement")
    if (receipt.get("source_sha256") != identity or receipt.get("resolution") != list(size)
            or receipt.get("lift_ev") != ev or any(receipt.get(k) != stamp[k] for k in keys)):
        return False
    prior_points = receipt["marks"]
    for current, past in zip(points, prior_points, strict=True):
        if any(current[key] != past[key] for key in ("area_id", "sensor_x", "sensor_y", "peak_xy")):
            return False
        if "ai" not in past["results"]:
            return False
    files = prior / "part1-images"
    if not all(
        (files / f"part1-canon-{area['id']}-ai{suffix}").is_file()
        for area in areas
        for suffix in [".jpg", *(f"-{i}.webp" for i in range(1, len(spots[area["id"]])+1))]
    ):
        return False
    for area in areas:
        src = files / f"part1-canon-{area['id']}-ai"
        shutil.copyfile(src.with_suffix(".jpg"), folder / ai_crop_path(area))
        for index in range(1, len(spots[area["id"]])+1):
            # The earlier lossless patches are already at the requested 6×.
            shutil.copyfile(src.with_name(f"{src.name}-{index}.webp"), folder / spot_path(area, "ai", index))
    for current, past in zip(points, prior_points, strict=True):
        current["results"]["ai"] = past["results"]["ai"]
    return dict(status="reused", seconds=receipt["ai"]["seconds"])


def render_ai(folder, model_root, photo, identity, areas, points, spots, size, ev):
    if model_root is None:
        return dict(status="unavailable", reason="No Bayer AI model folder supplied")
    with tempfile.TemporaryDirectory(prefix="bayer-ai-", dir=folder) as temp:
        scratch = Path(temp)
        request = scratch / "request.json"
        request.write_text(marking.json_text(dict(
            file=photo, source_sha256=identity, areas=areas, points=points,
            resolution=size, lift_ev=ev,
        )))
        guard_file = scratch / "guard.json"
        child = subprocess.run(
            [sys.executable, "-m", "tools.denoise_eval.candidates.guard",
             "--receipt", str(guard_file), "--seconds", "180", "--",
             sys.executable, "-m", "tools.denoise_eval.candidates.speck_round5_ai",
             str(request), str(model_root)],
            check=False,
        )
        guard = json.loads(guard_file.read_text())
        if child.returncode:
            return dict(status="unavailable", reason=guard["aborted"] or "AI reference render failed", guard=guard)
        scores = json.loads((scratch / "ai-scores.json").read_text())
        with np.load(scratch / "ai-crops.npz") as crops:
            for area in areas:
                left, top, right, bottom = area["visible_xyxy"]
                x, y = area["sensor_xy"]
                rect = marks.rectangle(area, *size, 16)
                cropped = crops[area["id"]][top-rect[1]:bottom-rect[1], left-rect[0]:right-rect[0]]
                pixels = np.zeros((area["size"], area["size"], 3), dtype=np.uint8)
                pixels[top-y:bottom-y, left-x:right-x] = marking.display_pixels(acescg_to_linear_srgb(cropped), ev)
                save_view(folder, area, "ai", pixels, spots[area["id"]])
        for point, score in zip(points, scores.pop("scores"), strict=True):
            point["results"]["ai"] = score
        return dict(status="rendered", guard=guard, **scores)


def write_page(folder, title, filename, areas, spots, ai, combined):
    names = dict(NAMES, **{combined: BASE + " + " + " + ".join(PASSES[key] for key in combined.split("+"))})
    page = [
        f'<!doctype html><html lang="en"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{escape(title)}</title><link rel="stylesheet" href="../../../frontend/visual-tokens.css">'
        f'<style>{PAGE_STYLE}</style><main><p><a href="index.html">Both photos</a></p><h1>{escape(title)}</h1>'
        '<p>Scroll each row sideways to compare the same area. The large crop is shown at '
        '100% on a Retina screen. The close-ups below it are shown at 6×.</p>'
    ]
    if not ai:
        page.append("<p>The AI reference is unavailable for this photo. Row numbers stay aligned across the pages.</p>")
    for area in areas:
        heading = escape(f"{area['id']} · {area['what']}")
        page.append(f'<section><h2>{heading}</h2><div class="line" aria-label="{heading}">')
        for number, key in enumerate(names, 1):
            if key == "ai" and not ai:
                continue
            name = escape(names[key])
            image = ai_crop_path(area) if key == "ai" else spot_path(area, key)
            page.append(f'<article class="tile"><div class="label">Row {number} · {name}</div>'
                        f'<img class="crop" src="{image}" width="256" height="256" '
                        f'alt="{heading} · {name}" loading="lazy"><div class="marks">')
            for index, (_, _, label) in enumerate(spots[area["id"]], 1):
                label = escape(label.replace("Unmarked spot", "Spot"))
                page.append(f'<figure><img src="{spot_path(area, key, index)}" width="96" height="96" '
                            f'alt="{label} at 6×" loading="lazy"><figcaption>{label}</figcaption></figure>')
            page.append("</div></article>")
        page.append("</div></section>")
    page.append("</main></html>\n")
    (folder / filename).write_text("\n".join(page))


def write_index(folder):
    (folder / "index.html").write_text(f"""<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Denoise round 5</title><link rel="stylesheet" href="../../../frontend/visual-tokens.css">
<style>{PAGE_STYLE}</style>
<main><h1>Denoise round 5</h1>
<ul><li><a href="part1.html">Canon fire dancers</a></li>
<li><a href="part2.html">Boy portrait</a></li></ul></main></html>
""")


def score_summary(points):
    summary = {}
    for key in points[0]["results"]:
        pairs = [(p["results"]["even"], p["results"][key], p["results"]["baseline"]) for p in points]
        counts = {}
        for field in ("colour", "luma"):
            grain_key = f"{field}_grain"
            if field == "colour":
                cohort = [(b, a) for b, a, _ in pairs if b[field] > 2*b[grain_key]]
            else:
                cohort = [(b, a) for b, a, _ in pairs if b[field] < -2*b[grain_key]]
            counts[field] = dict(
                cohort=len(cohort),
                near_grain=sum(abs(a[field]) <= 2*b[grain_key] for b, a in cohort),
                weaker=sum(abs(a[field]) <= .75*abs(b[field]) for b, a in cohort),
                worse=sum(abs(a[field]) > 1.25*abs(b[field]) and
                          abs(a[field])-abs(b[field]) >= .005 for b, a in cohort),
                all_near_today=sum(abs(a[field]) <= 2*t[grain_key] for _, a, t in pairs),
                new_at_marks=sum(abs(b[field]) <= 2*b[grain_key] < abs(a[field]) and
                                 abs(a[field])-abs(b[field]) >= .005 for b, a, _ in pairs),
                median_own_grain=float(np.median([a[grain_key] for _, a, _ in pairs])),
            )
        summary[key] = counts
    return summary


def blob_strength(shown):
    # Coherent excursions: a 3x3 core against a square ring 7–12 px away.
    delta = even.box(shown, 1) - even.annulus(shown, 12, 6)
    return np.stack((trial.magnitude(delta[..., 1:]), np.maximum(-delta[..., 0], 0)), axis=-1)


def new_spots(before, after):
    """Screen for new coherent excursions; counts include scene edges."""
    base = blob_strength(before)
    changed = blob_strength(after)
    fields = before - even.box(before, 2)
    fine = np.stack((trial.magnitude(fields[..., 1:]), np.abs(fields[..., 0])), axis=-1)
    noise = np.maximum(1.25 * even.box(fine, 16), marks.DISPLAY_FLOOR)
    footprint = np.ones((9, 9), np.uint8)
    prior = cv2.dilate(base, footprint)
    peaks = (changed == cv2.dilate(changed, footprint))
    candidates = peaks & (changed > 3*noise) & (changed > 1.5*prior) & (changed-prior >= 4/255)
    found = {}
    for index, name in enumerate(("colour", "dark")):
        mask = candidates[..., index].astype(np.uint8)
        count, _, _, centres = cv2.connectedComponentsWithStats(mask, connectivity=8)
        locations = []
        for x, y in np.rint(centres[1:]).astype(int):
            locations.append([int(x), int(y), round(float((changed-prior)[y, x, index])*255, 2)])
        locations.sort(key=lambda point: -point[2])
        found[name] = dict(count=count-1, largest=locations[:8])
    return found


def portrait_inputs():
    photos, feedback = marks.inputs()
    fixed = {area["id"]: area for area in photos[PORTRAIT]}
    areas = [fixed[key] for key in PORTRAIT_ORDER]
    points = [p for p in feedback["marks"] if p["file"] == PORTRAIT]
    counts = {area: sum(p["area_id"] == area for p in points) for area in PORTRAIT_ORDER}
    if counts != {"S1": 9, "S2": 0, "D1": 0, "D2": 11, "D3": 5}:
        raise ValueError(f"Unexpected portrait mark counts: {counts}")
    identity = next(row["sha256"] for row in manifest_files() if row["name"] == PORTRAIT)
    return check_source(PORTRAIT, identity), identity, areas, points


def portrait_spots(area, points):
    key = area["id"]
    if key in PORTRAIT_UNMARKED:
        return [(x, y, f"Spot {i}") for i, (x, y) in enumerate(PORTRAIT_UNMARKED[key], 1)]
    x, y = area["sensor_xy"]
    group = [p for p in points if p["area_id"] == key]
    return [(group[i]["sensor_x"]-x, group[i]["sensor_y"]-y, f"Mark {i+1}")
            for i in PORTRAIT_SPOTS[key]]


def review(folder, prior, pair, *, photo, model_root):
    is_canon = photo == "canon"
    path, identity, areas, original = canon.inputs() if is_canon else portrait_inputs()
    for area in areas:
        area["photo"] = photo
    (folder / "images" / photo).mkdir(parents=True, exist_ok=True)
    noisy, flip, size, ev = round4.prepare(path, areas)
    spots = {area["id"]: (round4.selected_spots(area, original, canon_page=True) if is_canon
                          else portrait_spots(area, original)) for area in areas}
    flags = defaultdict(dict)
    base_crops = {}

    def record(key, frame):
        scene = marking.sensor_view(frame, flip)
        for area in areas:
            pixels = round4.display(scene, area, ev)
            save_view(folder, area, key, pixels, spots[area["id"]])
            if key == "even":
                base_crops[area["id"]] = pixels
            elif key in PASSES or "+" in key:
                axes = marks.DISPLAY_AXES.T
                flags[key][area["id"]] = new_spots(
                    base_crops[area["id"]].astype(np.float32) / 255 @ axes,
                    pixels.astype(np.float32) / 255 @ axes,
                )
        canon.score_views(scene, areas, points, size, ev, key)
        print(f"{path.name} review · {key}", flush=True)

    tamed, _ = marking.develop(path, cleanup=True)
    model = adaptive.estimate_adaptive_model(tamed, workers=1)
    baseline = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
    points = canon.area_peaks(marking.sensor_view(baseline, flip), areas, original, size, ev)
    record("noisy", noisy)
    del noisy
    record("baseline", baseline)
    round4.mark_hues(marking.sensor_view(baseline, flip), areas, points, size, ev)
    del baseline
    frame = grain_matched(tamed, model)
    del tamed
    record("even", frame)
    for key in (*PASSES, pair):
        result = apply(frame, model, key)
        if key in PASSES and key.startswith("colour-"):
            for area in areas:
                src, dst = (marking.extract(marking.sensor_view(f, flip), area) for f in (frame, result))
                round4.channel_error(src, dst, "colour")
        record(key, result)
        del result
    del frame
    if is_canon:
        ai = (load_ai(folder, prior, areas, points, spots, identity, size, ev)
              or dict(status="unavailable", reason="Matching round 4 AI crops unavailable"))
    else:
        ai = render_ai(folder, model_root, PORTRAIT, identity, areas, points, spots, size, ev)
    summary = score_summary(points)
    receipt = dict(round4.stamp(), file=path.name, source_sha256=identity, resolution=size, lift_ev=ev, ai=ai,
                   combination=pair, marks=points, summary=summary, possible_new_spots=flags)
    (folder / f"{photo}.json").write_text(marking.json_text(receipt))
    title, filename = ("Canon fire dancers", "part1.html") if is_canon else ("Boy portrait", "part2.html")
    write_page(folder, title, filename, areas, spots, ai["status"] != "unavailable", pair)


def benchmark(folder, repeats, pair, sources=TIMING_SOURCES):
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    photos = {}
    for name in sources:
        path = check_source(name, identities[name])
        tamed, _ = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        samples = []
        for index in range(repeats):
            times = {}
            today, times["baseline"] = round4.clocked(adaptive.resolve_adaptive, tamed, model, marking.CONTROLS)
            del today
            frame, times["even"] = round4.clocked(grain_matched, tamed, model)
            keys = (*PASSES, pair)
            for key in keys if index % 2 == 0 else reversed(keys):
                result, times[key] = round4.clocked(apply, frame, model, key)
                del result
            del frame
            samples.append(times)
            print(f"{name} native pass {index+1}: " + ", ".join(f"{k} {v:.2f}s" for k, v in times.items()),
                  flush=True)
        photos[name] = dict(pixels=int(np.prod(tamed.shape[:2])), sha256=identities[name], samples=samples)
        del tamed
    (folder / "timing.json").write_text(marking.json_text(dict(round4.stamp(), combination=pair, photos=photos)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", choices=("review", "timing", "all"))
    parser.add_argument("--round4", type=Path, help="Round 4 output folder for the matching AI reference")
    parser.add_argument("--model-root", type=Path, help="Folder containing the Bayer AI model for the portrait reference")
    parser.add_argument("--repeats", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--colour", choices=("colour-gentle", "colour-strong", "colour-broad"), default="colour-broad")
    parser.add_argument("--patch", choices=("heal", "average"), default="heal")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pair = f"{args.colour}+{args.patch}"
    if args.run in ("review", "all"):
        scratch = OUTPUT / "images"
        if scratch.is_dir():
            shutil.rmtree(scratch)
        for photo in ("canon", "portrait"):
            review(OUTPUT, args.round4, pair, photo=photo, model_root=args.model_root)
        write_index(OUTPUT)
    if args.run in ("timing", "all"):
        benchmark(OUTPUT, args.repeats, pair)


if __name__ == "__main__":
    main()
