"""Generate Steve's static Denoise comparisons and native CPU timing receipts."""
import argparse
from collections import defaultdict
from dataclasses import asdict
from html import escape
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from time import perf_counter

import cv2
import numpy as np
from PIL import Image, ImageFile

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher.color import acescg_to_linear_srgb
from tools.denoise_eval import canon_ladder as canon, colour_speck_features as features
from tools.denoise_eval import colour_speck_marks as marks, marking_page as marking
from tools.denoise_eval.candidates import canon_ladder as old, colour_speck as colour
from tools.denoise_eval.candidates import even_keep_round4 as trial
from tools.denoise_eval.colour_speck_trials import TIMING_SOURCES, check_source
from tools.lib.test_photos import manifest_files, sha256

OUTPUT = marking.OUTPUT.parent / "round4"
MAX_BYTES = 25_000_000
TODAY = "Today (Denoise + Even out harsh specks)"
STRENGTH = {"gentle": .55, "strong": 1.0}
CHROMA_LABEL = {"hue": "Hue unify", "local": "Green/magenta cleanup",
                "balance": "Green/magenta channel balance"}
DARK_LABEL = {"centre": "Dark clump breakup", "medium": "Dark clump breakup (Medium only)"}
CANON_SPOTS = {"S2": (0, 4, 9), "D1": (0, 4, 8), "D4": (1, 2, 11)}
# The other Canon crops have no original marks. These are fixed review positions
# in crop coordinates, not additional scored marks.
UNMARKED_SPOTS = {"S1": ((168, 205), (331, 327)), "D2": ((238, 221), (305, 305)),
                  "D3": ((207, 230), (310, 351))}
PATCH = 32
ZOOM = 6


def even_label(distance, grain_weighted=False):
    suffix = " (grain-weighted)" if grain_weighted else ""
    return f"Even keep brightness {distance} px{suffix}"


def combined_label(args, *, use_colour=True, use_dark=True):
    names = [even_label(args.distance)]
    if use_colour:
        names.append(f"{CHROMA_LABEL[args.chroma_mode]} ({args.chroma_strength})")
    if use_dark:
        names.append(f"{DARK_LABEL[args.dark_mode]} ({args.dark_strength})")
    return " + ".join(names)


def stamp():
    return dict(source_commit=subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                area_sha256=sha256(marking.AREAS), marks_sha256=sha256(marks.MARKS),
                controls=asdict(marking.CONTROLS), measurement=adaptive.MEASUREMENT_VERSION)


def prepare(path, areas):
    noisy, flip, width, height, ev, _ = marks.develop_inputs(path, areas)
    for area in areas:
        area["visible_xyxy"] = marking.bounds_for(area, width, height)
    return noisy, flip, (width, height), ev


def display(scene, area, ev):
    x, y = area["sensor_xy"]
    left, top, right, bottom = area["visible_xyxy"]
    size = area["size"]
    pixels = np.zeros((size, size, 3), dtype=np.uint8)
    pixels[top-y:bottom-y, left-x:right-x] = marking.display_pixels(
        acescg_to_linear_srgb(marking.extract(scene, area)), ev)
    return pixels


def selected_spots(area, points, *, canon_page):
    group = [p for p in points if p["area_id"] == area["id"]]
    x, y = area["sensor_xy"]
    if group:
        indices = CANON_SPOTS[area["id"]] if canon_page else (0,)
        return [(group[i]["sensor_x"]-x, group[i]["sensor_y"]-y, f"Mark {i+1}") for i in indices]
    if canon_page:
        return [(u, v, f"Unmarked spot {i}") for i, (u, v) in enumerate(UNMARKED_SPOTS[area["id"]], 1)]
    return []


