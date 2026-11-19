"""Grain-matched adaptive Denoise and the experimental cleanup stages.

All neighbourhood work stays in linear light. A whole-image reduction fits two
brightness gains, then each tile runs the same reconstruction and cleanup.
"""
from itertools import islice, product
from tempfile import TemporaryFile
from threading import Lock
from weakref import finalize

import cv2
import numpy as np

from . import denoise_adaptive as adaptive
from .cpu_budget import CpuExecutor

GRAIN_RADIUS = 18
COLOUR_MARGIN = 68
HEAL_MARGIN = 28
LUMA = adaptive.ACESCG_LUMINANCE
CHROMA = adaptive.OPPONENT[1:]
CLEAN_TILE_SIZE = adaptive.TILE_SIZE - 2 * (COLOUR_MARGIN + HEAL_MARGIN)
DONORS = tuple((y * step, x * step) for step in (4, 8, 12, 16)
               for y, x in product((-1, 0, 1), repeat=2) if x or y)


def _box(values, radius):
    width = 2 * radius + 1
    return cv2.boxFilter(values, -1, (width, width), borderType=cv2.BORDER_REPLICATE)


def _origins(height, width, size):
    return product(range(0, height, size), range(0, width, size))


def _region(read, height, width, origin, size, margin):
    y, x = origin
    bottom, right = min(y + size, height), min(x + size, width)
    top, left = max(0, y - margin), max(0, x - margin)
    end_y, end_x = min(height, bottom + margin), min(width, right + margin)
    pixels = read(top, left, end_y, end_x)[..., :3]
    core = np.s_[y-top:bottom-top, x-left:right-left]
    edges = adaptive._Edges(top == 0, end_y == height, left == 0, end_x == width, height, width)
    return pixels, core, edges


def fit_grain(height, width, read, model, controls):
    """Fit scale and offset to retain the original wavelet energy in each band."""
    size = adaptive.TILE_SIZE

    def sums(origin):
        pixels, core, edges = _region(read, height, width, origin, size, 17 + GRAIN_RADIUS)
        result = np.zeros((2, 4), dtype=np.float64)
        for level, (band, gains, _) in enumerate(islice(adaptive._bands(pixels, model, controls, edges), 3)):
            if level == 0:
                continue
            power = np.square(band[core][..., 0], dtype=np.float64)
            original = gains[0][core]
            averaged = _box(gains[0], GRAIN_RADIUS)[core]
            result[level - 1] = (power.sum(), np.sum(power * original * original),
                                 np.sum(power * averaged), np.sum(power * averaged * averaged))
        return result

    with CpuExecutor() as pool:
        totals = np.sum(list(pool.map(sums, _origins(height, width, size))), axis=0)
    fit = []
    for power, target, first, second in totals:
        scale = np.sqrt(target / max(second, 1e-30))
        linear = 2 * (first - second)
        square = max(power - 2 * first + second, 0)
        increase = max(target - second, 0)
        offset = (2 * increase) / max(linear + np.sqrt(linear**2 + 4 * square * increase), 1e-30)
        fit.append((float(np.float32(min(1, scale) * (1 - offset))), float(np.float32(offset))))
    return tuple(fit)


def grain_gain(gain, evenness, fit):
    scale, offset = fit
    matched = np.clip(_box(gain, GRAIN_RADIUS) * np.float32(scale) + np.float32(offset), 0, 1)
    if evenness == 1:
        return matched
    return gain + np.float32(evenness) * (matched - gain)


def _ramp(value, low, high):
    return np.clip((value - low) / (high - low), 0, 1)


def _magnitude(vector):
    a, b = cv2.split(vector)
    return cv2.magnitude(a, b)


def _grain(field, *, chroma=False):
    fine = field - _box(field, 2)
    absolute = _magnitude(fine) if chroma else np.abs(fine)
    return np.maximum(1.25 * _box(absolute, 16), np.float32(1e-7))


def _shift(padded, shape, y, x):
    height, width = shape
    return padded[y:y+height, x:x+width]


