"""Own GPL-3 research: cached adaptive bands plus guarded residual cleanup.

No application import. Thresholds are locked before public-pair evaluation;
there is no clean-reference, camera-name or ISO-specific runtime selection.
"""
from dataclasses import dataclass, asdict
import time

import cv2
import numpy as np
from hdr_finisher.denoise_adaptive import (
    ACESCG_LUMINANCE, OPPONENT, LEVELS, AdaptiveControls, _Edges,
    _atrous, _box, _noise_variance, estimate_adaptive_model,
)

DEFAULT = AdaptiveControls()
CLEANUP_MARGIN = 20
MARGIN = 66 + CLEANUP_MARGIN


@dataclass
class Cache:
    original: np.ndarray
    bands: np.ndarray
    noise_to_energy: np.ndarray
    corrections: np.ndarray
    statistics: dict


def decompose(image, model, edges=None):
    h, w = image.shape[:2]
    edges = edges or _Edges(True, True, True, True, h, w)
    current = image[..., :3] @ OPPONENT.T
    variance = _noise_variance(image[..., :3] @ ACESCG_LUMINANCE, model, edges)
    bands, noise_to_energy = [], []
    for level in range(LEVELS):
        smooth = _atrous(current, level, edges)
        band = current - smooth
        energy = _box(band * band, 3)
        noise = variance[..., None] * np.square(np.asarray(model.band_sigmas)[:, level]).astype('float32')
        noise_to_energy.append(noise / np.maximum(energy, np.float32(1e-20)))
        bands.append(band)
        current = smooth
    return np.stack(bands), np.stack(noise_to_energy), variance


def adaptive(cache, controls):
    result = cache.original.copy()
    if controls.amount <= 0 or (controls.luminance <= 0 and controls.color_noise <= 0):
        return result
    correction = np.zeros_like(result[..., :3])
    luma, chroma = controls.strengths()
    for level in range(LEVELS):
        strength = np.array([luma, chroma, chroma], 'float32') * controls.size_multiplier(level)
        if level < 2:
            strength *= controls.fine_band_multiplier()
        gain = np.maximum(1 - cache.noise_to_energy[level] * strength**2, 0)
        if level < 2:
            gain = np.maximum(gain, controls.fine_band_floor())
        correction += (gain - 1) * cache.bands[level]
    result[..., :3] += correction @ OPPONENT
    return result


def shift(image, dy, dx):
    # Only the outer frame is reflected; haloed native tiles discard this reach.
    h, w = image.shape[:2]
    padded = cv2.copyMakeBorder(image, abs(dy), abs(dy), abs(dx), abs(dx), cv2.BORDER_REFLECT_101)
    return padded[abs(dy)+dy:abs(dy)+dy+h, abs(dx)+dx:abs(dx)+dx+w]


def cleanup(image, model, variance, variant='guarded'):
    """Return separate opponent impulse/chroma corrections, fixed finite support.

    The guarded version only repairs *dark* local extrema, with a bright rim,
    without a supported line direction. Every positive point is protected.
    Joint range weights refuse to cross strong luma OR chroma boundaries.
    """
    opponent = image[..., :3] @ OPPONENT.T
    sigma = np.sqrt(variance)[..., None] * np.asarray(model.band_sigmas, 'float32')[:, 0]
    # Denoised residual is smaller than input noise. This deliberately remains
    # conservative: no per-image fit to a favourable clean reference.
    residual_sigma = np.maximum(sigma * .35, np.float32(1e-12))
    median = np.stack([cv2.medianBlur(opponent[..., c], 5) for c in range(3)], -1)
    residual = opponent - median
    outlier = np.clip((np.abs(residual) / residual_sigma - 2.5) / 2.5, 0, 1)
    if variant == 'median':
        impulse = -residual * outlier
    else:
        y = opponent[..., 0]
        local = cv2.boxFilter(y, -1, (9, 9), borderType=cv2.BORDER_REFLECT_101)
        ring = (cv2.boxFilter(y, -1, (5, 5), borderType=cv2.BORDER_REFLECT_101)*25 - y) / 24
        # A dark point with no light rim (tiny ink/digit) is not repaired.
        rim = np.clip((ring - local) / residual_sigma[..., 0] - .25, 0, 1)
        directional = np.zeros_like(y)
        for dy, dx in ((0, 2), (2, 0), (2, 2), (2, -2)):
            # A line has similarly dark support on BOTH sides of the point.
            support = np.maximum(abs(y-shift(y, dy, dx)), abs(y-shift(y, -dy, -dx)))
            directional = np.maximum(directional, np.clip(1-support/(2*residual_sigma[..., 0]), 0, 1))
        dark = (residual[..., 0] < 0).astype('float32') * rim * (1-directional)
        # Do not change bright luma point detail through a chroma-only impulse.
        impulse = -residual * outlier * dark[..., None]
    # Two spatial scales; chroma is smoothed only among compatible colours and
    # luminances, never by an unguarded large Gaussian across a colour edge.
    chroma_delta = np.zeros_like(opponent)
    if variant != 'median':
        coarse_sigma = np.sqrt(variance)[..., None] * np.asarray(model.band_sigmas, 'float32')[:, 2]
        denominator = np.maximum(coarse_sigma * np.array([3., 6., 6.], 'float32'), 1e-12)
        total = np.zeros_like(opponent[..., 1:])
        weights = np.zeros_like(opponent[..., 0])
        for dy in (-16, -8, 0, 8, 16):
            for dx in (-16, -8, 0, 8, 16):
                neighbour = shift(opponent, dy, dx)
                distance = ((opponent-neighbour)/denominator)**2
                weight = np.exp(-.5*np.sum(distance, axis=-1)) * np.float32(np.exp(-(dx*dx+dy*dy)/256))
                total += weight[..., None] * neighbour[..., 1:]
                weights += weight
        chroma_delta[..., 1:] = .65*(total/weights[..., None] - opponent[..., 1:])
    if variant in ('shadow', 'center_shadow'):
        # Restrict intervention to signal/noise <12, with full treatment <4.
        # No absolute scene-linear brightness cutoff: exposure covariance stays.
        y = image[..., :3] @ ACESCG_LUMINANCE
        noise_y = np.maximum(sigma[..., 0] / np.sqrt(3.), 1e-12)
        surround = cv2.medianBlur(y, 5) if variant == 'shadow' else y
        shadow = np.clip((12*noise_y-abs(surround))/(8*noise_y), 0, 1)
        # Bright point evidence protects colour as well as luma.
        point = np.clip((residual[..., 0]/residual_sigma[..., 0]-2)/2, 0, 1)
        chroma_delta *= (shadow*(1-point))[..., None]
        # Opponent C is orthogonal to equal RGB, not ACEScg luminance.
        # Explicitly project colour repair onto the constant-ACEScg-Y plane.
        rgb_delta = chroma_delta @ OPPONENT
        rgb_delta -= (rgb_delta @ ACESCG_LUMINANCE)[..., None]
        chroma_delta = rgb_delta @ OPPONENT.T
        impulse *= shadow[..., None]
    corrections = np.stack([impulse, chroma_delta])
    return corrections, dict(impulse_pixels=int(np.count_nonzero(np.max(abs(impulse), axis=-1) > 1e-10)),
                             mean_chroma_correction=float(np.mean(abs(chroma_delta[..., 1:]))))


