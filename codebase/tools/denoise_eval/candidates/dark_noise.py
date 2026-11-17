"""Research-only informative-block calibration inside adaptive-atrous-v1."""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.noise_model_specks import constrained_shape, variance_observations


def block_mean(values):
    height, width = values.shape[:2]
    block = adaptive._BLOCK
    return values[:height // block * block, :width // block * block].reshape(
        height // block, block, width // block, block).mean(axis=(1, 3)).ravel()


def prepare_informative(source, *, all_bands=False, stable_shape=True):
    windows = adaptive._sample_tiles(*source.shape[:2])
    observations = variance_observations(source, windows)
    shape = constrained_shape(observations) if stable_shape else adaptive._estimate_variance_model(source, windows)
    if shape is None:
        return adaptive._estimate(source), dict(fallback='no informative brightness bins')
    model = adaptive.AdaptiveNoiseModel(*shape, ((0.,) * adaptive.LEVELS,) * 3)
    spreads, informative, signals = [], [], []
    height, width = source.shape[:2]
    for top, left, bottom, right in windows:
        rgb = source[top:bottom, left:right, :3]
        edges = adaptive._Edges(top == 0, bottom == height, left == 0, right == width, height, width)
        luminance = rgb @ adaptive.ACESCG_LUMINANCE
        sigma = np.sqrt(adaptive._noise_variance(luminance, model, edges))
        response = adaptive._conv3(luminance, adaptive._IMMERKAER)
        floor = np.float32(32 * np.finfo(np.float32).eps) * np.maximum(np.abs(luminance), 1e-20)
        informative.append(block_mean(np.abs(response) <= floor) < .25)
        signals.append(block_mean(luminance))
        current = rgb @ adaptive.OPPONENT.T
        levels = []
        for level in range(adaptive.LEVELS if all_bands else 2):
            smooth = adaptive._atrous(current, level, edges)
            band = (current - smooth) / sigma[..., None]
            levels.append(np.stack([adaptive._block_stds(band[..., component])
                                    for component in range(3)], axis=1))
            current = smooth
        spreads.append(np.stack(levels, axis=1))
    spreads = np.concatenate(spreads)
    informative = np.concatenate(informative)
    signals = np.concatenate(signals)
    if informative.sum() < 8:
        return adaptive._estimate(source), dict(fallback='fewer than eight informative blocks')
    flat = informative & (spreads[:, 0, 0] <= np.quantile(
        spreads[informative, 0, 0], adaptive.FLAT_BLOCK_QUANTILE))
    original_flat = spreads[:, 0, 0] <= np.quantile(spreads[:, 0, 0], adaptive.FLAT_BLOCK_QUANTILE)
    calibration = adaptive._quantile_calibration(.1)
    rows = []
    for component in range(3):
        measured = np.quantile(spreads[flat, :, component], .1, axis=0) * calibration
        ratio = float(np.clip(measured[1] / max(measured[0], 1e-12), *adaptive.BAND_RATIO_RANGE))
        decay = float(np.clip(ratio, *adaptive.COARSE_DECAY_RANGE))
        rows.append(tuple(measured if all_bands else [measured[0]] + [
            measured[0] * ratio * decay ** (level - 1) for level in range(1, adaptive.LEVELS)]))
    model = replace(model, band_sigmas=tuple(rows))
    limits, reference = adaptive._tail_reference()
    tails, fraction = adaptive._energy_tails(source, windows, model, limits)
    confidence = adaptive._tail_confidence(fraction)
    rows = []
    for component, row in enumerate(model.band_sigmas):
        factors = []
        for level in (0, 1):
            measured = tails[component][level] / reference[component][level]
            measured = float(np.clip(measured, *adaptive.TAIL_FACTOR_RANGE)) if np.isfinite(measured) else 1.
            factors.append(1 + confidence * (measured - 1))
        rows.append(tuple(float(sigma * np.sqrt(factors[level])) if level < 2 else float(sigma)
                          for level, sigma in enumerate(row)))
    return replace(model, band_sigmas=tuple(rows)), dict(
        fallback=None, blocks=len(informative), informative_blocks=int(informative.sum()),
        selected_blocks=int(flat.sum()), selected_signal_percentiles=np.percentile(signals[flat], [0, 50, 100]).tolist(),
        original_selected_blocks=int(original_flat.sum()),
        censored_original_selected_blocks=int((original_flat & ~informative).sum()),
        original_selected_signal_percentiles=np.percentile(signals[original_flat], [0, 50, 100]).tolist(),
        all_bands=all_bands, observations=observations)


def independent_energy_filter(rgb, model, controls, edges):
    variance = adaptive._noise_variance(rgb @ adaptive.ACESCG_LUMINANCE, model, edges)
    current = rgb @ adaptive.OPPONENT.T
    result = np.zeros_like(current)
    neighbours = (2 * adaptive.WIENER_RADIUS + 1) ** 2 - 1
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = np.maximum((adaptive._box(band * band, adaptive.WIENER_RADIUS)
                             * (neighbours + 1) - band * band) / neighbours, 0)
        for component in range(3):
            strength = controls.strengths()[int(component > 0)] * controls.size_multiplier(level)
            if level < 2:
                strength *= controls.fine_band_multiplier()
            noise = np.float32((strength * model.band_sigmas[component][level]) ** 2) * variance
            gain = np.maximum(energy[..., component] - noise, 0) / np.maximum(energy[..., component], 1e-20)
            if level < 2:
                gain = np.maximum(gain, controls.fine_band_floor())
            result[..., component] += band[..., component] * gain
        current = smooth
    return (result + current) @ adaptive.OPPONENT


class Informative(AppDefault):
    def __init__(self, all_bands=False, stable_shape=True, independent_energy=False):
        super().__init__()
        self.all_bands = all_bands
        self.stable_shape = stable_shape
        self.independent_energy = independent_energy

    def prepare(self, image, metadata):
        return prepare_informative(image, all_bands=self.all_bands, stable_shape=self.stable_shape)

    def process(self, image, metadata, state, *, bypass=False):
        if not self.independent_energy or bypass or self.controls.amount <= 0 or (
                self.controls.luminance <= 0 and self.controls.color_noise <= 0):
            return super().process(image, metadata, state[0], bypass=bypass)
        source = np.asarray(image, dtype=np.float32)
        height, width = source.shape[:2]
        result = source.copy()
        for top in range(0, height, adaptive.TILE_SIZE):
            for left in range(0, width, adaptive.TILE_SIZE):
                bottom, right = min(height, top + adaptive.TILE_SIZE), min(width, left + adaptive.TILE_SIZE)
                first, start = max(0, top - self.margin), max(0, left - self.margin)
                last, end = min(height, bottom + self.margin), min(width, right + self.margin)
                edges = adaptive._Edges(first == 0, last == height, start == 0, end == width, height, width)
                filtered = independent_energy_filter(source[first:last, start:end, :3], state[0], self.controls, edges)
                result[top:bottom, left:right, :3] = filtered[top-first:bottom-first, left-start:right-start]
        if not np.isfinite(result).all():
            raise FloatingPointError('Independent-energy research produced invalid pixels')
        return result

    def state_description(self, state):
        return dict(model=state[0].as_dict(), calibration=state[1])

    def description(self):
        return dict(**super().description(), research='censored brightness bins and calibration blocks',
                    all_bands=self.all_bands, stable_shape=self.stable_shape,
                    energy='leave-centre-out second moment' if self.independent_energy else 'shipping second moment')


def factory():
    return Informative()


def perband():
    return Informative(all_bands=True)


def calibration_only():
    return Informative(stable_shape=False)


def independent():
    return Informative(independent_energy=True)


def detail_zero():
    adapter = factory()
    adapter.controls = replace(adapter.controls, detail_recovery=0)
    return adapter


def strong():
    adapter = factory()
    adapter.controls = replace(adapter.controls, amount=1, luminance=1)
    return adapter


def signed():
    from tools.denoise_eval.candidates.signed_shadows import SignedShadows
    adapter = SignedShadows(True)
    adapter.current = factory()
    return adapter


def detail_zero():
    adapter = factory()
    adapter.controls = replace(adapter.controls, detail_recovery=0)
    return adapter


def signed():
    from tools.denoise_eval.candidates.signed_shadows import SignedShadows
    adapter = SignedShadows(True)
    adapter.current = factory()
    return adapter


def signed_independent():
    from tools.denoise_eval.candidates.signed_shadows import SignedShadows
    adapter = SignedShadows(True)
    adapter.current = independent()
    return adapter
