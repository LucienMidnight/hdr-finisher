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
from .denoise_quality import colour_reference
from .grain_work import background_fill_allowed
from .library_diagnostics import log

GRAIN_RADIUS = 18
SMALL_COLOUR_MARGIN = 40
LARGE_COLOUR_MARGIN = 76
FRINGE_MARGIN = 24
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


def _splotch_edge_weight(chroma, noise):
    """Protect an abrupt colour boundary that continues along the edge."""
    pad = 12
    field = np.pad(chroma, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    shape = chroma.shape[:2]
    longest = np.zeros_like(noise)
    for y, x in ((0, 1), (1, 0), (1, 1), (1, -1)):
        def cross(reach, along):
            return (_shift(field, shape, pad + reach*y + along*x, pad + reach*x - along*y)
                    - _shift(field, shape, pad - reach*y + along*x, pad - reach*x - along*y))
        direction = cross(6, 0)
        length = np.maximum(_magnitude(direction), 1e-7)
        coherent = length.copy()
        for along in (-5, 5):
            coherent = np.minimum(coherent, np.sum(direction * cross(6, along), axis=-1) / length)
        sharp = length / np.maximum(_magnitude(cross(pad, 0)), length)
        longest = np.maximum(longest, _ramp(coherent / noise, 4, 9) * _ramp(sharp, .4, .7))
    return 1 - longest


def colour_delta(rgb, broad, *, splotches=True, fringes=True, separate=False):
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
    reference = colour_reference()
    if native is None or (reference and not hasattr(native, "colour_guides_relative")):
        guide_peak, guide_background, guide_light = peak, background, np.maximum(local, 0)
        if reference:
            scale = np.float32(reference) / luma_noise
            guide_peak, guide_background, guide_light = peak * scale, background * scale, guide_light * scale
        highlight = _ramp(guide_peak, .065, .125)
        texture = texture / np.maximum(background + 3 * luma_noise, 1e-6)
        limit = (1 - .97 * highlight) * (1 - _ramp(texture, .045, .15) * _ramp(guide_background, .004, .015))
        dark = 1 - _ramp(guide_light, .006, .014)
        sharpness = _ramp(sharp / np.maximum(np.maximum(local, 0) + 4 * luma_noise, 1e-6), .06, .24)
        edge_weight = .45 * highlight * sharpness * _ramp(fringe_magnitude / noise, 3, 8)
    else:
        limit, dark, edge_weight = (np.empty_like(local) for _ in range(3))
        args = (local, luma_noise, peak, background, texture, sharp, fringe_magnitude,
                noise, limit, dark, edge_weight, local.size)
        if reference:
            native.colour_guides_relative(*args, reference)
        else:
            native.colour_guides(*args)
    if separate:
        fringe_fix = fringe * edge_weight[..., None] if fringes else np.float32(0)
        fringe_delta = -fringe_fix * light[..., None] if fringes else np.zeros_like(original)
        if not splotches:
            return fringe_delta, None
        small = _colour_pass(chroma, noise, limit, dark, 12, 2, 1, native)
        chroma -= small * _splotch_edge_weight(chroma, noise)[..., None] + fringe_fix
        if broad:
            large = _colour_pass(chroma, noise, limit, dark, 28, 4, 3, native)
            chroma -= large * _splotch_edge_weight(chroma, noise)[..., None]
        return fringe_delta, chroma * light[..., None] - original - fringe_delta
    # Micro Grain uses the original combined pass.
    chroma -= _colour_pass(chroma, noise, limit, dark, 12, 2, 1, native) + fringe * edge_weight[..., None]
    if broad:
        chroma -= _colour_pass(chroma, noise, limit, dark, 28, 4, 3, native)
    return chroma * light[..., None] - original


def apply_colour(rgb, delta, blend):
    output = rgb + (delta * np.float32(blend)) @ CHROMA
    output += ((rgb @ LUMA) - (output @ LUMA))[..., None]
    return output


def _colour_controls(controls):
    clean = controls.method == "clean_grain"
    return clean and controls.clean_splotches, clean and controls.clean_fringes


def _colour_margin(splotches, fringes, broad):
    if splotches:
        return LARGE_COLOUR_MARGIN if broad else SMALL_COLOUR_MARGIN
    return FRINGE_MARGIN if fringes else 0


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
    def __init__(self, size, process, height, width, *, started, log_fields):
        self.size = size
        self.process = process
        self.count = ceil(height / size) * ceil(width / size)
        self.started = started
        self.log_fields = log_fields
        self.done = set()
        self.inflight = {}
        self.background_pending = 0
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
        splotches, fringes = _colour_controls(controls)
        broad = splotches and controls.splotch_size == "large"
        margin = _colour_margin(splotches, fringes, broad)
        size = adaptive.TILE_SIZE - 2 * margin

        def resolve(origin):
            start = perf_counter()
            rgb, inner = _resolved_tile(read, height, width, origin, size, margin, model, controls, fit)
            resolved = perf_counter()
            delta = None
            if splotches or fringes:
                fringe_delta, splotch_delta = colour_delta(rgb, broad, splotches=splotches, fringes=fringes, separate=True)
                if fringes:
                    rgb = apply_colour(rgb, fringe_delta, 1)
                if splotch_delta is not None:
                    delta = splotch_delta[inner]
            coloured = perf_counter()
            rows = _pack(rgb[inner], delta)
            if not np.isfinite(rgb[inner]).all():
                raise FloatingPointError("Grain Denoise produced invalid samples.")
            packed = perf_counter()
            waiting, writing = self._write(origin, rows)
            return (resolved - start, coloured - resolved, packed - coloured, waiting, writing, 0)

        self._base = _TilePass(size, resolve, height, width, started=started, log_fields=log_fields or {})

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
            if background and not background_fill_allowed():
                return None
            return phase.process(origin)

        # The POST's request lease ends when it returns the token. These
        # tasks belong to the scratch file and its source from that point on.
        submit = self._pool.submit_background if background else self._pool.submit
        future = Context().run(submit, run)
        phase.inflight[origin] = future, background
        future.add_done_callback(lambda done: self._tile_finished(phase, origin, done, background))
        return future

    def _tile_finished(self, phase, origin, future, background):
        with self._tiles_lock:
            if phase.inflight.get(origin, (None,))[0] is not future:
                return
            phase.inflight.pop(origin)
            if future.cancelled():
                if background:
                    phase.background_pending -= 1
                return
            if self._closed:
                return
            error = future.exception()
            if error is not None:
                self._error = error
                self.close()
                return
            timings = future.result()
            if background:
                phase.background_pending -= 1
            if timings is None:
                return
            phase.done.add(origin)
            phase.timings += timings
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
            elif background:
                self._background(phase)

    def _background(self, phase):
        if self._closed or phase.background_pending >= _PREVIEW_TILE_WORK.workers or not background_fill_allowed():
            return
        for origin in _origins(self.height, self.width, phase.size):
            if self._closed or phase.background_pending >= _PREVIEW_TILE_WORK.workers:
                break
            if origin not in phase.done and origin not in phase.inflight:
                phase.background_pending += 1
                self._submit(phase, origin, background=True)

    def _intersecting(self, phase, y, x, bottom, right):
        size = phase.size
        return product(range(y // size * size, bottom, size), range(x // size * size, right, size))

    def _ensure(self, phase, origins, *, fill_background=True):
        with self._tiles_lock:
            if self._closed:
                raise self._error or InterruptedError("The Denoise preparation was replaced.")
            pending = [(origin, future) for origin in origins
                       if (future := self._submit(phase, origin, background=False))]
            if fill_background:
                self._background(phase)
        try:
            for origin, future in pending:
                if future.result() is None:
                    # A running background tile may have joined this request
                    # just as its memory gate closed. Retry it as visible work.
                    with self._tiles_lock:
                        if phase.inflight.get(origin, (None,))[0] is future:
                            phase.inflight.pop(origin)
                            phase.background_pending -= 1
                        foreground = self._submit(phase, origin, background=False)
                    if foreground is not None:
                        foreground.result()
        except CancelledError as error:
            raise self._error or InterruptedError("The Denoise preparation was replaced.") from error

    def _write(self, origin, rows):
        y, x = origin
        start = perf_counter()
        with self._lock:
            if self._file.closed:
                raise InterruptedError("The Denoise preparation was replaced.")
            writing = perf_counter()
            # Append visible tiles without reserving space for earlier ones.
            offset = self._written_bytes
            self._file.seek(offset)
            if self._file.write(rows) != rows.nbytes:
                raise OSError("Incomplete Grain Denoise scratch write.")
            self._tile_offsets[origin] = offset
            self._written_bytes += rows.nbytes
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
            phase = self._base
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

    def _prepare_region(self, y, x, height, width, *, fill_background=True):
        origins = tuple(self._intersecting(self._base, y, x, y + height, x + width))
        self._ensure(self._base, origins, fill_background=fill_background)

    def _prepared_fields(self, y, x, height, width):
        self._prepare_region(y, x, height, width)
        return self._read(y, x, height, width)

    def region(self, y, x, height, width, frame_height, frame_width, *, warm_only=False):
        if min(y, x) < 0 or min(height, width) < 1 or y + height > frame_height or x + width > frame_width:
            raise ValueError("Grain Denoise region exceeds the requested frame.")
        if not self._current():
            self.close()
            raise InterruptedError("A newer source replaced the Denoise preparation.")
        if self.height == frame_height and self.width == frame_width:
            if warm_only:
                self._prepare_region(y, x, height, width, fill_background=False)
                return None
            fields = self._prepared_fields(y, x, height, width)
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
            fields = self._prepared_fields(top, left, bottom - top, right - left)
            result[row:row + count] = _resize_window(fields, (x0, y0, x1, y1), (width, count),
                                                     (left, top), (block, xs, ys))
        return result.tobytes()


def resolve_grain(source, model, controls, *, allocate_output=None):
    evenness = controls.grain_evenness
    splotches = controls.color_splotches
    clean_splotches, clean_fringes = _colour_controls(controls)
    clean_splotches = clean_splotches and splotches > 0
    broad = clean_splotches and controls.splotch_size == "large"
    clean = clean_splotches or clean_fringes
    if (not clean and not evenness) or controls.amount <= 0 or not (controls.luminance or controls.color_noise):
        return adaptive._resolve_standard(source, model, controls, allocate_output=allocate_output)
    height, width = source.shape[:2]
    result = adaptive._denoise_output(source, allocate_output)
    read = lambda y, x, b, r: source[y:b, x:r]
    fit = fit_grain(height, width, read, model, controls) if evenness else None
    # Stage only the core and the pixels the next stage will read.
    downstream = _colour_margin(clean_splotches, clean_fringes, broad)
    size = adaptive.TILE_SIZE - 2 * downstream

    def run(origin):
        base, core = _resolved_tile(read, height, width, origin, size, downstream, model, controls, fit)
        y, x = origin
        rgb = base
        if clean:
            fringe, delta = colour_delta(base, broad, splotches=clean_splotches, fringes=clean_fringes, separate=True)
            if clean_fringes:
                rgb = apply_colour(rgb, fringe, 1)
            if delta is not None:
                rgb = apply_colour(rgb, delta, splotches)
        result[y:y+size, x:x+size, :3] = rgb[core]

    from itertools import count
    from .export_timing import tick
    origins = list(_origins(height, width, size))
    finished = count(1)
    lock = Lock()

    def run_and_report(origin):
        run(origin)
        with lock:
            done = next(finished)
        tick(done, len(origins))

    with CpuExecutor() as pool:
        list(pool.map(run_and_report, origins))
    if not adaptive._denoise_is_finite(result):
        raise FloatingPointError("Grain Denoise produced a non-finite value.")
    return result
