"""Generate inspectable controlled dust repairs; no projects or app state touched.

Run from codebase: .venv/Scripts/python.exe tools/retouch_prototype.py
Optional cv2 is used only for comparison, never by the repair engine.
"""
from dataclasses import asdict
import argparse
import hashlib
import html
import io
import json
from pathlib import Path
import sys
from time import perf_counter

import numpy as np
from PIL import Image, ImageCms, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from hdr_finisher.retouch import InpaintSettings, RepairInput
from hdr_finisher.retouch_jobs import RepairRevision, RepairWorker
from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg


def fixtures():
    y, x = np.mgrid[:96, :96].astype(np.float32)
    gradient = np.stack((0.12 + x * .001, .24 + y * .001, .48 + x * .0015), -1)
    texture = .04 * np.sin(x * .8) * np.cos(y * .65) + .02 * np.sin((x + y) * 1.7)
    rng = np.random.Generator(np.random.PCG64(17))
    ground = rng.normal(0, .025, (96, 96)).astype(np.float32)
    ground += .015 * np.sin(x * .31 + np.sin(y * .41))
    cases = {
        "sky": np.broadcast_to(np.array([.16, .32, .65], np.float32), (96, 96, 3)).copy(),
        "gradient": gradient,
        "texture": gradient + texture[..., None],
        "stochastic-texture": gradient + ground[..., None],
        "edge": gradient + (x > 48)[..., None] * np.array([.5, .3, .1], np.float32),
        "hdr-highlight": gradient * 18 + np.exp(-((x - 50)**2 + (y - 46)**2) / 450)[..., None] * 6,
        "negative-gradient": gradient - np.array([.4, .1, .05], np.float32),
        "border": gradient.copy(),
    }
    for name, clean in cases.items():
        cx, cy = (2, 48) if name == "border" else (48, 48)
        distance = np.hypot(x - cx, y - cy)
        mask = (distance <= 7).astype(np.float32)
        # Dark soft dust inside a larger exclusion mask: no dirty feather ring.
        dust = .55 * np.exp(-distance**2 / 12) * (distance <= 6)
        dirty = clean * (1 - dust[..., None])
        yield name, clean.astype(np.float32), dirty.astype(np.float32), mask


def composite(dirty, patch):
    output = dirty.copy()
    x, y = patch.origin
    h, w = patch.pixels.shape[:2]
    output[y:y + h, x:x + w] = patch.pixels
    return output


def display(image, lo, hi):
    # Inspection-only common linear-sRGB range then encoding; floats stay intact.
    value = np.clip((acescg_to_linear_srgb(image) - lo) / (hi - lo), 0, 1)
    value = np.where(value <= .0031308, 12.92 * value, 1.055 * value ** (1 / 2.4) - .055)
    return Image.fromarray(np.round(value * 255).astype(np.uint8))


def detail_rms(image, mask):
    """Diagnostic 3x3 high-pass energy, not a perceptual quality threshold."""
    value = image.astype(np.float64)
    p = np.pad(value, ((1, 1), (1, 1), (0, 0)), mode="edge")
    smooth = sum(p[y:y + value.shape[0], x:x + value.shape[1]]
                 for y in range(3) for x in range(3)) / 9
    return float(np.sqrt(np.mean((value - smooth)[mask > 0]**2)))


