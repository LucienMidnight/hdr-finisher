"""Grain-matched adaptive Denoise and the experimental cleanup stages.

All neighbourhood work stays in linear light. A whole-image reduction fits two
brightness gains, then each tile runs the same reconstruction and cleanup.
"""
from concurrent.futures import CancelledError
from contextvars import Context
from itertools import product
from math import ceil, floor
from threading import Lock, RLock
from time import perf_counter
from weakref import finalize

import cv2
import numpy as np

from . import denoise_adaptive as adaptive, denoise_filters
from .cpu_budget import CpuExecutor, CpuWorkLimit, logical_cpus
from .library_diagnostics import log

GRAIN_RADIUS = 18
SMALL_COLOUR_MARGIN = 40
LARGE_COLOUR_MARGIN = 76
LUMA = adaptive.ACESCG_LUMINANCE
CHROMA = adaptive.OPPONENT[1:]
# Native Grade and Library share one workspace per pair of logical CPUs,
# leaving a CPU outside that pairing for requests and renderer work.
_PREVIEW_TILE_WORK = CpuWorkLimit(max(1, (logical_cpus() - 1) // 2))


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


def fit_grain(height, width, read, model, controls, is_current=None):
    """Fit two brightness gains with the same RGB projection as reconstruction."""
    size = adaptive.TILE_SIZE
    luma_strength, _ = controls.strengths()
    fine_multiplier = controls.fine_band_multiplier()
    fine_floor = np.float32(controls.fine_band_floor())

    def sums(origin):
        if is_current is not None and not is_current():
            raise InterruptedError("A newer edit replaced the Denoise grain fit.")
        pixels, core, edges = _region(read, height, width, origin, size, 17 + GRAIN_RADIUS)
        variance = adaptive._noise_variance(pixels @ adaptive.ACESCG_LUMINANCE, model, edges)
        current = adaptive._atrous((pixels @ adaptive.OPPONENT.T)[..., 0], 0, edges)
        result = np.empty((2, 4), dtype=np.float64)
        for level in (1, 2):
            smooth = adaptive._atrous(current, level, edges)
            band = current - smooth
            energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
            gain = adaptive._band_gain(energy, variance, luma_strength * controls.size_multiplier(level),
                                       model.band_sigmas[0][level], level, fine_multiplier, fine_floor)
            power = np.square(band[core], dtype=np.float64)
            original = gain[core]
            averaged = _box(gain, GRAIN_RADIUS)[core]
            result[level - 1] = (power.sum(), np.sum(power * original * original),
                                 np.sum(power * averaged), np.sum(power * averaged * averaged))
            current = smooth
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


def _colour_offsets(reach):
    diagonal = round(reach / np.sqrt(2))
    return ((0, reach), (reach, 0), (diagonal, diagonal), (diagonal, -diagonal))


def _colour_pairs(field, reach, tap):
    """Pairs of colour samples on opposite sides of the centre."""
    padded = cv2.copyMakeBorder(_box(field, tap), reach, reach, reach, reach, cv2.BORDER_REFLECT_101)
    shape = field.shape[:2]
    for y, x in _colour_offsets(reach):
        yield (_shift(padded, shape, reach+y, reach+x),
               _shift(padded, shape, reach-y, reach-x))


def _colour_pass(chroma, noise, limit, dark, reach, tap, centre, native=None):
    core = _box(chroma, centre)
    closest = np.full_like(noise, np.inf)
    total = np.zeros_like(core)
    low = np.full_like(core, np.inf)
    high = np.full_like(core, -np.inf)
    if native is not None:
        first_x, first_y, second_x, second_y = (np.empty_like(noise) for _ in range(4))
    for first, second in _colour_pairs(chroma, reach, tap):
        if native is not None:
            native.colour_pair(first, second, core, first_x, first_y, second_x, second_y,
                               total, low, high, *noise.shape, first.strides[0] // first.itemsize)
            cv2.magnitude(first_x, first_y, first_x)
            cv2.magnitude(second_x, second_y, second_x)
            np.minimum(first_x, second_x, out=first_x)
            np.minimum(closest, first_x, out=closest)
            continue
        np.minimum(closest, np.minimum(_magnitude(core - first), _magnitude(core - second)), out=closest)
        pair = first + second
        pair *= .5
        total += pair
        np.minimum(low, pair, out=low)
        np.maximum(high, pair, out=high)
    if native is None:
        total -= low
        total -= high
        total *= .5
        delta = core - total
        pixel_delta = chroma - total
    else:
        delta, pixel_delta = np.empty_like(core), np.empty_like(core)
        native.colour_deltas(core, chroma, total, low, high, delta, pixel_delta, core.size)
    signal = _magnitude(delta)
    relative = signal / noise
    pixel_relative = _magnitude(pixel_delta) / noise
    peak = cv2.dilate(pixel_relative, np.ones((7, 7), dtype=np.uint8))
    if native is not None:
        output = np.empty_like(core)
        native.colour_repair(core, chroma, closest, signal, relative, pixel_relative,
                             limit, dark, peak, delta, pixel_delta, output, noise.size)
        return output
    isolated = _ramp(closest / np.maximum(signal, 1e-7), .1, .65)
    # A large difference that repeats on one side is more likely real colour.
    protection = 1 - (1 - isolated) * _ramp(relative, 5, 12)
    strength = np.maximum(_ramp(relative, 1.5, 5),
                          _ramp(pixel_relative, 2.5, 5) * _ramp(relative, .65, 2.5))
    fine_weight = .8 * _ramp(pixel_relative, 1, 4)
    correction = (delta + fine_weight[..., None] * (chroma - core))
    moderate = correction * (strength * protection * limit)[..., None]

    # Permit a stronger repair at compact peaks in the darkest patches.
    isolated_dark = dark * _ramp(pixel_relative / np.maximum(peak, 1e-6), .55, .95) * _ramp(pixel_relative, 1.8, 4)
    return moderate + isolated_dark[..., None] * (pixel_delta * limit[..., None] - moderate)


def colour_delta(rgb, broad):
    """Full-strength opponent-colour correction, leaving scene luminance alone."""
    native = denoise_filters.library()
    if not denoise_filters.supports(rgb) or not hasattr(native, "colour_guides"):
        native = None
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
    background = np.maximum(_box(local, 12), 0)
    texture = _box(np.abs(local - _box(local, 5)), 4)
    channels = cv2.split(chroma)
    median = cv2.merge([cv2.medianBlur(channel, 5) for channel in channels])
    fringe = chroma - median
    sharp = np.abs(local - _box(local, 3))
    fringe_magnitude = _magnitude(fringe)
    if native is None:
        highlight = _ramp(peak, .065, .125)
        texture = texture / np.maximum(background + 3 * luma_noise, 1e-6)
        limit = (1 - .97 * highlight) * (1 - _ramp(texture, .045, .15) * _ramp(background, .004, .015))
        dark = 1 - _ramp(np.maximum(local, 0), .006, .014)
        sharpness = _ramp(sharp / np.maximum(np.maximum(local, 0) + 4 * luma_noise, 1e-6), .06, .24)
        edge_weight = .45 * highlight * sharpness * _ramp(fringe_magnitude / noise, 3, 8)
    else:
        limit, dark, edge_weight = (np.empty_like(local) for _ in range(3))
        native.colour_guides(local, luma_noise, peak, background, texture, sharp, fringe_magnitude,
                             noise, limit, dark, edge_weight, local.size)
    chroma -= _colour_pass(chroma, noise, limit, dark, 12, 2, 1, native) + fringe * edge_weight[..., None]
    if broad:
        chroma -= _colour_pass(chroma, noise, limit, dark, 28, 4, 3, native)
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


class _TilePass:
    def __init__(self, size, process, height, width, *, started, log_fields, dependency_margin=0):
        self.size = size
        self.process = process
        self.dependency_margin = dependency_margin
        self.count = ceil(height / size) * ceil(width / size)
        self.started = started
        self.log_fields = log_fields
        self.done = set()
        self.inflight = {}
        self.background_requested = False
        self.background_started = False
        self.foreground_count = 0
        self.background_count = 0
        self.timings = np.zeros(6)


class GrainPreparation:
    """The selected source's native denoised RGB and live colour correction."""

    def __init__(self, height, width, read, model, controls, fit, is_current, disk_cache, source_path=None,
                 *, log_fields=None):
        self.height = height
        self.width = width
        self._lock = Lock()
        self._tiles_lock = RLock()
        self._pool = CpuExecutor(work_limit=_PREVIEW_TILE_WORK)
        started = perf_counter()
        self._current = is_current
        self._error = None
        self._closed = False
        self._file, close = disk_cache.open_grade_scratch(height * width * 16, grain_source=source_path,
                                                        preallocate=False)
        self._close = finalize(self, close)
        self._tile_offsets = {}
        self._written_bytes = 0
        clean = controls.method == "clean_grain"
        broad = controls.splotch_size == "large"
        margin = (LARGE_COLOUR_MARGIN if broad else SMALL_COLOUR_MARGIN) if clean else 0
        size = adaptive.TILE_SIZE - 2 * margin

        def resolve(origin):
            start = perf_counter()
            rgb, inner = _resolved_tile(read, height, width, origin, size, margin, model, controls, fit)
            resolved = perf_counter()
            delta = colour_delta(rgb, broad)[inner] if clean else None
            coloured = perf_counter()
            rows = _pack(rgb[inner], delta)
            if not np.isfinite(rgb[inner]).all():
                raise FloatingPointError("Grain Denoise produced invalid samples.")
            packed = perf_counter()
            waiting, writing = self._write(origin, rows)
            return (resolved - start, coloured - resolved, packed - coloured, waiting, writing, 0)

        self._base = _TilePass(size, resolve, height, width, started=started, log_fields=log_fields or {})
        self._colour = None

    @property
    def usable(self):
        with self._tiles_lock:
            return not self._closed

    @staticmethod
    def _timing_ms(phase):
        return dict(zip(("wavelet", "colour", "pack", "write_wait", "write", "read"),
                        (phase.timings * 1000).tolist()))

    def _submit(self, phase, origin, *, background):
        if self._closed:
            raise self._error or InterruptedError("The Denoise preparation was replaced.")
        if origin in phase.done:
            return None
        existing = phase.inflight.get(origin)
        if existing is not None:
            future, was_background = existing
            # A queued task can change priority. A running task owns this
            # tile until it finishes, and all readers join the same future.
            if background or not was_background or not future.cancel():
                return future

        def run():
            if not self._current():
                raise InterruptedError("A newer source replaced the Denoise preparation.")
            return phase.process(origin)

        # The POST's request lease ends when it returns the token. These
        # tasks belong to the scratch file and its source from that point on.
        submit = self._pool.submit_background if background else self._pool.submit
        future = Context().run(submit, run)
        phase.inflight[origin] = future, background
        future.add_done_callback(lambda done: self._tile_finished(phase, origin, done, background))
        return future

    def _tile_finished(self, phase, origin, future, background):
        if future.cancelled():
            return
        with self._tiles_lock:
            phase.inflight.pop(origin, None)
            if self._closed:
                return
            error = future.exception()
            if error is not None:
                self._error = error
                self.close()
                return
            phase.done.add(origin)
            phase.timings += future.result()
            if background:
                phase.background_count += 1
            else:
                phase.foreground_count += 1
            if len(phase.done) == phase.count:
                phase.process = None
                log("denoise_grain_tiles_completed", **phase.log_fields, area="denoise", route="cpu",
                    reason="native_tiles_ready", duration_ms=(perf_counter() - phase.started) * 1000,
                    foreground_tile_count=phase.foreground_count, background_tile_count=phase.background_count,
                    worker_limit=_PREVIEW_TILE_WORK.workers,
                    tile_worker_ms=self._timing_ms(phase))
                if phase is self._base and self._colour is not None and self._colour.background_requested:
                    self._background(self._colour)

    def _background(self, phase):
        if self._closed or phase.background_started:
            return
        phase.background_started = True
        for origin in _origins(self.height, self.width, phase.size):
            if self._closed:
                break
            self._submit(phase, origin, background=True)

    def _intersecting(self, phase, y, x, bottom, right):
        size = phase.size
        return product(range(y // size * size, bottom, size), range(x // size * size, right, size))

    def _ensure(self, phase, origins, *, fill_background=True):
        with self._tiles_lock:
            if self._closed:
                raise self._error or InterruptedError("The Denoise preparation was replaced.")
            pending = [future for origin in origins if (future := self._submit(phase, origin, background=False))]
            if fill_background:
                phase.background_requested = True
                if phase is self._base or len(self._base.done) == self._base.count:
                    self._background(phase)
        try:
            for future in pending:
                future.result()
        except CancelledError as error:
            raise self._error or InterruptedError("The Denoise preparation was replaced.") from error

    def add_colour(self, controls, is_current, *, log_fields=None):
        """Fill the reserved correction fields using neighbouring Fine Grain RGB."""
        broad = controls.splotch_size == "large"
        margin = LARGE_COLOUR_MARGIN if broad else SMALL_COLOUR_MARGIN
        size = adaptive.TILE_SIZE - 2 * margin

        def read(y, x, bottom, right):
            fields = self._read(y, x, bottom - y, right - x)
            return fields.view("<f4")[..., :3].copy()

        def colour(origin):
            start = perf_counter()
            rgb, core, _ = _region(read, self.height, self.width, origin, size, margin)
            loaded = perf_counter()
            delta = colour_delta(rgb, broad)[core]
            coloured = perf_counter()
            rows = _pack(rgb[core], delta)
            packed = perf_counter()
            waiting, writing = self._write(origin, rows)
            return 0.0, coloured - loaded, packed - coloured, waiting, writing, loaded - start

        if not is_current():
            raise InterruptedError("The Denoise preparation was replaced.")
        with self._tiles_lock:
            if self._closed:
                raise InterruptedError("The Denoise preparation was replaced.")
            self._colour = _TilePass(size, colour, self.height, self.width, started=perf_counter(),
                                     log_fields=log_fields or {}, dependency_margin=margin)

    def _write(self, origin, rows):
        y, x = origin
        start = perf_counter()
        with self._lock:
            if self._file.closed:
                raise InterruptedError("The Denoise preparation was replaced.")
            writing = perf_counter()
            height, width = rows.shape[:2]
            size = self._base.size
            if y % size == x % size == 0 and height == min(size, self.height - y) and width == min(size, self.width - x):
                # Append the visible tiles without reserving physical blocks
                # for earlier rows. Upgrades can overwrite a ready tile.
                offset = self._tile_offsets.get(origin, self._written_bytes)
                self._file.seek(offset)
                if self._file.write(rows) != rows.nbytes:
                    raise OSError("Incomplete Grain Denoise scratch write.")
                if origin not in self._tile_offsets:
                    self._tile_offsets[origin] = offset
                    self._written_bytes += rows.nbytes
            else:
                for start, column, pixels, tile_width in self._pieces(y, x, height, width, rows):
                    for dy, row in enumerate(pixels):
                        self._file.seek(start + (dy * tile_width + column) * 16)
                        if self._file.write(row) != row.nbytes:
                            raise OSError("Incomplete Grain Denoise scratch write.")
            written = perf_counter()
        return writing - start, written - writing

    def _pieces(self, y, x, height, width, rows):
        """Map an arbitrary window over the compact base-tile scratch layout."""
        bottom, right = y + height, x + width
        size = self._base.size
        for top, left in self._intersecting(self._base, y, x, bottom, right):
            tile_height = min(size, self.height - top)
            tile_width = min(size, self.width - left)
            y0, x0 = max(y, top), max(x, left)
            y1, x1 = min(bottom, top + tile_height), min(right, left + tile_width)
            offset = self._tile_offsets[top, left] + (y0 - top) * tile_width * 16
            yield offset, x0 - left, rows[y0-y:y1-y, x0-x:x1-x], tile_width

    def close(self):
        with self._tiles_lock:
            if self._closed:
                return
            self._closed = True
            self._pool.shutdown(wait=False, cancel_futures=True)
            phase = self._colour or self._base
            if len(phase.done) != phase.count:
                log("denoise_grain_tiles_stopped", **phase.log_fields, area="denoise", route="cpu",
                    reason="tile_failed" if self._error and not isinstance(self._error, InterruptedError)
                    else "preparation_replaced",
                    completed_tile_count=len(phase.done), total_tile_count=phase.count)
            with self._lock:
                self._close()

    def _read(self, y, x, height, width):
        rows = np.empty((height, width, 4), dtype="<u4")
        with self._lock:
            if self._file.closed:
                raise InterruptedError("The Denoise preparation was replaced.")
            for offset, column, pixels, tile_width in self._pieces(y, x, height, width, rows):
                # One read for consecutive rows of a scratch tile, even
                # when the viewport only uses some of its columns.
                piece_width = pixels.shape[1]
                for row in range(0, len(pixels), 128):
                    target = pixels[row:row+128]
                    block = target if piece_width == tile_width and target.flags.c_contiguous else np.empty(
                        (len(target), tile_width, 4), dtype=rows.dtype)
                    self._file.seek(offset + row * tile_width * 16)
                    if self._file.readinto(block) != block.nbytes:
                        raise OSError("Incomplete Grain Denoise source.")
                    if block is not target:
                        target[:] = block[:, column:column+piece_width]
        return rows

    def _prepare_region(self, y, x, height, width, colour, *, fill_background=True):
        phase = self._colour if colour is not False and self._colour is not None else self._base
        origins = tuple(self._intersecting(phase, y, x, y + height, x + width))
        if phase.dependency_margin:
            size, margin = phase.size, phase.dependency_margin
            required = dict.fromkeys(
                origin for top, left in origins for origin in self._intersecting(
                    self._base, max(0, top - margin), max(0, left - margin),
                    min(self.height, top + size + margin), min(self.width, left + size + margin))
            )
            self._ensure(self._base, required, fill_background=False)
        self._ensure(phase, origins, fill_background=fill_background)
        if fill_background and phase.dependency_margin:
            with self._tiles_lock:
                self._background(self._base)

    def _prepared_fields(self, y, x, height, width, colour):
        self._prepare_region(y, x, height, width, colour)
        fields = self._read(y, x, height, width)
        if colour is False:
            fields[..., 3] = 0
        return fields

    def region(self, y, x, height, width, frame_height, frame_width, *, colour=None, warm_only=False):
        if min(y, x) < 0 or min(height, width) < 1 or y + height > frame_height or x + width > frame_width:
            raise ValueError("Grain Denoise region exceeds the requested frame.")
        if not self._current():
            self.close()
            raise InterruptedError("A newer source replaced the Denoise preparation.")
        if self.height == frame_height and self.width == frame_width:
            if warm_only:
                self._prepare_region(y, x, height, width, colour, fill_background=False)
                return None
            fields = self._prepared_fields(y, x, height, width, colour)
            return fields.tobytes()
        if warm_only:
            raise ValueError("A Grain tile warmup needs native frame dimensions.")

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
            fields = self._prepared_fields(top, left, bottom - top, right - left, colour)
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
