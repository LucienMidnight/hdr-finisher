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
from PIL import Image, ImageEnhance, ImageOps

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
        yield out


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
    (OUT / "t").mkdir(parents=True)

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
