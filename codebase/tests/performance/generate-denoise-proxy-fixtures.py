from __future__ import annotations

import argparse
import gc
from pathlib import Path

import numpy as np
import tifffile


def synthetic_scene(width: int, height: int) -> np.ndarray:
    rng = np.random.default_rng(20260825)
    x = np.linspace(0.0, 1.0, width, dtype=np.float32)
    y = np.linspace(0.0, 1.0, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    image = np.stack(
        [
            0.02 + 1.8 * xx,
            0.03 + 0.9 * yy,
            0.04 + 0.7 * (1.0 - xx) + 0.25 * yy,
        ],
        axis=-1,
    ).astype(np.float32)
    image += (0.018 * rng.standard_normal(image.shape)).astype(np.float32)
    image[height // 8:height // 3, width // 7:width // 3] += np.array([6.0, 3.0, 1.0], dtype=np.float32)
    image[height // 2:height * 3 // 4, width // 2:width * 6 // 7] += np.array([0.2, 1.1, 2.4], dtype=np.float32)
    return np.maximum(image, 0.0, out=image)


def write_exr(path: Path, image: np.ndarray) -> None:
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
    try:
        output.writePixels({
            "R": image[..., 0].tobytes(),
            "G": image[..., 1].tobytes(),
            "B": image[..., 2].tobytes(),
        })
    finally:
        output.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate large deterministic TIFF/EXR inputs for denoise proxy gates.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=3072)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    image = synthetic_scene(args.width, args.height)
    tiff_path = args.output / f"denoise-{args.width}x{args.height}.tiff"
    tifffile.imwrite(tiff_path, image, photometric="rgb")
    exr_path = args.output / f"denoise-{args.width}x{args.height}.exr"
    write_exr(exr_path, image)
    del image
    gc.collect()
    print(f"Wrote {tiff_path}")
    print(f"Wrote {exr_path}")


if __name__ == "__main__":
    main()
