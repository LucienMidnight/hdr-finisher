from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import tifffile


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.test_pattern import build_delivery_proof_pattern, build_hdr_test_pattern


DEFAULT_OUTPUT_DIR = ROOT / "local-test-media" / "inputs" / "generated"


def _write_float_tiff(path: Path, image: np.ndarray, purpose: str) -> dict[str, object]:
    image = np.asarray(image, dtype=np.float32)
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"Expected an HxWx3 image for {path.name}, got {image.shape}.")
    if not np.all(np.isfinite(image)) or float(image.min()) < 0.0:
        raise ValueError(f"Pattern {path.name} contains invalid scene-linear values.")
    if float(image.max()) <= 1.0:
        raise ValueError(f"Pattern {path.name} does not contain HDR headroom.")

    tifffile.imwrite(path, image, photometric="rgb")
    decoded = tifffile.imread(path)
    if decoded.dtype != np.float32 or decoded.shape != image.shape:
        raise RuntimeError(f"Generated TIFF did not round-trip correctly: {path}")

    return {
        "filename": path.name,
        "purpose": purpose,
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "dtype": str(image.dtype),
        "minimum_linear": float(image.min()),
        "maximum_linear": float(image.max()),
        "stops_above_diffuse_white": float(np.log2(float(image.max()) / 0.18)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate repeatable float32 HDR inputs for hands-on HDR Finisher validation."
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    records = [
        _write_float_tiff(
            output_dir / "synthetic-hdr-scene-float32.tiff",
            build_hdr_test_pattern(width=1920, height=1080),
            "Preview, rolloff, bloom, color, texture, and SDR tone-mapping stress image.",
        ),
        _write_float_tiff(
            output_dir / "delivery-proof-pattern-float32.tiff",
            build_delivery_proof_pattern(width=1920, height=1080),
            "Known 0-4 stop neutral patches, saturated patches, and logarithmic HDR gradient.",
        ),
    ]

    manifest = {
        "source_interpretation": "ACEScg Linear",
        "reference_white_nits": 100,
        "images": records,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"output_dir": str(output_dir), **manifest}, indent=2))


if __name__ == "__main__":
    main()
