"""Native Denoise reference crops and fixed-mark comparison for the speed brief."""

import argparse
from html import escape
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image

from hdr_finisher import denoise_adaptive as adaptive, raw_speck_cleanup
from hdr_finisher.adjustments import _srgb_encode
from hdr_finisher.color import acescg_to_linear_bt2020
from hdr_finisher.color_context import RenderColorContext, scene_linear_to_nits
from hdr_finisher.cpu_strips import render_in_strips
from hdr_finisher.models import AdjustmentState, DenoiseLiveControls, PreviewKind
from tools.denoise_eval import canon_ladder, colour_speck_marks as marks
from tools.denoise_eval import even_keep_round4 as round4, marking_page as marking
from tools.denoise_eval.colour_speck_trials import check_source
from tools.lib.test_photos import manifest_files

ATRIUM = "DSC01212.ARW"
ORDINARY = "DSC05622.ARW"
PHOTOS = (ATRIUM, "IMG_0790.CR2", "_DSC7970.ARW", ORDINARY)
METHODS = {"standard": "Standard", "fine_grain": "Fine Grain", "clean_grain": "Clean Grain"}
OUTPUT = marking.OUTPUT.parents[1] / "review/denoise-speed-baseline"
# Unrotated sensor coordinates. The light is at x=3460, y=3000.
ATRIUM_AREAS = [
    dict(id="lights", what="Railing lights and planter", kind="detail", sensor_xy=[3200, 2800], size=512),
    dict(id="shadows", what="Foliage in shadow", kind="speck", sensor_xy=[3210, 3300], size=512),
    dict(id="detail", what="Roof structure and lighting", kind="detail", sensor_xy=[5640, 2180], size=512),
]
PRE_FIX = "f784e1fd"
GRADE = AdjustmentState()
GRADE.hdr.highlight_section_enabled = True
CONTEXT = RenderColorContext()


def old_cleanup():
    root = Path(__file__).resolve().parents[3]
    previous = subprocess.check_output([
        "git", "show", f"{PRE_FIX}:codebase/backend/hdr_finisher/raw_speck_cleanup.py",
    ], cwd=root)
    namespace = {"__name__": "hdr_finisher.raw_speck_cleanup", "__package__": "hdr_finisher"}
    exec(compile(previous, f"{PRE_FIX}:raw_speck_cleanup.py", "exec"), namespace)
    return namespace["apply"]


def resolve(source, model, method):
    controls = DenoiseLiveControls(method=method)
    return adaptive.resolve_adaptive(source, model, adaptive.AdaptiveControls(**controls.model_dump()))


def save_crops(folder, method, scene, flip, areas):
    views = {area["id"]: {"scene_acescg": marking.extract(marking.sensor_view(scene, flip), area).copy()}
             for area in areas}
    for lane in (PreviewKind.SDR, PreviewKind.HDR):
        output, _ = render_in_strips(scene, GRADE, lane, color_context=CONTEXT)
        for area in areas:
            crop = marking.extract(marking.sensor_view(output, flip), area)
            reference = views[area["id"]]
            if lane == PreviewKind.SDR:
                reference["sdr_linear_srgb"] = crop.copy()
            else:
                nits = scene_linear_to_nits(
                    acescg_to_linear_bt2020(crop), CONTEXT.hdr_reference_white_nits
                )
                if np.max(nits) > GRADE.hdr.highlight_compression_target_nits:
                    raise ValueError("HDR crop exceeded its highlight target")
                reference["hdr_rec2020_nits"] = nits
        del output
    for area in areas:
        stem = folder / f'{area["id"]}-{method}'
        reference = views[area["id"]]
        np.savez_compressed(stem.with_suffix(".npz"), **reference)
        pixels = np.rint(255 * _srgb_encode(np.clip(reference["sdr_linear_srgb"], 0, 1))).astype(np.uint8)
        pixels = marking.sensor_view(pixels, {0: 0, 3: 3, 5: 6, 6: 5}[flip])
        Image.fromarray(np.ascontiguousarray(pixels)).save(stem.with_suffix(".webp"), lossless=True)


def score(points):
    result = {}
    for field in ("colour", "luma"):
        grain = field + "_grain"
        cohort = [p for p in points if
                  (p["results"]["old-fine_grain"][field] * (1 if field == "colour" else -1)
                   > 2 * p["results"]["old-fine_grain"][grain])]
        result[field] = dict(
            cohort=len(cohort),
            **{key: sum(abs(p["results"][key][field]) <= 2 * p["results"]["old-fine_grain"][grain]
                         for p in cohort) for key in points[0]["results"]},
        )
    return result