def make_cache(image, model, variant='shadow', edges=None):
    start = time.perf_counter()
    bands, ratios, variance = decompose(image, model, edges)
    decomposition_seconds = time.perf_counter()-start
    cache = Cache(image.copy(), bands, ratios, None, {})
    start = time.perf_counter()
    baseline = adaptive(cache, DEFAULT)
    baseline_seconds = time.perf_counter()-start
    start = time.perf_counter()
    cache.corrections, cache.statistics = cleanup(baseline, model, variance, variant)
    cache.statistics.update(decomposition_seconds=decomposition_seconds, baseline_seconds=baseline_seconds,
                            cleanup_seconds=time.perf_counter()-start)
    return cache


def resolve(cache, controls=DEFAULT):
    result = adaptive(cache, controls)
    if controls.amount <= 0 or (controls.luminance <= 0 and controls.color_noise <= 0):
        return result
    luma, chroma = controls.strengths()
    dl, dc = DEFAULT.strengths()
    # Masks/coefficients stay fixed: all eight controls are cheap array algebra.
    fine = .5*(controls.size_multiplier(0)+controls.size_multiplier(1))
    fine *= controls.fine_band_multiplier()*(1-controls.fine_band_floor())
    coarse = .5*(controls.size_multiplier(2)+controls.size_multiplier(4))
    strength = np.array([luma/dl, chroma/dc, chroma/dc], 'float32')
    correction = cache.corrections[0] * np.clip(strength*fine, 0, 1)
    correction += cache.corrections[1] * np.clip(strength*coarse, 0, 1)
    result[..., :3] += correction @ OPPONENT
    return result


class SpeckCleanup:
    input_kind = 'rgb'
    margin = 0  # Prepared-frame slices; independent prepare-grid probe is separate.
    supports_alpha = True
    supports_bypass = True

    def __init__(self, variant='shadow'):
        self.variant = variant
        self.controls = DEFAULT

    def description(self):
        return dict(algorithm='adaptive-residual-cleanup-v1-research', variant=self.variant,
                    input_kind=self.input_kind, controls=asdict(self.controls),
                    source='own GPL-3 code; current adaptive noise model',
                    cache='five source bands/noise-energy ratios plus two correction maps',
                    prepare_margin=MARGIN, threshold_sigma=2.5, positive_points_protected=self.variant!='median')

    def prepare(self, image, metadata):
        if image.shape[0]*image.shape[1] > 1_000_000:
            raise ValueError('Use speck_measure native bounded runner above 1 MP')
        if not np.isfinite(image).all():
            raise ValueError('Expected finite scene-linear image')
        start = time.perf_counter()
        model = estimate_adaptive_model(image, workers=1)
        cache = make_cache(image, model, self.variant)
        cache.statistics['prepare_seconds'] = time.perf_counter()-start
        return cache

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            return image.copy()
        top, left = metadata.get('tile_origin', (0, 0))
        value = resolve(state, self.controls)
        return value[top:top+image.shape[0], left:left+image.shape[1]].copy()

    def state_description(self, state):
        return state.statistics


def factory():
    return SpeckCleanup()


def median():
    return SpeckCleanup('median')


def guarded():
    return SpeckCleanup('guarded')


def center_shadow():
    return SpeckCleanup('center_shadow')
