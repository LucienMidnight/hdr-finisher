"""Grain-matched adaptive Denoise and the experimental cleanup stages.

All neighbourhood work stays in linear light. A whole-image reduction fits two
brightness gains, then each tile runs the same reconstruction and cleanup.
"""
from itertools import islice, product
from math import ceil, floor
from threading import Lock
from time import perf_counter
from weakref import finalize

import cv2
import numpy as np

from . import denoise_adaptive as adaptive
from .cpu_budget import CpuExecutor

GRAIN_RADIUS = 18
SMALL_COLOUR_MARGIN = 40
LARGE_COLOUR_MARGIN = 76
LUMA = adaptive.ACESCG_LUMINANCE
CHROMA = adaptive.OPPONENT[1:]


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


def _colour_pairs(field, reach, tap):
    """Pairs of colour samples on opposite sides of the centre."""
    padded = cv2.copyMakeBorder(_box(field, tap), reach, reach, reach, reach, cv2.BORDER_REFLECT_101)
    diagonal = round(reach / np.sqrt(2))
    shape = field.shape[:2]
    for y, x in ((0, reach), (reach, 0), (diagonal, diagonal), (diagonal, -diagonal)):
        yield (_shift(padded, shape, reach+y, reach+x),
               _shift(padded, shape, reach-y, reach-x))


def _colour_pass(chroma, noise, limit, dark, reach, tap, centre):
    core = _box(chroma, centre)
    closest = np.full_like(noise, np.inf)
    pairs = []
    for first, second in _colour_pairs(chroma, reach, tap):
        np.minimum(closest, np.minimum(_magnitude(core - first), _magnitude(core - second)), out=closest)
        pairs.append(.5 * (first + second))
    low = np.minimum(np.minimum(pairs[0], pairs[1]), np.minimum(pairs[2], pairs[3]))
    high = np.maximum(np.maximum(pairs[0], pairs[1]), np.maximum(pairs[2], pairs[3]))
    surrounding = .5 * (sum(pairs) - low - high)
    delta = core - surrounding
    pixel_delta = chroma - surrounding
    signal = _magnitude(delta)
    relative = signal / noise
    pixel_relative = _magnitude(pixel_delta) / noise
    isolated = _ramp(closest / np.maximum(signal, 1e-7), .1, .65)
    # A large difference that repeats on one side is more likely real colour.
    protection = 1 - (1 - isolated) * _ramp(relative, 5, 12)
    strength = np.maximum(_ramp(relative, 1.5, 5),
                          _ramp(pixel_relative, 2.5, 5) * _ramp(relative, .65, 2.5))
    fine_weight = .8 * _ramp(pixel_relative, 1, 4)
    correction = (delta + fine_weight[..., None] * (chroma - core))
    moderate = correction * (strength * protection * limit)[..., None]

    # Permit a stronger repair at compact peaks in the darkest patches.
    peak = cv2.dilate(pixel_relative, np.ones((7, 7), dtype=np.uint8))
    isolated_dark = dark * _ramp(pixel_relative / np.maximum(peak, 1e-6), .55, .95) * _ramp(pixel_relative, 1.8, 4)
    return moderate + isolated_dark[..., None] * (pixel_delta * limit[..., None] - moderate)


def colour_delta(rgb, broad):
    """Full-strength opponent-colour correction, leaving scene luminance alone."""
    y = rgb @ LUMA
    local = _box(y, 1)
    luma_noise = _grain(y)
    light = np.maximum(local, 0) + 2 * luma_noise
    original = rgb @ CHROMA.T
    chroma = original / light[..., None]
    noise = _grain(chroma, chroma=True)

    # Broad colour pulls must not follow very bright neighbours into dark
    # pixels. Keep a narrow pass for thin colour fringes on bright edges.
    peak = cv2.dilate(np.maximum(local, 0), np.ones((41, 41), dtype=np.uint8))
    highlight = _ramp(peak, .065, .125)
    background = np.maximum(_box(local, 12), 0)
    texture = _box(np.abs(local - _box(local, 5)), 4) / np.maximum(background + 3 * luma_noise, 1e-6)
    limit = (1 - .97 * highlight) * (1 - _ramp(texture, .045, .15) * _ramp(background, .004, .015))
    dark = 1 - _ramp(np.maximum(local, 0), .006, .014)
    channels = cv2.split(chroma)
    median = cv2.merge([cv2.medianBlur(channel, 5) for channel in channels])
    fringe = chroma - median
    sharpness = _ramp(np.abs(local - _box(local, 3)) /
                      np.maximum(np.maximum(local, 0) + 4 * luma_noise, 1e-6), .06, .24)
    edge_weight = .45 * highlight * sharpness * _ramp(_magnitude(fringe) / noise, 3, 8)
    chroma -= _colour_pass(chroma, noise, limit, dark, 12, 2, 1) + fringe * edge_weight[..., None]
    if broad:
        chroma -= _colour_pass(chroma, noise, limit, dark, 28, 4, 3)
    return chroma * light[..., None] - original