def _surround(field, reach, tap):
    """Average opposite directions, omitting the two extreme pairs."""
    padded = cv2.copyMakeBorder(_box(field, tap), reach, reach, reach, reach, cv2.BORDER_REFLECT_101)
    diagonal = round(reach / np.sqrt(2))
    shape = field.shape[:2]
    pairs = []
    for y, x in ((0, reach), (reach, 0), (diagonal, diagonal), (diagonal, -diagonal)):
        pairs.append(.5 * (_shift(padded, shape, reach+y, reach+x)
                            + _shift(padded, shape, reach-y, reach-x)))
    low = np.minimum(np.minimum(pairs[0], pairs[1]), np.minimum(pairs[2], pairs[3]))
    high = np.maximum(np.maximum(pairs[0], pairs[1]), np.maximum(pairs[2], pairs[3]))
    return .5 * (sum(pairs) - low - high)


def colour_delta(rgb, broad):
    """Full-strength opponent-colour correction, leaving scene luminance alone."""
    y = rgb @ LUMA
    light = np.maximum(_box(y, 1), 0) + 2 * _grain(y)
    original = rgb @ CHROMA.T
    chroma = original / light[..., None]
    noise = _grain(chroma, chroma=True)
    for reach, tap, centre in ((12, 2, 1), (28, 4, 3)) if broad else ((12, 2, 1),):
        delta = _box(chroma, centre) - _surround(chroma, reach, tap)
        weight = .9 * _ramp(_magnitude(delta) / noise, .65, 2.5)
        chroma -= delta * weight[..., None]
    return chroma * light[..., None] - original


def apply_colour(rgb, delta, blend):
    output = rgb + (delta * np.float32(blend)) @ CHROMA
    output += ((rgb @ LUMA) - (output @ LUMA))[..., None]
    return output


def patch_fields(y):
    """Prepare the lift and its relative light scale for a live repair blend."""
    centre = _box(y, 1)
    target = .5 * (_surround(y, 8, 2) + _surround(y, 13, 3))
    noise = _grain(y)
    weight = _ramp((target - centre) / noise, .45, 1.7)

    reach = 16
    shape = y.shape
    coarse = _box(y, 2)
    padded_guide = cv2.copyMakeBorder(coarse, reach, reach, reach, reach, cv2.BORDER_REFLECT_101)
    padded_y = cv2.copyMakeBorder(y, reach, reach, reach, reach, cv2.BORDER_REFLECT_101)
    best = np.full_like(y, np.inf)
    donor = y.copy()
    donor_coarse = coarse.copy()
    for dy, dx in DONORS:
        guide = _shift(padded_guide, shape, reach+dy, reach+dx)
        context = np.square(guide - coarse)
        # The centre is excluded from the matching ring.
        distance = (361 * _box(context, 9) - 81 * _box(context, 4)) / 280
        distance += .40 * np.square(guide - target)
        distance += .015 * (dy*dy + dx*dx) / reach**2 * noise**2
        better = distance < best
        np.copyto(donor, _shift(padded_y, shape, reach+dy, reach+dx), where=better)
        np.copyto(donor_coarse, guide, where=better)
        np.minimum(best, distance, out=best)

    replacement = _box(donor_coarse, 1) + .75 * (donor - donor_coarse)
    lift = _box(weight, 1) * (replacement - y)
    return lift, np.maximum(lift / (np.maximum(centre, 0) + 2 * noise), -1)


def apply_patches(rgb, fields, blend):
    lift, saturation = fields
    y = rgb @ LUMA
    return rgb + (lift * blend)[..., None] + (rgb - y[..., None]) * (saturation * blend)[..., None]


def clean_fields(rgb, broad):
    delta = colour_delta(rgb, broad)
    # Use the fully corrected colour for the reference luminance calculation.
    # Colour strength preserves scene luminance, so the donor can stay fixed.
    lift, saturation = patch_fields(apply_colour(rgb, delta, 1) @ LUMA)
    return delta, lift, saturation


