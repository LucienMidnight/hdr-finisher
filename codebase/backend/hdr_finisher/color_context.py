from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


AUTHORING_ANCHOR = 0.18
DEFAULT_HDR_REFERENCE_WHITE_NITS = 203
SUPPORTED_HDR_REFERENCE_WHITES = (100, 203)
CHROMIUM_CANVAS_REFERENCE_WHITE_NITS = 203.0


def validate_reference_white(value: object) -> int:
    """Validate the closed project preset set without bool/int coercion."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("HDR reference white must be the 100- or 203-nit preset.")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric not in SUPPORTED_HDR_REFERENCE_WHITES:
        raise ValueError("HDR reference white must be the 100- or 203-nit preset.")
    return int(numeric)


def scene_linear_to_nits(value: np.ndarray | float, reference_white_nits: int | float) -> np.ndarray | float:
    return np.asarray(value) / np.float32(AUTHORING_ANCHOR) * np.float32(validate_reference_white(reference_white_nits))


def nits_to_scene_linear(value: np.ndarray | float, reference_white_nits: int | float) -> np.ndarray | float:
    return np.asarray(value) / np.float32(validate_reference_white(reference_white_nits)) * np.float32(AUTHORING_ANCHOR)


def scene_linear_to_canvas(
    value: np.ndarray | float,
    reference_white_nits: int | float,
    canvas_reference_white_nits: float = CHROMIUM_CANVAS_REFERENCE_WHITE_NITS,
) -> np.ndarray | float:
    if not math.isfinite(canvas_reference_white_nits) or canvas_reference_white_nits <= 0:
        raise ValueError("Canvas reference white must be finite and positive.")
    return (
        np.asarray(value)
        / np.float32(AUTHORING_ANCHOR)
        * (np.float32(validate_reference_white(reference_white_nits)) / np.float32(canvas_reference_white_nits))
    )


@dataclass(frozen=True, slots=True)
class RenderColorContext:
    hdr_reference_white_nits: int = DEFAULT_HDR_REFERENCE_WHITE_NITS
    canvas_reference_white_nits: float = CHROMIUM_CANVAS_REFERENCE_WHITE_NITS

    def __post_init__(self) -> None:
        object.__setattr__(self, "hdr_reference_white_nits", validate_reference_white(self.hdr_reference_white_nits))
        if not math.isfinite(self.canvas_reference_white_nits) or self.canvas_reference_white_nits <= 0:
            raise ValueError("Canvas reference white must be finite and positive.")

    @property
    def cache_key(self) -> tuple[int, float]:
        return self.hdr_reference_white_nits, float(self.canvas_reference_white_nits)
