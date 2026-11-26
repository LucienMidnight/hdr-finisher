"""Optional signed Bayer noise-tail clamp, shared before CPU/GPU development."""
from __future__ import annotations

import cv2
import numpy as np

from .raw_pixel_cleanup import CANDIDATE_BATCH, STRIP_ROWS, _normalise, _store_repairs
from .denoise_quality import BAYER_NOISE_REFERENCE, enabled

ABSOLUTE_FLOOR = .005
ENVELOPE = 1.5
STRENGTH = .75
MAX_AREA = 5
BORDER = 4  # Same-phase pixels, as in the research (eight sensor pixels).
CONTEXT = 24  # Two medians + a six-sample component witness, in sensor rows.
LIGHT_SIGMA = 3.5
LIGHT_FLOOR = .005
LIGHT_NEIGHBOURHOOD = np.ones((3, 3), np.uint8)
LIGHT_MARGIN = np.ones((5, 5), np.uint8)
SUPPORT_OFFSETS = tuple((row, column) for row in range(-2, 3) for column in range(-2, 3) if row or column)


def tame_plane(plane, shot, read, threshold=2.5, *, absolute_floor=ABSOLUTE_FLOOR,
               light_evidence=None, light_floor=LIGHT_FLOOR):
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
    if light_evidence is not None:
        light_evidence[:] = (residual > light_floor) & (distance > LIGHT_SIGMA)
    candidates = distance > threshold
    clipped = source >= .98
    if clipped.any():
        candidates &= ~cv2.dilate(clipped.astype(np.uint8), LIGHT_MARGIN).astype(bool)
    candidates[:BORDER] = candidates[-BORDER:] = False
    candidates[:, :BORDER] = candidates[:, -BORDER:] = False
    result = source.copy()
    if not candidates.any():
        return result
    eligible = candidates.copy()
    for polarity in (residual > 0, residual < 0):
        same_sign = candidates & polarity
        if not same_sign.any():
            continue
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            same_sign.astype(np.uint8), connectivity=8)
        rejected = np.zeros(count, bool)
        rejected[1:] = stats[1:, cv2.CC_STAT_AREA] > MAX_AREA
        eligible &= ~rejected[labels]
    rows, columns = np.nonzero(eligible & (np.abs(residual) > absolute_floor))
    for start in range(0, len(rows), CANDIDATE_BATCH):
        batch = slice(start, start + CANDIDATE_BATCH)
        batch_rows, batch_columns = rows[batch], columns[batch]
        samples = source[batch_rows, batch_columns]
        noise = sigma[batch_rows, batch_columns]
        support = np.zeros(len(samples), np.uint8)
        for delta_row, delta_column in SUPPORT_OFFSETS:
            neighbours = source[batch_rows + delta_row, batch_columns + delta_column]
            support += np.abs(neighbours - samples) <= noise
        isolated = support < 2
        sites = batch_rows[isolated], batch_columns[isolated]
        ramp = np.clip((distance[sites] - threshold) / (threshold - ENVELOPE), 0, 1)
        ramp *= ramp * (3 - 2 * ramp)
        tail = residual[sites]
        correction = np.sign(tail) * np.maximum(np.abs(tail) - ENVELOPE * noise[isolated], 0)
        result[sites] = samples[isolated] - STRENGTH * ramp * correction
    return result


def filter_sensor(mosaic, config, threshold=2.5, *, absolute_floor=ABSOLUTE_FLOOR):
    image = np.asarray(mosaic, dtype=np.float32)
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError('Expected finite signed normalized Bayer samples')
    result = image.copy()
    if config is None:
        return result
    if len(config['noise']) != 4 or sorted(config['colours']) != [0, 1, 1, 2]:
        raise ValueError('Four Bayer noise phases required')
    evidence = np.zeros((3, *image.shape), dtype=np.uint8)
    relative = enabled("RAW_LEVELS")
    for phase, (noise, colour) in enumerate(zip(config['noise'], config['colours'])):
        rows, columns = slice(phase // 2, None, 2), slice(phase % 2, None, 2)
        scale = (np.sqrt(noise['b'] + (1 / config['spans'][phase]) ** 2 / 12) / BAYER_NOISE_REFERENCE
                 if relative else 1)
        result[rows, columns] = tame_plane(image[rows, columns], noise['a'], noise['b'], threshold,
                                          absolute_floor=absolute_floor * scale, light_floor=LIGHT_FLOOR * scale,
                                          light_evidence=evidence[colour, rows, columns])
    # Bayer samples are staggered. Look for positive detail in all three
    # colours within one sensor pixel, then protect the edge of that light.
    light = cv2.dilate(evidence[0], LIGHT_NEIGHBOURHOOD)
    for channel in evidence[1:]:
        light &= cv2.dilate(channel, LIGHT_NEIGHBOURHOOD)
    light = cv2.dilate(light, LIGHT_MARGIN).astype(bool)
    # Only restore readings reduced by the positive clamp. Dark specks still
    # use the original rule, even beside a light.
    np.copyto(result, image, where=light & (result < image))
    return result


def apply(sensor, config, threshold=2.5, *, cancelled=None, absolute_floor=ABSOLUTE_FLOOR, repairs=None):
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
            first_row, first_column = top + phase // 2, phase % 2
            rows, columns = slice(first_row - first, bottom - first, 2), slice(first_column, None, 2)
            before, after = original[rows, columns], filtered[rows, columns]
            changed_rows, changed_columns = np.nonzero(before != after)
            changed_count += _store_repairs(sensor, changed_rows * 2 + first_row, changed_columns * 2 + first_column,
                after[changed_rows, changed_columns], black[phase], spans[phase], repairs)
    return changed_count