def apply_colour(rgb, delta, blend):
    output = rgb + (delta * np.float32(blend)) @ CHROMA
    output += ((rgb @ LUMA) - (output @ LUMA))[..., None]
    return output


def _resolved_tile(read, height, width, origin, size, downstream, model, controls, fit):
    pixels, core, edges = _region(read, height, width, origin, size, adaptive.TILE_MARGIN + downstream)
    base = adaptive._filter_region(pixels, model, controls, edges, controls.grain_evenness, fit)
    top, left = max(0, core[0].start - downstream), max(0, core[1].start - downstream)
    end_y = min(base.shape[0], core[0].stop + downstream)
    end_x = min(base.shape[1], core[1].stop + downstream)
    inner = np.s_[core[0].start-top:core[0].stop-top, core[1].start-left:core[1].stop-left]
    return base[top:end_y, left:end_x], inner


def _pack(rgb, delta=None):
    """Three float32 channels and two signed float16 corrections in 16 bytes."""
    fields = np.empty((*rgb.shape[:2], 4), dtype="<u4")
    fields[..., :3].view("<f4")[:] = rgb
    fields[..., 3] = 0
    if delta is not None:
        half = np.ascontiguousarray(delta, dtype="<f2")
        if not np.isfinite(half).all():
            raise FloatingPointError("Clean Grain produced an invalid colour correction.")
        fields[..., 3] = half.view("<u4")[..., 0]
    return fields