def _resolved_tile(read, height, width, origin, size, downstream, model, controls, fit):
    pixels, core, edges = _region(read, height, width, origin, size, adaptive.TILE_MARGIN + downstream)
    base = adaptive._filter_region(pixels, model, controls, edges, controls.grain_evenness, fit)
    top, left = max(0, core[0].start - downstream), max(0, core[1].start - downstream)
    end_y = min(base.shape[0], core[0].stop + downstream)
    end_x = min(base.shape[1], core[1].stop + downstream)
    inner = np.s_[core[0].start-top:core[0].stop-top, core[1].start-left:core[1].stop-left]
    return base[top:end_y, left:end_x], inner


class CleanGrainPreparation:
    """One temporary, region-readable correction image owned by a source cache."""

    def __init__(self, height, width, read, model, controls, fit, is_current):
        self.height = height
        self.width = width
        self._lock = Lock()
        self._file = TemporaryFile()
        self._close = finalize(self, self._file.close)
        self._file.truncate(height * width * 16)
        size = CLEAN_TILE_SIZE

        def run(origin):
            if not is_current():
                raise InterruptedError("A newer source replaced the Denoise preparation.")
            rgb, inner = _resolved_tile(read, height, width, origin, size, COLOUR_MARGIN + HEAL_MARGIN,
                                        model, controls, fit)
            fields = np.dstack(clean_fields(rgb, controls.splotch_size == "large"))[inner]
            if not np.isfinite(fields).all():
                raise FloatingPointError("Clean Grain produced invalid corrections.")
            y, x = origin
            rows = np.ascontiguousarray(fields, dtype="<f4")
            with self._lock:
                for dy, row in enumerate(rows):
                    self._file.seek(((y + dy) * width + x) * 16)
                    self._file.write(row)

        try:
            with CpuExecutor() as pool:
                list(pool.map(run, _origins(height, width, size)))
            self._file.flush()
        except BaseException:
            self._close()
            raise

    def region(self, y, x, height, width):
        if min(y, x) < 0 or min(height, width) < 1 or y + height > self.height or x + width > self.width:
            raise ValueError("Clean Grain region exceeds the prepared source.")
        rows = bytearray(height * width * 16)
        stride = width * 16
        with self._lock:
            for dy in range(height):
                self._file.seek(((y + dy) * self.width + x) * 16)
                self._file.readinto(memoryview(rows)[dy*stride:(dy+1)*stride])
        return bytes(rows)


def resolve_grain(source, model, controls):
    evenness = controls.grain_evenness
    splotches = controls.color_splotches
    broad = controls.splotch_size == "large"
    specks = controls.dark_specks
    clean = controls.method == "clean_grain" and (splotches > 0 or specks > 0)
    if (not clean and not evenness) or controls.amount <= 0 or not (controls.luminance or controls.color_noise):
        return adaptive._resolve_standard(source, model, controls)
    height, width = source.shape[:2]
    result = source.copy()
    read = lambda y, x, b, r: source[y:b, x:r]
    fit = fit_grain(height, width, read, model, controls) if evenness else None
    size = CLEAN_TILE_SIZE if clean else adaptive.TILE_SIZE
    # Stage only the core and the pixels the next stage will read.
    downstream = (COLOUR_MARGIN if splotches and clean else 0) + (HEAL_MARGIN if specks and clean else 0)

    def run(origin):
        base, core = _resolved_tile(read, height, width, origin, size, downstream, model, controls, fit)
        y, x = origin
        rgb = base
        if clean:
            delta = colour_delta(base, broad) if splotches else None
            if delta is not None:
                rgb = apply_colour(base, delta, splotches)
            if specks:
                patch_base = rgb
                if delta is not None and splotches != 1:
                    patch_base = apply_colour(base, delta, 1)
                rgb = apply_patches(rgb, patch_fields(patch_base @ LUMA), specks)
        result[y:min(y+size, height), x:min(x+size, width), :3] = rgb[core]

    with CpuExecutor() as pool:
        list(pool.map(run, _origins(height, width, size)))
    if not np.isfinite(result).all():
        raise FloatingPointError("Grain Denoise produced a non-finite value.")
    return result
