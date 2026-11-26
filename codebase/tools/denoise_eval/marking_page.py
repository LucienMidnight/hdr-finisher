"""Generate Steve's fixed-area Denoise baseline and local marking page."""
from dataclasses import asdict
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

import cv2
import numpy as np
import rawpy
from PIL import Image, ImageFile

from hdr_finisher import denoise_adaptive, raw_import
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.models import LensCorrectionSettings, RawImportSettings, RawPixelCleanupSettings
from tools.lib.test_photos import manifest_files, photo_root, sha256

CODEBASE = Path(__file__).resolve().parents[2]
AREAS = Path(__file__).with_name("steve-areas-2026-11-18.json")
OUTPUT = CODEBASE / "output/denoise-v1/marking"
COLUMNS = {
    "noisy": "Noisy",
    "today": "Today",
    "even_out": "Today + Even out harsh specks",
}
CONTROLS = denoise_adaptive.AdaptiveControls(
    amount=.75, color_noise=.75, detail_recovery=.5, luminance=.5,
    finest_noise=.5, fine_noise=.5, medium_noise=.5, coarse_noise=.5,
)
JPEG_QUALITY = 90
LUMA = np.array([.2126, .7152, .0722], dtype=np.float32)
MAX_BYTES = 20_000_000


def json_text(data):
    return json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def sensor_view(image, flip):
    """Undo LibRaw's orientation as a view so x/y refer to the visible CFA."""
    if flip == 3:
        return image[::-1, ::-1]
    if flip == 5:
        return np.rot90(image, -1)
    if flip == 6:
        return np.rot90(image, 1)
    if flip != 0:
        raise ValueError(f"Unexpected RAW orientation {flip}")
    return image


def develop(path, cleanup):
    settings = RawImportSettings(
        lens=LensCorrectionSettings(mode="off"),
        pixel_cleanup=RawPixelCleanupSettings(
            even_out_specks=cleanup, speck_threshold=2.5, remove_hot_pixels=False,
        ),
    )
    scene, provenance = raw_import.decode_raw(path, settings)
    development = provenance["raw_development"]
    if not development.get("signed_sensor_samples"):
        raise ValueError("Native signed Bayer AHD was unavailable")
    diagnostic = provenance["raw_pixel_cleanup"]
    if cleanup and not diagnostic.get("noise_supported"):
        raise ValueError("Even out harsh specks could not fit this photo's sensor noise")
    return scene, diagnostic


def bounds_for(area, width, height):
    x, y = area["sensor_xy"]
    size = area["size"]
    return [max(0, x), max(0, y), min(width, x + size), min(height, y + size)]


def extract(scene, area):
    left, top, right, bottom = area["visible_xyxy"]
    return scene[top:bottom, left:right]


def exposure_lift(crops, areas):
    """Set each photo's view from the median brightness of its noisy problem areas."""
    medians = [float(np.median(crops[area["id"]] @ LUMA)) for area in areas
               if area["kind"] == "speck" and area["id"] in crops]
    if not medians:
        return 0.
    reference = max(float(np.median(medians)), .08 / 2**6)
    return round(max(0., math.log2(.08 / reference)), 2)


def display_pixels(linear, ev):
    linear = linear * np.float32(2**ev)
    # Fit below-gamut colours by reducing saturation toward the same brightness.
    # Negative-luminance values reach display black. The shared shoulder rolls
    # off the brightest channel and scales all channels together, keeping hue.
    luma = np.maximum(linear @ LUMA, 0)
    low = np.minimum(linear.min(axis=-1), 0)
    saturation = np.divide(luma, luma - low, out=np.ones_like(low), where=low < 0)
    linear = np.maximum(luma[..., None] + (linear - luma[..., None]) * saturation[..., None], 0)
    peak = linear.max(axis=-1)
    above = np.maximum(peak - .55, 0)
    shoulder = .55 + .45 * above / (.45 + above)
    linear *= (shoulder / np.maximum(peak, .55))[..., None]
    srgb = np.where(linear <= .0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)
    return np.rint(srgb * 255).astype(np.uint8)


