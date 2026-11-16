"""Research-only empirical Wiener reference; never imported by the application."""
from dataclasses import dataclass
import json
from pathlib import Path
import time

import numpy as np

from hdr_finisher.denoise_adaptive import (
    ACESCG_LUMINANCE, LEVELS, OPPONENT, AdaptiveControls,
    _Edges, _atrous, _box, _noise_variance, estimate_adaptive_model,
    resolve_adaptive,
)
from tools.denoise_eval.candidates.rawnind import RawNIND
from tools.denoise_eval.inputs import develop


@dataclass
class Cache:
    original: np.ndarray
    bands: np.ndarray
    gains: np.ndarray
    pilot_chroma: np.ndarray
    timing: dict


def decompose(image, edges):
    current = np.asarray(image[..., :3], dtype=np.float32) @ OPPONENT.T
    bands = []
    for level in range(LEVELS):
        smooth = _atrous(current, level, edges)
        bands.append(current - smooth)
        current = smooth
    return current, np.stack(bands)


def make_cache(image, pilot, model, *, edges=None, radius=1, strength=1.):
    """Cache the source coefficients and unit-strength gains, not a new image."""
    if image.shape[:2] != pilot.shape[:2] or not np.isfinite(pilot).all():
        raise ValueError('Pilot must be finite and aligned to the source')
    if not np.isfinite(image).all() or radius not in (0, 1, 3) or strength < 0:
        raise ValueError('Expected finite source and valid locked analysis settings')
    height, width = image.shape[:2]
    edges = edges or _Edges(True, True, True, True, height, width)
    base, bands = decompose(image, edges)
    pilot_base, pilot_bands = decompose(pilot, edges)
    variance = _noise_variance(image[..., :3] @ ACESCG_LUMINANCE, model, edges)
    gains = np.empty_like(bands)
    for level in range(LEVELS):
        power = pilot_bands[level] ** 2
        if radius:
            power = _box(power, radius)
        noise = variance[..., None] * np.square(
            np.asarray(model.band_sigmas, dtype=np.float32)[:, level])
        denominator = power + np.float32(strength) * noise
        gains[level] = np.divide(power, denominator, out=np.ones_like(power), where=denominator > 0)
    chroma = np.concatenate(((pilot_bands - bands)[..., 1:],
                              (pilot_base - base)[None, ..., 1:]), axis=0)
    return Cache(image.copy(), bands, gains, chroma, {})


def control_gains(gains, controls):
    resolved = np.empty_like(gains)
    luma, chroma = controls.strengths()
    for level in range(LEVELS):
        strength = np.asarray([luma, chroma, chroma], dtype=np.float32) * controls.size_multiplier(level)
        if level < 2:
            strength *= controls.fine_band_multiplier()
        base = gains[level]
        denominator = base + np.square(strength) * (1 - base)
        value = np.divide(base, denominator, out=np.ones_like(base), where=denominator > 0)
        value[..., strength == 0] = 1
        if level < 2:
            value = np.maximum(value, controls.fine_band_floor())
        resolved[level] = np.clip(value, 0, 1)
    return resolved


def resolve(cache, controls=AdaptiveControls(), *, direct_chroma=False):
    if controls.amount <= 0 or (controls.luminance <= 0 and controls.color_noise <= 0):
        return cache.original.copy()
    gains = control_gains(cache.gains, controls)
    correction = np.sum((gains - 1) * cache.bands, axis=0)
    if direct_chroma:
        correction[..., 1:] = 0
        for level in range(LEVELS + 1):
            weight = 4 * controls.amount * controls.color_noise * controls.size_multiplier(min(level, LEVELS-1))
            if level < 2:
                weight *= controls.fine_band_multiplier() * (1 - controls.fine_band_floor())
            correction[..., 1:] += np.float32(np.clip(weight, 0, 1)) * cache.pilot_chroma[level]
    output = cache.original.copy()
    output[..., :3] += correction @ OPPONENT
    return output


class PilotWiener:
    margin = 0
    supports_alpha = True
    supports_bypass = True

    def __init__(self, pilot='self', direct_chroma=False):
        self.pilot = pilot
        self.direct_chroma = direct_chroma
        self.input_kind = 'bayer' if pilot == 'bayer' else 'rgb'
        self.network = RawNIND('bayer') if pilot == 'bayer' else None
        self.controls = AdaptiveControls()

    def description(self):
        return dict(algorithm='pilot-empirical-wiener-research', pilot=self.pilot,
                    input_kind=self.input_kind, direct_chroma=self.direct_chroma,
                    power_window=3, k=1., noise='current measured adaptive model on AHD RGB',
                    resolve='cached bands and gains; no pilot or decomposition on control changes',
                    no_invention='own coefficient attenuation; excludes direct pilot chroma')

    def pilot_controls(self, metadata):
        if self.pilot != 'tuned':
            return AdaptiveControls()
        selections = json.loads(Path(__file__).with_name('tuned_controls.json').read_text())
        nearest = min(selections, key=lambda value: abs(int(value)-int(metadata.get('iso') or 6400)))
        return AdaptiveControls(**selections[nearest]['psnr']['controls'])

    def prepare(self, image, metadata):
        if image.shape[0] * image.shape[1] > 1_000_000:
            raise ValueError('Use pilot_wiener_measure native tiled runner for full frames')
        start = time.perf_counter()
        original = develop(image, metadata) if self.input_kind == 'bayer' else image
        model = estimate_adaptive_model(original, workers=1)
        model_seconds = time.perf_counter() - start
        then = time.perf_counter()
        if self.network:
            pilot = self.network.prepare(image, metadata).denoised
        else:
            pilot = resolve_adaptive(original, model, self.pilot_controls(metadata))
        pilot_seconds = time.perf_counter() - then
        then = time.perf_counter()
        cache = make_cache(original, pilot, model)
        cache.timing = dict(model=model_seconds, pilot=pilot_seconds,
                            decomposition_gains=time.perf_counter()-then)
        return cache

    def state_description(self, state):
        return dict(timing=state.timing)

    def process(self, image, metadata, state, *, bypass=False):
        top, left = metadata.get('tile_origin', (0, 0))
        height, width = image.shape[:2]
        region = np.s_[top:top+height, left:left+width]
        cache = Cache(state.original[region], state.bands[:, top:top+height, left:left+width],
                      state.gains[:, top:top+height, left:left+width],
                      state.pilot_chroma[:, top:top+height, left:left+width], {})
        return cache.original.copy() if bypass else resolve(cache, self.controls, direct_chroma=self.direct_chroma)


def self_both():
    return PilotWiener()


def tuned_both():
    return PilotWiener('tuned')


def bayer_both():
    return PilotWiener('bayer')


def self_luma():
    return PilotWiener(direct_chroma=True)


def tuned_luma():
    return PilotWiener('tuned', direct_chroma=True)


def bayer_luma():
    return PilotWiener('bayer', direct_chroma=True)
