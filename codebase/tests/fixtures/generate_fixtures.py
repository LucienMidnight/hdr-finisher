from __future__ import annotations

from pathlib import Path

import imageio.v3 as iio
import numpy as np
import tifffile
from PIL import Image


FIXTURES_DIR = Path(__file__).resolve().parent


def build_png_fixture() -> None:
    width, height = 24, 16
    x = np.linspace(0, 1, width, dtype=np.float32)
    y = np.linspace(0, 1, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    rgb = np.stack(
        [
            xx,
            yy * 0.7 + 0.1,
            (1.0 - xx) * 0.8,
        ],
        axis=-1,
    )
    data = np.clip(np.round(rgb * 255.0), 0.0, 255.0).astype(np.uint8)
    Image.fromarray(data).save(FIXTURES_DIR / "sdr_gradient.png", format="PNG")


def build_hdr_tiff_fixture() -> None:
    width, height = 20, 14
    x = np.linspace(0.05, 3.5, width, dtype=np.float32)
    y = np.linspace(0.2, 1.8, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    rgb = np.stack(
        [
            xx,
            yy,
            np.sqrt(xx * yy),
        ],
        axis=-1,
    ).astype(np.float32)
    tifffile.imwrite(FIXTURES_DIR / "hdr_headroom.tiff", rgb)


def build_linear_exr_fixture() -> None:
    width, height = 18, 12
    x = np.linspace(0.02, 0.9, width, dtype=np.float32)
    y = np.linspace(0.05, 0.7, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    rgb = np.stack(
        [
            xx,
            yy,
            np.clip((xx + yy) * 0.5, 0.0, 0.95),
        ],
        axis=-1,
    ).astype(np.float32)
    _write_exr(FIXTURES_DIR / "linear_unconfirmed.exr", rgb)


def _write_exr(path: Path, image: np.ndarray) -> None:
    import Imath
    import OpenEXR

    height, width, _ = image.shape
    header = OpenEXR.Header(width, height)
    header["channels"] = {
        "R": Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
        "G": Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
        "B": Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)),
    }
    output = OpenEXR.OutputFile(str(path), header)
    output.writePixels(
        {
            "R": image[..., 0].astype(np.float32).tobytes(),
            "G": image[..., 1].astype(np.float32).tobytes(),
            "B": image[..., 2].astype(np.float32).tobytes(),
        }
    )
    output.close()


def validate_fixture_reads() -> None:
    iio.imread(FIXTURES_DIR / "sdr_gradient.png")
    tifffile.imread(FIXTURES_DIR / "hdr_headroom.tiff")
    assert (FIXTURES_DIR / "linear_unconfirmed.exr").exists()


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    stale_pfm = FIXTURES_DIR / "linear_unconfirmed.pfm"
    if stale_pfm.exists():
        stale_pfm.unlink()
    build_png_fixture()
    build_hdr_tiff_fixture()
    stale_hdr = FIXTURES_DIR / "linear_unconfirmed.hdr"
    if stale_hdr.exists():
        stale_hdr.unlink()
    build_linear_exr_fixture()
    validate_fixture_reads()
    print("Wrote fixtures:")
    for path in sorted(FIXTURES_DIR.glob("*")):
        if path.is_file():
            print(path.name)


if __name__ == "__main__":
    main()