def photo_record(path, folder, areas, original, previous, verify, guard):
    noisy, flip, size, ev = round4.prepare(path, areas)
    del noisy
    points = guard["marks"] if guard else None
    fixed = raw_speck_cleanup.apply
    trials = {"old": previous, "fixed": fixed} if verify else {"fixed": fixed}
    receipt = dict(lift_ev=ev, size=size, libraw_flip=flip, areas=areas, trials={})
    for tag, clamp in trials.items():
        raw_speck_cleanup.apply = clamp
        try:
            source, sensor = marking.develop(path, cleanup=True)
        finally:
            raw_speck_cleanup.apply = fixed
        receipt["trials"][tag] = sensor
        model = adaptive.estimate_adaptive_model(source, workers=1)
        for method in METHODS:
            frame = resolve(source, model, method)
            if original:
                view = marking.sensor_view(frame, flip)
                if points is None:
                    points = canon_ladder.area_peaks(view, areas, original, size, ev)
                canon_ladder.score_views(view, areas, points, size, ev, f"{tag}-{method}")
                del view
            if not verify:
                save_crops(folder, method, frame, flip, areas)
            del frame
            print(f"{path.name} {tag} {method}", flush=True)
        del source
    if points:
        receipt["marks"] = points
        if verify or guard:
            receipt["counts"] = score(points)
    return receipt


def write_page(folder, records):
    start = """<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Denoise reference</title>
<link rel="stylesheet" href="../../../frontend/visual-tokens.css">
<style>
html { background: var(--viewer); color: var(--text); }
body { margin: 16px; font: var(--font-weight-regular) var(--font-size-md)/var(--line-height-normal) var(--font-body); }
h1 { font-size: var(--page-title-font-size); font-weight: var(--font-weight-semibold); }
h2 { font-size: var(--font-size-2xl); font-weight: var(--font-weight-semibold); margin-block-start: 36px; }
h3 { font-size: var(--font-size-md); font-weight: var(--font-weight-medium); }
a { color: var(--accent-strong); }
.line { display: flex; gap: 12px; overflow-x: auto; }
figure { flex: none; margin: 0; padding: 8px; background: var(--panel); border: 1px solid var(--border); }
img { display: block; margin-block-start: 6px; }
</style>
<main>
<h1>Denoise reference</h1>
<p>Even out harsh specks is on at ×2.5. Each row shows one SDR area at 1:1 on a Retina screen.
The reference files contain the same native crop in scene-linear ACEScg, finished SDR and finished HDR
in the unrotated sensor orientation used for the spot measurements.</p>
"""
    parts = [start]
    for name, record in records.items():
        parts.append(f"<section><h2>{escape(name)}</h2>")
        if "counts" in record:
            parts.append("<ul>")
            for method, label in METHODS.items():
                colour, luma = (record["counts"][field] for field in ("colour", "luma"))
                parts.append(f'<li>{label} brought {colour[f"fixed-{method}"]}/{colour["cohort"]} colour spots '
                             f'and {luma[f"fixed-{method}"]}/{luma["cohort"]} pits to grain level.</li>')
            parts.append("</ul>")
        for area in record["areas"]:
            title = escape(area["what"])
            parts.append(f'<h3>{title}</h3><div class="line">')
            left, top, right, bottom = area["visible_xyxy"]
            width, height = (right - left) / 2, (bottom - top) / 2
            if record["libraw_flip"] in (5, 6):
                width, height = height, width
            for method, label in METHODS.items():
                stem = f'{escape(Path(name).stem)}/{escape(area["id"])}-{method}'
                parts.append(f'<figure><figcaption>{label} · <a href="{stem}.npz">Reference pixels</a></figcaption>'
                             f'<img src="{stem}.webp" style="width:{width:g}px;height:{height:g}px" '
                             f'alt="{title} with {label}" loading="lazy"></figure>')
            parts.append("</div>")
        parts.append("</section>")
    parts.append("</main></html>")
    (folder / "index.html").write_text("\n".join(parts), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-guard", type=Path, metavar="RECEIPT")
    parser.add_argument("--guard-receipt", type=Path, metavar="RECEIPT",
                        help="Keep the original mark positions and grain thresholds from the guard comparison")
    args = parser.parse_args()
    previous = old_cleanup() if args.verify_guard else None
    guard = json.loads(args.guard_receipt.read_text(encoding="utf-8"))["photos"] if args.guard_receipt else {}
    area_set, feedback = marks.inputs()
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    records = {}
    for name in PHOTOS:
        if args.verify_guard and name == ATRIUM:
            continue
        path = check_source(name, identities[name])
        areas = area_set.get(name, ATRIUM_AREAS)
        originals = [p for p in feedback["marks"] if p["file"] == name]
        folder = OUTPUT / path.stem
        if not args.verify_guard:
            folder.mkdir(parents=True, exist_ok=True)
        records[name] = photo_record(path, folder, areas, originals, previous, bool(args.verify_guard), guard.get(name))
        records[name]["source_sha256"] = identities[name]
    receipt = dict(**round4.stamp(), photos=records,
                   method_controls={method: DenoiseLiveControls(method=method).model_dump()
                                    for method in METHODS},
                   hdr_target_nits=GRADE.hdr.highlight_compression_target_nits,
                   hdr_reference_white_nits=CONTEXT.hdr_reference_white_nits)
    if args.verify_guard:
        args.verify_guard.write_text(marking.json_text(receipt), encoding="utf-8")
    else:
        (OUTPUT / "reference.json").write_text(marking.json_text(receipt), encoding="utf-8")
        write_page(OUTPUT, records)


if __name__ == "__main__":
    main()
