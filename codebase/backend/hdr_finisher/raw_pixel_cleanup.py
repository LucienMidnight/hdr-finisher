"""Bayer noise estimation and optional hot-pixel cleanup before demosaic."""
from __future__ import annotations

from collections import OrderedDict
from hashlib import sha256
from threading import Lock

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
CANDIDATE_BATCH = 65_536
CACHE_BYTES = 24 * 1024 * 1024
CACHE_ENTRIES = 16


class _CleanupCache:
    def __init__(self):
        self.entries = OrderedDict()
        self.bytes = 0
        self.lock = Lock()

    def get(self, key, default):
        with self.lock:
            if key not in self.entries:
                return default
            self.entries.move_to_end(key)
            return self.entries[key][0]

    def put(self, key, value, size=0):
        with self.lock:
            if key in self.entries:
                self.bytes -= self.entries.pop(key)[1]
            self.entries[key] = value, size
            self.bytes += size
            while self.bytes > CACHE_BYTES or len(self.entries) > CACHE_ENTRIES:
                self.bytes -= self.entries.popitem(last=False)[1][1]


class _Repairs:
    def __init__(self, sensor):
        self.width = sensor.shape[1]
        self.index_type = np.int32 if sensor.size <= np.iinfo(np.int32).max else np.int64
        self.size = 0
        self.parts = []

    def append(self, rows, columns, values):
        if self.parts is None or not len(values):
            return
        self.size += values.nbytes + len(values) * np.dtype(self.index_type).itemsize
        if self.size > CACHE_BYTES:
            self.parts = None
            return
        positions = (rows * self.width + columns).astype(self.index_type, copy=False)
        self.parts.append((positions, values))


_cleanup_cache = _CleanupCache()
_MISSING = object()


def source_stamp(path):
    """Use the same file identity fields as the decoded-source cache."""
    try:
        stat = path.stat()
    except OSError:
        return None
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def _check_cancelled(cancelled):
    if cancelled is not None and cancelled():
        raise InterruptedError("RAW development cancelled")


def _sensor_digest(sensor, cancelled):
    """Fingerprint the visible samples without copying the whole mosaic."""
    digest = sha256()
    for top in range(0, len(sensor), STRIP_ROWS):
        _check_cancelled(cancelled)
        digest.update(np.ascontiguousarray(sensor[top:top + STRIP_ROWS]))
    return digest.digest()


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
    _validate_sensor(image)
    result = image.copy()
    for _, rows, columns, values in _hot_repairs(image, config):
        result[rows, columns] = values
    return result


def _validate_sensor(image):
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError("Expected finite signed normalized Bayer samples")


def _hot_repairs(image, config):
    if config is None or min(image.shape) < 2 * HALO + 1:
        return
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
        local_rows, local_columns = np.nonzero(proposed)
        for start in range(0, len(local_rows), CANDIDATE_BATCH):
            batch = slice(start, start + CANDIDATE_BATCH)
            rows = first_row + 2 * local_rows[batch]
            columns = first_column + 2 * local_columns[batch]
            rows, columns = _vetted_hot_sites(image, rows, columns, phase, colours, noise, steps)
            if len(rows):
                first = np.stack([image[rows - dy, columns - dx] for dy, dx in DIRECTIONS]).astype(np.float64)
                second = np.stack([image[rows + dy, columns + dx] for dy, dx in DIRECTIONS]).astype(np.float64)
                best = np.argmin(np.abs(first - second), axis=0, keepdims=True)
                first = np.take_along_axis(first, best, axis=0)[0]
                second = np.take_along_axis(second, best, axis=0)[0]
                yield phase, rows, columns, (0.5 * (first + second)).astype(np.float32)


