"""Bayer noise estimation and optional hot-pixel cleanup before demosaic."""
from __future__ import annotations

import numpy as np

from .denoise_quality import BAYER_NOISE_REFERENCE, enabled

HOT_SIGMA = 8.0
LIGHT_SIGMA = 2.5
MINIMUM_EXCESS = 0.02
CLIP_GUARD = 0.98
HALO = 4
STRIP_ROWS = 256
OFFSETS = ((-2, -2), (-2, 0), (-2, 2), (0, -2),
           (0, 2), (2, -2), (2, 0), (2, 2))
DIRECTIONS = ((0, 2), (2, 0), (2, 2), (2, -2))


def cleanup_thresholds():
    """The second CPU/WGSL slot is an absolute floor or a negative noise multiplier."""
    minimum_excess = -MINIMUM_EXCESS / BAYER_NOISE_REFERENCE if enabled("RAW_LEVELS") else MINIMUM_EXCESS
    return [HOT_SIGMA, minimum_excess, LIGHT_SIGMA, CLIP_GUARD]


def _normalise(sensor, black, spans):
    image = np.asarray(sensor, dtype=np.float32).copy()
    for phase in range(4):
        plane = image[phase // 2::2, phase % 2::2]
        plane -= black[phase]
        plane *= np.float32(1.0) / spans[phase]
    return image


def _fit(observations):
    from .denoise_adaptive import CALIBRATION_RULES

    if len(observations) < 12:
        return None
    values = np.asarray(observations, dtype=np.float64)
    selected = []
    counts = []
    for group in np.array_split(values[np.argsort(values[:, 0])], min(12, len(values) // 8)):
        quiet = group[group[:, 2] <= np.quantile(group[:, 2], 0.5)]
        selected.append((np.median(quiet[:, 0]), np.quantile(quiet[:, 1], 0.25)))
        counts.append(len(quiet))
    signal, variance = np.asarray(selected).T
    signal_scale = max(float(signal.max()), 1e-20)
    variance_scale = float(np.median(variance))
    signal, variance = signal / signal_scale, variance / variance_scale
    weights = np.sqrt(counts) / np.maximum(variance, CALIBRATION_RULES["variance_floor"])
    design = np.column_stack((signal, np.ones_like(signal))) * weights[:, None]
    target = variance * weights
    choices = []
    for terms in ([0, 1], [0], [1]):
        coefficients = np.linalg.lstsq(design[:, terms], target, rcond=None)[0]
        if not np.isfinite(coefficients).all() or np.any(coefficients < 0):
            continue
        pair = np.zeros(2)
        pair[terms] = coefficients
        choices.append(pair)
    if not choices:
        return None
    shot, read = min(choices, key=lambda pair: np.sum((design @ pair - target) ** 2))
    if shot + read <= 0:
        return None
    return dict(a=float(shot * variance_scale / signal_scale), b=float(read * variance_scale))


def configuration(sensor, metadata, *, cancelled=None):
    """Estimate per-phase Bayer noise from nine bounded crops, including deep shadows."""
    pattern = metadata.raw_pattern
    if pattern.shape != (2, 2):
        return None
    colours = metadata.raw_channel_to_rgb[pattern].ravel()
    if sorted(colours.tolist()) != [0, 1, 1, 2]:
        return None
    black = metadata.raw_black_level[pattern].astype(np.float32).ravel()
    spans = (metadata.raw_white_level[pattern] - metadata.raw_black_level[pattern]).astype(np.float32).ravel()
    if not np.isfinite(spans).all() or np.any(spans <= 0):
        return None
    size = min(512, *sensor.shape) // 2 * 2
    coordinates = np.indices((16, 16))
    design = np.column_stack((np.ones(256), coordinates[1].ravel(), coordinates[0].ravel()))
    inverse = np.linalg.pinv(design)
    observations = [[] for _ in range(4)]
    for fraction_row in (0.15, 0.5, 0.85):
        for fraction_column in (0.15, 0.5, 0.85):
            if cancelled is not None and cancelled():
                raise InterruptedError("RAW development cancelled")
            top = int((sensor.shape[0] - size) * fraction_row) // 2 * 2
            left = int((sensor.shape[1] - size) * fraction_column) // 2 * 2
            crop = _normalise(sensor[top:top + size, left:left + size], black, spans)
            for phase in range(4):
                plane = crop[phase // 2::2, phase % 2::2]
                for row in range(0, len(plane) - 15, 16):
                    for column in range(0, plane.shape[1] - 15, 16):
                        block = plane[row:row + 16, column:column + 16].ravel().astype(float)
                        residual = (block - design @ (inverse @ block)).reshape(16, 16)
                        variance = np.sum(residual ** 2) / 253
                        mean = block.mean()
                        if mean < 0.85 and variance > 0:
                            correlation = abs(np.mean(residual[:, 1:] * residual[:, :-1])) + abs(np.mean(residual[1:] * residual[:-1]))
                            observations[phase].append((max(mean, 0), variance, correlation / variance))
    noise = [_fit(phase) for phase in observations]
    if any(phase is None for phase in noise):
        return None
    return dict(noise=noise, black=black.tolist(), spans=spans.tolist(), colours=colours.tolist(),
                thresholds=cleanup_thresholds(),
                confidence="single-frame per-CFA estimate; not a camera calibration")


def filter_sensor(mosaic, config):
    """Return repaired signed samples, reading only the unchanged input."""
    image = np.asarray(mosaic, dtype=np.float32)
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError("Expected finite signed normalized Bayer samples")
    result = image.copy()
    if config is None or min(image.shape) < 2 * HALO + 1:
        return result
    colours = config['colours']
    noise = np.asarray([[phase['a'], phase['b']] for phase in config['noise']], dtype=np.float32)
    steps = np.float32(1.0) / np.asarray(config['spans'], dtype=np.float32)
    minimum_excess = config.get('thresholds', (HOT_SIGMA, MINIMUM_EXCESS))[1]
    height, width = image.shape
    for phase, (shot, read) in enumerate(noise):
        first_row = HALO + phase // 2
        first_column = HALO + phase % 2
        centre = image[first_row:height - HALO:2, first_column:width - HALO:2]
        largest = np.full_like(centre, -np.inf)
        for delta_row, delta_column in OFFSETS:
            np.maximum(largest, image[first_row + delta_row:height - HALO + delta_row:2,
                                      first_column + delta_column:width - HALO + delta_column:2], out=largest)
        variance = shot * np.maximum(centre, 0) + read + steps[phase] ** 2 / 12
        floor = (np.float32(-minimum_excess) * np.sqrt(read + steps[phase] ** 2 / 12)
                 if minimum_excess < 0 else MINIMUM_EXCESS)
        proposed = centre - largest > np.maximum(HOT_SIGMA * np.sqrt(variance), floor)
        for local_row, local_column in zip(*np.nonzero(proposed)):
            row = first_row + 2 * int(local_row)
            column = first_column + 2 * int(local_column)
            if np.max(image[row - 2:row + 3, column - 2:column + 3]) >= CLIP_GUARD:
                continue
            light = False
            for delta_row in (-1, 0, 1):
                for delta_column in (-1, 0, 1):
                    support_row, support_column = row + delta_row, column + delta_column
                    support_phase = (support_row % 2) * 2 + support_column % 2
                    if colours[support_phase] == colours[phase]:
                        continue
                    support = float(image[support_row, support_column])
                    background = float(np.median([image[support_row + offset_row, support_column + offset_column]
                                                  for offset_row, offset_column in OFFSETS]))
                    support_shot, support_read = noise[support_phase]
                    sigma = np.sqrt(support_shot * max(support, background, 0) + support_read + steps[support_phase] ** 2 / 12)
                    if support - background > max(LIGHT_SIGMA * sigma, 2 * steps[support_phase]):
                        light = True
            if not light:
                pairs = [(float(image[row - delta_row, column - delta_column]),
                          float(image[row + delta_row, column + delta_column])) for delta_row, delta_column in DIRECTIONS]
                first, second = min(pairs, key=lambda pair: abs(pair[0] - pair[1]))
                result[row, column] = 0.5 * (first + second)
    return result


def apply(sensor, config, *, cancelled=None):
    """Repair LibRaw's DN buffer using strips and original four-row seam context."""
    if config is None:
        return 0
    black = np.asarray(config['black'], dtype=np.float32)
    spans = np.asarray(config['spans'], dtype=np.float32)
    height = len(sensor)
    previous = None
    repaired = 0
    for top in range(0, height, STRIP_ROWS):
        if cancelled is not None and cancelled():
            raise InterruptedError("RAW development cancelled")
        bottom = min(height, top + STRIP_ROWS)
        first, last = max(0, top - HALO), min(height, bottom + HALO)
        original = _normalise(sensor[first:last], black, spans)
        if previous is not None:
            original[:HALO] = previous
        previous = original[bottom - first - HALO:bottom - first].copy()
        filtered = filter_sensor(original, config)
        for phase in range(4):
            rows = slice(top - first + phase // 2, bottom - first, 2)
            columns = slice(phase % 2, None, 2)
            before, after = original[rows, columns], filtered[rows, columns]
            changed = before != after
            destination = sensor[top + phase // 2:bottom:2, columns]
            encoded = np.clip(np.rint(after[changed].astype(np.float64) * spans[phase] + black[phase]), 0, 65535).astype(np.uint16)
            repaired += int(np.count_nonzero(encoded != destination[changed]))
            destination[changed] = encoded
    return repaired


def apply_raw(raw, metadata, settings, *, cancelled=None):
    enabled = settings.pixel_cleanup.remove_hot_pixels
    diagnostic = dict(enabled=enabled, supported=metadata.raw_pattern.shape == (2, 2), repaired=0,
                      stage="signed_normalized_sensor_before_opposed_color")
    diagnostic.update(specks_enabled=settings.pixel_cleanup.even_out_specks, tamed=0)
    if (enabled or settings.pixel_cleanup.even_out_specks) and diagnostic['supported']:
        config = configuration(raw.raw_image_visible, metadata, cancelled=cancelled)
        diagnostic['noise_supported'] = config is not None
        if enabled:
            diagnostic['repaired'] = apply(raw.raw_image_visible, config, cancelled=cancelled)
        if settings.pixel_cleanup.even_out_specks:
            from .raw_speck_cleanup import apply as tame
            diagnostic['tamed'] = tame(raw.raw_image_visible, config,
                settings.pixel_cleanup.speck_threshold, cancelled=cancelled)
    return diagnostic
