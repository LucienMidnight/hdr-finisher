"""Shared "Light" colour selection for Global HSL and the Local hue mask.

CPU reference of ``frontend/hsl-selection-gpu.js``; the GPU is the primary
route and this is its fallback. Both read the HSL stage input (the picture
after exposure, white balance and colour edits, in D65 linear sRGB) and never
change RGB.

Every distance is authored in source pixels and converted by the processing
scale, so a reduced preview, a zoomed tile and an export select the same
area of the photograph. The coarse grid is anchored to the frame origin, so a
tile with enough halo reproduces the whole-frame result.
"""
from dataclasses import dataclass
import math
import cv2
import numpy as np
from .hsl import to_lab, _smooth, _delta

# Source pixels: coarse cell edge (chroma averaged over about eight), guided
# filter radius and bright-edge surround radius at native scale.
CELL_SOURCE_PIXELS = 4
GUIDE_SOURCE_PIXELS = 4
SURROUND_SOURCE_PIXELS = 2
GUIDE_EPSILON = .03
MIN_SCALE = .05  # the GPU's SOURCE_PIXEL_SCALE floor


def _round(value):
    # JavaScript Math.round, not Python's banker's rounding.
    return int(math.floor(value + .5))


@dataclass(frozen=True)
class SelectionGeometry:
    cell: int
    sigma: float
    taps: int
    guide: int
    surround: int

    @property
    def reach(self):
        """Pixels past a tile edge that change its interior selection."""
        return self.cell * (self.taps + 2) + 2 * self.guide + self.surround + 2


def geometry(scale=1.0):
    s = min(1.0, max(MIN_SCALE, float(scale)))
    cell = max(1, _round(CELL_SOURCE_PIXELS * s))
    sigma = CELL_SOURCE_PIXELS * s / cell
    return SelectionGeometry(cell, sigma, max(1, math.ceil(4 * sigma)),
                             max(1, _round(GUIDE_SOURCE_PIXELS * s)),
                             max(1, _round(SURROUND_SOURCE_PIXELS * s)))


@dataclass(frozen=True)
class PreparedSelection:
    chroma: np.ndarray       # smoothed coarse relative chroma (a/L, b/L)
    guide: np.ndarray        # log2 Oklab lightness, full resolution
    protection: np.ndarray   # bright-edge / colour-mismatch protection
    geometry: SelectionGeometry
    origin: tuple

    @property
    def shape(self):
        return self.guide.shape


def _box(values, radius):
    return cv2.boxFilter(values, -1, (2 * radius + 1, 2 * radius + 1),
                         borderType=cv2.BORDER_REFLECT)


def _cells(length, origin, cell):
    starts = [0] + [i for i in range(1, length) if (origin + i) % cell == 0]
    return np.asarray(starts)


def _coarse_mean(values, origin, cell):
    ys = _cells(values.shape[0], origin[1], cell)
    xs = _cells(values.shape[1], origin[0], cell)
    sums = np.add.reduceat(np.add.reduceat(values.astype(np.float64), ys, axis=0), xs, axis=1)
    rows = np.diff(np.append(ys, values.shape[0]))
    cols = np.diff(np.append(xs, values.shape[1]))
    return (sums / (rows[:, None] * cols[None, :])[..., None]).astype(np.float32)


def _interpolation(length, origin, cell, coarse_length):
    first = origin // cell
    position = (np.arange(length) + origin + .5) / cell - .5 - first
    base = np.floor(position).astype(np.int64)
    frac = (position - base).astype(np.float32)
    lo = np.clip(base, 0, coarse_length - 1)
    hi = np.clip(base + 1, 0, coarse_length - 1)
    return lo, hi, frac