def _vetted_hot_sites(image, rows, columns, phase, colours, noise, steps):
    maximum = np.full(len(rows), -np.inf, dtype=np.float32)
    for delta_row in range(-2, 3):
        for delta_column in range(-2, 3):
            np.maximum(maximum, image[rows + delta_row, columns + delta_column], out=maximum)
    comparison_type = np.asarray(np.float32(0) + CLIP_GUARD).dtype
    safe = maximum.astype(comparison_type, copy=False) < CLIP_GUARD
    rows, columns = rows[safe], columns[safe]
    for delta_row in (-1, 0, 1):
        for delta_column in (-1, 0, 1):
            support_phase = ((phase // 2 + delta_row) % 2) * 2 + (phase % 2 + delta_column) % 2
            if colours[support_phase] == colours[phase] or not len(rows):
                continue
            support_rows, support_columns = rows + delta_row, columns + delta_column
            support = image[support_rows, support_columns].astype(np.float64)
            neighbourhood = [image[support_rows + dy, support_columns + dx] for dy, dx in OFFSETS]
            background = np.median(np.stack(neighbourhood, axis=1), axis=1).astype(np.float64)
            shot, read = noise[support_phase]
            variance_type = np.asarray(shot * 0.0 + read + steps[support_phase] ** 2 / 12).dtype
            signal = np.maximum(np.maximum(support, background), 0).astype(variance_type, copy=False)
            sigma = np.sqrt(shot * signal + read + steps[support_phase] ** 2 / 12)
            safe = ~(support - background > np.maximum(LIGHT_SIGMA * sigma, 2 * steps[support_phase]))
            rows, columns = rows[safe], columns[safe]
    return rows, columns


def apply(sensor, config, *, cancelled=None, repairs=None):
    """Repair LibRaw's DN buffer using strips and original four-row seam context."""
    if config is None:
        return 0
    black = np.asarray(config['black'], dtype=np.float32)
    spans = np.asarray(config['spans'], dtype=np.float32)
    height = len(sensor)
    previous = None
    repaired = 0
    for top in range(0, height, STRIP_ROWS):
        _check_cancelled(cancelled)
        bottom = min(height, top + STRIP_ROWS)
        first, last = max(0, top - HALO), min(height, bottom + HALO)
        original = _normalise(sensor[first:last], black, spans)
        if previous is not None:
            original[:HALO] = previous
        _validate_sensor(original)
        previous = original[bottom - first - HALO:bottom - first].copy()
        for phase, rows, columns, values in _hot_repairs(original, config):
            changed = (rows >= top - first) & (rows < bottom - first) & (values != original[rows, columns])
            repaired += _store_repairs(sensor, rows[changed] + first, columns[changed],
                                       values[changed], black[phase], spans[phase], repairs)
    return repaired


def _store_repairs(sensor, rows, columns, values, black, span, repairs):
    encoded = np.clip(np.rint(values.astype(np.float64) * span + black), 0, 65535).astype(np.uint16)
    different = encoded != sensor[rows, columns]
    rows, columns, encoded = rows[different], columns[different], encoded[different]
    sensor[rows, columns] = encoded
    if repairs is not None:
        repairs.append(rows, columns, encoded)
    return len(encoded)


def _apply_cached(sensor, key, operation, cancelled):
    if key is None:
        return operation(None)
    _check_cancelled(cancelled)
    result = _cleanup_cache.get(key, _MISSING)
    if result is not _MISSING:
        count, parts = result
        for positions, values in parts:
            _check_cancelled(cancelled)
            sensor.flat[positions] = values
        return count
    repairs = _Repairs(sensor)
    count = operation(repairs)
    _check_cancelled(cancelled)
    if repairs.parts is not None:
        _cleanup_cache.put(key, (count, tuple(repairs.parts)), repairs.size)
    return count


def apply_raw(raw, metadata, settings, *, cancelled=None, source_path=None, original_stamp=None):
    pixel = settings.pixel_cleanup
    diagnostic = dict(enabled=pixel.remove_hot_pixels, supported=metadata.raw_pattern.shape == (2, 2), repaired=0,
                      stage="signed_normalized_sensor_before_opposed_color")
    diagnostic.update(specks_enabled=pixel.even_out_specks, tamed=0)
    if (pixel.remove_hot_pixels or pixel.even_out_specks) and diagnostic['supported']:
        _check_cancelled(cancelled)
        sensor = raw.raw_image_visible
        key = None
        if source_path is not None and original_stamp is not None and source_stamp(source_path) == original_stamp:
            key = (original_stamp, sensor.shape, sensor.dtype, _sensor_digest(sensor, cancelled), enabled("RAW_LEVELS"),
                   tuple(metadata.raw_pattern.ravel()), tuple(metadata.raw_channel_to_rgb),
                   tuple(metadata.raw_black_level), tuple(metadata.raw_white_level))
        config = _MISSING if key is None else _cleanup_cache.get((key, 'noise'), _MISSING)
        if config is _MISSING:
            config = configuration(sensor, metadata, cancelled=cancelled)
            _check_cancelled(cancelled)
            if key is not None:
                _cleanup_cache.put((key, 'noise'), config)
        diagnostic['noise_supported'] = config is not None
        if pixel.remove_hot_pixels:
            diagnostic['repaired'] = _apply_cached(sensor, (key, 'hot') if key is not None else None,
                lambda repairs: apply(sensor, config, cancelled=cancelled, repairs=repairs), cancelled)
        if pixel.even_out_specks:
            from .raw_speck_cleanup import apply as tame
            speck_key = (key, 'specks', diagnostic['repaired'] > 0, pixel.speck_threshold) if key is not None else None
            diagnostic['tamed'] = _apply_cached(sensor, speck_key,
                lambda repairs: tame(sensor, config, pixel.speck_threshold, cancelled=cancelled, repairs=repairs), cancelled)
    return diagnostic