def photo_fixtures(path, crops):
    """Native-resolution real backgrounds with controlled injected dust.

    No project loading, RAW development, auto-saving, resizing or source writes.
    Honour an embedded ICC profile before converting linear sRGB to ACEScg.
    """
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        raise ValueError("Photo study accepts JPEG/PNG only; do not quantise HDR TIFF/RAW through Pillow")
    with Image.open(path) as photograph:
        profile = photograph.info.get("icc_profile")
        for label, x, y in crops:
            if x < 48 or y < 48 or x + 48 > photograph.width or y + 48 > photograph.height:
                raise ValueError("Photo crop must fit its full 96px native source region")
            crop = photograph.crop((x - 48, y - 48, x + 48, y + 48)).convert("RGB")
            if profile:
                crop = ImageCms.profileToProfile(crop, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                                                ImageCms.createProfile("sRGB"), outputMode="RGB")
            encoded = np.asarray(crop).astype(np.float32) / 255
            linear = np.where(encoded <= .04045, encoded / 12.92, ((encoded + .055) / 1.055) ** 2.4)
            clean = linear_srgb_to_acescg(linear).astype(np.float32)
            yy, xx = np.mgrid[:96, :96]
            distance = np.hypot(xx - 48, yy - 48)
            mask = (distance <= 7).astype(np.float32)
            dust = .55 * np.exp(-distance**2 / 12) * (distance <= 6)
            yield f"photo-{label}", clean, (clean * (1 - dust[..., None])).astype(np.float32), mask


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, help="Optional prior output directory with .npz results")
    parser.add_argument("--photo", type=Path, help="Read-only JPEG/PNG real-background source")
    parser.add_argument("--crop", action="append", default=[], metavar="LABEL:X:Y",
                        help="Native crop centre in the photo; repeat for sky/texture/edges")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "output" / "retouch-prototype")
    args = parser.parse_args()
    if bool(args.photo) != bool(args.crop):
        parser.error("--photo and at least one --crop must be supplied together")
    crops = []
    for text in args.crop:
        label, x, y = text.split(":")
        if not label or not all(c.isalnum() or c == "-" for c in label):
            parser.error("Use alphanumeric crop labels")
        crops.append((label, int(x), int(y)))
    if len({label for label, _, _ in crops}) != len(crops):
        parser.error("Crop labels must be unique")
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    try:
        import cv2
    except ImportError:
        cv2 = None
    settings = InpaintSettings()
    records, sections = [], []
    cases = list(fixtures())
    photo = None
    if args.photo:
        cases.extend(photo_fixtures(args.photo, crops))
        photo = {"path": str(args.photo.resolve()), "sha256": hashlib.sha256(args.photo.read_bytes()).hexdigest(),
                 "crops": crops, "dust": "synthetically injected; no claim these are naturally dusty pixels",
                 "untagged_color": "assume sRGB when no ICC profile is present"}
    with RepairWorker() as worker:
        for index, (name, clean, dirty, mask) in enumerate(cases):
            token = RepairRevision(name, "synthetic-v1", index)
            worker.set_current(token)
            start = perf_counter()
            future, _ = worker.submit(RepairInput(dirty, mask), settings, token=token)
            patch = worker.accept(future.result())
            elapsed = perf_counter() - start
            repaired = composite(dirty, patch)
            variants = {"clean": clean, "before": dirty, "patchmatch": repaired}
            baseline = args.baseline / f"{name}.npz" if args.baseline else None
            if baseline and baseline.is_file():
                with np.load(baseline) as previous:
                    if not (np.array_equal(previous["clean"], clean) and np.array_equal(previous["mask"], mask)
                            and np.array_equal(previous["before"], dirty)):
                        raise ValueError(f"Prior fixture differs: {name}")
                    variants["previous-patchmatch"] = previous["patchmatch"]
            if cv2 is not None:
                for label, method in (("telea-direct-float", cv2.INPAINT_TELEA), ("navier-stokes", cv2.INPAINT_NS)):
                    variants[label] = np.stack([
                        cv2.inpaint(np.ascontiguousarray(dirty[..., c]), (mask * 255).astype(np.uint8), 3, method)
                        for c in range(3)], axis=-1)
                # Telea's float implementation has scale-dependent constants.
                # Map the known ROI range to 0..255 but KEEP float32 channels;
                # reverse the affine transform, preserving HDR and negatives.
                known = dirty[mask == 0]
                offset = float(known.min())
                span = max(float(np.ptp(known)), 1e-6)
                scaled = ((dirty - offset) * (255 / span)).astype(np.float32)
                baseline = np.stack([cv2.inpaint(np.ascontiguousarray(scaled[..., c]),
                    (mask * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA) for c in range(3)], axis=-1)
                adapted = dirty.copy()
                adapted[mask > 0] = baseline[mask > 0] * (span / 255) + offset
                variants["telea-scaled-float"] = adapted
            np.savez_compressed(output / f"{name}.npz", mask=mask, source_centres=patch.source_centres,
                                target_centres=patch.target_centres,
                                texture_offset=np.asarray(patch.texture_offset or (), dtype=np.int32), **variants)
            clean_srgb = acescg_to_linear_srgb(clean)
            lo, hi = min(0., float(clean_srgb.min())), max(1., float(clean_srgb.max()))
            errors, details = {}, {}
            cards = []
            for label, image in variants.items():
                filename = f"{name}-{label}.png"
                display(image, lo, hi).resize((384, 384), Image.Resampling.NEAREST).save(output / filename)
                errors[label] = float(np.sqrt(np.mean((image[mask > 0].astype(np.float64) - clean[mask > 0])**2)))
                details[label] = detail_rms(image, mask)
                cards.append(f'<figure><figcaption>{html.escape(label)}</figcaption><img src="{filename}" alt="{name} {label}"></figure>')
            record = {"case": name, "seconds": elapsed, "masked_linear_rgb_rmse": errors,
                      "repaired_range": [float(repaired.min()), float(repaired.max())],
                      "untouched_exact": bool(np.array_equal(repaired[mask == 0], dirty[mask == 0])),
                      "tone_aligned": patch.tone_aligned,
                      "texture_offset": patch.texture_offset,
                      "detail_rms": details,
                      "kind": "injected dust on a real photo" if name.startswith("photo-") else "synthetic",
                      "display_range": [lo, hi]}
            records.append(record)
            sections.append(f'<section><h2>{name}</h2><div class="cards">' + "".join(cards) + '</div></section>')
    manifest = {"fixture_version": "synthetic-dust-v1", "working_space": "ACEScg", "settings": asdict(settings),
                "photo": photo, "baseline": str(args.baseline) if args.baseline else None,
                "opencv": cv2.__version__ if cv2 is not None else "not installed; comparison skipped",
                "numpy": np.__version__, "cases": records}
    (output / "results.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    columns = ["clean", "before", "patchmatch"]
    if any("previous-patchmatch" in item["masked_linear_rgb_rmse"] for item in records):
        columns.append("previous-patchmatch")
    if cv2 is not None:
        columns += ["navier-stokes", "telea-scaled-float"]
    sheet = Image.new("RGB", (110 + len(columns) * 180, len(records) * 155 + 35), "#202327")
    draw = ImageDraw.Draw(sheet)
    for col, label in enumerate(columns):
        draw.text((110 + col * 180, 8), label, fill="white")
    for row, record in enumerate(records):
        draw.text((2, 40 + row * 155), record["case"], fill="white")
        for col, label in enumerate(columns):
            if label not in record["masked_linear_rgb_rmse"]:
                continue
            with Image.open(output / f'{record["case"]}-{label}.png') as picture:
                sheet.paste(picture.resize((144, 144)), (110 + col * 180, 35 + row * 155))
    sheet.save(output / "contact-sheet.png")
    # Close views of the texture cases keep the already successful cases in the
    # full sheet while making the small repaired region easy to judge.
    texture_rows = [r for r in records if r["texture_offset"] is not None]
    texture_columns = [c for c in ("clean", "before", "previous-patchmatch", "patchmatch") if c in columns]
    close = Image.new("RGB", (130 + len(texture_columns) * 270, 40 + len(texture_rows) * 270), "#202327")
    draw = ImageDraw.Draw(close)
    for col, label in enumerate(texture_columns):
        draw.text((130 + col * 270, 8), label, fill="white")
    for row, record in enumerate(texture_rows):
        draw.text((2, 45 + row * 270), record["case"], fill="white")
        with np.load(output / f'{record["case"]}.npz') as arrays:
            ys, xs = np.nonzero(arrays["mask"])
            y0 = max(0, min(arrays["mask"].shape[0] - 32, int((ys.min() + ys.max()) / 2) - 16))
            x0 = max(0, min(arrays["mask"].shape[1] - 32, int((xs.min() + xs.max()) / 2) - 16))
            for col, label in enumerate(texture_columns):
                if label not in arrays:
                    continue
                pic = display(arrays[label], *record["display_range"]).crop((x0, y0, x0 + 32, y0 + 32))
                close.paste(pic.resize((256, 256), Image.Resampling.NEAREST), (130 + col * 270, 40 + row * 270))
    close.save(output / "texture-comparison.png")
    (output / "index.html").write_text('''<!doctype html><meta charset="utf-8"><title>HDRF dust prototype</title>
<style>body{font:16px system-ui;background:#202327;color:#eee;margin:24px}h1{font-size:26px}.cards{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}img{width:288px;height:288px}figcaption{padding:8px 0}section{margin:32px 0}p{max-width:950px}</style>
<h1>CPU Inpaint: controlled dust study</h1>
<p>Each row contains the reference, dusty input, current PatchMatch, optional previous PatchMatch and OpenCV comparisons.
The texture update keeps one donor's detail in affected small spots and matches its boundary to the surroundings.
All dust is synthetically injected. Optional photo crops use real native-resolution backgrounds, not confirmed natural defects.
These enlarged SDR illustrations convert working ACEScg to linear sRGB, use one common affine range per row, and encode sRGB.
Float HDR highlights and negatives remain intact in the .npz arrays. This is an inspection proxy, not finished HDR output.</p>
<p>All runs use the same explicit seed and settings. <a href="results.json">Settings and diagnostic errors</a>.
Linear RGB errors and high-pass detail strength are diagnostics, not perceptual pass/fail tolerances.
Different plausible noise samples can have higher pixel error while looking more natural.
Timing is a single observation, not a latency guarantee.</p>
<p><a href="texture-comparison.png">Enlarged texture comparison</a> · <a href="contact-sheet.png">All cases</a>.
The optional previous-patchmatch column contains the baseline supplied with --baseline.</p>'''
        + "".join(sections), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(f"Viewer: {output / 'index.html'}")


if __name__ == "__main__":
    main()