def save_jpeg(pixels, path):
    try:
        Image.fromarray(pixels).save(path, quality=JPEG_QUALITY, subsampling=0, optimize=True)
    except OSError:
        path.unlink(missing_ok=True)
        raise


def save_crops(folder, photo, crops, column):
    for area in photo["areas"]:
        if area["id"] not in crops:
            continue
        x, y = area["sensor_xy"]
        left, top, right, bottom = area["visible_xyxy"]
        size = area["size"]
        pixels = np.zeros((size, size, 3), dtype=np.uint8)
        pixels[top-y:bottom-y, left-x:right-x] = display_pixels(crops[area["id"]], photo["lift_ev"])
        file = f'{photo["file"]}-{area["id"]}-{column}.jpg'
        save_jpeg(pixels, folder / file)
        area["images"][column] = f"images/{file}"


def linear_crops(oriented, flip, areas):
    scene = sensor_view(oriented, flip)
    return {area["id"]: acescg_to_linear_srgb(extract(scene, area))
            for area in areas if "error" not in area}


def denoised_crops(scene, flip, areas):
    model = denoise_adaptive.estimate_adaptive_model(scene, workers=1)
    developed = denoise_adaptive.resolve_adaptive(scene, model, CONTROLS)
    return model.as_dict(), linear_crops(developed, flip, areas)


def render_photo(folder, path, photo):
    with rawpy.RawPy() as raw:
        # Header only. decode_raw below reads and develops the pixels.
        raw.open_file(str(path))
        sizes = raw.sizes
    flip = sizes.flip
    noisy, _ = develop(path, cleanup=False)
    height, width = sensor_view(noisy, flip).shape[:2]
    if (height, width) != (sizes.height, sizes.width):
        raise ValueError("Production development does not match the visible sensor dimensions")
    photo["sensor_wh"] = [width, height]
    photo["orientation"] = flip
    areas = photo["areas"]
    for area in areas:
        valid = area["visible_xyxy"] = bounds_for(area, width, height)
        if valid[0] >= valid[2] or valid[1] >= valid[3]:
            area["error"] = "The area is outside the visible sensor."
    crops = linear_crops(noisy, flip, areas)
    photo["lift_ev"] = exposure_lift(crops, areas)
    save_crops(folder, photo, crops, "noisy")
    del crops

    h, w = noisy.shape[:2]
    ratio = 240 / max(w, h)
    small = cv2.resize(noisy, (round(w * ratio), round(h * ratio)), interpolation=cv2.INTER_AREA)
    thumbnail = f"{path.name}-whole.jpg"
    save_jpeg(display_pixels(acescg_to_linear_srgb(sensor_view(small, flip)), photo["lift_ev"]),
              folder / thumbnail)
    photo["thumbnail"] = f"images/{thumbnail}"

    photo["noise_models"] = {}
    photo["noise_models"]["today"], crops = denoised_crops(noisy, flip, areas)
    save_crops(folder, photo, crops, "today")
    del noisy, crops

    tamed, diagnostic = develop(path, cleanup=True)
    if sensor_view(tamed, flip).shape[:2] != (height, width):
        raise ValueError("Visible sensor geometry changed between developments")
    photo["tamed_sensor_pixels"] = diagnostic["tamed"]
    photo["noise_models"]["even_out"], crops = denoised_crops(tamed, flip, areas)
    save_crops(folder, photo, crops, "even_out")


