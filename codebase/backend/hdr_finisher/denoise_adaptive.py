"""Adaptive denoise: a shift-invariant wavelet against a measured noise model.

The picture is split into five undecimated B3-spline ("a trous") bands in an
orthonormal luminance/opponent-colour basis. Each band coefficient is scaled by
a local Wiener gain -- how much of its neighbourhood's energy exceeds the noise
expected there -- so texture well above the noise survives and flat areas are
cleaned.

The noise expected at a pixel comes from a model measured on the picture
itself:

    variance(y) = c * y^2 + a * y + b          (y = scene-linear luminance)

``a`` is shot noise, ``b`` read noise and ``c`` relative noise, which is how
Monte Carlo render noise scales. Per band and per colour component a factor
turns that per-pixel sigma into the band's own noise level, which is what lets
one model describe sharpened exports, demosaiced raws and renders alike.

Everything is done in linear light against a per-pixel noise map rather than
through a variance-stabilising transform. That keeps the filter exactly neutral
where it removes nothing: at zero strength the output is the input.

Tiling is exact. The coarsest band reaches ``2 * (1 + 2 + 4 + 8 + 16)`` = 62
pixels and the Wiener window three more, so a tile computed from a scratch
region ``TILE_MARGIN`` wider on every side, with reflection applied only at the
frame's own edges, equals the whole-frame result over the tile. The WebGPU
preview implements the same arithmetic and the same edge rule.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np

ALGORITHM_VERSION = "adaptive-atrous-v1"
ACESCG_LUMINANCE = np.asarray((0.2722287, 0.6740818, 0.0536895), dtype=np.float32)
LEVELS = 5
WIENER_RADIUS = 3
TILE_SIZE = 512
TILE_MARGIN = 66
B3 = np.asarray((1.0, 4.0, 6.0, 4.0, 1.0), dtype=np.float32) / np.float32(16.0)
OPPONENT = np.asarray(
    (
        (1.0 / np.sqrt(3.0), 1.0 / np.sqrt(3.0), 1.0 / np.sqrt(3.0)),
        (1.0 / np.sqrt(2.0), 0.0, -1.0 / np.sqrt(2.0)),
        (1.0 / np.sqrt(6.0), -2.0 / np.sqrt(6.0), 1.0 / np.sqrt(6.0)),
    ),
    dtype=np.float32,
)
# Band 1 relative to band 0 ranges from ~0.17 (sharpened exports) through 0.23
# (white noise) to ~0.5-0.6 (demosaiced raw); it is measured and clamped to this
# range. Beyond band 1, noise decays per band by about the larger of 0.45 and
# that ratio: white noise and exports at 0.45, clumpy raw noise more slowly
# (DSC00264's colour noise at ~0.6), which is why a fixed 0.45 left its
# 8-16 px patches under-treated.
BAND_RATIO_RANGE = (0.15, 0.6)
COARSE_DECAY_RANGE = (0.45, 0.65)
# Estimation reads at most this many pixels, as evenly spaced tiles, so the
# analysis cost of a 42 MP export is bounded like that of a preview.
ESTIMATION_TILE = 256
ESTIMATION_MAX_TILES = 64


@dataclass(frozen=True)
class AdaptiveNoiseModel:
    a: float
    b: float
    c: float
    # [component (Y, C1, C2)][band], in units of the per-pixel model sigma.
    band_sigmas: tuple[tuple[float, ...], ...]

    def as_dict(self) -> dict:
        return {
            "algorithm_version": ALGORITHM_VERSION,
            "a": self.a,
            "b": self.b,
            "c": self.c,
            "band_sigmas": [list(row) for row in self.band_sigmas],
        }


@dataclass(frozen=True)
class AdaptiveControls:
    """The live controls, mapped so that 0.5 everywhere is the measured result.

    ``amount`` 0.5 removes the measured noise and 1.0 twice that. ``luminance``
    and ``color_noise`` scale their own components the same way. Detail
    Recovery below 0.5 cleans the two finest bands harder; above 0.5 it keeps a
    floor of those bands, grain included, which is what crisp edges need.

    ``fine_noise``, ``medium_noise`` and ``coarse_noise`` scale by noise size
    the same way, for both components: fine is bands 0-1 (~1-4 px), medium
    band 2 (~8 px), coarse bands 3-4 (~16-32 px). 0 leaves that size alone.
    """

    amount: float = 0.5
    luminance: float = 0.5
    color_noise: float = 0.5
    detail_recovery: float = 0.5
    fine_noise: float = 0.5
    medium_noise: float = 0.5
    coarse_noise: float = 0.5

    def size_multiplier(self, level: int) -> float:
        value = self.fine_noise if level < 2 else self.medium_noise if level == 2 else self.coarse_noise
        return 2.0 * float(value)

    def strengths(self) -> tuple[float, float]:
        overall = 2.0 * float(self.amount)
        return overall * 2.0 * float(self.luminance), overall * 2.0 * float(self.color_noise)

    def fine_band_multiplier(self) -> float:
        return 1.0 + max(0.0, 0.5 - float(self.detail_recovery))

    def fine_band_floor(self) -> float:
        return max(0.0, float(self.detail_recovery) - 0.5) * 0.6


# --------------------------------------------------------------------------
# Filters with frame-edge semantics


def _pad_axis(values: np.ndarray, axis: int, reach: int, frame_low: bool, frame_high: bool, frame_extent: int) -> np.ndarray:
    """Pad one axis by ``reach``: reflect at a frame edge, replicate at a tile edge.

    A tile edge is interior to the frame; what lies beyond it only affects the
    margin that the caller discards. Reflection needs the frame to be wider
    than the reach, as numpy's does, and falls back to replication otherwise.
    """
    reflect = frame_extent > reach
    pads = []
    for is_frame, side in ((frame_low, "low"), (frame_high, "high")):
        pads.append("reflect" if is_frame and reflect else "edge")
    width = [(0, 0)] * values.ndim
    if pads[0] == pads[1]:
        width[axis] = (reach, reach)
        return np.pad(values, width, mode=pads[0])
    width[axis] = (reach, 0)
    values = np.pad(values, width, mode=pads[0])
    width[axis] = (0, reach)
    return np.pad(values, width, mode=pads[1])


@dataclass(frozen=True)
class _Edges:
    top: bool
    bottom: bool
    left: bool
    right: bool
    frame_height: int
    frame_width: int


def _atrous(values: np.ndarray, level: int, edges: _Edges) -> np.ndarray:
    step = 2 ** level
    reach = 2 * step
    out = values
    for axis, low, high, extent in ((0, edges.top, edges.bottom, edges.frame_height), (1, edges.left, edges.right, edges.frame_width)):
        padded = _pad_axis(out, axis, reach, low, high, extent)
        size = out.shape[axis]
        acc = np.zeros_like(out)
        for tap, weight in enumerate(B3):
            index = [slice(None)] * out.ndim
            index[axis] = slice(tap * step, tap * step + size)
            acc += weight * padded[tuple(index)]
        out = acc
    return out


def _box(values: np.ndarray, radius: int) -> np.ndarray:
    """Mean over a (2r+1)^2 window, edge-replicated at every boundary."""
    out = values
    width = 2 * radius + 1
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (radius, radius)
        padded = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for tap in range(width):
            index = [slice(None)] * out.ndim
            index[axis] = slice(tap, tap + out.shape[axis])
            acc += padded[tuple(index)]
        out = acc / np.float32(width)
    return out


def _noise_variance(luminance: np.ndarray, model: AdaptiveNoiseModel, edges: _Edges) -> np.ndarray:
    smooth = _atrous(_atrous(luminance, 0, edges), 1, edges)
    y = np.maximum(smooth, 0.0)
    return np.maximum(np.float32(model.c) * y * y + np.float32(model.a) * y + np.float32(model.b), np.float32(1e-20))


def _filter_region(rgb: np.ndarray, model: AdaptiveNoiseModel, controls: AdaptiveControls, edges: _Edges) -> np.ndarray:
    luma_strength, chroma_strength = controls.strengths()
    fine_multiplier = controls.fine_band_multiplier()
    fine_floor = np.float32(controls.fine_band_floor())
    variance = _noise_variance(rgb @ ACESCG_LUMINANCE, model, edges)
    current = rgb @ OPPONENT.T
    out = np.zeros_like(current)
    for level in range(LEVELS):
        smooth = _atrous(current, level, edges)
        band = current - smooth
        energy = _box(band * band, WIENER_RADIUS)
        for component in range(3):
            strength = (luma_strength if component == 0 else chroma_strength) * controls.size_multiplier(level)
            if level < 2:
                strength *= fine_multiplier
            noise = np.float32((strength * model.band_sigmas[component][level]) ** 2) * variance
            e = energy[..., component]
            gain = np.maximum(e - noise, 0.0) / np.maximum(e, np.float32(1e-20))
            if level < 2 and fine_floor > 0:
                gain = np.maximum(gain, fine_floor)
            out[..., component] += band[..., component] * gain
        current = smooth
    out += current
    return (out @ OPPONENT).astype(np.float32)


def resolve_adaptive(image: np.ndarray, model: AdaptiveNoiseModel, controls: AdaptiveControls = AdaptiveControls()) -> np.ndarray:
    """Denoise ``image`` tile by tile; alpha, if present, passes through."""
    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3 or source.shape[2] not in (3, 4):
        raise ValueError("Denoise input must be an H x W scene-linear RGB or RGBA array.")
    if controls.amount <= 0.0 or (controls.luminance <= 0.0 and controls.color_noise <= 0.0):
        return source.copy()
    height, width = source.shape[:2]
    result = source.copy()

    def run(origin: tuple[int, int]) -> None:
        y0, x0 = origin
        y1 = min(height, y0 + TILE_SIZE)
        x1 = min(width, x0 + TILE_SIZE)
        sy0, sy1 = max(0, y0 - TILE_MARGIN), min(height, y1 + TILE_MARGIN)
        sx0, sx1 = max(0, x0 - TILE_MARGIN), min(width, x1 + TILE_MARGIN)
        edges = _Edges(sy0 == 0, sy1 == height, sx0 == 0, sx1 == width, height, width)
        filtered = _filter_region(source[sy0:sy1, sx0:sx1, :3], model, controls, edges)
        result[y0:y1, x0:x1, :3] = filtered[y0 - sy0:y1 - sy0, x0 - sx0:x1 - sx0]

    origins = [(y0, x0) for y0 in range(0, height, TILE_SIZE) for x0 in range(0, width, TILE_SIZE)]
    # Tiles read only the source and write disjoint rectangles, and numpy
    # releases the GIL for array arithmetic, so threads divide the work.
    workers = max(1, min(len(origins), (os.cpu_count() or 2) - 1, 8))
    if workers == 1:
        for origin in origins:
            run(origin)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(run, origins))
    if not np.isfinite(result).all():
        raise FloatingPointError("Adaptive denoise produced a non-finite value.")
    return result


# --------------------------------------------------------------------------
# Estimation


_IMMERKAER = np.asarray(((1, -2, 1), (-2, 4, -2), (1, -2, 1)), dtype=np.float32)
_SOBEL_X = np.asarray(((-1, 0, 1), (-2, 0, 2), (-1, 0, 1)), dtype=np.float32)
_BLOCK = 16
# Blocks with the least fine luminance structure that noise is read from.
FLAT_BLOCK_QUANTILE = 0.25


def _conv3(values: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    padded = np.pad(values, 1, mode="reflect" if min(values.shape) > 1 else "edge")
    height, width = values.shape
    return sum(kernel[i, j] * padded[i:i + height, j:j + width] for i in range(3) for j in range(3))


def _sample_tiles(height: int, width: int) -> list[tuple[int, int, int, int]]:
    """Evenly spaced estimation windows; the whole frame when it is small."""
    if height * width <= ESTIMATION_TILE * ESTIMATION_TILE * ESTIMATION_MAX_TILES:
        return [(0, 0, height, width)]
    per_side = int(np.floor(np.sqrt(ESTIMATION_MAX_TILES)))
    ys = np.linspace(0, height - ESTIMATION_TILE, per_side).astype(int)
    xs = np.linspace(0, width - ESTIMATION_TILE, per_side).astype(int)
    return [(int(y), int(x), int(y) + ESTIMATION_TILE, int(x) + ESTIMATION_TILE) for y in ys for x in xs]


def _fit_variance(xs: np.ndarray, vs: np.ndarray, ws: np.ndarray) -> tuple[float, float, float]:
    """Non-negative least squares for (c, a, b) by trying every subset of terms.

    Residuals are relative, so dark and bright bins count equally rather than
    the brightest variance dominating the fit.
    """
    weight = np.sqrt(ws) / np.maximum(vs, 1e-20)
    columns = {"c": xs * xs, "a": xs, "b": np.ones_like(xs)}
    best = None
    for mask in range(1, 8):
        names = [name for bit, name in enumerate("cab") if mask >> bit & 1]
        design = np.stack([columns[name] for name in names], axis=1) * weight[:, None]
        coef, *_ = np.linalg.lstsq(design, vs * weight, rcond=None)
        if np.any(coef < 0):
            continue
        residual = float(np.sum((design @ coef - vs * weight) ** 2))
        if best is None or residual < best[0] - 1e-9:
            best = (residual, dict(zip(names, coef)))
    terms = best[1] if best else {"b": float(np.median(vs))}
    b = max(float(terms.get("b", 0.0)), float(np.min(vs)) * 0.02, 1e-20)
    return float(terms.get("a", 0.0)), b, float(terms.get("c", 0.0))


def _estimate_variance_model(image: np.ndarray, windows) -> tuple[float, float, float]:
    """Immerkaer's mask cancels constant and linear structure; edges are dropped
    by the gradient of a smoothed copy; each brightness bin keeps the low end of
    the remaining spread. Only the *shape* of the model matters downstream."""
    ms, rs, gs = [], [], []
    for y0, x0, y1, x1 in windows:
        y = image[y0:y1, x0:x1, :3] @ ACESCG_LUMINANCE
        smooth = _conv3(y, np.full((3, 3), 1.0 / 9.0, dtype=np.float32))
        ms.append(smooth.ravel())
        rs.append(_conv3(y, _IMMERKAER).ravel())
        gs.append(np.hypot(_conv3(smooth, _SOBEL_X), _conv3(smooth, _SOBEL_X.T)).ravel())
    m, r, g = np.concatenate(ms), np.concatenate(rs), np.concatenate(gs)
    keep = m > 0
    m, r, g = m[keep], r[keep], g[keep]
    if m.size < 1000:
        return 0.0, 1e-8, 0.0
    spread_quantile = 0.25
    z = NormalDist().inv_cdf(0.5 + spread_quantile / 2.0)
    edges = np.quantile(m, np.linspace(0.02, 0.98, 13))
    xs, vs, ws = [], [], []
    for low, high in zip(edges[:-1], edges[1:]):
        selected = (m >= low) & (m < high)
        if selected.sum() < 500:
            continue
        flat = selected & (g <= np.quantile(g[selected], 0.3))
        std = np.quantile(np.abs(r[flat]), spread_quantile) / z / 6.0
        xs.append(float(np.median(m[flat])))
        vs.append(float(std * std))
        ws.append(float(flat.sum()))
    if len(xs) < 2:
        return 0.0, float(vs[0]) if vs else 1e-8, 0.0
    return _fit_variance(np.asarray(xs), np.asarray(vs), np.asarray(ws))


def _block_stds(values: np.ndarray) -> np.ndarray:
    bh, bw = values.shape[0] // _BLOCK, values.shape[1] // _BLOCK
    return values[:bh * _BLOCK, :bw * _BLOCK].reshape(bh, _BLOCK, bw, _BLOCK).std(axis=(1, 3)).ravel()


_CALIBRATION: dict[float, float] = {}


def _quantile_calibration(quantile: float) -> float:
    """1 / what the estimator's own procedure reads on unit white noise.

    The procedure keeps the quarter of blocks with the least fine-band spread
    and then takes a low quantile of those, so the calibration has to be
    measured through exactly that selection, not over every block.
    """
    if quantile not in _CALIBRATION:
        noise = np.random.default_rng(11).standard_normal((2048, 2048)).astype(np.float32)
        stds = _block_stds(noise)
        flat = stds <= np.quantile(stds, FLAT_BLOCK_QUANTILE)
        _CALIBRATION[quantile] = 1.0 / float(np.quantile(stds[flat], quantile))
    return _CALIBRATION[quantile]


def estimate_adaptive_model(image: np.ndarray) -> AdaptiveNoiseModel:
    source = np.asarray(image, dtype=np.float32)
    height, width = source.shape[:2]
    windows = _sample_tiles(height, width)
    a, b, c = _estimate_variance_model(source, windows)
    partial = AdaptiveNoiseModel(a=a, b=b, c=c, band_sigmas=((0.0,) * LEVELS,) * 3)
    luma0, fine, coarse = [], [[], [], []], [[], [], []]
    for y0, x0, y1, x1 in windows:
        rgb = source[y0:y1, x0:x1, :3]
        edges = _Edges(y0 == 0, y1 == height, x0 == 0, x1 == width, height, width)
        sigma = np.sqrt(_noise_variance(rgb @ ACESCG_LUMINANCE, partial, edges))[..., None]
        current = rgb @ OPPONENT.T
        smooth0 = _atrous(current, 0, edges)
        smooth1 = _atrous(smooth0, 1, edges)
        band0 = (current - smooth0) / sigma
        band1 = (smooth0 - smooth1) / sigma
        luma0.append(_block_stds(band0[..., 0]))
        for component in range(3):
            fine[component].append(_block_stds(band0[..., component]))
            coarse[component].append(_block_stds(band1[..., component]))
    luma0_all = np.concatenate(luma0)
    flat = luma0_all <= np.quantile(luma0_all, FLAT_BLOCK_QUANTILE)
    quantile = 0.10
    calibration = _quantile_calibration(quantile)
    rows = []
    for component in range(3):
        s0 = float(np.quantile(np.concatenate(fine[component])[flat], quantile) * calibration)
        s1 = float(np.quantile(np.concatenate(coarse[component])[flat], quantile) * calibration)
        ratio = float(np.clip(s1 / max(s0, 1e-12), *BAND_RATIO_RANGE))
        decay = float(np.clip(ratio, *COARSE_DECAY_RANGE))
        rows.append(tuple([s0] + [s0 * ratio * decay ** (level - 1) for level in range(1, LEVELS)]))
    return AdaptiveNoiseModel(a=a, b=b, c=c, band_sigmas=tuple(rows))
