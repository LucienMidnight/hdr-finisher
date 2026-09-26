"""Four ways to compute clarity's blurred base, all on log2 luminance.

- ``true_gaussian``: the reference, a dense Gaussian out to 4 sigma.
- ``gpu_current``: an emulation of the WebGPU preview today, 17 bilinear taps
  over +/-2 sigma, sigma/4 apart, horizontal then vertical, clamped at edges.
- ``cpu_current``: the export path today, ``detail._gaussian_blur`` (3 boxes).
- ``pyramid``: the proposal as first prototyped. Box-average down to a level
  where sigma is a few texels, blur densely there, then upsample with a cubic
  B-spline. The level's own blur (box + B-spline) is subtracted from the dense
  blur's variance, so the total spread is exactly sigma.
- ``shipped``: the version the app ships (`detail.clarity_base`): the same
  pyramid, averaged in two steps and with its kernel stopped at 3 sigma.
"""

from __future__ import annotations

import math
import sys

import numpy as np

from .source import ROOT

sys.path.insert(0, str(ROOT / "backend"))
from hdr_finisher import detail  # noqa: E402

LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
FLOOR = np.float32(1e-4)


def linear_luma(image: np.ndarray) -> np.ndarray:
    return np.maximum(image @ LUMA, FLOOR).astype(np.float32)


def clarity_sigma(shape: tuple[int, int], radius_percent: float) -> float:
    return max(0.5, math.hypot(shape[0], shape[1]) * radius_percent / 100.0)


# --- reference -------------------------------------------------------------

def _fft_axis(values: np.ndarray, kernel: np.ndarray, axis: int) -> np.ndarray:
    radius = kernel.size // 2
    padding = [(0, 0), (0, 0)]
    padding[axis] = (radius, radius)
    padded = np.pad(values.astype(np.float64), padding, mode="edge")
    length = padded.shape[axis] + kernel.size
    spectrum = np.fft.rfft(padded, n=length, axis=axis)
    shape = [1, 1]
    shape[axis] = -1
    spectrum *= np.fft.rfft(kernel, n=length).reshape(shape)
    full = np.fft.irfft(spectrum, n=length, axis=axis)
    index = [slice(None), slice(None)]
    index[axis] = slice(2 * radius, 2 * radius + values.shape[axis])
    return full[tuple(index)].astype(np.float32)


def gaussian_kernel(sigma: float, reach: float = 4.0) -> np.ndarray:
    radius = max(1, int(math.ceil(reach * sigma)))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (x / sigma) ** 2)
    return kernel / kernel.sum()


def true_gaussian(log_luma: np.ndarray, sigma: float) -> np.ndarray:
    kernel = gaussian_kernel(sigma)
    return _fft_axis(_fft_axis(log_luma, kernel, 1), kernel, 0)


# --- the preview today ------------------------------------------------------

def _bilinear_axis(values: np.ndarray, offset: float, axis: int) -> np.ndarray:
    """Sample ``values`` at every pixel centre + offset along ``axis``, clamped."""
    size = values.shape[axis]
    position = np.clip(np.arange(size, dtype=np.float64) + offset, 0.0, size - 1.0)
    low = np.floor(position).astype(np.int64)
    high = np.minimum(low + 1, size - 1)
    fraction = (position - low).astype(np.float32)
    shape = [1, 1]
    shape[axis] = -1
    fraction = fraction.reshape(shape)
    return np.take(values, low, axis=axis) * (1 - fraction) + np.take(values, high, axis=axis) * fraction


def gpu_current(linear: np.ndarray, sigma: float, half_samples: int = 8) -> np.ndarray:
    # Horizontal pass: the sampler interpolates RGB (so linear luminance)
    # before the shader takes the log.
    total = np.zeros_like(linear)
    weights = 0.0
    for index in range(-half_samples, half_samples + 1):
        distance = 2.0 * index / half_samples
        weight = math.exp(-0.5 * distance * distance)
        total += np.log2(np.maximum(_bilinear_axis(linear, distance * sigma, 1), FLOOR)) * weight
        weights += weight
    horizontal = (total / weights).astype(np.float32)
    # Vertical pass: interpolates the stored log values.
    total = np.zeros_like(linear)
    for index in range(-half_samples, half_samples + 1):
        distance = 2.0 * index / half_samples
        total += _bilinear_axis(horizontal, distance * sigma, 0) * math.exp(-0.5 * distance * distance)
    return (total / weights).astype(np.float32)


