from __future__ import annotations

import numpy as np


def build_hdr_test_pattern(width: int = 1024, height: int = 576) -> np.ndarray:
    x = np.linspace(0.0, 1.0, width, dtype=np.float32)
    y = np.linspace(0.0, 1.0, height, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)

    base = np.stack(
        [
            0.08 + (xx**1.2) * 0.9,
            0.06 + ((1.0 - xx) * 0.45) + (yy * 0.2),
            0.1 + (yy**1.5) * 0.85,
        ],
        axis=-1,
    )

    cx, cy = 0.72, 0.3
    radius = np.sqrt((xx - cx) ** 2 + ((yy - cy) * 1.2) ** 2)
    highlight = np.clip(1.0 - (radius / 0.23), 0.0, 1.0)
    bloom = np.power(highlight, 3.0) * 8.0
    core = np.power(np.clip(1.0 - (radius / 0.08), 0.0, 1.0), 8.0) * 48.0

    stripes = np.where(((np.floor(xx * 12.0) + np.floor(yy * 8.0)) % 2) == 0, 1.0, 0.6).astype(np.float32)
    hdr_patch = np.clip((xx - 0.06) / 0.25, 0.0, 1.0) * np.clip((0.94 - yy) / 0.22, 0.0, 1.0)
    hdr_patch = np.power(hdr_patch, 1.3)[..., None] * np.array([6.0, 4.0, 1.8], dtype=np.float32) * stripes[..., None]

    image = base
    image += bloom[..., None] * np.array([1.0, 0.78, 0.45], dtype=np.float32)
    image += core[..., None] * np.array([1.0, 0.98, 0.92], dtype=np.float32)
    image += hdr_patch
    return np.clip(image.astype(np.float32), 0.0, None)
