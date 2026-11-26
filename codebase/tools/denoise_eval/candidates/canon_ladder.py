"""Canon-only research interventions around today's CPU Denoise."""
from dataclasses import dataclass
from itertools import product

import cv2
import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates import colour_speck as colour
from tools.denoise_eval.marking_page import CONTROLS

BANDS = (1, 2)
RADII = (6, 18)
NOISE_MULTIPLIERS = (1.5, 2.5, 4, 8)
PIT_THRESHOLDS = (3, 2, 1.5)
SMOOTHING_SIGMAS = (2, 4, 8)
CHANNELS = {"colour": (1, 2), "brightness": (0,), "both": (0, 1, 2)}
PIT_OFFSETS = ((0, 7), (5, 5), (7, 0), (5, -5), (0, 11), (8, 8), (11, 0), (8, -8))
PIT_RADIUS = 14


@dataclass(frozen=True)
class Trial:
    method: str
    target: str
    step: int

    @property
    def key(self):
        return f"{self.method}-{self.target}-{self.step}"


def trials():
    for method in ("even", "stronger", "band-pits", "after-pits"):
        targets = ("brightness", "both") if method.endswith("pits") else tuple(CHANNELS)
        for target, step in product(targets, range(1, 4 if method.endswith("pits") else 5)):
            yield Trial(method, target, step)
    for target, step in product(CHANNELS, range(1, len(SMOOTHING_SIGMAS) + 1)):
        yield Trial("smooth", target, step)


def starting_bands(rgb, model, edges):
    strengths = CONTROLS.strengths()
    fine_multiplier = CONTROLS.fine_band_multiplier()
    fine_floor = np.float32(CONTROLS.fine_band_floor())
    variance = adaptive._noise_variance(rgb @ colour.LUMA, model, edges)
    current = rgb @ adaptive.OPPONENT.T
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        size = CONTROLS.size_multiplier(level) * (fine_multiplier if level < 2 else 1)
        noise = np.square([size * strengths[int(c > 0)] * model.band_sigmas[c][level]
                           for c in range(3)]).astype(np.float32) * variance[..., None]
        denominator = np.maximum(energy, np.float32(1e-20))
        floor = fine_floor if level < 2 else np.float32(0)
        gain = np.maximum(np.maximum(energy - noise, 0) / denominator, floor)
        yield level, band, gain, smooth, energy, noise, denominator, floor
        current = smooth


def tile_gain_sums(image, model, edges, core):
    """Measure frame-wide retained energy using each pixel exactly once."""
    totals = np.empty((len(BANDS), 1 + len(RADII), 3, 3), np.float64)
    for level, band, gain, *_ in starting_bands(image, model, edges):
        if level not in BANDS:
            continue
        power = np.square(band[core], dtype=np.float64)
        for i, current in enumerate([gain] + [adaptive._box(gain, r) for r in RADII]):
            local = current[core]
            totals[BANDS.index(level), i] = [power.sum(axis=(0, 1)),
                                             (power * local).sum(axis=(0, 1)),
                                             (power * local * local).sum(axis=(0, 1))]
        if level == BANDS[-1]:
            break
    return totals


def even_calibration(rgb, model):
    h, w = rgb.shape[:2]
    totals = np.zeros((len(BANDS), 1 + len(RADII), 3, 3), np.float64)
    margin = adaptive.TILE_MARGIN + max(RADII)
    for y, x in product(range(0, h, adaptive.TILE_SIZE), range(0, w, adaptive.TILE_SIZE)):
        b, r = min(h, y + adaptive.TILE_SIZE), min(w, x + adaptive.TILE_SIZE)
        t, l, eb, er = max(0, y - margin), max(0, x - margin), min(h, b + margin), min(w, r + margin)
        edges = adaptive._Edges(t == 0, eb == h, l == 0, er == w, h, w)
        totals += tile_gain_sums(rgb[t:eb, l:er], model, edges, np.s_[y-t:b-t, x-l:r-l])
    calibration = {}
    for i, level in enumerate(BANDS):
        power, _, goal = totals[i, 0]
        for j, radius in enumerate(RADII, start=1):
            _, first, second = totals[i, j]
            # Scale toward zero or blend toward one to match retained power
            # while keeping every gain in [0, 1].
            slope = np.sqrt(goal / np.maximum(second, 1e-30))
            linear = 2 * (first - second)
            square = np.maximum(power - 2 * first + second, 0)
            increase = np.maximum(goal - second, 0)
            blend = (2 * increase) / np.maximum(linear + np.sqrt(linear**2 + 4*square*increase), 1e-30)
            calibration[level, radius] = (np.minimum(1, slope) * (1 - blend)).astype(np.float32), blend.astype(np.float32)
        calibration[level, 0] = np.sqrt(goal / np.maximum(power, 1e-30)).astype(np.float32)
    return calibration


