"""Whole-image perceptual acceptance; brightness ceilings are checked separately."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .color import acescg_to_linear_bt2020
import colour
from .color_context import scene_linear_to_nits

# Proposed before measurement and recorded in PRD 11d, October 18, 2026.
DELIVERY_MEAN_LIMIT = 1.0
DELIVERY_P999_LIMIT = 3.0


@dataclass(frozen=True)
class DeliveryColourDifference:
    metric: str
    mean: float
    p999: float

    @property
    def passed(self) -> bool:
        return self.mean < DELIVERY_MEAN_LIMIT and self.p999 <= DELIVERY_P999_LIMIT


def compare_finished_pixels(
    first: np.ndarray, second: np.ndarray, lane: str, *, reference_white_nits: int = 203,
) -> DeliveryColourDifference:
    """Compare equal-size RGB renditions without peak normalization or sampling.

    SDR is finished display-linear sRGB. HDR is finished scene-linear ACEScg,
    using the supplied reference white. Convert decoded imports to that same
    reference white first; bundled HDR decoders use 203 nits. No error-based
    pixel exclusion and no per-pixel maximum are part of colour acceptance.
    """
    if lane not in {"hdr", "sdr"}:
        raise ValueError("Delivery colour comparison requires hdr or sdr.")
    a, b = np.asarray(first), np.asarray(second)
    if (a.ndim != 3 or b.ndim != 3 or a.shape[:2] != b.shape[:2]
            or min(a.shape[2], b.shape[2]) < 3 or a.size == 0):
        raise ValueError("Delivery colour comparison requires matching nonempty RGB images.")
    if not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)):
        raise ValueError("Delivery colour comparison requires finite pixels.")
    errors = np.empty(a.shape[:2], dtype=np.float64)
    # Keep colour-science's float64 intermediate arrays bounded at native size.
    for row in range(0, a.shape[0], 128):
        pair = [image[row:row + 128, :, :3] for image in (a, b)]
        if lane == "sdr":
            converted = [colour.XYZ_to_Lab(colour.RGB_to_XYZ(
                np.clip(image, 0, 1), colour.RGB_COLOURSPACES["sRGB"])) for image in pair]
            delta = colour.difference.delta_E_CIE2000(*converted)
        else:
            converted = [colour.RGB_to_ICtCp(np.maximum(scene_linear_to_nits(
                acescg_to_linear_bt2020(image), reference_white_nits), 0),
                method="ITU-R BT.2100-2 PQ") for image in pair]
            delta = colour.difference.delta_E_ITP(*converted)
        errors[row:row + 128] = delta
    return DeliveryColourDifference("Delta E 2000" if lane == "sdr" else "Delta E ITP",
        float(np.mean(errors)), float(np.percentile(errors, 99.9)))
