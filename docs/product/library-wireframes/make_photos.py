"""Prepare photos for the library mock-up.

Reads photos from the folders or files given, and writes small copies into
`photos/` beside this script, plus `photos/photos.js` listing them. Nothing is
written anywhere else, and the originals are only read.

    python make_photos.py <folder-or-file> [...]            real shoot, as is
    python make_photos.py --bursts 6 <folder-or-file> [...] few photos: fake
                                                            a shoot by making
                                                            near-duplicates

`photos/` is ignored by git, so personal photos are never committed.
"""

import argparse
import json
import random
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
OUT = HERE / "photos"
RAW = {".arw", ".dng", ".cr2", ".cr3", ".nef", ".raf", ".rw2", ".orf"}
PLAIN = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif"}
LARGE, SMALL = 1600, 480


def load(path):
    ext = path.suffix.lower()
    if ext in RAW:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(half_size=True, use_camera_wb=True, no_auto_bright=False)
        return Image.fromarray(rgb)
    if ext in {".heic", ".heif"}:
        import pillow_heif

        pillow_heif.register_heif_opener()
    if ext in {".tif", ".tiff"}:
        import tifffile

        data = tifffile.imread(str(path))
        if data.ndim == 3 and data.shape[0] in (3, 4) and data.shape[2] > 4:
            data = np.moveaxis(data, 0, -1)
        data = data[..., :3]
        if data.dtype == np.uint16:
            data = (data / 257).astype(np.uint8)
        elif data.dtype != np.uint8:
            data = (np.clip(data, 0, 1) * 255).astype(np.uint8)
        return Image.fromarray(data)
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def kind(path):
    ext = path.suffix.lower()
    if ext in RAW:
        return "RAW"
    return {".jpeg": "JPG", ".tiff": "TIF", ".heif": "HEIC"}.get(ext, ext[1:].upper())


def variants(img, count, rng):
    """Near-duplicates of one photo, the way a burst looks in a real shoot."""
    yield img
    w, h = img.size
    for i in range(count - 1):
        portrait = i == 2 and w > h
        cw = int(h * 0.72) if portrait else int(w * rng.uniform(0.80, 0.95))
        ch = int(h * 0.98) if portrait else int(cw * h / w)
        x = rng.randint(0, w - cw)
        y = rng.randint(0, h - ch)
        out = img.crop((x, y, x + cw, y + ch))
        out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.82, 1.15))
        if i in (0, 3):  # a couple of frames per burst miss focus, as in a real run
            out = out.filter(ImageFilter.GaussianBlur(out.width / 500))
        yield out


def focus_map(large, size):
    """Where the fine detail is. Stands in for the map made from the quick decode."""
    g = np.asarray(large.convert("L"), dtype=np.float32)
    lap = np.abs(4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:])
    f = max(1, large.width // size[0])
    h, w = (lap.shape[0] // f) * f, (lap.shape[1] // f) * f
    pooled = lap[:h, :w].reshape(h // f, f, w // f, f).max(axis=(1, 3))
    level = max(34.0, float(np.percentile(pooled, 90)))
    alpha = np.clip((pooled - level) / level, 0, 1) * 235
    rgba = np.zeros(pooled.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = 255  # the app tints it; the map only says where
    rgba[..., 3] = alpha.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").resize(size, Image.NEAREST)


def exposure_maps(small):
    """Blown highlights and blocked shadows, as two maps so each has its own colour."""
    rgb = np.asarray(small.convert("RGB"))
    maps = []
    for hit, strength in ((rgb.min(axis=2) >= 249, 225), (rgb.max(axis=2) <= 2, 215)):
        rgba = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
        rgba[hit] = (255, 255, 255, strength)
        maps.append(Image.fromarray(rgba, "RGBA"))
    return maps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+")
    parser.add_argument("--bursts", type=int, default=1)
    parser.add_argument("--limit", type=int, default=240)
    args = parser.parse_args()

    files = []
    for source in map(Path, args.sources):
        found = sorted(source.iterdir()) if source.is_dir() else [source]
        files += [f for f in found if f.suffix.lower() in RAW | PLAIN]
    if not files:
        sys.exit("No photos found.")

    if OUT.exists():
        shutil.rmtree(OUT)
    for sub in ("t", "focus", "high", "low"):
        (OUT / sub).mkdir(parents=True)

    rng = random.Random(7)
    manifest = []
    for path in files:
        try:
            base = load(path)
        except Exception as error:  # an unreadable file is skipped, as in the PRD
            print(f"skipped {path.name}: {error}")
            continue
        for n, img in enumerate(variants(base, args.bursts, rng)):
            if len(manifest) >= args.limit:
                break
            index = len(manifest)
            large = img.copy()
            large.thumbnail((LARGE, LARGE), Image.LANCZOS)
            large.save(OUT / f"{index:03d}.jpg", quality=82)
            small = img.copy()
            small.thumbnail((SMALL, SMALL), Image.LANCZOS)
            small.save(OUT / "t" / f"{index:03d}.jpg", quality=80)
            focus_map(large, small.size).save(OUT / "focus" / f"{index:03d}.png")
            high, low = exposure_maps(small)
            high.save(OUT / "high" / f"{index:03d}.png")
            low.save(OUT / "low" / f"{index:03d}.png")
            name = path.name
            if args.bursts > 1:
                stem = "".join(c for c in path.stem if not c.isdigit())[:4].upper() or "IMG"
                name = f"{stem.rstrip('_-')}_{4100 + index:05d}{path.suffix}"
            manifest.append(
                {"id": index, "name": name, "w": img.width, "h": img.height, "kind": kind(path), "burst": len(manifest) - n}
            )
        print(f"{path.name}: ok")

    (OUT / "photos.js").write_text("window.MOCK_PHOTOS = " + json.dumps(manifest, indent=1) + ";\n", encoding="utf-8")
    print(f"{len(manifest)} photos written to {OUT}")


if __name__ == "__main__":
    main()