def save_row(folder, page, name, area, key, pixels, spots):
    prefix = f"{page}-{name}-{area['id']}-{key}"
    images = folder / f"{page}-images"
    photo = images / f"{prefix}.jpg"
    Image.fromarray(pixels).save(photo, quality=88, subsampling=0, optimize=True)
    paths = []
    for index, (x, y, label) in enumerate(spots, 1):
        left = np.clip(x-PATCH//2, 0, pixels.shape[1]-PATCH)
        top = np.clip(y-PATCH//2, 0, pixels.shape[0]-PATCH)
        thumbnail = Image.fromarray(pixels[top:top+PATCH, left:left+PATCH])
        path = images / f"{prefix}-{index}.webp"
        thumbnail.resize((PATCH*ZOOM,)*2, Image.Resampling.NEAREST).save(path, lossless=True, method=3)
        paths.append((label, str(path.relative_to(folder))))
    return str(photo.relative_to(folder)), paths


PAGE_STYLE = """
html { background: var(--viewer); color: var(--text); }
body { margin: 24px; font-family: var(--font-body); font-size: var(--font-size-lg);
       line-height: var(--line-height-normal); }
h1 { font-size: var(--page-title-font-size); font-weight: var(--font-weight-semibold); }
h2 { font-size: var(--font-size-2xl); font-weight: var(--font-weight-semibold); }
a { color: var(--accent-strong); }
section { margin-block: 24px 48px; }
table { border-collapse: collapse; background: var(--panel); }
th, td { padding: 8px; border-block-start: 1px solid var(--border); text-align: left;
         vertical-align: top; }
th { width: 175px; min-width: 175px; font-weight: var(--font-weight-medium); }
th small { display: block; color: var(--muted); font-size: var(--font-size-sm); }
figure { margin: 0; }
figcaption { color: var(--body); font-size: var(--font-size-sm); }
img { display: block; image-rendering: pixelated; }
"""


def page_document(title, body):
    return (f'<!doctype html>\n<html lang="en"><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{escape(title)}</title><link rel="stylesheet" href="../../../frontend/visual-tokens.css">'
            f'<style>{PAGE_STYLE}</style><main><h1>{escape(title)}</h1>{body}</main></html>\n')


def photo_block(number, title, area, rows):
    heading = f"Block {number} · {title}"
    contents = [f'<section><h2>{escape(heading)}</h2><table aria-label="{escape(heading)}">']
    for i, (label, (image, patches)) in enumerate(rows, 1):
        size = area["size"]
        contents.append(f'<tr><th scope="row"><small>Row {i}</small>{escape(label)}</th>'
                        f'<td><img src="{image}" width="{size}" height="{size}" loading="lazy" '
                        f'alt="{escape(title)} at 1:1"></td>')
        for caption, path in patches:
            contents.append(f'<td><figure><img src="{path}" width="{PATCH*ZOOM}" height="{PATCH*ZOOM}" '
                            f'loading="lazy" alt="{escape(caption)} enlarged six times">'
                            f'<figcaption>{escape(caption)} · 6×</figcaption></figure></td>')
        contents.append("</tr>")
    return "".join(contents) + "</table></section>"


def write_index(folder):
    body = ('<ul><li><a href="part1.html">Part 1 · Six Canon areas and marked close-ups</a></li>'
            '<li><a href="part2.html">Part 2 · All 54 areas and edge cases</a></li></ul>')
    (folder / "index.html").write_text(page_document("Denoise review · Even keep brightness", body))


def render_rows(folder, page, name, areas, points, flip, ev, key, label, frame, rows):
    scene = marking.sensor_view(frame, flip)
    for area in areas:
        pixels = display(scene, area, ev)
        spots = selected_spots(area, points, canon_page=page == "part1")
        rows[area["id"]].append((label, save_row(folder, page, name, area, key, pixels, spots)))


def get_fixed_summary(points):
    summary = {}
    for key in points[0]["results"]:
        group = {}
        for area in ("all", *canon.AREA_ORDER):
            selected = [p for p in points if area in ("all", p["area_id"])]
            before = [p["results"]["baseline"] for p in selected]
            after = [p["results"][key] for p in selected]
            pits = [(b, a) for b, a in zip(before, after) if b["luma"] < -2*b["luma_grain"]]
            colour_outliers = [(b, a) for b, a in zip(before, after) if b["colour"] >= .015]
            fixed_luma = sum(abs(a["luma"]) <= 2*b["luma_grain"] for b, a in zip(before, after))
            fixed_colour = sum(a["colour"] <= 2*b["colour_grain"] for b, a in zip(before, after))
            new_colour = sum(a["colour"] > 1.25*b["colour"] and a["colour"]-b["colour"] >= .005
                             for b, a in zip(before, after))
            group[area] = dict(
                brightness=fixed_luma, colour=fixed_colour,
                both=sum(abs(a["luma"]) <= 2*b["luma_grain"] and a["colour"] <= 2*b["colour_grain"]
                         for b, a in zip(before, after)),
                dark_pits=len(pits),
                pits_now_near_grain=sum(abs(a["luma"]) <= 2*b["luma_grain"] for b, a in pits),
                pits_quarter_weaker=sum(abs(a["luma"]) <= .75*abs(b["luma"]) for b, a in pits),
                colour_quarter_weaker=sum(a["colour"] <= .75*b["colour"] for b, a in colour_outliers),
                colour_newly_stronger=new_colour,
                median_colour=float(np.median([a["colour"] for a in after])) if after else None,
                median_brightness_grain=float(np.median([a["luma_grain"] for a in after])) if after else None,
                median_colour_grain=float(np.median([a["colour_grain"] for a in after])) if after else None,
            )
        summary[key] = group
    return summary


def mark_hues(scene, areas, points, size, ev):
    for area in areas:
        rect = marks.rectangle(area, *size, 16)
        shown = marks.display_axes(marks.crop(scene, rect), ev)
        for point in points:
            if point["area_id"] != area["id"]:
                continue
            x, y = (point["peak_xy"][i]-rect[i] for i in range(2))
            reference, _ = marks.ring(shown, x, y)
            _, green_magenta, red_blue = shown[y, x]-reference
            score = point["results"]["baseline"]["colour_score"]
            point["baseline_hue"] = ("weak colour" if score < 2 else
                                     "green/magenta" if abs(green_magenta) >= abs(red_blue) else "red/blue")


def incremental_summary(points, base_key):
    summary = {}
    for key in [item for item in points[0]["results"] if item.startswith(("colour-", "dark-", "full"))]:
        groups = defaultdict(list)
        for point in points:
            pair = point["results"][base_key], point["results"][key]
            groups["all"].append(pair)
            groups[point["baseline_hue"]].append(pair)
            groups[point["area_id"]].append(pair)
        summary[key] = {}
        for name, pairs in groups.items():
            pits = [(before, after) for before, after in pairs if before["luma"] < -2*before["luma_grain"]]
            colour_outliers = [(before, after) for before, after in pairs if before["colour"] >= .015]
            summary[key][name] = dict(
                points=len(pairs), dark_pits=len(pits), colour_outliers=len(colour_outliers),
                pits_quarter_weaker=sum(abs(a["luma"]) <= .75*abs(b["luma"]) for b, a in pits),
                pits_now_near_grain=sum(abs(a["luma"]) <= 2*b["luma_grain"] for b, a in pits),
                colour_quarter_weaker=sum(a["colour"] <= .75*b["colour"] for b, a in colour_outliers),
                colour_newly_stronger=sum(a["colour"] > 1.25*b["colour"] and a["colour"]-b["colour"] >= .005
                                          for b, a in pairs))
    return summary


def agreement(reference, fast, areas, flip, ev):
    from colour.difference import delta_E_CIE2000

    result = {}
    for area in areas:
        lab = []
        for frame in (reference, fast):
            pixels = display(marking.sensor_view(frame, flip), area, ev)
            lab.append(cv2.cvtColor(pixels.astype(np.float32)/255, cv2.COLOR_RGB2LAB))
        de = delta_E_CIE2000(*lab)
        result[area["id"]] = dict(mean=float(np.mean(de)), p99=float(np.quantile(de, .99)),
                                  p999=float(np.quantile(de, .999)))
    return result


def colour_retention_diagnostic(source, baseline, colour_even, points, areas, flip, size, ev):
    """Track how often the old colour keep strengthens an existing mark."""
    axes = adaptive.OPPONENT[1:].T
    quiet_chroma = []
    shifts = []
    for area in areas:
        a, b, c = [marking.extract(marking.sensor_view(frame, flip), area) @ axes
                   for frame in (source, baseline, colour_even)]
        # Compare the same ~2–8 px chroma at places where Today was especially quiet.
        bands = [trial.box(image, 1)-trial.box(image, 6) for image in (a, b, c)]
        power = [np.linalg.norm(band, axis=-1) for band in bands]
        reduced = (power[1] <= .25*power[0]) & (power[0] > np.quantile(power[0], .5))
        quiet_chroma.append(float(np.median(power[2][reduced]/power[0][reduced])))
        shifts.append(float(np.mean(power[2][reduced] > power[1][reduced])))
    canon.score_views(marking.sensor_view(colour_even, flip), areas, points, size, ev, "old-colour18")
    return dict(areas={area["id"]: dict(
        median_fraction_of_source_amplitude=amp, fraction_amplitude_increased=increased)
        for area, amp, increased in zip(areas, quiet_chroma, shifts)})


def channel_error(before, after, target):
    basis = colour.LUMA if target == "colour" else adaptive.OPPONENT[1:].T
    first, second = before @ basis, after @ basis
    np.testing.assert_allclose(first, second, rtol=2e-6, atol=2e-7)
    return float(np.max(np.abs(first-second)))


def canon_render(folder, args):
    path, identity, areas, original_points = canon.inputs()
    noisy, flip, size, ev = prepare(path, areas)
    rows = defaultdict(list)
    render_rows(folder, "part1", "canon", areas, original_points, flip, ev, "noisy", "Noisy", noisy, rows)
    del noisy
    tamed, _ = marking.develop(path, cleanup=True)
    model = adaptive.estimate_adaptive_model(tamed, workers=1)
    baseline = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
    points = canon.area_peaks(marking.sensor_view(baseline, flip), areas, original_points, size, ev)
    errors = defaultdict(float)

    def record(key, label, image, *, check=None, reference=None):
        scene = marking.sensor_view(image, flip)
        if check:
            before = marking.sensor_view(reference, flip)
            for area in areas:
                error = channel_error(marking.extract(before, area), marking.extract(scene, area), check)
                errors[key] = max(errors[key], error)
        render_rows(folder, "part1", "canon", areas, original_points, flip, ev, key, label, image, rows)
        canon.score_views(scene, areas, points, size, ev, key)

    record("baseline", TODAY, baseline)
    mark_hues(marking.sensor_view(baseline, flip), areas, points, size, ev)
    if args.model_root:
        # Reuse the previous guarded original-RAW AI render and its scores.
        # The previous JPEG is used only for the 1:1 crop. Its lossless strip
        # supplies the same exact marked pixels for the 6× close-ups.
        with tempfile.TemporaryDirectory(prefix="round4-ai-", dir=folder) as scratch:
            ai_folder = Path(scratch)
            (ai_folder / "images").mkdir()
            photo = dict(areas=areas, sensor_wh=size, lift_ev=ev)
            ai = canon.run_ai(ai_folder, photo, points, args.model_root)
            if ai["status"] != "complete":
                raise RuntimeError(f"Canon AI reference failed: {ai}")
            for area in areas:
                source = ai_folder / area["images"].pop("ai")
                image_path = folder / "part1-images" / f"part1-canon-{area['id']}-ai.jpg"
                shutil.move(source, image_path)
                with Image.open(ai_folder / area["patches"].pop("ai")) as strip:
                    patches = []
                    for index, (x, y, label) in enumerate(selected_spots(area, original_points, canon_page=True)):
                        if area["id"] in CANON_SPOTS:
                            offset = CANON_SPOTS[area["id"]][index]*canon.PATCH_SIZE
                            # Account for both the original sprite and current patch's crop-edge clamping.
                            n = area["size"]
                            dx = np.clip(x-PATCH//2, 0, n-PATCH)-np.clip(x-canon.PATCH_SIZE//2, 0, n-canon.PATCH_SIZE)
                            dy = np.clip(y-PATCH//2, 0, n-PATCH)-np.clip(y-canon.PATCH_SIZE//2, 0, n-canon.PATCH_SIZE)
                            close = strip.crop((dx, offset+dy, dx+PATCH, offset+dy+PATCH))
                        else:
                            with Image.open(image_path) as whole:
                                close = whole.crop((x-PATCH//2, y-PATCH//2, x+PATCH//2, y+PATCH//2))
                        dest = image_path.with_name(f"{image_path.stem}-{index+1}.webp")
                        close.resize((PATCH*ZOOM,)*2, Image.Resampling.NEAREST).save(dest, lossless=True, method=3)
                        patches.append((label, str(dest.relative_to(folder))))
                rows[area["id"]].append(("AI Denoise (reference)", (str(image_path.relative_to(folder)), patches)))
    else:
        ai = {"status": "omitted (no model supplied)"}

    matched = old.even_calibration(tamed, model)
    previous = old.resolve(tamed, baseline, model, old.Trial("even", "brightness", 2), matched)
    old_colour = old.resolve(tamed, baseline, model, old.Trial("even", "colour", 2), matched)
    diagnostic = colour_retention_diagnostic(tamed, baseline, old_colour, points, areas, flip, size, ev)
    del old_colour
    calibration = trial.calibrate_brightness(tamed, model, trial.DISTANCES)
    comparison = {}
    for distance in trial.DISTANCES:
        result = trial.resolve(tamed, model, distance, calibration=calibration)
        record(f"even{distance}", even_label(distance), result, check="brightness", reference=baseline)
        if distance == 18:
            comparison["matched"] = agreement(previous, result, areas, flip, ev)
        if distance == args.distance:
            even = result
        del result
    for key, weighted in (("plain18", False), ("weighted18", True)):
        result = trial.resolve(tamed, model, 18, weighted)
        label = even_label(18, True) if weighted else even_label(18) + " (local average only)"
        record(key, label, result, check="brightness", reference=baseline)
        comparison[key] = agreement(previous, result, areas, flip, ev)
        del result
    del previous, tamed, baseline

    for mode, label in CHROMA_LABEL.items():
        for strength, amount in STRENGTH.items():
            result = trial.native_colour(even, model, mode, amount)
            record(f"colour-{mode}-{strength}", f"{even_label(args.distance)} + {label} ({strength})",
                   result, check="colour", reference=even)
            del result
    for mode, label in DARK_LABEL.items():
        for strength, amount in STRENGTH.items():
            result = trial.native_dark(even, model, mode, amount)
            record(f"dark-{mode}-{strength}", f"{even_label(args.distance)} + {label} ({strength})",
                   result, check="brightness", reference=even)
            del result
    clean = trial.native_colour(even, model, args.chroma_mode, STRENGTH[args.chroma_strength])
    full = trial.native_dark(clean, model, args.dark_mode, STRENGTH[args.dark_strength])
    record("full", combined_label(args), full)
    for area in areas:
        rect = area["visible_xyxy"]
        before, after = (marks.crop(marking.sensor_view(frame, flip), rect) for frame in (clean, full))
        errors["full-dark"] = max(errors["full-dark"], channel_error(before, after, "brightness"))
    del full, clean
    for mode in CHROMA_LABEL:
        if mode == args.chroma_mode:
            continue
        clean = trial.native_colour(even, model, mode, STRENGTH[args.chroma_strength])
        other = trial.native_dark(clean, model, args.dark_mode, STRENGTH[args.dark_strength])
        canon.score_views(marking.sensor_view(other, flip), areas, points, size, ev, f"full-{mode}")
        del other, clean
    del even
    receipt = dict(stamp(), source_sha256=identity, resolution=size, lift_ev=ev, model=model.as_dict(),
                   plan=combined_label(args), marks=points, fixed_grain=get_fixed_summary(points),
                   own_grain=canon.data_summary(points, tuple(points[0]["results"])),
                   changes_from_even=incremental_summary(
                       points, f"even{args.distance}"),
                   agreement_delta_e00=comparison, channel_errors=errors, prior_colour=diagnostic, ai=ai)
    (folder / "canon.json").write_text(marking.json_text(receipt))
    intro = ('<p>Crops are shown at 1:1. Close-ups use the same marked positions in every row. '
             'S1, D2 and D3 use unmarked comparison spots.</p>')
    blocks = []
    for number, area in enumerate(areas, 1):
        title = f"Canon {area['id']} · {area['what']}"
        blocks.append(photo_block(number, title, area, rows[area["id"]]))
    (folder / "part1.html").write_text(page_document("Part 1 · Canon fire dancers", intro+"".join(blocks)))


def edge_measure(base, other, crop_box=None):
    if crop_box is not None:
        l, t, r, b = crop_box
        selection = np.s_[t:b, l:r]
    else:
        selection = np.s_[:, :]
    keys = ("local_colour", "colour_edge", "brightness_edge")
    before_signals, after_signals = features.signals(base), features.signals(other)
    ratios = {key: features.compare(a[selection], b[selection])
              for key, a, b in zip(keys, before_signals, after_signals)}
    delta = np.abs(other[selection].astype(np.int16)-base[selection]).max(axis=-1)
    return dict(**ratios, p99_rgb_levels=float(np.quantile(delta, .99)), max_rgb_levels=int(delta.max()))


def corpus_render(folder, args):
    area_set, feedback = marks.inputs()
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    blocks = []
    results = {}
    named = defaultdict(list)
    extra_features = (
        ("Barista skin", "DSC05293.ARW", "D4", None),
        ("Ear and skin", "_DSC7970.ARW", "D3", None),
        ("Knit collar", "DSC05622.ARW", "D3", None),
        ("Dark jacket fabric", "PC131157.ORF", "D4", None),
    )
    for label, name, area, crop_box in (*features.FEATURES, *extra_features):
        named[name, area].append((label, crop_box))
    for name, fixed in area_set.items():
        print(f"Part 2: {name} ({len(fixed)} areas)", flush=True)
        path = check_source(name, identities[name])
        points = [point for point in feedback["marks"] if point["file"] == name]
        noisy, flip, size, ev = prepare(path, fixed)
        del noisy
        tamed, _ = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        baseline = adaptive.resolve_adaptive(tamed, model, marking.CONTROLS)
        calibration = trial.calibrate_brightness(tamed, model, (args.distance,))
        even = trial.resolve(tamed, model, args.distance, calibration=calibration)
        del tamed
        cleaned = trial.native_colour(even, model, args.chroma_mode, STRENGTH[args.chroma_strength])
        full = trial.native_dark(cleaned, model, args.dark_mode, STRENGTH[args.dark_strength])
        frames = [marking.sensor_view(frame, flip) for frame in (baseline, even, full)]
        colour_only = marking.sensor_view(cleaned, flip)
        records = {}
        for area in fixed:
            crops = [display(frame, area, ev) for frame in frames]
            spots = selected_spots(area, points, canon_page=False)
            rows = []
            keys = ("baseline", "even", "full")
            labels = (TODAY, even_label(args.distance), combined_label(args))
            for key, label, pixels in zip(keys, labels, crops):
                rows.append((label, save_row(folder, "part2", name, area, key, pixels, spots)))
            title = f"{name} {area['id']} · {area['what']}"
            if name == canon.PHOTO:
                title = f"Canon {area['id']} · {area['what']}"
            blocks.append(photo_block(len(blocks)+1, title, area, rows))
            with_colour = display(colour_only, area, ev)
            metrics = {}
            for label, rect in [("whole crop", None), *named[name, area["id"]]]:
                metrics[label] = {"even": edge_measure(crops[0], crops[1], rect),
                                  "full": edge_measure(crops[0], crops[2], rect),
                                  "extra": edge_measure(crops[1], crops[2], rect),
                                  "colour_only": edge_measure(crops[1], with_colour, rect),
                                  "dark_after_colour": edge_measure(with_colour, crops[2], rect)}
            records[area["id"]] = dict(label=area["what"], measurements=metrics)
        results[name] = dict(sha256=identities[name], lift_ev=ev, resolution=size, areas=records)
        del frames, colour_only, baseline, even, cleaned, full
    if len(blocks) != 54 or len(area_set) != 11:
        raise ValueError("Expected 54 fixed areas and 11 photos")
    intro = ('<p>Crops are shown at 1:1. Where Steve placed marks, the first mark in the area '
             'is shown at 6× in all three rows.</p>')
    (folder / "part2.html").write_text(page_document("Part 2 · Eleven photos", intro+"".join(blocks)))
    (folder / "corpus.json").write_text(marking.json_text(dict(stamp(), plan=combined_label(args), photos=results)))


def clocked(function, *args):
    start = perf_counter()
    result = function(*args)
    return result, perf_counter()-start


def time_native(folder, args):
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    results = {}
    for name in TIMING_SOURCES:
        path = check_source(name, identities[name])
        tamed, _ = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        size = tamed.shape[:2]
        samples = []
        for index in range(args.repeats):
            functions = (("baseline", adaptive.resolve_adaptive, (marking.CONTROLS,)),
                         ("plain", trial.resolve, (args.distance,)),
                         ("weighted", trial.resolve, (args.distance, True)))
            times = {}
            for key, function, values in functions if index % 2 == 0 else reversed(functions):
                frame, times[key] = clocked(function, tamed, model, *values)
                del frame
            fit, times["energy_fit"] = clocked(trial.calibrate_brightness, tamed, model, (args.distance,))
            even, times["energy_resolve"] = clocked(trial.resolve, tamed, model, args.distance, False, fit)
            for mode in CHROMA_LABEL if index % 2 == 0 else reversed(CHROMA_LABEL):
                frame, times[f"colour-{mode}"] = clocked(
                    trial.native_colour, even, model, mode, STRENGTH[args.chroma_strength])
                if mode == args.chroma_mode:
                    clean = frame
                del frame
            for mode in DARK_LABEL if index % 2 == 0 else reversed(DARK_LABEL):
                frame, times[f"dark-{mode}"] = clocked(
                    trial.native_dark, clean, model, mode, STRENGTH[args.dark_strength])
                del frame
            del clean, even
            times["colour"] = times[f"colour-{args.chroma_mode}"]
            times["dark"] = times[f"dark-{args.dark_mode}"]
            times["plain_added"] = times["plain"]-times["baseline"]
            times["weighted_added"] = times["weighted"]-times["baseline"]
            times["energy_added"] = times["energy_fit"]+times["energy_resolve"]-times["baseline"]
            times["full_added"] = times["energy_added"]+times["colour"]+times["dark"]
            print(f"{name} pair {index+1} {times}", flush=True)
            samples.append(times)
        results[name] = dict(pixels=size[0]*size[1], sha256=identities[name], samples=samples)
        del tamed
    (folder / "timing.json").write_text(marking.json_text(dict(stamp(), plan=combined_label(args), photos=results)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("canon", "corpus", "timing", "all"))
    parser.add_argument("--distance", type=int, choices=trial.DISTANCES, default=18)
    parser.add_argument("--chroma-mode", choices=CHROMA_LABEL, default="balance")
    parser.add_argument("--chroma-strength", choices=STRENGTH, default="strong")
    parser.add_argument("--dark-mode", choices=DARK_LABEL, default="centre")
    parser.add_argument("--dark-strength", choices=STRENGTH, default="strong")
    parser.add_argument("--model-root", type=Path, help="Directory with the pinned Bayer ONNX reference")
    parser.add_argument("--repeats", type=int, choices=(2, 3, 4), default=3)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 2 * 1024 * 1024)
    phases = {"canon": ("part1", canon_render), "corpus": ("part2", corpus_render),
              "timing": (None, time_native)}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="denoise-round4-", dir=OUTPUT.parent) as scratch:
        folder = Path(scratch)
        selected = tuple(phases) if args.phase == "all" else (args.phase,)
        for phase in selected:
            images, run = phases[phase]
            if images:
                (folder / f"{images}-images").mkdir()
            run(folder, args)
        write_index(folder)
        new = {item.name for item in folder.iterdir()}
        retained = [path for path in OUTPUT.glob("*") if path.name not in new]
        total = sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())
        for path in retained:
            total += path.stat().st_size if path.is_file() else sum(
                item.stat().st_size for item in path.rglob("*") if item.is_file())
        if total >= MAX_BYTES:
            raise ValueError(f"Round 4 output exceeds the 25 MB cap ({total:,} bytes)")
        OUTPUT.mkdir(exist_ok=True)
        for item in folder.iterdir():
            dest = OUTPUT / item.name
            if dest.is_dir():
                shutil.rmtree(dest)
            item.replace(dest)
    print(f"{total:,} bytes. {OUTPUT / 'index.html'}", flush=True)


if __name__ == "__main__":
    main()
