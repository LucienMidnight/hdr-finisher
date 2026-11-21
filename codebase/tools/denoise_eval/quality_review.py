"""Build the QUAL-1 review from the local, read-only copies of the test RAWs."""

from contextlib import contextmanager
from html import escape
import os

import cv2
import numpy as np
from PIL import Image

from hdr_finisher import denoise_adaptive as adaptive, denoise_grain as grain, denoise_micro_grain as micro
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.models import RawImportSettings
from tools.denoise_eval import colour_speck_marks as marked, marking_page as marking


OUTPUT = marking.CODEBASE / "output/review/grain-quality"
PHOTOS = {
    "IMG_0790.CR2": ("Canon", ("D4", "S2")),
    "_DSC7970.ARW": ("Sony", ("D2", "S1")),
    "gpu-raw/DSC01212.ARW": ("Atrium", ("Lights",)),
}
CANDIDATES = {
    "COLOUR_LEVELS": ("Colour protection", "Colour cleanup follows the grain level; look for the same railing and flame-edge detail as you change exposure."),
    "MICRO_GUARD": ("Micro light guard", "Micro Grain uses sensor noise to decide which lights to leave alone; look for crisp lights without untreated patches around them."),
    "RAW_LEVELS": ("RAW cleanup floors", "RAW cleanup scales its cutoffs to the sensor noise; look for fewer stray specks without losing tiny lights."),
    "BAYER_FIT": ("Weighted Bayer fit", "The noise estimate gives clean shadow samples more say; look for smoother shadow grain without softer hair or edges."),
}
EXPOSURES = (-3, 0, 3)
SETTINGS = RawImportSettings(lens={"mode": "off"}, pixel_cleanup={"remove_hot_pixels": True, "even_out_specks": True})
CONTROLS = micro.MicroGrainControls()
CLEAN = adaptive.AdaptiveControls(method="clean_grain", grain_evenness=0)