# --- the export today -------------------------------------------------------

def cpu_current(log_luma: np.ndarray, sigma: float) -> np.ndarray:
    return detail._gaussian_blur(log_luma, sigma)


# --- the proposal -----------------------------------------------------------

def pyramid_plan(sigma: float, min_texels: float = 2.0) -> tuple[int, float]:
    """(level, dense sigma at that level) for a target full-resolution sigma."""
    level = 0 if sigma < 2.0 * min_texels else int(math.floor(math.log2(sigma / min_texels)))
    scale = 2.0 ** level
    # A 2^L box contributes (1 - 4^-L)/12 texel^2, the cubic B-spline 1/3.
    inherent = 0.0 if level == 0 else (1.0 - 4.0 ** -level) / 12.0 + 1.0 / 3.0
    return level, math.sqrt(max((sigma / scale) ** 2 - inherent, 0.0))


def _dense_axis(values: np.ndarray, sigma: float, axis: int) -> np.ndarray:
    if sigma <= 1e-6:
        return values
    kernel = gaussian_kernel(sigma, 3.5).astype(np.float32)
    radius = kernel.size // 2
    padding = [(0, 0), (0, 0)]
    padding[axis] = (radius, radius)
    padded = np.pad(values, padding, mode="edge")
    size = values.shape[axis]
    result = np.zeros_like(values)
    for tap, weight in enumerate(kernel):
        index = [slice(None), slice(None)]
        index[axis] = slice(tap, tap + size)
        result += padded[tuple(index)] * weight
    return result


def _bspline_axis(coarse: np.ndarray, scale: int, size: int, axis: int) -> np.ndarray:
    position = (np.arange(size, dtype=np.float64) + 0.5) / scale - 0.5
    base = np.floor(position).astype(np.int64)
    t = (position - base).astype(np.float32)
    weights = (
        (1 - t) ** 3 / 6,
        (3 * t ** 3 - 6 * t ** 2 + 4) / 6,
        (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
        t ** 3 / 6,
    )
    shape = [1, 1]
    shape[axis] = -1
    limit = coarse.shape[axis] - 1
    result = None
    for k, weight in enumerate(weights):
        taken = np.take(coarse, np.clip(base - 1 + k, 0, limit), axis=axis) * weight.reshape(shape)
        result = taken if result is None else result + taken
    return result


def shipped(log_luma: np.ndarray, sigma: float) -> np.ndarray:
    """What the app ships: the export's clarity_base, which the preview matches."""
    return detail.clarity_base(log_luma, sigma)


def pyramid(log_luma: np.ndarray, sigma: float, min_texels: float = 2.0) -> np.ndarray:
    level, dense = pyramid_plan(sigma, min_texels)
    if level == 0:
        return _dense_axis(_dense_axis(log_luma, dense, 1), dense, 0)
    scale = 2 ** level
    height, width = log_luma.shape
    coarse_height, coarse_width = -(-height // scale), -(-width // scale)
    padded = np.pad(log_luma, ((0, coarse_height * scale - height), (0, coarse_width * scale - width)), mode="edge")
    coarse = padded.reshape(coarse_height, scale, coarse_width, scale).mean(axis=(1, 3), dtype=np.float32)
    coarse = _dense_axis(_dense_axis(coarse, dense, 1), dense, 0)
    return _bspline_axis(_bspline_axis(coarse, scale, width, 1), scale, height, 0).astype(np.float32)


# --- clarity itself -----------------------------------------------------------

def clarity(image: np.ndarray, log_luma: np.ndarray, base: np.ndarray, amount: float) -> np.ndarray:
    """The composite both paths share: band, cross-edge fence, gain on RGB."""
    band = log_luma - base
    weight = np.exp(-np.square(band / np.float32(0.75)))
    delta = np.clip(band * weight * np.float32(amount / 125.0), -16.0, 16.0)
    return image * np.exp2(delta)[..., None]