def _resize_window(fields, box, size, bounds, ranges):
    from PIL import Image
    from .preview import _block_reduce, _neighbour_reduce

    left, top = bounds
    block, x, y = ranges
    channels = [*np.moveaxis(fields[..., :3].view("<f4"), -1, 0),
                *np.moveaxis(np.ascontiguousarray(fields[..., 3]).view("<f2").reshape(*fields.shape[:2], 2), -1, 0)]
    resized = []
    for channel in channels:
        channel = channel.astype(np.float32, copy=False)
        value = np.asarray(Image.fromarray(channel).resize(size, Image.Resampling.LANCZOS, box=box))
        limits = []
        for reduce in (np.minimum, np.maximum):
            coarse = _block_reduce(reduce, _block_reduce(reduce, channel, block, 0), block, 1)
            coarse = _neighbour_reduce(reduce, _neighbour_reduce(reduce, coarse, 0), 1)
            limits.append(coarse[np.ix_(y - top // block, x - left // block)])
        resized.append(np.clip(value, *limits))
    return _pack(np.stack(resized[:3], axis=-1), np.stack(resized[3:], axis=-1))


class GrainPreparation:
    """The selected source's native denoised RGB and live colour correction."""

    def __init__(self, height, width, read, model, controls, fit, is_current, disk_cache):
        self.height = height
        self.width = width
        self._lock = Lock()
        self._file, close = disk_cache.open_grade_scratch(height * width * 16)
        self._close = finalize(self, close)
        broad = controls.splotch_size == "large"
        margin = LARGE_COLOUR_MARGIN if broad else SMALL_COLOUR_MARGIN
        size = adaptive.TILE_SIZE - 2 * margin

        def run(origin):
            if not is_current():
                raise InterruptedError("A newer source replaced the Denoise preparation.")
            start = perf_counter()
            rgb, inner = _resolved_tile(read, height, width, origin, size, margin, model, controls, fit)
            resolved = perf_counter()
            delta = colour_delta(rgb, broad)[inner] if controls.method == "clean_grain" else None
            coloured = perf_counter()
            rows = _pack(rgb[inner], delta)
            if not np.isfinite(rgb[inner]).all():
                raise FloatingPointError("Grain Denoise produced invalid samples.")
            y, x = origin
            packed = perf_counter()
            with self._lock:
                writing = perf_counter()
                for dy, row in enumerate(rows):
                    self._file.seek(((y + dy) * width + x) * 16)
                    self._file.write(row)
                written = perf_counter()
            return (resolved - start, coloured - resolved, packed - coloured,
                    writing - packed, written - writing)

        try:
            with CpuExecutor() as pool:
                tile_timings = tuple(pool.map(run, _origins(height, width, size)))
        except BaseException:
            self.close()
            raise
        # These sums span parallel workers. The caller also logs the elapsed
        # wall time so concurrent work is never counted twice in the wait.
        self.tile_timing_ms = dict(zip(
            ("wavelet", "colour", "pack", "write_wait", "write"),
            (sum(stage) * 1000 for stage in zip(*tile_timings)),
        ))

    def close(self):
        with self._lock:
            self._close()

    def _read(self, y, x, height, width):
        rows = np.empty((height, width, 4), dtype="<u4")
        with self._lock:
            if self._file.closed:
                raise InterruptedError("The Denoise preparation was replaced.")
            if width == self.width:
                self._file.seek(y * width * 16)
                if self._file.readinto(rows) != rows.nbytes:
                    raise OSError("Incomplete Grain Denoise source.")
            else:
                for dy, row in enumerate(rows):
                    self._file.seek(((y + dy) * self.width + x) * 16)
                    if self._file.readinto(row) != row.nbytes:
                        raise OSError("Incomplete Grain Denoise source.")
        return rows

    def region(self, y, x, height, width, frame_height, frame_width):
        if min(y, x) < 0 or min(height, width) < 1 or y + height > frame_height or x + width > frame_width:
            raise ValueError("Grain Denoise region exceeds the requested frame.")
        if self.height == frame_height and self.width == frame_width:
            return self._read(y, x, height, width).tobytes()

        sx, sy = self.width / frame_width, self.height / frame_height
        block = max(1, ceil(max(sx, sy)))

        def axis(start, count, ratio, native):
            stop = start + count
            indices = ((np.arange(start, stop) + .5) * ratio).astype(np.intp) // block
            support = ceil(3 * max(1, ratio))
            first = min(floor(start * ratio) - support, (indices[0] - 1) * block)
            last = max(ceil(stop * ratio) + support, (indices[-1] + 2) * block)
            low = max(0, first // block * block)
            high = min(native, ceil(last / block) * block)
            return low, high, start * ratio - low, stop * ratio - low, indices

        left, right, x0, x1, xs = axis(x, width, sx, self.width)
        # Bounded source reads even when the full Fit picture occupies one response.
        target_rows = max(1, floor(128 / max(1, sy)))
        result = np.empty((height, width, 4), dtype="<u4")
        for row in range(0, height, target_rows):
            count = min(target_rows, height - row)
            top, bottom, y0, y1, ys = axis(y + row, count, sy, self.height)
            fields = self._read(top, left, bottom - top, right - left)
            result[row:row + count] = _resize_window(fields, (x0, y0, x1, y1), (width, count),
                                                     (left, top), (block, xs, ys))
        return result.tobytes()


def resolve_grain(source, model, controls):
    evenness = controls.grain_evenness
    splotches = controls.color_splotches
    broad = controls.splotch_size == "large"
    clean = controls.method == "clean_grain" and splotches > 0
    if (not clean and not evenness) or controls.amount <= 0 or not (controls.luminance or controls.color_noise):
        return adaptive._resolve_standard(source, model, controls)
    height, width = source.shape[:2]
    result = source.copy()
    read = lambda y, x, b, r: source[y:b, x:r]
    fit = fit_grain(height, width, read, model, controls) if evenness else None
    # Stage only the core and the pixels the next stage will read.
    margin = LARGE_COLOUR_MARGIN if broad else SMALL_COLOUR_MARGIN
    downstream = margin if clean else 0
    size = adaptive.TILE_SIZE - 2 * downstream

    def run(origin):
        base, core = _resolved_tile(read, height, width, origin, size, downstream, model, controls, fit)
        y, x = origin
        rgb = base
        if clean:
            rgb = apply_colour(base, colour_delta(base, broad), splotches)
        result[y:min(y+size, height), x:min(x+size, width), :3] = rgb[core]

    with CpuExecutor() as pool:
        list(pool.map(run, _origins(height, width, size)))
    if not np.isfinite(result).all():
        raise FloatingPointError("Grain Denoise produced a non-finite value.")
    return result
