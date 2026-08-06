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


def build_delivery_proof_pattern(width: int = 1280, height: int = 720) -> np.ndarray:
    """Synthetic neutral, chromatic, gradient, and highlight targets.

    Values use HDR Finisher's 0.18 == 100-nit convention and are deliberately
    stable so browser observations can be compared across evidence records.
    """
    image = np.full((height, width, 3), 0.018, dtype=np.float32)
    margin = max(8, width // 80)
    patch_gap = max(4, width // 160)
    top_h = height // 3
    stops = np.array([0.0, 1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    patch_w = (width - 2 * margin - 4 * patch_gap) // 5
    for index, stop in enumerate(stops):
        x0 = margin + index * (patch_w + patch_gap)
        x1 = x0 + patch_w
        value = np.float32(0.18 * (2.0 ** float(stop)))
        image[margin:top_h, x0:x1] = value

    colors = np.array(
        [[1.0, 0.08, 0.04], [0.08, 1.0, 0.05], [0.05, 0.12, 1.0], [1.0, 0.18, 0.75]],
        dtype=np.float32,
    )
    color_y0 = top_h + patch_gap
    color_y1 = (height * 2) // 3
    color_w = (width - 2 * margin - 3 * patch_gap) // 4
    for index, color in enumerate(colors):
        x0 = margin + index * (color_w + patch_gap)
        image[color_y0:color_y1, x0:x0 + color_w] = color * np.float32(1.44)

    gradient_y0 = (height * 2) // 3 + patch_gap
    gradient = np.geomspace(0.0018, 5.76, width - 2 * margin, dtype=np.float32)
    image[gradient_y0:height - margin, margin:width - margin] = gradient[None, :, None]
    return image
