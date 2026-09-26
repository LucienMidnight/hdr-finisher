"""The lab's picture: the DSC06898 beach frame, box-downsampled 2x.

Clarity's radius is a fraction of the frame diagonal and the shader's sample
spacing is a fixed fraction of that radius, so the staircase has the same shape
at any resolution. Half size keeps the true-Gaussian reference quick. The frame
has smooth sky against hard dark edges, which is where clarity bands.
"""

from __future__ import annotations

import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "local-test-media" / "inputs" / "Affinity_DSC06898_DisplayP3_Linear_32f.exr"
OUT = ROOT / "output" / "clarity_lab"
CACHE = OUT / "source-half.npy"


def load() -> np.ndarray:
    if CACHE.exists():
        return np.load(CACHE)
    sys.path.insert(0, str(ROOT / "backend"))
    from hdr_finisher import loader  # noqa: PLC0415 - heavy import, lab only

    image = loader.load_image(SOURCE)[0][..., :3].astype(np.float32)
    height, width = (image.shape[0] // 2) * 2, (image.shape[1] // 2) * 2
    image = image[:height, :width]
    half = image.reshape(height // 2, 2, width // 2, 2, 3).mean(axis=(1, 3), dtype=np.float32)
    OUT.mkdir(parents=True, exist_ok=True)
    np.save(CACHE, half)
    return half
