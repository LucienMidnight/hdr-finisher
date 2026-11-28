"""Seeded dye/silver fields, integrated over the output pixel's box.

Random lattice values are reconstructed with a separable tent. Its analytic
integral gives each node's weight without supersampling, including when one
pixel sees several nodes. Coordinates and spacing are both in the full
render frame, so moving or splitting a render cannot move the field.
"""
from __future__ import annotations

import numpy as np

from .grain_work import checkpoint

UNIT_RMS = np.float32(0.37)
# Spacing relative to the old Poisson cell size (not the old grain radius).
NODE_SPACING = np.float32(0.43)
F32 = np.float32


def _mix(x):
    x = np.asarray(x, dtype=np.uint32)
    x = x ^ (x >> np.uint32(16))
    x = x * np.uint32(0x7FEB352D)
    x ^= x >> np.uint32(15)
    x *= np.uint32(0x846CA68B)
    x ^= x >> np.uint32(16)
    return x


def seed_hash(seed: int, salt: int):
    return _mix(np.array([(int(seed) + salt * 0x9E3779B9) & 0xFFFFFFFF], dtype=np.uint32))[0]


def _tent_cdf(x):
    edge = F32(1) - np.minimum(np.abs(x), F32(1))
    area = F32(0.5) * edge * edge
    return np.where(x < 0, area, F32(1) - area)


def _axis(origin: int, count: int, pitch: np.float32):
    coordinate = (np.arange(origin, origin + count, dtype=F32) + F32(0.5)) / pitch
    footprint = F32(1) / pitch
    half = F32(0.5) * footprint
    start = np.floor(coordinate - half).astype(np.int32)
    end = np.ceil(coordinate + half).astype(np.int32)
    # The first and last nodes may be less than one step outside the box;
    # a tent centred further out cannot contribute.
    nodes = start[None, :] + np.arange(int((end - start).max()) + 1, dtype=np.int32)[:, None]
    delta = coordinate[None, :] - nodes.astype(F32)
    weights = (_tent_cdf(delta + half) - _tent_cdf(delta - half)) * pitch
    return nodes, weights


def _layer_features(left, top, height, width, pitch, seeded):
    # A pixel can overlap more lattice nodes on a deep reduction. Limit the
    # lattice, not only the output rows, so even a single very wide row is
    # safe. These scratch blocks do not survive a call or share across jobs.
    pixel_budget = max(1, int(131072 * float(min(pitch, F32(1))) ** 2))
    result = np.empty((height, width, 2), dtype=F32)
    for x in range(0, width, pixel_budget):
        _filter_columns(left + x, top, pitch, seeded, pixel_budget, result[:, x:x + pixel_budget])
    checkpoint()
    return result


def _filter_columns(left, top, pitch, seeded, pixel_budget, result):
    height, width = result.shape[:2]
    cols, wx = _axis(left, width, pitch)
    rows_per_band = max(1, min(height, pixel_budget // width))
    c0 = int(cols.min())
    c1 = int(cols.max()) + 1
    cols = cols - c0
    col_key = _mix(seeded ^ np.arange(c0, c1, dtype=np.int32).astype(np.uint32))
    for start in range(0, height, rows_per_band):
        checkpoint()
        end = min(start + rows_per_band, height)
        rows, wy = _axis(top + start, end - start, pitch)
        r0 = int(rows.min())
        r1 = int(rows.max()) + 1
        row_ids = np.arange(r0, r1, dtype=np.int32).astype(np.uint32)
        values = (_mix(col_key[None, :] ^ row_ids[:, None]) >> np.uint32(8)).astype(F32) * F32(1 / 8388608) - F32(1)
        squares = values * values
        features = np.stack((np.copysign(squares, values), squares - F32(1 / 3)), axis=-1)
        horizontal = np.zeros((len(row_ids), width, 2), dtype=F32)
        for column, weight in zip(cols, wx):
            horizontal += features[:, column] * weight[None, :, None]
        band = result[start:end]
        band.fill(0.0)
        for row, weight in zip(rows, wy):
            band += horizontal[row - r0] * weight[:, None, None]


def _layer(signal, left, top, pitch, scale, seed, salt, monochrome):
    field = _layer_features(left, top, *signal.shape, pitch, seed_hash(seed, salt))
    # A fixed pair of random moments is shaped *after* the footprint
    # integral, keeping the same specks as exposure changes.
    skew = F32(1.35) * (F32(1) - signal) ** 2 - F32(0.95 if monochrome else 0.42) * signal
    # Node variance is 1/5 for the odd term and 4/45 for the even term.
    # Calibrate Amount at the native scan, not independently at every zoom.
    ratio = F32(0.58) * scale / pitch
    native_gain = np.sqrt(F32(1) + ratio * ratio)
    normal = F32(3.35) * native_gain / np.sqrt(F32(1) + F32(4 / 9) * skew * skew)
    develop = F32(0.06) + F32(0.88) * signal
    contrast = np.sqrt(np.sqrt(develop / F32(0.5))) * (
        F32(1) - F32(0.58 if monochrome else 0.40) * (develop - F32(0.5)))
    return (field[..., 0] + skew * field[..., 1]) * (normal * contrast)


def preview_grain_noise(signals, luma_signal, luma_weights, left, top, physical_pitch,
                        seed, film_type_name, softness, chroma, *, preview_scale=1.0):
    """Return per-channel grain before Amount and Shadow/Midtone/Highlight response."""
    scale = F32(min(1.0, max(0.05, preview_scale)))
    pitch = F32(physical_pitch)
    monochrome = film_type_name == "black_and_white"
    # Soft edges correspond to finer, less contrasted structures in the
    # original grain profile. The setting acts identically at every zoom.
    spacing = NODE_SPACING * (F32(1.11) - F32(0.22) * F32(softness))
    if monochrome:
        silver_pitch = max(scale, pitch)
        mono = _layer(luma_signal, left, top, spacing * silver_pitch, scale, seed, 239, True)
        # Silver's dark clumps are wider than its individual grains. A second,
        # independently seeded band restores their low-frequency contrast at
        # Fit without changing native pitch or inventing a preview-only field.
        shadow = (F32(1) - luma_signal) ** 2
        if np.any(shadow):
            mottle = _layer_features(left, top, *luma_signal.shape, F32(1.5) * silver_pitch, seed_hash(seed, 341))
            mono += (F32(3.35 * 0.46) * shadow) * mottle[..., 0]
        return np.repeat((mono * UNIT_RMS)[..., None], 3, axis=-1)
    layers = np.stack([
        _layer(signals[..., channel], left, top, spacing * max(scale, pitch * F32(size)),
               scale, seed, salt, False)
        for channel, size, salt in ((0, 0.9, 211), (1, 1.0, 223), (2, 1.3, 227))
    ], axis=-1)
    weights = np.asarray(luma_weights, dtype=F32)
    mono = ((layers[..., 0] * weights[0] + layers[..., 1] * weights[1]) + layers[..., 2] * weights[2]) / F32(0.749615)
    spread = np.asarray(chroma, dtype=F32)[..., None] * F32(0.6)
    return (mono[..., None] + spread * (layers - mono[..., None])) * UNIT_RMS
