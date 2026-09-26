"""Scores for a denoised result, measured the way the viewer sees it.

Every error is taken after the same display transform the Show noise view
uses (exposure, shoulder, 2.2 gamma), with exposure normalised so the clean
crop's median luminance lands on 18%. That keeps a shadow error and a
highlight error comparable, which a linear-light RMS does not.
"""

from __future__ import annotations

import numpy as np

from .corpus import LUMA

ZONES = (("shadows", -np.inf, -3.0), ("midtones", -3.0, 1.0), ("highlights", 1.0, np.inf))


def exposure_for(clean: np.ndarray) -> float:
    return 0.18 / float(max(np.median(clean @ LUMA), 1e-5))


def encode(image: np.ndarray, exposure: float) -> np.ndarray:
    exposed = np.maximum(image * exposure, 0.0)
    return (exposed / (1.0 + exposed)) ** (1.0 / 2.2)


def zone_masks(clean: np.ndarray, exposure: float) -> dict[str, np.ndarray]:
    ev = np.log2(np.maximum(clean @ LUMA * exposure, 1e-6) / 0.18)
    return {name: (ev >= low) & (ev < high) for name, low, high in ZONES}


def rms(values: np.ndarray, mask: np.ndarray | None = None) -> float:
    if mask is not None:
        if not mask.any():
            return float("nan")
        values = values[mask]
    return float(np.sqrt(np.mean(np.square(values))))


def lattice_score(error: np.ndarray, period: int = 4) -> float:
    """Periodic structure in the error at the Haar block period.

    The mean error over each residue class of (y mod period, x mod period).
    Noise averages out; a lattice anchored to the block grid does not. The
    result is the spread of those class means, relative to the error's RMS.
    """
    luma = error @ LUMA
    height = luma.shape[0] // period * period
    width = luma.shape[1] // period * period
    classes = luma[:height, :width].reshape(height // period, period, width // period, period).mean(axis=(0, 2))
    return float(classes.std() / max(rms(luma), 1e-9))


def score(clean: np.ndarray, noisy: np.ndarray, denoised: np.ndarray, clean_denoised: np.ndarray) -> dict:
    exposure = exposure_for(clean)
    reference = encode(clean, exposure)
    masks = zone_masks(clean, exposure)
    noisy_error = encode(noisy, exposure) - reference
    error = encode(denoised, exposure) - reference
    detail = encode(clean_denoised, exposure) - reference
    result = {
        "error": rms(error),
        "noisy_error": rms(noisy_error),
        "detail_loss": rms(detail),
        "lattice": lattice_score(error),
    }
    for zone, mask in masks.items():
        result[f"error_{zone}"] = rms(error, mask)
        result[f"noisy_{zone}"] = rms(noisy_error, mask)
    return result