def pit_lift(luma, k):
    """Fill a compact valley on a soft ramp using opposite samples in two rings."""
    padded = cv2.copyMakeBorder(luma, PIT_RADIUS, PIT_RADIUS, PIT_RADIUS, PIT_RADIUS, cv2.BORDER_REFLECT_101)
    h, w = luma.shape
    ring = []
    for dy, dx in PIT_OFFSETS:
        for sign in (-1, 1):
            y, x = PIT_RADIUS + dy*sign, PIT_RADIUS + dx*sign
            ring.append(padded[y:y+h, x:x+w])
    ring = np.stack(ring)
    centre = cv2.GaussianBlur(luma, (5, 5), 1)
    # Use angular coverage as a compactness check. An edge has at
    # least one low side and a long dark streak has a low opposite pair.
    paired = np.minimum(ring[::2], ring[1::2])
    directional = paired.reshape((2, 4, h, w)).max(axis=0).min(axis=0)
    background = np.median(ring, axis=0)
    grain = np.maximum(np.median(np.abs(ring - background), axis=0) * 1.4826, np.float32(1e-6))
    depth = np.minimum(background, directional) - centre
    rim_weight = colour.ramp(depth / grain, k, k + 1)
    deficit = np.maximum(background - luma - .25 * grain, 0)
    return deficit * rim_weight


def resolve_region(image, model, edges, trial, calibration):
    normal = np.zeros_like(image)
    selected = np.zeros_like(image)
    for level, band, gain, smooth, energy, noise, denominator, floor in starting_bands(image, model, edges):
        kept = band * gain
        normal += kept
        if level not in BANDS or trial is None:
            continue
        if trial.method == "even":
            if trial.step <= len(RADII):
                radius = RADII[trial.step - 1]
                scale, offset = calibration[level, radius]
                new_gain = np.clip(adaptive._box(gain, radius) * scale + offset, 0, 1)
            else:
                new_gain = calibration[level, 0] if trial.step == 3 else 0
        elif trial.method == "stronger" or trial.target == "both":
            multiplier = (NOISE_MULTIPLIERS[trial.step - 1] if trial.method == "stronger"
                          else NOISE_MULTIPLIERS[(0, 1, 3)[trial.step - 1]])
            new_gain = np.maximum(np.maximum(energy - noise * np.float32(multiplier**2), 0) / denominator, floor)
        else:
            new_gain = gain
        if trial.method == "band-pits":
            selected[..., 0] += kept @ colour.BAND_LUMA
        channels = (1, 2) if trial.method.endswith("pits") and trial.target == "both" else CHANNELS[trial.target]
        for channel in channels:
            if channel == 0 and trial.method.endswith("pits"):
                continue
            factor = new_gain[..., channel] if np.ndim(new_gain) else new_gain
            delta = band[..., channel] * factor - kept[..., channel]
            normal[..., channel] += delta
            if channel:
                # Opponent component zero is average RGB. Correct the true
                # scene brightness contribution of a chroma-only change.
                normal[..., 0] -= delta * np.float32(colour.BAND_LUMA[channel] / colour.BAND_LUMA[0])
    normal += smooth
    if trial is not None and trial.method == "band-pits":
        lift = pit_lift(selected[..., 0], PIT_THRESHOLDS[trial.step - 1])
        normal[..., 0] += lift / colour.BAND_LUMA[0]
    return normal @ adaptive.OPPONENT


def resolve(tamed, baseline, model, trial, calibration=None, *, tile=adaptive.TILE_SIZE):
    if trial.method == "smooth":
        # Deliberate over-smoothing control. A broad blur shows what it
        # looks like when the targeted scales no longer survive anywhere.
        sigma = SMOOTHING_SIGMAS[trial.step - 1]
        radius = 3 * sigma
        width = 2 * radius + 1

        def smooth_frame(rgb, _rect, _edges):
            if trial.target == "both":
                return cv2.GaussianBlur(rgb, (width, width), sigma)
            if trial.target == "brightness":
                luminance = rgb @ colour.LUMA
                return rgb + (cv2.GaussianBlur(luminance, (width, width), sigma) - luminance)[..., None]
            chroma = rgb @ adaptive.OPPONENT[1:].T
            delta = cv2.GaussianBlur(chroma, (width, width), sigma) - chroma
            return rgb + delta @ colour.CHROMA_RGB

        return colour.tiled(baseline, radius, smooth_frame, tile=tile)
    if trial.method == "after-pits" and trial.target == "brightness":
        return colour.tiled(baseline, PIT_RADIUS, lambda rgb, _rect, _edges: rgb + pit_lift(
            rgb @ colour.LUMA, PIT_THRESHOLDS[trial.step - 1])[..., None], tile=tile)
    margin = adaptive.TILE_MARGIN
    if trial.method == "even" and trial.step <= len(RADII):
        margin += RADII[trial.step - 1]
    if trial.method.endswith("pits"):
        margin += PIT_RADIUS

    def kernel(rgb, rect, edges):
        result = resolve_region(rgb, model, edges, trial, calibration)
        if trial.method == "after-pits":
            lift = pit_lift(baseline[rect] @ colour.LUMA, PIT_THRESHOLDS[trial.step - 1])
            result += lift[..., None]
        return result

    return colour.tiled(tamed, margin, kernel, tile=tile)