def generate(folder):
    images = folder / "images"
    images.mkdir()
    source = json.loads(AREAS.read_text(encoding="utf-8"))
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    manifest = dict(
        commit=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=CODEBASE, text=True).strip(),
        generator_sha256=sha256(__file__),
        area_set_sha256=sha256(AREAS),
        coordinates=source["coordinates"],
        raw_settings="Production CPU signed AHD, as-shot white balance, Opposed color, lens corrections off",
        noise_measurement=denoise_adaptive.MEASUREMENT_VERSION,
        denoise_controls=asdict(CONTROLS),
        columns=COLUMNS,
        pixel_cleanup={"even_out_threshold": 2.5, "remove_hot_pixels": False},
        display="Linear sRGB with one lift per photo, luminance-preserving lower-gamut mapping and a fixed highlight shoulder, then sRGB transfer",
        jpeg={"quality": JPEG_QUALITY, "chroma_subsampling": "4:4:4"},
        photos=[],
    )
    root = photo_root()
    for file, areas in source["photos"].items():
        path = root / file
        photo = dict(file=file, areas=[dict(area, images={}) for area in areas])
        manifest["photos"].append(photo)
        print(f"Rendering {file} ({len(areas)} areas)", flush=True)
        try:
            photo["sha256"] = sha256(path)
            if photo["sha256"] != identities[file]:
                raise ValueError("The source hash differs from the approved test-photo manifest")
            render_photo(images, path, photo)
        except (OSError, ValueError, RuntimeError, FloatingPointError) as exc:
            for area in photo["areas"]:
                if len(area["images"]) < len(COLUMNS):
                    area.setdefault("error", str(exc))
            print(f"  Incomplete: {exc}", flush=True)

    write_page(folder, manifest)
    return manifest


def write_page(folder, manifest):
    (folder / "manifest.json").write_text(json_text(manifest), encoding="utf-8")
    # Local file pages can load their relative images and styles, but fetch()
    # of a neighbouring JSON file is blocked by some browsers on file://.
    page_data = json_text(manifest).replace("<", "\\u003c")
    (folder / "index.html").write_text(PAGE.replace("/*PAGE_DATA*/", page_data), encoding="utf-8")


def main():
    cv2.setNumThreads(1)
    # Optimized 4:4:4 encoding of noisy crops may exceed Pillow's one-byte-
    # per-pixel estimate. Give libjpeg room for the complete encoded crop.
    ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 2 * 1024 * 1024)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="marking-", dir=OUTPUT.parent) as temporary:
        folder = Path(temporary)
        manifest = generate(folder)
        size = sum(file.stat().st_size for file in folder.rglob("*") if file.is_file())
        if size >= MAX_BYTES:
            raise ValueError(f"Review exceeds 20 MB ({size:,} bytes)")
        OUTPUT.mkdir(exist_ok=True)
        if (OUTPUT / "images").exists():
            shutil.rmtree(OUTPUT / "images")
        for item in folder.iterdir():
            item.replace(OUTPUT / item.name)
    areas = [area for photo in manifest["photos"] for area in photo["areas"]]
    complete = sum(len(area["images"]) == len(COLUMNS) for area in areas)
    print(f"{complete}/{len(areas)} areas, {size:,} bytes. {OUTPUT / 'index.html'}")