def _interpolate(coarse, prepared_shape, origin, cell):
    """Bilinear from cell centres; the outermost samples clamp."""
    h, w = prepared_shape
    y0, y1, fy = _interpolation(h, origin[1], cell, coarse.shape[0])
    x0, x1, fx = _interpolation(w, origin[0], cell, coarse.shape[1])
    fx = fx[None, :, None] if coarse.ndim == 3 else fx[None, :]
    fy = fy[:, None, None] if coarse.ndim == 3 else fy[:, None]
    top = coarse[y0][:, x0] * (1 - fx) + coarse[y0][:, x1] * fx
    bottom = coarse[y1][:, x0] * (1 - fx) + coarse[y1][:, x1] * fx
    return (top * (1 - fy) + bottom * fy).astype(np.float32)


def prepare(rgb, scale=1.0, origin=(0, 0)):
    """Selection data that depends only on the stage input, not the controls."""
    geo = geometry(scale)
    origin = (int(origin[0]), int(origin[1]))
    lab = to_lab(np.asarray(rgb, dtype=np.float32)[..., :3]).astype(np.float32)
    light = np.maximum(np.abs(lab[..., 0]), 1e-6)
    ab = (lab[..., 1:3] / light[..., None]).astype(np.float32)
    guide = np.log2(np.maximum(light, 1e-4)).astype(np.float32)
    return prepare_fields(ab, guide, scale, origin)


def prepare_fields(ab, guide, scale=1.0, origin=(0, 0)):
    """``prepare`` from relative chroma (a/L, b/L) and log2 lightness."""
    geo = geometry(scale)
    origin = (int(origin[0]), int(origin[1]))
    coarse = _coarse_mean(ab, origin, geo.cell)
    kernel = np.exp(-.5 * (np.arange(-geo.taps, geo.taps + 1) / geo.sigma) ** 2)
    kernel = (kernel / kernel.sum()).astype(np.float32)
    coarse = cv2.sepFilter2D(coarse, -1, kernel, kernel, borderType=cv2.BORDER_REFLECT)
    # No bright-spot protection: small bright spots follow their surroundings
    # (Steve, 2026-10-27; excluding them left harsh dots when darkening).
    protection = np.ones(guide.shape, np.float32)
    return PreparedSelection(coarse, guide, protection, geo, origin)


def _qualify(chroma, ranges, floor):
    hue = np.degrees(np.arctan2(chroma[..., 1], chroma[..., 0]))
    inc = np.zeros_like(hue)
    exc = np.zeros_like(hue)
    for r in ranges:
        w = 1 - _smooth(r.width, r.width + r.feather, np.abs(_delta(hue, r.center)))
        if r.subtract:
            exc = np.maximum(exc, w)
        else:
            inc = np.maximum(inc, w)
    return (inc * (1 - exc) * _smooth(floor, floor + .04, np.linalg.norm(chroma, axis=-1))).astype(np.float32)


def select(prepared, ranges, floor=.02):
    """Coverage 0..1 at full resolution for one set of hue ranges."""
    geo, guide = prepared.geometry, prepared.guide
    low = _interpolate(_qualify(prepared.chroma, ranges, floor), guide.shape, prepared.origin, geo.cell)
    mean_i = _box(guide, geo.guide)
    mean_p = _box(low, geo.guide)
    variance = _box(guide * guide, geo.guide) - mean_i * mean_i
    a = (_box(guide * low, geo.guide) - mean_i * mean_p) / np.maximum(variance + GUIDE_EPSILON, GUIDE_EPSILON)
    b = mean_p - a * mean_i
    refined = _box(a, geo.guide) * guide + _box(b, geo.guide)
    return np.clip(refined * prepared.protection, 0, 1).astype(np.float32)


def hue_ranges(leaf):
    """Local hue-mask controls as one ordinary HSL range (the only adapter)."""
    from .hsl import HSLRange
    return [HSLRange(center=leaf.hue_center, width=leaf.hue_width, feather=leaf.hue_smoothness)]


def select_hue(prepared, leaf):
    """Local hue controls; combine/invert/opacity belongs to the mask owner."""
    if leaf.hue_center is None:
        return np.zeros(prepared.shape, np.float32)
    return select(prepared, hue_ranges(leaf), leaf.saturation_floor)
