"""Candidate denoisers for the benchmark.

Each method is two steps, mirroring the app's analysis/resolve split:

    state = method.prepare(noisy)            # noise model, done once
    out = method.apply(image, state, **knobs) # the denoise itself

``apply`` is also run on the *clean* reference with the state measured from
the noisy image, which is how detail loss is scored: anything a method changes
on a clean picture is structure it would remove from a real one.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

import numpy as np

from . import noise_model
from .corpus import LUMA, ROOT

sys.path.insert(0, str(ROOT / "backend"))
from hdr_finisher import denoise_adaptive  # noqa: E402
from hdr_finisher.denoise_reference import (  # noqa: E402
    AnalysisPreset,
    ResolveControls,
    analyze_denoise,
    resolve_denoise,
)

# --------------------------------------------------------------------------
# Shared building blocks


def box_filter(values: np.ndarray, radius: int) -> np.ndarray:
    """Mean over a (2r+1)^2 window, edge-replicated, via cumulative sums."""
    if radius <= 0:
        return values
    out = values
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (radius + 1, radius)
        padded = np.pad(out, pad, mode="edge")
        cumulative = np.cumsum(padded, axis=axis, dtype=np.float64)
        width = 2 * radius + 1
        upper = [slice(None)] * out.ndim
        lower = [slice(None)] * out.ndim
        upper[axis] = slice(width, None)
        lower[axis] = slice(0, -width)
        out = ((cumulative[tuple(upper)] - cumulative[tuple(lower)]) / width).astype(np.float32)
    return out


B3 = np.array([1.0, 4.0, 6.0, 4.0, 1.0], dtype=np.float32) / 16.0


def atrous_smooth(values: np.ndarray, level: int) -> np.ndarray:
    """One B3-spline a trous step: the 5-tap kernel dilated by 2**level."""
    step = 2 ** level
    reach = 2 * step
    out = values
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (reach, reach)
        padded = np.pad(out, pad, mode="reflect" if out.shape[axis] > reach else "edge")
        size = out.shape[axis]
        acc = np.zeros_like(out)
        for tap, weight in enumerate(B3):
            start = tap * step
            index = [slice(None)] * out.ndim
            index[axis] = slice(start, start + size)
            acc += weight * padded[tuple(index)]
        out = acc
    return out


OPPONENT = np.array(
    [[1 / np.sqrt(3), 1 / np.sqrt(3), 1 / np.sqrt(3)],
     [1 / np.sqrt(2), 0.0, -1 / np.sqrt(2)],
     [1 / np.sqrt(6), -2 / np.sqrt(6), 1 / np.sqrt(6)]],
    dtype=np.float32,
)


def calibrated_block_sigma(values: np.ndarray, block: int = 16, quantile: float = 0.10) -> float:
    """Noise sigma of a band from its flattest blocks, calibrated for white noise."""
    bh, bw = values.shape[0] // block, values.shape[1] // block
    blocks = values[:bh * block, :bw * block].reshape(bh, block, bw, block)
    stds = blocks.std(axis=(1, 3)).ravel()
    return float(np.quantile(stds, quantile) * _BLOCK_CALIBRATION[(block, quantile)])


def _calibrate() -> dict:
    rng = np.random.default_rng(7)
    noise = rng.standard_normal((1024, 1024)).astype(np.float32)
    bh = bw = 1024 // 16
    stds = noise.reshape(bh, 16, bw, 16).std(axis=(1, 3)).ravel()
    return {(16, 0.10): 1.0 / float(np.quantile(stds, 0.10))}


_BLOCK_CALIBRATION = _calibrate()


def noise_map(image: np.ndarray, model: noise_model.NoiseModel) -> np.ndarray:
    """Per-pixel noise sigma from the model, read at a smoothed luminance."""
    luma = image @ LUMA
    smooth = atrous_smooth(atrous_smooth(luma, 0), 1)
    return model.sigma(smooth).astype(np.float32)


# --------------------------------------------------------------------------
# Methods


class CurrentHaar:
    """The shipping algorithm, driven exactly as the app drives it."""

    name = "current"

    def prepare(self, noisy: np.ndarray) -> float:
        return float(max(np.median(noisy @ LUMA), 1e-4))

    def apply(self, image, median, *, levels=2, relative_sigma=None, amount=0.5,
              luminance=0.5, color=0.5, detail=0.5):
        if relative_sigma is None:
            preset = AnalysisPreset(levels=levels)  # the shipping default: absolute 0.035
        else:
            sigma = relative_sigma * median
            preset = AnalysisPreset(levels=levels, luma_sigma=sigma, chroma_sigma=sigma)
        analysis = analyze_denoise(image, preset)
        controls = ResolveControls(amount=amount, luminance=luminance, color_noise=color, detail_recovery=detail)
        return resolve_denoise(image, analysis, controls)


@dataclass(frozen=True)
class NoiseState:
    model: noise_model.NoiseModel
    sigmas: np.ndarray  # [component, level], in units of the model's sigma


class AtrousWiener:
    """Undecimated B3 wavelet with local Wiener shrinkage against a per-pixel noise map.

    Equivalent in intent to a variance-stabilising transform, but done in linear
    light: every band's noise is the model's sigma at that pixel times a per-band
    factor, so no forward/inverse transform ever touches untouched pixels. At
    zero strength the output is the input exactly.
    """

    name = "atrous-wiener"
    levels = 5

    def _bands(self, image: np.ndarray):
        current = image @ OPPONENT.T
        bands = []
        for level in range(self.levels):
            smooth = atrous_smooth(current, level)
            bands.append(current - smooth)
            current = smooth
        return bands, current

    def prepare(self, noisy: np.ndarray) -> NoiseState:
        model = noise_model.estimate(noisy)
        sigma = noise_map(noisy, model)
        bands, _ = self._bands(noisy)
        sigmas = noise_model.band_sigmas([band / sigma[..., None] for band in bands])
        return NoiseState(model=model, sigmas=sigmas)

    def apply(self, image, state: NoiseState, *, strength=1.0, chroma=1.5, window=3, amount=1.0, two_stage=False):
        sigma2 = noise_map(image, state.model) ** 2
        bands, out = self._bands(image)
        pilot = [None] * len(bands)
        for level, band in enumerate(bands):
            pilot[level] = np.empty_like(band)
            for c in range(3):
                k = strength * (chroma if c else 1.0)
                noise_power = (k * state.sigmas[c, level]) ** 2 * sigma2
                energy = box_filter(band[..., c] * band[..., c], window)
                gain = np.maximum(energy - noise_power, 0.0) / np.maximum(energy, 1e-20)
                pilot[level][..., c] = band[..., c] * gain
        if two_stage:
            # Empirical Wiener against the pilot: the pilot's local energy is a
            # far better estimate of the signal than noisy energy minus noise,
            # which is what spares edges their outline.
            for level, band in enumerate(bands):
                for c in range(3):
                    k = strength * (chroma if c else 1.0)
                    noise_power = (k * state.sigmas[c, level]) ** 2 * sigma2
                    signal = box_filter(pilot[level][..., c] ** 2, window)
                    out[..., c] += band[..., c] * signal / np.maximum(signal + noise_power, 1e-20)
        else:
            for level in range(len(bands)):
                out += pilot[level]
        denoised = out @ OPPONENT
        return image - amount * (image - denoised)


class Adaptive:
    """The shipping adaptive denoise (backend/hdr_finisher/denoise_adaptive.py).

    Knobs are the benchmark's: ``strength`` scales both components, ``chroma``
    scales colour on top, mapped onto the app's live controls.
    """

    name = "adaptive"

    def prepare(self, noisy: np.ndarray):
        return denoise_adaptive.estimate_adaptive_model(noisy)

    def apply(self, image, model, *, strength=1.0, chroma=1.0, detail=0.5, amount=1.0):
        controls = denoise_adaptive.AdaptiveControls(
            amount=strength / 2.0, luminance=0.5, color_noise=chroma * 0.5, detail_recovery=detail,
        )
        denoised = denoise_adaptive.resolve_adaptive(image, model, controls)
        return image - amount * (image - denoised)


class NlmReference:
    """Non-local means on noise-normalised luma; a quality reference, not a live GPU candidate."""

    name = "nlm"

    def prepare(self, noisy: np.ndarray) -> NoiseState:
        model = noise_model.estimate(noisy)
        sigma = noise_map(noisy, model)
        opponent = noisy @ OPPONENT.T
        fine = opponent - atrous_smooth(opponent, 0)
        sigmas = np.array([[calibrated_block_sigma(fine[..., c] / sigma) / 0.8908] for c in range(3)])
        return NoiseState(model=model, sigmas=sigmas)

    def apply(self, image, state: NoiseState, *, strength=1.0, patch=2, search=5, amount=1.0):
        z = image @ OPPONENT.T
        guide = z[..., 0] / (noise_map(image, state.model) * float(state.sigmas[0, 0]))
        # Guide is in noise-sigma units, so Buades' h = 0.4 sigma becomes 0.4.
        h2 = (0.4 * strength) ** 2
        pad = search
        padded = np.pad(z, ((pad, pad), (pad, pad), (0, 0)), mode="reflect")
        padded_guide = np.pad(guide, pad, mode="reflect")
        total = np.zeros_like(z)
        weights = np.zeros(guide.shape, dtype=np.float32)
        height, width = guide.shape
        for dy in range(-search, search + 1):
            for dx in range(-search, search + 1):
                shifted = padded_guide[pad + dy:pad + dy + height, pad + dx:pad + dx + width]
                distance = box_filter((guide - shifted) ** 2, patch)
                weight = np.exp(-np.maximum(distance - 2.0, 0.0) / h2)
                total += weight[..., None] * padded[pad + dy:pad + dy + height, pad + dx:pad + dx + width]
                weights += weight
        denoised = (total / weights[..., None]) @ OPPONENT
        return image - amount * (image - denoised)