PAGE = r"""<!doctype html>
<html lang="en" data-theme="modern-dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Denoise baseline marking</title>
<link rel="stylesheet" href="../../../frontend/visual-tokens.css">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--text); background: var(--app);
    font: var(--font-weight-regular) var(--font-size-md)/var(--line-height-normal) var(--font-body); }
  header { position: sticky; top: 0; z-index: 2; background: var(--panel);
    border-bottom: 1px solid var(--border); }
  .wrap { max-width: 1780px; margin: auto; padding: 12px 18px; }
  .toolbar, .question, .controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .toolbar { gap: 10px; }
  h1, h2, h3, p, figure, fieldset { margin: 0; }
  h1 { font: var(--font-weight-semibold) var(--font-size-3xl)/var(--line-height-tight) var(--font-body); }
  h2 { font: var(--section-title-font); }
  h3, figcaption { font: var(--subsection-title-font); }
  p, small, .meta, #status { color: var(--muted); }
  small, .meta, #status { font-size: var(--font-size-sm); }
  .meta { font-family: var(--font-mono); }
  button, select { font: inherit; color: var(--text); background: var(--raised);
    border: 1px solid var(--border); border-radius: var(--radius-plate); padding: 3px 8px; }
  button { cursor: pointer; }
  button:hover { border-color: var(--muted); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-bed); }
  #export { border-color: var(--accent); }
  .group { scroll-margin-top: var(--header-height); }
  .group > h2 { margin: 18px 0 8px; }
  .area { display: grid; grid-template-columns: 166px repeat(3, minmax(0, 1fr));
    gap: 12px; padding: 12px 0 16px; border-top: 1px solid var(--border); }
  .area aside { display: grid; align-content: start; gap: 8px; }
  .question { margin-top: 3px; }
  fieldset { border: 0; padding: 0; min-width: 0; }
  legend { padding: 0; color: var(--body); }
  .thumbnail { position: relative; width: 100%; }
  .thumbnail img { display: block; width: 100%; }
  .outline { position: absolute; border: 1px solid var(--attention);
    outline: 1px solid var(--viewer); }
  .comparison { display: grid; grid-template-rows: auto 1fr; gap: 5px; }
  .view { width: 100%; max-width: 512px; height: 524px; overflow: scroll;
    background: var(--viewer); overscroll-behavior: contain; }
  .frame { position: relative; }
  .crop-image { display: block; width: 100%; height: 100%; image-rendering: pixelated;
    cursor: crosshair; user-select: none; }
  .panning .crop-image { cursor: grabbing; }
  .marked-points, .unavailable-pixels { position: absolute; inset: 0; pointer-events: none; }
  .unavailable-pixels > span { position: absolute; background: var(--quiet); }
  .point { position: absolute; transform: translate(-50%, -50%); pointer-events: auto;
    width: var(--bypass-icon-size); height: var(--bypass-icon-size); padding: 0;
    background: transparent; border: 2px solid var(--attention);
    outline: 1px solid var(--viewer); border-radius: var(--radius-pill); }
  .point[data-kind="detail_damaged"] { border-color: var(--accent-preset-coating-blue); border-radius: var(--radius-1); }
  .point:hover, .point:focus-visible { border-color: var(--text); }
  .error { color: var(--error-text); }
  [hidden] { display: none !important; }
  @media (max-width: 880px) {
    .area { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .area aside { grid-column: 1 / -1; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); align-items: start; }
    .thumbnail { max-width: 160px; }
    .view { height: min(524px, 60vh); }
  }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Denoise baseline marking</h1>
    <div class="toolbar">
      <label>Jump to <select id="photo-select"><option value="">Choose a photo</option></select></label>
      <label>Click to mark <select id="mark-kind">
        <option value="distracting_spot">Distracting spot</option>
        <option value="detail_damaged">Detail lost/damaged</option>
      </select></label>
      <button type="button" id="export">Export marks</button>
      <button type="button" id="import">Import marks</button>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
      <span id="status" role="status"></span>
    </div>
    <p>Click any picture to mark it. Click a mark to remove it. Drag or scroll a picture to move all three together.</p>
  </div>
</header>
<main class="wrap" id="photos"></main>
<template id="area-template">
  <article class="area">
    <aside>
      <h3></h3>
      <small class="description"></small>
      <small class="meta"></small>
      <div class="thumbnail" hidden><img alt="Whole photo in sensor orientation" loading="lazy"><span class="outline"></span></div>
      <label class="controls">Zoom <select class="zoom">
        <option value="1">1×</option><option value="2">2×</option><option value="3">3×</option>
        <option value="4">4×</option><option value="6">6×</option>
      </select></label>
      <small class="error" hidden></small>
      <fieldset data-question="worst_problem"><legend>Worst problem here</legend><div class="question"></div></fieldset>
      <fieldset data-question="today_vs_even_out"><legend>Today vs Even out</legend><div class="question"></div></fieldset>
    </aside>
  </article>
</template>
<template id="comparison-template">
  <figure class="comparison">
    <figcaption></figcaption>
    <div class="view" tabindex="0">
      <div class="frame">
        <img class="crop-image" loading="lazy" draggable="false" alt="">
        <div class="unavailable-pixels" aria-hidden="true"></div>
        <div class="marked-points"></div>
      </div>
    </div>
    <small class="error" hidden>Picture unavailable</small>
  </figure>
</template>
<script>
"use strict";
const baseline = /*PAGE_DATA*/;
const options = {
  worst_problem: [["colour_specks", "Colour specks"], ["dark_pits", "Dark pits"],
                  ["blotchy_colour", "Blotchy colour"], ["fine_grain_ok", "Fine grain OK"]],
  today_vs_even_out: [["better", "Better"], ["same", "Same"], ["worse", "Worse"]]
};
const typeLabels = {distracting_spot: "Distracting spot", detail_damaged: "Detail lost/damaged"};
const areaKey = (file, id) => JSON.stringify([file, id]);
const areaMap = new Map(baseline.photos.flatMap(photo => photo.areas.map(
  area => [areaKey(photo.file, area.id), area])));
const storageKey = "hdr-finisher.denoise-marking." + baseline.area_set_sha256;
const get = id => document.getElementById(id);
const status = get("status");
const empty = () => ({version: 1, area_set_sha256: baseline.area_set_sha256, marks: [], answers: []});
let state = empty();
let storageAvailable = true;
let initialMessage = "";
const refreshers = [];

function validPoint(area, x, y) {
  if (!area?.visible_xyxy || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const [left, top, right, bottom] = area.visible_xyxy;
  return x >= left && x < right && y >= top && y < bottom;
}

function markKey(mark) {
  return JSON.stringify([mark.file, mark.area_id, mark.column, mark.type, mark.sensor_x, mark.sensor_y]);
}

function validate(data) {
  if (data?.version !== 1 || data.area_set_sha256 !== baseline.area_set_sha256 ||
      !Array.isArray(data.marks) || !Array.isArray(data.answers)) {
    throw new Error("Choose a marks file exported from this set of review areas.");
  }
  const clean = empty();
  for (const mark of data.marks) {
    const {file, area_id, column, type, sensor_x, sensor_y} = mark;
    const area = areaMap.get(areaKey(file, area_id));
    if (!Object.hasOwn(baseline.columns, column) || !area?.images[column] ||
        !Object.hasOwn(typeLabels, type) || !validPoint(area, sensor_x, sensor_y)) {
      throw new Error("The file has a mark outside its area or on an unavailable picture.");
    }
    clean.marks.push({file, area_id, column, type, sensor_x, sensor_y});
  }
  for (const record of data.answers) {
    const {file, area_id} = record;
    if (!areaMap.has(areaKey(file, area_id))) throw new Error("The file names an unknown area.");
    const answer = {file, area_id};
    for (const [question, choices] of Object.entries(options)) {
      const value = record[question];
      if (value === undefined) continue;
      if (!choices.some(([choice]) => choice === value)) throw new Error("The file has an unknown answer.");
      answer[question] = value;
    }
    if (Object.keys(answer).length > 2) clean.answers.push(answer);
  }
  return clean;
}

function merge(data) {
  state.marks = [...new Map([...state.marks, ...data.marks].map(mark => [markKey(mark), mark])).values()];
  const records = new Map();
  for (const answer of [...state.answers, ...data.answers]) {
    const key = areaKey(answer.file, answer.area_id);
    records.set(key, {...records.get(key), ...answer});
  }
  state.answers = [...records.values()];
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try { merge(validate(JSON.parse(saved))); }
    catch { initialMessage = "Saved marks could not be read."; }
  }
} catch { storageAvailable = false; }

function showStatus(message = "") {
  const count = `${state.marks.length} marks · ${state.answers.length} areas answered`;
  status.textContent = [message, count, storageAvailable ? "" : "Browser storage unavailable. Export to save."]
    .filter(Boolean).join(" · ");
}

function save(message) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    storageAvailable = true;
  } catch { storageAvailable = false; }
  showStatus(message);
}

get("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2) + "\n"], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "steve-marks.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus("Exported steve-marks.json.");
});

get("import").addEventListener("click", () => get("import-file").click());
get("import-file").addEventListener("change", async event => {
  const input = event.target;
  if (!input.files.length) return;
  try {
    merge(validate(JSON.parse(await input.files[0].text())));
    refreshers.forEach(update => update());
    save("Imported marks. Existing points were kept.");
  } catch (error) {
    showStatus("Import failed. " + error.message);
  } finally {
    input.value = "";
  }
});

function placeBox(node, x, y, w, h, totalWidth, totalHeight) {
  node.style.left = 100 * x / totalWidth + "%";
  node.style.top = 100 * y / totalHeight + "%";
  node.style.width = 100 * w / totalWidth + "%";
  node.style.height = 100 * h / totalHeight + "%";
}

function markPoints(overlay, file, id, column, area) {
  const [x, y] = area.sensor_xy;
  const points = state.marks.filter(mark => mark.file === file && mark.area_id === id && mark.column === column);
  overlay.replaceChildren(...points.map(mark => {
    const point = document.createElement("button");
    point.type = "button";
    point.className = "point";
    point.dataset.kind = mark.type;
    point.style.left = 100 * (mark.sensor_x - x + .5) / area.size + "%";
    point.style.top = 100 * (mark.sensor_y - y + .5) / area.size + "%";
    point.title = `Remove ${typeLabels[mark.type].toLowerCase()} at (${mark.sensor_x}, ${mark.sensor_y})`;
    point.setAttribute("aria-label", point.title);
    point.addEventListener("click", () => {
      state.marks = state.marks.filter(other => other !== mark);
      markPoints(overlay, file, id, column, area);
      save();
    });
    return point;
  }));
}

function buildArea(photo, area) {
  const row = get("area-template").content.firstElementChild.cloneNode(true);
  const [x, y] = area.sensor_xy;
  const size = area.size;
  row.querySelector("h3").textContent = area.id + " · " + (area.kind === "speck" ? "Noise" : "Detail");
  row.querySelector(".description").textContent = area.what;
  row.querySelector(".meta").textContent = `(${x}, ${y}) · ${size} × ${size}`;
  const error = row.querySelector(".error");
  if (area.error) {
    error.textContent = area.error;
    error.hidden = false;
  }
  const views = [];
  const frames = [];
  const alignedScroll = new WeakMap();
  function moveView(view, left, top) {
    view.scrollTo(left, top);
    alignedScroll.set(view, [view.scrollLeft, view.scrollTop]);
  }
  const [left, top, right, bottom] = area.visible_xyxy ?? [x, y, x, y];
  const thumbnail = row.querySelector(".thumbnail");
  if (photo.thumbnail) {
    thumbnail.hidden = false;
    thumbnail.querySelector("img").src = photo.thumbnail;
    const [w, h] = photo.sensor_wh;
    placeBox(thumbnail.querySelector(".outline"), left, top, right-left, bottom-top, w, h);
  }

  const gapLeft = left-x, gapRight = x+size-right, gapTop = top-y, gapBottom = y+size-bottom;
  if (!area.error && (gapLeft || gapRight || gapTop || gapBottom)) {
    error.textContent = "Grey strip lies outside the visible sensor.";
    error.hidden = false;
  }

  for (const [column, title] of Object.entries(baseline.columns)) {
    const figure = get("comparison-template").content.firstElementChild.cloneNode(true);
    figure.querySelector("figcaption").textContent = title;
    row.append(figure);
    const view = figure.querySelector(".view");
    if (!area.images[column]) {
      view.hidden = true;
      figure.querySelector(".error").hidden = false;
      continue;
    }
    view.setAttribute("aria-label", `${title}, ${photo.file} ${area.id}`);
    const frame = figure.querySelector(".frame");
    const img = figure.querySelector("img");
    img.src = area.images[column];
    const overlay = figure.querySelector(".marked-points");
    const unavailable = figure.querySelector(".unavailable-pixels");
    for (const [gx, gy, w, h] of [[0, 0, gapLeft, size], [size-gapRight, 0, gapRight, size],
                                    [0, 0, size, gapTop], [0, size-gapBottom, size, gapBottom]]) {
      if (!(w && h)) continue;
      const strip = document.createElement("span");
      placeBox(strip, gx, gy, w, h, size, size);
      unavailable.append(strip);
    }
    views.push(view);
    frames.push(frame);
    frame.style.width = frame.style.height = size + "px";
    const refresh = () => markPoints(overlay, photo.file, area.id, column, area);
    refreshers.push(refresh);
    refresh();

    let drag = null;
    let moved = false;
    img.addEventListener("pointerdown", event => {
      moved = false;
      if (event.button !== 0 || event.pointerType === "touch") return;
      drag = {x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop};
    });
    img.addEventListener("pointermove", event => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      img.setPointerCapture(event.pointerId);
      view.classList.add("panning");
      view.scrollTo(drag.left - dx, drag.top - dy);
    });
    function endDrag() { drag = null; view.classList.remove("panning"); }
    img.addEventListener("pointerup", endDrag);
    img.addEventListener("pointercancel", endDrag);
    img.addEventListener("pointerleave", () => { if (!moved) endDrag(); });
    img.addEventListener("click", event => {
      if (moved) return;
      const rect = img.getBoundingClientRect();
      const sensor_x = x + Math.floor(size * (event.clientX - rect.left) / rect.width);
      const sensor_y = y + Math.floor(size * (event.clientY - rect.top) / rect.height);
      if (!validPoint(area, sensor_x, sensor_y)) return;
      const type = get("mark-kind").value;
      const mark = {file: photo.file, area_id: area.id, column, type, sensor_x, sensor_y};
      if (state.marks.some(other => markKey(other) === markKey(mark))) return;
      state.marks.push(mark);
      refresh();
      save();
    });

    view.addEventListener("scroll", () => {
      const {scrollLeft, scrollTop} = view;
      const last = alignedScroll.get(view);
      // Ignore the notifications we caused while bringing a view into line.
      if (last?.[0] === scrollLeft && last?.[1] === scrollTop) return;
      alignedScroll.set(view, [scrollLeft, scrollTop]);
      for (const other of views) {
        if (other !== view) moveView(other, scrollLeft, scrollTop);
      }
    });
  }

  let zoom = 1;
  const zoomPicker = row.querySelector(".zoom");
  zoomPicker.disabled = !views.length;
  zoomPicker.addEventListener("change", () => {
    const next = Number(zoomPicker.value);
    const {scrollLeft, scrollTop, clientWidth, clientHeight} = views[0];
    const cx = (scrollLeft + Math.min(clientWidth, size * zoom) / 2) * next / zoom;
    const cy = (scrollTop + Math.min(clientHeight, size * zoom) / 2) * next / zoom;
    zoom = next;
    for (const frame of frames) frame.style.width = frame.style.height = size * zoom + "px";
    for (const view of views) moveView(view, cx - view.clientWidth / 2, cy - view.clientHeight / 2);
  });

  for (const field of row.querySelectorAll("fieldset")) {
    const question = field.dataset.question;
    const container = field.querySelector(".question");
    const answerForArea = () => state.answers.find(record => record.file === photo.file && record.area_id === area.id);
    const refresh = () => {
      const value = answerForArea()?.[question];
      for (const button of container.children) button.setAttribute("aria-pressed", value === button.value);
    };
    for (const [value, label] of options[question]) {
      const button = document.createElement("button");
      button.type = "button";
      button.value = value;
      button.textContent = label;
      if (question === "today_vs_even_out") button.title = "Even out looks " + label.toLowerCase() + " compared with Today";
      button.addEventListener("click", () => {
        let answer = answerForArea();
        if (!answer) {
          answer = {file: photo.file, area_id: area.id};
          state.answers.push(answer);
        }
        if (answer[question] === value) delete answer[question];
        else answer[question] = value;
        if (Object.keys(answer).length === 2) state.answers = state.answers.filter(other => other !== answer);
        refresh();
        save();
      });
      container.append(button);
    }
    refreshers.push(refresh);
    refresh();
  }
  return row;
}

for (const [index, photo] of baseline.photos.entries()) {
  const group = document.createElement("section");
  group.className = "group";
  group.id = "photo-" + index;
  const heading = document.createElement("h2");
  const lift = photo.lift_ev === undefined ? "lift unavailable" : `+${photo.lift_ev.toFixed(2)} EV display lift`;
  heading.textContent = photo.file + " · " + lift;
  group.append(heading, ...photo.areas.map(area => buildArea(photo, area)));
  get("photos").append(group);
  get("photo-select").add(new Option(photo.file, group.id));
}
get("photo-select").addEventListener("change", event => {
  const picker = event.target;
  if (picker.value) get(picker.value).scrollIntoView();
  picker.selectedIndex = 0;
});
const header = document.querySelector("header");
new ResizeObserver(() => document.body.style.setProperty("--header-height", header.offsetHeight + 8 + "px")).observe(header);
showStatus(initialMessage);
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
