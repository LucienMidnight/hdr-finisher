"""Optional signed Bayer noise-tail clamp, shared before CPU/GPU development."""
from __future__ import annotations

import cv2
import numpy as np

from .raw_pixel_cleanup import STRIP_ROWS, _normalise

ABSOLUTE_FLOOR = .005
ENVELOPE = 1.5
STRENGTH = .75
MAX_AREA = 5
BORDER = 4  # Same-phase pixels, as in the research (eight sensor pixels).
CONTEXT = 24  # Two medians + a six-sample component witness, in sensor rows.


def tame_plane(plane, shot, read, threshold=2.5, *, absolute_floor=ABSOLUTE_FLOOR):
    """Soften both signed tails, never replace a median.

    The floor can be overridden for qualification, not through the app. Count component
    size before the always-on neighbour-similarity veto, reading unchanged input.
    """
    source = np.asarray(plane, dtype=np.float32)
    if (source.ndim != 2 or not np.isfinite(source).all()
            or not np.isfinite([shot, read, threshold, absolute_floor]).all()
            or min(shot, read, absolute_floor) < 0 or shot + read <= 0
            or not 2 <= threshold <= 4):
        raise ValueError('Expected finite signed plane, noise model and threshold 2–4')
    if min(source.shape) < 2 * BORDER + 1:
        return source.copy()
    centre = cv2.medianBlur(source, 5)
    sigma = np.maximum(np.sqrt(shot * np.maximum(centre, 0) + read),
                       cv2.medianBlur(np.abs(source - centre), 5) * np.float32(1.4826))
    np.maximum(sigma, np.float32(1e-12), out=sigma)
    residual = source - centre
    distance = np.abs(residual) / sigma
    candidates = distance > threshold
    candidates &= ~cv2.dilate((source >= .98).astype('uint8'), np.ones((5, 5), 'uint8')).astype(bool)
    candidates[:BORDER] = candidates[-BORDER:] = False
    candidates[:, :BORDER] = candidates[:, -BORDER:] = False
    eligible = candidates.copy()
    for polarity in (residual > 0, residual < 0):
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            (candidates & polarity).astype('uint8'), connectivity=8)
        rejected = np.zeros(count, bool)
        rejected[1:] = stats[1:, cv2.CC_STAT_AREA] > MAX_AREA
        eligible &= ~rejected[labels]
    support = np.zeros(source.shape, np.uint8)
    padded = np.pad(source, 2, mode='reflect')
    height, width = source.shape
    for row in range(5):
        for column in range(5):
            if row == column == 2:
                continue
            support += np.abs(padded[row:row + height, column:column + width] - source) <= sigma
    eligible &= (support < 2) & (np.abs(residual) > absolute_floor)
    ramp = np.clip((distance - threshold) / (threshold - ENVELOPE), 0, 1)
    ramp *= ramp * (3 - 2 * ramp)
    correction = np.sign(residual) * np.maximum(np.abs(residual) - ENVELOPE * sigma, 0)
    return (source - np.where(eligible, STRENGTH * ramp * correction, 0)).astype(np.float32)


def filter_sensor(mosaic, config, threshold=2.5, *, absolute_floor=ABSOLUTE_FLOOR):
    image = np.asarray(mosaic, dtype=np.float32)
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError('Expected finite signed normalized Bayer samples')
    result = image.copy()
    if config is None:
        return result
    if len(config['noise']) != 4 or sorted(config['colours']) != [0, 1, 1, 2]:
        raise ValueError('Four Bayer noise phases required')
    for phase, noise in enumerate(config['noise']):
        rows, columns = slice(phase // 2, None, 2), slice(phase % 2, None, 2)
        result[rows, columns] = tame_plane(image[rows, columns], noise['a'], noise['b'], threshold,
                                          absolute_floor=absolute_floor)
    return result


def apply(sensor, config, threshold=2.5, *, cancelled=None, absolute_floor=ABSOLUTE_FLOOR):
    """Encode changed readings into the existing DN buffer in bounded strips.

    Signed black-subtracted readings stay signed after DN rounding. Original
    context across seams prevents a previous strip influencing the next one.
    """
    if config is None:
        return 0
    black, spans = (np.asarray(config[key], np.float32) for key in ('black', 'spans'))
    height = len(sensor)
    previous = None
    changed_count = 0
    for top in range(0, height, STRIP_ROWS):
        if cancelled is not None and cancelled():
            raise InterruptedError('RAW development cancelled')
        bottom = min(height, top + STRIP_ROWS)
        first, last = max(0, top - CONTEXT), min(height, bottom + CONTEXT)
        original = _normalise(sensor[first:last], black, spans)
        if previous is not None:
            original[:len(previous)] = previous
        previous = original[max(0, bottom - first - CONTEXT):bottom - first].copy()
        filtered = filter_sensor(original, config, threshold, absolute_floor=absolute_floor)
        for phase in range(4):
            rows, columns = slice(top - first + phase // 2, bottom - first, 2), slice(phase % 2, None, 2)
            before, after = original[rows, columns], filtered[rows, columns]
            changed = before != after
            destination = sensor[top + phase // 2:bottom:2, columns]
            encoded = np.clip(np.rint(after[changed].astype(float) * spans[phase] + black[phase]), 0, 65535).astype(np.uint16)
            changed_count += int(np.count_nonzero(encoded != destination[changed]))
            destination[changed] = encoded
    return changed_count
