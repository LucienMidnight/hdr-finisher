"""Generate inspectable synthetic dust repairs; no projects or app state touched.

Run from codebase: .venv/Scripts/python.exe tools/retouch_prototype.py
Optional cv2 is used only for comparison, never by the repair engine.
"""
from dataclasses import asdict
import html
import json
from pathlib import Path
import sys
from time import perf_counter

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from hdr_finisher.retouch import InpaintSettings, RepairInput
from hdr_finisher.retouch_jobs import RepairRevision, RepairWorker


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
    # Inspection-only common affine range then gamma; float arrays stay intact.
    value = np.clip((image - lo) / (hi - lo), 0, 1) ** (1 / 2.2)
    return Image.fromarray(np.round(value * 255).astype(np.uint8))


def main():
    output = Path(__file__).resolve().parents[1] / "output" / "retouch-prototype"
    output.mkdir(parents=True, exist_ok=True)
    try:
        import cv2
    except ImportError:
        cv2 = None
    settings = InpaintSettings()
    records, sections = [], []
    with RepairWorker() as worker:
        for index, (name, clean, dirty, mask) in enumerate(fixtures()):
            token = RepairRevision(name, "synthetic-v1", index)
            worker.set_current(token)
            start = perf_counter()
            future, _ = worker.submit(RepairInput(dirty, mask), settings, token=token)
            patch = worker.accept(future.result())
            elapsed = perf_counter() - start
            repaired = composite(dirty, patch)
            variants = {"clean": clean, "before": dirty, "patchmatch": repaired}
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
                                target_centres=patch.target_centres, **variants)
            lo, hi = min(0., float(clean.min())), max(1., float(clean.max()))
            errors = {}
            cards = []
            for label, image in variants.items():
                filename = f"{name}-{label}.png"
                display(image, lo, hi).resize((384, 384), Image.Resampling.NEAREST).save(output / filename)
                errors[label] = float(np.sqrt(np.mean((image[mask > 0].astype(np.float64) - clean[mask > 0])**2)))
                cards.append(f'<figure><figcaption>{html.escape(label)}</figcaption><img src="{filename}" alt="{name} {label}"></figure>')
            record = {"case": name, "seconds": elapsed, "masked_linear_rgb_rmse": errors,
                      "repaired_range": [float(repaired.min()), float(repaired.max())],
                      "untouched_exact": bool(np.array_equal(repaired[mask == 0], dirty[mask == 0])),
                      "display_range": [lo, hi]}
            records.append(record)
            sections.append(f'<section><h2>{name}</h2><div class="cards">' + "".join(cards) + '</div></section>')
    manifest = {"fixture_version": "synthetic-dust-v1", "settings": asdict(settings),
                "opencv": cv2.__version__ if cv2 is not None else "not installed; comparison skipped",
                "numpy": np.__version__, "cases": records}
    (output / "results.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    columns = ["clean", "before", "patchmatch"]
    if cv2 is not None:
        columns += ["navier-stokes", "telea-scaled-float"]
    sheet = Image.new("RGB", (110 + len(columns) * 180, len(records) * 155 + 35), "#202327")
    draw = ImageDraw.Draw(sheet)
    for col, label in enumerate(columns):
        draw.text((110 + col * 180, 8), label, fill="white")
    for row, record in enumerate(records):
        draw.text((2, 40 + row * 155), record["case"], fill="white")
        for col, label in enumerate(columns):
            with Image.open(output / f'{record["case"]}-{label}.png') as picture:
                sheet.paste(picture.resize((144, 144)), (110 + col * 180, 35 + row * 155))
    sheet.save(output / "contact-sheet.png")
    (output / "index.html").write_text('''<!doctype html><meta charset="utf-8"><title>HDRF dust prototype</title>
<style>body{font:16px system-ui;background:#202327;color:#eee;margin:24px}h1{font-size:26px}.cards{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}img{width:288px;height:288px}figcaption{padding:8px 0}section{margin:32px 0}p{max-width:950px}</style>
<h1>CPU Inpaint: synthetic dust study</h1>
<p>Left to right: clean ground truth, dusty input, PatchMatch, optional OpenCV direct-float Telea, Navier-Stokes and scaled-float Telea.
These enlarged SDR illustrations use one common range per row; highlights and negatives are preserved
in the downloadable .npz arrays. No real-photo quality claim is made. Inspect edges, gradients and repeated texture.</p>
<p>All runs use the same explicit seed and settings. <a href="results.json">Settings and diagnostic errors</a>.
Linear RGB errors are diagnostics, not perceptual pass/fail tolerances. Timing is a single observation, not a latency guarantee.</p>'''
        + "".join(sections), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print(f"Viewer: {output / 'index.html'}")


if __name__ == "__main__":
    main()