@contextmanager
def candidate(name=None):
    keys = {f"HDR_FINISHER_QUAL_{value}": value == name for value in CANDIDATES}
    before = {key: os.environ.get(key) for key in keys}
    try:
        for key, active in keys.items():
            os.environ[key] = "1" if active else "0"
        yield
    finally:
        for key, value in before.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def regions(path, source, areas, marks):
    height, width = source.sensor.shape
    photo, names = PHOTOS[path]
    for name in names:
        if photo == "Atrium":
            x, y, size = 3460, 3000, 320
            caption = "Railing lights and planter"
            points = []
        else:
            area = next(value for value in areas[path] if value["id"] == name)
            points = [(mark["sensor_x"], mark["sensor_y"]) for mark in marks
                      if mark["file"] == path and mark["area_id"] == name]
            size = 256
            x, y = max(points, key=lambda centre: sum(max(abs(xx - centre[0]), abs(yy - centre[1])) < size // 2
                                                        for xx, yy in points))
            caption = area["what"]
        left, top = max(0, min(x - size // 2, width - size)), max(0, min(y - size // 2, height - size))
        bounds = (left, top, left + size, top + size)
        count = sum(left <= xx < left + size and top <= yy < top + size for xx, yy in points)
        rect = marked.oriented_rect(bounds, width, height, source.flip)
        yield name, caption, count, rect


def micro_crop(source, rect):
    return source.render_core(CONTROLS, rect) * source.gain


def capture_clip_count(source):
    height, width = source.sensor.shape
    counts = [0, 0]

    def add(index, clipped):
        counts[index] += int(np.count_nonzero(clipped))

    for top in range(0, height, 512):
        for left in range(0, width, 768):
            rect = (left, top, min(left + 768, width), min(top + 512, height))
            outer = micro._expand(rect, (height, width), micro.BAYER_MARGIN, even=True)
            tile = micro.BayerTile(source.sensor[micro._inset(outer, (0, 0, 0, 0))], source.profile)
            centre = micro._inset(rect, outer, step=2)
            for index, controls in enumerate((CONTROLS, micro.MicroGrainControls(1, 1, 0))):
                tile.apply(controls, centre, signed_clips=lambda mask: add(index, mask))
    return height * width, *counts


def save_crop(prefix, variant, ev, rgb, display_ev):
    name = f"{prefix}-{variant}-{ev:+}.jpg"
    pixels = marking.display_pixels(acescg_to_linear_srgb(rgb), display_ev)
    Image.fromarray(pixels).save(OUTPUT / name, quality=90, subsampling=0, optimize=True)
    return name


def photo_rows(path, areas, marks):
    location = marking.CODEBASE / "output/test-photos" / path
    photo = PHOTOS[path][0]
    with candidate():
        source = micro.MicroGrainSource(location, SETTINGS)
        print(f"{photo}: {capture_clip_count(source)} (samples, default clips, strong clips)", flush=True)
        selections = list(regions(path, source, areas, marks))
        old_micro = {name: micro_crop(source, rect) for name, _, _, rect in selections}
        height, width = source.shape
        read = lambda top, left, bottom, right: source.read_unfiltered(top, left, bottom, right) * source.gain
        model = adaptive.estimate_adaptive_model_from_windows(height, width, read)
        old_clean = {name: grain._resolved_tile(read, height, width, (rect[1], rect[0]), rect[2] - rect[0],
                                               grain.SMALL_COLOUR_MARGIN, model, CLEAN, None)
                     for name, _, _, rect in selections}
    micro_variants = {"micro-today": old_micro}
    for variant in ("MICRO_GUARD", "RAW_LEVELS", "BAYER_FIT"):
        with candidate(variant):
            trial_source = source if variant == "MICRO_GUARD" else micro.MicroGrainSource(location, SETTINGS)
            micro_variants[variant] = {name: micro_crop(trial_source, rect) for name, _, _, rect in selections}
            del trial_source
    for name, caption, count, _ in selections:
        prefix = f"{photo.lower()}-{name.lower()}"
        base, core = old_clean[name]
        rows = []
        for ev in EXPOSURES:
            scale = np.float32(2. ** ev)
            shifted = base * scale
            images = []
            for variant in (None, "COLOUR_LEVELS"):
                with candidate(variant):
                    pixels = grain.apply_colour(shifted, grain.colour_delta(shifted, False), CLEAN.color_splotches)[core]
                    images.append(save_crop(prefix, variant or "clean-today", ev, pixels, 0))
            images.extend(save_crop(prefix, variant, ev, values[name], ev) for variant, values in micro_variants.items())
            rows.append((ev, images))
        yield photo, name, caption, count, rows


def page(sections):
    columns = ("Clean today", CANDIDATES["COLOUR_LEVELS"][0], "Micro today",
               *(CANDIDATES[key][0] for key in ("MICRO_GUARD", "RAW_LEVELS", "BAYER_FIT")))
    headers = "<th>Exposure</th>" + "".join(f"<th scope='col'>{label}</th>" for label in columns)
    explanations = "".join(f"<li><strong>{label}:</strong> {line}</li>" for label, line in CANDIDATES.values())
    comparisons = []
    for photo, name, caption, count, rows in sections:
        images = []
        for ev, files in rows:
            label = f"{ev:+d}" if ev else "0"
            cells = "".join(f"<td><a href='{file}'><img loading='lazy' src='{file}' alt='{escape(column)} at {label} EV'></a></td>"
                            for column, file in zip(columns, files, strict=True))
            images.append(f"<tr><th scope='row'>{label} EV</th>{cells}</tr>")
        marks = f" · {count} of Steve’s marks in this crop" if count else ""
        comparisons.append(f"<section><h2>{photo} {name} — {escape(caption)}{marks}</h2>"
                           f"<div class='crop-table'><table><thead><tr>{headers}</tr></thead>"
                           f"<tbody>{''.join(images)}</tbody></table></div></section>")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grain quality review</title><style>
body {{ font: 16px/1.5 system-ui, sans-serif; margin: 2rem; color: #eee; background: #202124; }}
main {{ max-width: 1750px; margin: auto; }} h1 {{ margin-bottom: 0; }} h2 {{ font-size: 1.1rem; }}
section {{ margin-top: 2rem; }} .crop-table {{ overflow-x: auto; }}
table {{ width: 100%; min-width: 820px; border-collapse: collapse; table-layout: fixed; }}
th, td {{ padding: .25rem; text-align: center; }} th:first-child {{ width: 4.5rem; }}
td:nth-child(4), th:nth-child(4) {{ border-left: 2px solid #888; }}
img {{ display: block; width: 100%; }} a:focus-visible {{ outline: 3px solid white; }}
</style></head><body><main><h1>Grain quality review</h1>
<p>Compare each candidate with “today” in the same group. Click any crop for its original size. Nothing is enabled by default.</p>
<ul>{explanations}</ul>
<p>The Clean pair changes exposure before colour cleanup to stress the new guides; RAW and Micro run before the exposure edit, so those columns show the same sensor result viewed at each exposure.</p>
{''.join(comparisons)}</main></body></html>"""


def main():
    cv2.setNumThreads(1)
    areas, answers = marked.inputs()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sections = [row for path in PHOTOS for row in photo_rows(path, areas, answers["marks"])]
    (OUTPUT / "index.html").write_text(page(sections), encoding="utf-8")
    print(OUTPUT, sum(item.stat().st_size for item in OUTPUT.iterdir()), "bytes", flush=True)


if __name__ == "__main__":
    main()
