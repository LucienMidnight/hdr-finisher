"""Round 3 Micro Grain on signed Bayer and scene-linear RGB.

The supplied mosaic has already passed through the RAW cleanup and sensor
highlight stages. All neighbourhoods are local. The reader must supply the
full sensor or an even-aligned window with the required halo.
"""
from collections import OrderedDict
from contextvars import Context
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
import weakref

import cv2
import numpy as np

from . import app_memory, denoise_adaptive as wave, denoise_grain, signed_raw
from .cpu_budget import CpuExecutor, CpuWorkLimit, logical_cpus
from .denoise_quality import BAYER_NOISE_REFERENCE, enabled


BAYER_MARGIN = 80
DEMOSAIC_MARGIN = 12
SCENE_MARGIN = 112
VIEWPORT_BAYER_CACHE_BYTES = 256 * 1024**2
# A full core and its halos use up to about 160 MB of live working arrays.
# Model windows are smaller and run in a separate stage of each source build.
_TILE_WORK = CpuWorkLimit(min(logical_cpus(), max(1, app_memory.WORKING // 160_000_000)))
_STRIDES = (1, 2, 4, 8, 16)
_BRIGHTNESS_WEIGHTS = (0.16, 1.35, 4.5, 7.0, 8.0)
_OPPONENT = np.array(((.25, .25, .25, .25), (1, -.5, -.5, 0),
                      (0, -.5, -.5, 1), (0, 1, -1, 0)))
_B3_SHORT = np.asarray((.25, .50, .25), dtype=np.float32)


def _band_gains():
    parent = np.ones(1)
    result = []
    for stride in _STRIDES:
        kernel = np.zeros(2 * stride + 1)
        kernel[::stride] = _B3_SHORT
        child = np.convolve(parent, kernel)
        centred = np.pad(parent, stride)
        result.append(np.float32(np.linalg.norm(np.outer(centred, centred) - np.outer(child, child))))
        parent = child
    return tuple(result)


_GAINS = _band_gains()


@dataclass(frozen=True)
class MicroGrainControls:
    luminance: float = .5
    color: float = .5
    detail: float = .5

    @classmethod
    def from_settings(cls, controls):
        return cls(controls.micro_luminance, controls.micro_color, controls.micro_detail)

    @property
    def protection(self):
        return .85 + .30 * self.detail

    @property
    def fine_removal(self):
        return .52 - .20 * self.detail


@dataclass(frozen=True)
class BayerProfile:
    black: np.ndarray
    span: np.ndarray
    shot: np.ndarray
    read: np.ndarray
    opponent: np.ndarray
    inverse: np.ndarray
    cfa: np.ndarray
    lab: np.ndarray
    inverse_range: np.ndarray
    white_balance: np.ndarray
    acescg: np.ndarray

    @classmethod
    def from_camera(cls, config, camera, lab):
        pattern = camera.raw_pattern
        cfa = camera.raw_channel_to_rgb[pattern]
        colours = cfa.ravel()
        order = np.argsort(colours, kind="stable")
        black = np.asarray(config["black"], np.float32)
        span = np.asarray(config["spans"], np.float32)
        shot, read = np.asarray([(phase["a"], phase["b"]) for phase in config["noise"]], np.float32).T
        read += (1 / span) ** 2 / 12
        inverse_range = (1 / (camera.white_level - camera.black_level)).astype(np.float32)
        white_balance = camera.as_shot_wb.astype(np.float32)
        gain = (camera.as_shot_wb[colours] * np.asarray(config["spans"])
                / (camera.white_level - camera.black_level)[colours])
        opponent = (_OPPONENT @ (np.eye(4)[order] * gain)).astype(np.float32)
        inverse = np.linalg.inv(opponent).astype(np.float32)
        return cls(black, span, shot, read, opponent, inverse, cfa, lab, inverse_range,
                   white_balance, camera.camera_to_acescg.astype(np.float32))


def _box(values, size):
    return cv2.blur(values, (size, size), borderType=cv2.BORDER_REPLICATE)


def _lowpass(values, stride):
    kernel = np.zeros(2 * stride + 1, dtype=np.float32)
    kernel[::stride] = _B3_SHORT
    return cv2.sepFilter2D(values, -1, kernel, kernel, borderType=cv2.BORDER_REPLICATE)


def _ramp(value, low, scale):
    return np.clip((value - low) / scale, 0, 1)


def _structure(signal, variance, *, quiet, coherence_start, coherence_width, energy_start, energy_width):
    x = cv2.Sobel(signal, -1, 1, 0, ksize=3, scale=.125, borderType=cv2.BORDER_REPLICATE)
    y = cv2.Sobel(signal, -1, 0, 1, ksize=3, scale=.125, borderType=cv2.BORDER_REPLICATE)
    xx, yy, xy = (_box(product, 5) for product in (x * x, y * y, x * y))
    energy = xx + yy
    coherence = np.sqrt((xx - yy) ** 2 + 4 * xy ** 2) / np.maximum(energy, 1e-20)
    return 1 - quiet * _ramp(coherence, coherence_start, coherence_width) * _ramp(
        energy / variance, energy_start, energy_width
    )


def _highlight_guard(cells, profile):
    mean = _box(cells, 3)
    sigma = np.sqrt(profile.shot * np.maximum(mean, 0) + profile.read)
    if enabled("MICRO_GUARD"):
        scale = np.sqrt(profile.read) / np.float32(BAYER_NOISE_REFERENCE)
        threshold = np.maximum(.007 * scale, 5 * sigma)
        bright = np.any(cells >= .12 * scale, axis=-1)
    else:
        threshold = np.maximum(.007, 5 * sigma)
        bright = cells.max(axis=-1) >= .12
    seed = bright | (np.count_nonzero(cells - mean > threshold, axis=-1) >= 2)
    return cv2.dilate(seed.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)


def _lift_chroma(chroma, pilot, variance, confidence):
    base = _lowpass(chroma, 1)
    signal = base.copy()
    for stride in _STRIDES[1:]:
        for earlier, later in ((np.s_[:, :-stride], np.s_[:, stride:]),
                               (np.s_[:-stride, :], np.s_[stride:, :])):
            scale = .002 ** 2 + .75 * (variance[earlier] + variance[later])
            edge = (1 + (pilot[earlier] - pilot[later]) ** 2 / scale) ** -2
            weight = np.float32(.245) * edge * np.minimum(confidence[earlier], confidence[later])
            flux = (signal[later] - signal[earlier]) * weight[..., None]
            signal[earlier] += flux
            signal[later] -= flux
    return signal - base


def _packed_cells(sensor, profile):
    height, width = sensor.shape
    if height % 2 or width % 2 or min(height, width) < 2:
        raise ValueError("Micro Grain needs a complete Bayer cell at each sensor edge")
    codes = sensor.reshape(height // 2, 2, width // 2, 2).transpose(0, 2, 1, 3)
    return (codes.reshape(height // 2, width // 2, 4).astype(np.float32) - profile.black) / profile.span


class BayerTile:
    """Sensor coefficients for one bounded, phase-aligned native tile."""

    @staticmethod
    def retained_nbytes(width, height):
        planes = 4 + 2 + 3 * len(_STRIDES) + 4
        return width * height // 4 * (1 + planes * np.dtype(np.float32).itemsize)

    def __init__(self, sensor, profile, *, color=True):
        self.profile = profile
        self.cells = _packed_cells(sensor, profile)
        self.guard = _highlight_guard(self.cells, profile)
        field = self.cells @ profile.opponent.T
        variance = (profile.shot * np.maximum(_box(self.cells, 5), 0) + profile.read) @ (profile.opponent[0] ** 2)
        sigma = np.sqrt(variance)
        luma = field[..., 0]
        fine = luma - _lowpass(luma, 1)
        pilot = luma - np.copysign(np.minimum(np.abs(fine), sigma * _GAINS[0]), fine)
        guide = _lowpass(pilot, 1)
        gate = _structure(guide, variance, quiet=.85, coherence_start=.35, coherence_width=.50,
                          energy_start=.045, energy_width=.35)
        self.detail_gate = _structure(_box(pilot, 5), variance, quiet=.98, coherence_start=.48,
                                      coherence_width=.38, energy_start=.002, energy_width=.026)
        self.brightness_gate = np.minimum(gate, self.detail_gate)
        self.bands = []
        for stride, gain, weight in zip(_STRIDES, _GAINS, _BRIGHTNESS_WEIGHTS):
            low = _lowpass(luma, stride)
            band = luma - low
            noise = sigma * gain
            local = np.maximum(_box((band / noise) ** 2, 5) - 1, 0)
            self.bands.append((band, noise, np.sqrt(np.clip(local, .09, 16)), weight))
            luma = low
        self.chroma = (_lift_chroma(field[..., 1:], pilot, variance, gate ** 2 * ~self.guard)
                       @ profile.inverse[:, 1:].T) if color else None

    @property
    def nbytes(self):
        return (self.cells.nbytes + self.guard.nbytes + self.detail_gate.nbytes + self.brightness_gate.nbytes
                + sum(band.nbytes + noise.nbytes + local.nbytes for band, noise, local, _ in self.bands)
                + (self.chroma.nbytes if self.chroma is not None else 0))

    def apply(self, controls, central, *, signed_clips=None):
        """Return the encoded mosaic and packed structure gate for the AHD tile."""
        protection = 1 - self.brightness_gate
        fine = np.clip(1 - np.float32(controls.protection) * protection, 0, 1)
        broad = 1 - np.float32(.8 * controls.protection) * protection
        brightness = np.zeros_like(fine)
        for level, (band, noise, local, weight) in enumerate(self.bands):
            gate = fine if level < 2 else broad
            strength = np.float32(1.4 * controls.luminance) * weight * gate / local
            brightness -= np.sign(band) * np.minimum(np.abs(band), noise * strength)
        brightness -= _box(brightness, 13)
        delta = brightness[central][..., None] * self.profile.inverse[:, 0]
        if controls.color:
            delta += np.float32(1.4 * controls.color) * self.chroma[central]
        original = self.cells[central]
        adjusted = np.where(self.guard[central][..., None], original, original + delta)
        rounded = np.rint(adjusted * self.profile.span + self.profile.black)
        if signed_clips is not None:
            signed_clips(rounded < 0)
        codes = np.clip(rounded, 0, 65535).astype(np.uint16)
        height, width = codes.shape[:2]
        return codes.reshape(height, width, 2, 2).transpose(0, 2, 1, 3).reshape(height * 2, width * 2)


def resolve_scene(rgb, model, controls, edges, detail_gate):
    """Apply centred adaptive differences, then centred Small colour repair."""
    adaptive = wave.AdaptiveControls(luminance=.20 * controls.luminance,
                                     color_noise=1.80 * controls.color)
    correction = np.zeros_like(rgb)
    for level, (band, gains, _) in enumerate(wave._bands(rgb, model, adaptive, edges)):
        for component, gain in enumerate(gains):
            scale = controls.fine_removal if level == component == 0 else 1
            correction[..., component] += band[..., component] * (gain - 1) * scale
    chroma = correction[..., 1:]
    chroma -= _box(chroma, 65)
    result = denoise_grain.apply_colour(rgb, chroma, 1.)
    if controls.luminance:
        gate = np.clip(1 - np.float32(controls.protection) * (1 - detail_gate), 0, 1)
        brightness = correction[..., 0] * wave.OPPONENT[0, 0] * gate
        brightness -= _box(brightness, 65)
        result += brightness[..., None]
    if controls.color:
        repair = denoise_grain.colour_delta(result, False)
        repair -= _box(repair, 65)
        result = denoise_grain.apply_colour(result, repair, 2 * controls.color)
    return result


def _expand(rect, shape, margin, *, even=False):
    x, y, right, bottom = rect
    height, width = shape
    if even:
        x, y = (x - margin) // 2 * 2, (y - margin) // 2 * 2
        right, bottom = (right + margin + 1) // 2 * 2, (bottom + margin + 1) // 2 * 2
    else:
        x, y, right, bottom = x - margin, y - margin, right + margin, bottom + margin
    return max(0, x), max(0, y), min(width, right), min(height, bottom)


def _inset(rect, outer, *, step=1):
    x, y, right, bottom = ((a - b) // step for a, b in zip(rect, (*outer[:2], *outer[:2])))
    return np.s_[y:bottom, x:right]


def tile_regions(rect, shape):
    target = _expand(rect, shape, SCENE_MARGIN)
    demosaic = _expand(target, shape, DEMOSAIC_MARGIN, even=True)
    outer = _expand(demosaic, shape, BAYER_MARGIN, even=True)
    return outer, demosaic, target


def develop_tile(raw, profile, controls, outer, demosaic, target, cancelled=None):
    cells = _inset(demosaic, outer, step=2)
    mosaic = raw.apply(controls, cells)
    rgb = signed_raw.demosaic(mosaic, profile.cfa, profile.black.reshape(2, 2), profile.lab, cancelled=cancelled)
    rgb *= profile.inverse_range
    rgb *= profile.white_balance
    view = _inset(target, demosaic)
    rgb = (rgb @ profile.acescg.T)[view].copy()
    gate = raw.detail_gate[cells].repeat(2, axis=0).repeat(2, axis=1)[view]
    return rgb, gate


def render_tile(sensor, profile, model, controls, rect, *, cancelled=None):
    """Return a sensor-coordinate core. Scratch is bounded by the caller's core."""
    outer, demosaic, target = tile_regions(rect, sensor.shape)
    raw = BayerTile(sensor[_inset(outer, (0, 0, 0, 0))], profile, color=bool(controls.color))
    rgb, gate = develop_tile(raw, profile, controls, outer, demosaic, target, cancelled)
    if controls.color or controls.luminance:
        x, y, right, bottom = target
        height, width = sensor.shape
        edges = wave._Edges(y == 0, bottom == height, x == 0, right == width, height, width)
        rgb = resolve_scene(rgb, model, controls, edges, gate)
    return rgb[_inset(rect, target)].copy()


class MicroGrainUnavailable(ValueError):
    pass


def unavailable_reason(frame):
    owner = getattr(frame, "delivery_owner", frame)
    metadata = getattr(owner, "metadata", {})
    if not metadata.get("raw_development", {}).get("signed_sensor_samples") or metadata.get("dng_input"):
        return "Micro Grain needs an ordinary Bayer RAW."
    if any(edge % 2 for edge in owner.image.shape[:2]):
        return "Micro Grain needs complete Bayer cells at the sensor edges."
    highlights = owner.raw_import_settings.highlight_reconstruction
    if highlights.enabled and highlights.method == "edge_colour_v1":
        return "Micro Grain is not available with Edge Colour highlight reconstruction."
    if getattr(owner, "repairs", None):
        return "Micro Grain is not available with retouch repairs."
    return None


def _sensor_rect(rect, shape, flip):
    left, top, right, bottom = rect
    height, width = shape
    if flip == 3:
        return width-right, height-bottom, width-left, height-top
    if flip == 5:
        return width-bottom, left, width-top, right
    if flip == 6:
        return top, height-right, bottom, height-left
    return rect


class MicroGrainSource:
    def __init__(self, path, settings, *, cancelled=None):
        import rawpy
        from . import raw_import, raw_pixel_cleanup, raw_speck_cleanup
        from .import_defaults import RAW_CALIBRATION_EV, fuji_dynamic_range

        with rawpy.imread(str(path)) as raw:
            camera = raw_import._camera_linear_metadata_from_libraw(raw)
            mosaic = raw.raw_image_visible
            if camera.raw_pattern.shape != (2, 2):
                raise MicroGrainUnavailable("Micro Grain needs a Bayer RAW.")
            config = raw_pixel_cleanup.configuration(mosaic, camera, cancelled=cancelled)
            if config is None:
                raise MicroGrainUnavailable("Could not measure this Bayer sensor's noise.")
            self.profile = BayerProfile.from_camera(config, camera, raw_import._ahd_lab_matrix(raw))
            pixel = settings.pixel_cleanup
            if pixel.remove_hot_pixels:
                raw_pixel_cleanup.apply(mosaic, config, cancelled=cancelled)
            if pixel.even_out_specks:
                raw_speck_cleanup.apply(mosaic, config, pixel.speck_threshold, cancelled=cancelled)
            raw_import._apply_raw_highlight_reconstruction(raw, camera, settings, cancelled=cancelled)
            self.sensor = mosaic.copy()
            self.flip = int(raw.sizes.flip)
        self.shape = self.sensor.shape[::-1] if self.flip in (5, 6) else self.sensor.shape
        self.gain = np.float32(2 ** (RAW_CALIBRATION_EV + {200: 1, 400: 2}.get(fuji_dynamic_range(path), 0)))
        self.model = wave.estimate_adaptive_model_from_windows(
            *self.shape,
            lambda *window: self.read_unfiltered(*window, cancelled=cancelled),
            workers=_TILE_WORK.workers,
        )
        self.tiles = OrderedDict()
        self.tiles_lock = RLock()

    @property
    def prepared_nbytes(self):
        # The GPU route accounts for retained Bayer tiles separately.
        return self.sensor.nbytes + sum(array.nbytes for array in vars(self.profile).values())

    def clear_bayer_cache(self):
        with self.tiles_lock:
            self.tiles.clear()
            self._claim_recent_source_tiles(0)

    def _claim_recent_source_tiles(self, tiles_bytes, *, extra=0):
        # Called with tiles_lock held. Reclaim can drop the cache reference
        # without touching this source's tiles or an in-flight region.
        with _source_lock:
            if self is not _recent_source[1]:
                return True
            retained = self.prepared_nbytes + tiles_bytes
            if app_memory.claim(_SOURCE_RAM_KEY, "working", retained + extra):
                return True
            app_memory.claim(_SOURCE_RAM_KEY, "working", retained)
            return False

    def read_unfiltered(self, top, left, bottom, right, *, cancelled=None):
        rect = _sensor_rect((left, top, right, bottom), self.sensor.shape, self.flip)
        outer = _expand(rect, self.sensor.shape, DEMOSAIC_MARGIN, even=True)
        profile = self.profile
        rgb = signed_raw.demosaic(self.sensor[_inset(outer, (0, 0, 0, 0))], profile.cfa,
                                 profile.black.reshape(2, 2), profile.lab, cancelled=cancelled)
        rgb *= profile.inverse_range
        rgb *= profile.white_balance
        return signed_raw.orient((rgb @ profile.acescg.T)[_inset(rect, outer)], self.flip)

    def develop_region(self, rect, controls, *, retain=False, cancelled=None):
        raw, outer, demosaic, sensor_rect = self.bayer_region(rect, controls, retain=retain)
        rgb, gate = develop_tile(raw, self.profile, controls, outer, demosaic, sensor_rect, cancelled)
        return signed_raw.orient(rgb, self.flip), signed_raw.orient(gate, self.flip)

    def bayer_region(self, rect, controls, *, retain):
        sensor_rect = _sensor_rect(rect, self.sensor.shape, self.flip)
        demosaic = _expand(sensor_rect, self.sensor.shape, DEMOSAIC_MARGIN, even=True)
        outer = _expand(demosaic, self.sensor.shape, BAYER_MARGIN, even=True)
        sensor = self.sensor[_inset(outer, (0, 0, 0, 0))]
        if not retain:
            if (rect[2] - rect[0]) * (rect[3] - rect[1]) > 512 * 512:
                self.clear_bayer_cache()
            return BayerTile(sensor, self.profile, color=bool(controls.color)), outer, demosaic, sensor_rect
        with self.tiles_lock:
            raw = self.tiles.get(outer)
            if raw is not None:
                self.tiles.move_to_end(outer)
            else:
                size = BayerTile.retained_nbytes(outer[2] - outer[0], outer[3] - outer[1])
                while self.tiles and size + sum(tile.nbytes for tile in self.tiles.values()) > VIEWPORT_BAYER_CACHE_BYTES:
                    self.tiles.popitem(last=False)
                raw = BayerTile(sensor, self.profile)
                retained = sum(tile.nbytes for tile in self.tiles.values())
                extra = raw.nbytes if raw.nbytes <= VIEWPORT_BAYER_CACHE_BYTES else 0
                if self._claim_recent_source_tiles(retained, extra=extra) and extra:
                    self.tiles[outer] = raw
        return raw, outer, demosaic, sensor_rect

    def gpu_region(self, rect, controls, *, retain):
        from .library_gpu_raw import frame

        raw, outer, demosaic, sensor_rect = self.bayer_region(rect, controls, retain=retain)
        cells = _inset(demosaic, outer, step=2)
        mosaic = raw.apply(controls, cells)
        gate = np.ascontiguousarray(raw.detail_gate[cells], dtype="<f4")
        height, width = mosaic.shape
        profile = self.profile
        return frame({"width": width, "height": height, "flip": self.flip,
                      "offset": [sensor_rect[0]-demosaic[0], sensor_rect[1]-demosaic[1]],
                      "crop": [sensor_rect[2]-sensor_rect[0], sensor_rect[3]-sensor_rect[1]],
                      "phase_width": gate.shape[1], "mosaic_bytes": mosaic.nbytes,
                      "cfa": profile.cfa.ravel().tolist(), "black": profile.black.tolist(),
                      "wb": profile.white_balance.tolist(), "inv_range": profile.inverse_range.tolist(),
                      "aces": profile.acescg.tolist(), "lab": profile.lab.tolist()},
                     mosaic.astype("<u2", copy=False).tobytes(), b"\0" * (-mosaic.nbytes % 4), gate.tobytes())

    def render_core(self, controls, rect, *, cancelled=None):
        if cancelled and cancelled():
            raise InterruptedError("Micro Grain was replaced.")
        height, width = self.shape
        target = _expand(rect, self.shape, SCENE_MARGIN)
        rgb, gate = self.develop_region(target, controls, cancelled=cancelled)
        west, north, east, south = target
        edges = wave._Edges(north == 0, south == height, west == 0, east == width, height, width)
        return resolve_scene(rgb, self.model, controls, edges, gate)[_inset(rect, target)].copy()

    def cores(self, rect):
        left, top, right, bottom = rect
        height, width = self.shape
        return ((x, y, min(x + 768, width), min(y + 512, height))
                for y in range(top // 512 * 512, bottom, 512)
                for x in range(left // 768 * 768, right, 768))

    def render(self, controls, *, cancelled=None):
        height, width = self.shape
        result = np.empty((height, width, 3), np.float32)

        def render_core(rect):
            left, top, right, bottom = rect
            result[top:bottom, left:right] = self.render_core(controls, rect, cancelled=cancelled)

        # Each job owns its scratch and writes a distinct rectangle. Keep all
        # futures until completion so cancellation joins every running writer.
        with CpuExecutor(work_limit=_TILE_WORK) as pool:
            for _ in pool.map(render_core, self.cores((0, 0, width, height))):
                pass
        return result


_prepare_lock = RLock()
_source_lock = RLock()
_recent_source = (None, None)
_SOURCE_RAM_KEY = "micro-grain-gpu-source"


def _trim_recent_source(_target):
    global _recent_source
    with _source_lock:
        if _recent_source[1] is not None:
            _recent_source = (None, None)
            app_memory.claim(_SOURCE_RAM_KEY, "working", 0)


app_memory.register(_SOURCE_RAM_KEY, "working", _trim_recent_source)


def preparation_key(frame):
    path = Path(frame.source_path)
    stat = path.stat()
    # Lensfun is applied to the finished Micro RGB, after the sensor
    # preparation and noise fit. Keep every other RAW setting in this key.
    return (path, stat.st_mtime_ns, stat.st_size, getattr(frame, "source_fingerprint_sha256", None),
            frame.raw_import_settings.model_dump_json(exclude={"lens"}))


def take_recent_preparation(key):
    """Hand the admitted GPU preparation to the CPU session cache."""
    with _source_lock:
        if key != _recent_source[0]:
            return None
        source = _recent_source[1]
        _trim_recent_source(0)
    # Tiles belong to the GPU cache. Clear them outside the source lock:
    # GPU region reads may take the tile lock first.
    source.clear_bayer_cache()
    return source


def prepare_source(frame, *, cancelled=None, retain=True):
    global _recent_source
    if reason := unavailable_reason(frame):
        raise MicroGrainUnavailable(reason)
    owner = getattr(frame, "delivery_owner", frame)
    path = Path(owner.source_path)
    settings = owner.raw_import_settings
    key = preparation_key(owner)
    with _prepare_lock:
        with _source_lock:
            if key == _recent_source[0]:
                return _recent_source[1]
            _trim_recent_source(0)
        source = MicroGrainSource(path, settings, cancelled=cancelled)
        if retain:
            with _source_lock:
                if app_memory.claim(_SOURCE_RAM_KEY, "working", source.prepared_nbytes):
                    _recent_source = (key, source)
        return source


def resolve_source(frame, controls, *, cancelled=None):
    owner = getattr(frame, "delivery_owner", frame)
    if unavailable_reason(owner) or not (controls.luminance or controls.color):
        return frame.image
    source = prepare_source(owner, cancelled=cancelled, retain=False)
    source.clear_bayer_cache()
    return render_prepared_source(frame, source, controls, cancelled=cancelled)


def _lens_inputs(owner):
    exif = owner.metadata.get("raw_exif", {})
    lens = owner.raw_import_settings.lens
    lens = lens.model_copy(update={key: getattr(lens, key) or exif.get(key)
                                  for key in ("focal_length_mm", "aperture", "focus_distance_m")})
    return lens, dict(camera_maker=exif.get("camera_maker"), camera_model=exif.get("camera_model"),
                      lens_maker=exif.get("lens_maker"), lens_name=exif.get("lens_model") or exif.get("lens_name"))


def render_prepared_source(frame, source, controls, *, cancelled=None, render=None, allocate_lens_output=None,
                           timings=None):
    from time import perf_counter

    from . import raw_import
    from .preview import downsample_image

    owner = getattr(frame, "delivery_owner", frame)
    started = perf_counter()
    result = source.render(controls, cancelled=cancelled) if render is None else render(cancelled)
    if timings is not None:
        timings["micro_render_ms"] = round((perf_counter() - started) * 1000, 2)
    started = perf_counter()
    if owner.metadata.get("lens_correction", {}).get("applied"):
        lens, profile = _lens_inputs(owner)
        result, _ = raw_import.apply_lens_correction(
            result, lens, **profile, cancelled=cancelled, consume_input=True, allocate_output=allocate_lens_output,
        )
    if timings is not None and owner.metadata.get("lens_correction", {}).get("applied"):
        timings["micro_lens_ms"] = round((perf_counter() - started) * 1000, 2)
    started = perf_counter()
    result *= source.gain
    if isinstance(result, np.memmap):
        result.flush()
    height, width = frame.image.shape[:2]
    result = result if result.shape[:2] == (height, width) else downsample_image(result, max(height, width))
    if timings is not None:
        timings["micro_source_finish_ms"] = round((perf_counter() - started) * 1000, 2)
    return result


class MicroRegionRefused(ValueError):
    pass


def _lens_region(frame, shape, rect):
    """Return the source bounds and exact map for a lens-corrected output window."""
    from .raw_import import _lens_modifier

    if not frame.metadata.get("lens_correction", {}).get("applied"):
        return rect, None, None, 0

    lens, profile = _lens_inputs(frame)
    modifier, metadata = _lens_modifier(shape, lens, **profile)
    if modifier is None:
        return rect, None, None, 0
    vignette = modifier if metadata["vignetting"] and metadata["profile"]["vignetting"] else None
    left, top, right, bottom = rect
    height, width = shape
    make_coordinates = (modifier.apply_subpixel_geometry_distortion if lens.chromatic_aberration
                        else modifier.apply_geometry_distortion if lens.distortion else None)
    if make_coordinates is None:
        return rect, None, vignette, 0

    # Lensfun accumulates float32 x and y starting at zero. Keep the original
    # origin and row width (including the original SIMD tail), only omit rows
    # below the viewport. Copy the viewport out so the prefix is released.
    prefix = make_coordinates(height=bottom)
    if prefix is None:
        return rect, None, vignette, 0
    coordinate_bytes = prefix.nbytes
    coordinates = prefix[top:bottom, left:right].copy()
    del prefix
    if not np.isfinite(coordinates).all():
        raise MicroRegionRefused("micro_unbounded_lens_mapping")

    # Inspect every mapped sample, including all edges and all TCA channels.
    # Include the bilinear neighbour and two spare pixels on each side.
    ranges = [(float(coordinates[..., axis].min()), float(coordinates[..., axis].max()))
              for axis in range(2)]
    x0, x1 = np.clip(ranges[0], 0, width - 1).astype(int)
    y0, y1 = np.clip(ranges[1], 0, height - 1).astype(int)
    bounds = (max(0, x0 - 2), max(0, y0 - 2), min(width, x1 + 4), min(height, y1 + 4))
    if (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 4 * (right - left) * (bottom - top):
        raise MicroRegionRefused("micro_extreme_lens_mapping")
    return bounds, coordinates, vignette, coordinate_bytes + coordinates.nbytes


def _vignette_region(modifier, shape, rect, pixels):
    # lensfunpy's float-image API requires the original shape, pitch and
    # origin. Only the sampled pixels need input values or sign restoration.
    left, top, right, bottom = rect
    scratch = np.zeros((*shape, 3), dtype=np.float32)
    window = scratch[top:bottom, left:right]
    np.abs(pixels, out=window)
    modifier.apply_color_modification(scratch)
    np.copysign(window, pixels, out=pixels)


def micro_background_allowed():
    from .grain_work import background_fill_allowed

    return background_fill_allowed()


class MicroPreviewTiles:
    """One source and control setting, with one low-priority tile in flight."""

    def __init__(self, source, controls):
        self.source = weakref.ref(source)
        self.controls = controls
        self.pool = CpuExecutor(work_limit=_TILE_WORK)
        self.lock = RLock()
        self.ready = {}
        self.inflight = {}
        self.bytes = 0
        self.closed = False
        self.foreground = 0
        self.consuming = False
        self.fill = None
        self.ram_key = f"micro-preview-tiles-{id(self)}"
        app_memory.register(self.ram_key, "working", self.trim)

    def trim(self, target):
        with self.lock:
            if target < self.bytes:
                # Reclamation ends this fill. A later visible read can restart it.
                self.fill = None
            while self.ready and self.bytes > target:
                _, tile = self.ready.popitem()
                self.bytes -= tile.nbytes
            app_memory.claim(self.ram_key, "working", self.bytes)

    def close(self):
        with self.lock:
            self.closed = True
            self.fill = None
            self.pool.shutdown(wait=False, cancel_futures=True)
            self.ready.clear()
            self.bytes = 0
            app_memory.forget(self.ram_key)

    def _submit(self, source, core, *, background=False, retain=True):
        if core in self.inflight:
            return self.inflight[core]

        def work():
            return source.render_core(self.controls, core, cancelled=lambda: self.closed)

        # A useful source tile can outlive the preview request that queued it.
        # Isolate it from the request's grain cancellation and diagnostics.
        future = Context().run(self.pool.submit_background if background else self.pool.submit, work)
        self.inflight[core] = future
        future.add_done_callback(lambda done: self._finished(core, done, background, retain))
        return future

    def _finished(self, core, future, background, retain):
        with self.lock:
            self.inflight.pop(core)
            if self.closed or not retain or self.consuming or future.cancelled() or future.exception() is not None:
                return
            tile = future.result()
            if app_memory.claim(self.ram_key, "working", self.bytes + tile.nbytes):
                self.ready[core] = tile
                self.bytes += tile.nbytes
            else:
                self.fill = None
            if background:
                self._fill_next()

    def _fill_next(self):
        if self.fill is None or self.foreground or self.inflight or self.closed:
            return
        source = self.source()
        if source is None or not micro_background_allowed():
            self.fill = None
            return
        core = next((item for item in self.fill if item not in self.ready), None)
        if core is not None:
            self._submit(source, core, background=True)

    def start_fill(self, source):
        with self.lock:
            if self.fill is None:
                height, width = source.shape
                self.fill = iter(source.cores((0, 0, width, height)))
            self._fill_next()

    def read(self, source, rect, *, cancelled, consume=False):
        from concurrent.futures import wait
        from .render_cache import StaleRender

        left, top, right, bottom = rect
        output = np.empty((bottom - top, right - left, 3), dtype=np.float32)
        with self.lock:
            if self.closed:
                raise StaleRender("The CPU Micro Grain source changed.")
            self.foreground += 1
            if consume:
                self.consuming = True
                self.fill = None
        try:
            # Submit only a worker batch at a time. Completed futures cannot
            # hold an unaccounted whole frame alongside the destination.
            from itertools import islice
            cores = source.cores(rect)
            while batch := list(islice(cores, _TILE_WORK.workers)):
                if cancelled():
                    raise StaleRender("The CPU Micro Grain preview was replaced.")
                with self.lock:
                    if self.closed:
                        raise StaleRender("The CPU Micro Grain source changed.")
                    pending = []
                    for core in batch:
                        tile = self.ready.pop(core, None) if consume else self.ready.get(core)
                        if tile is not None:
                            if consume:
                                self.bytes -= tile.nbytes
                            pending.append((core, tile, None))
                        else:
                            pending.append((core, None, self._submit(source, core, retain=not consume)))
                    if consume:
                        app_memory.claim(self.ram_key, "working", self.bytes)
                for core, tile, future in pending:
                    if future is not None:
                        while not wait((future,), timeout=0.05).done:
                            if cancelled():
                                raise StaleRender("The CPU Micro Grain preview was replaced.")
                        tile = future.result()
                    x, y, end_x, end_y = core
                    x0, y0, x1, y1 = max(left, x), max(top, y), min(right, end_x), min(bottom, end_y)
                    output[y0-top:y1-top, x0-left:x1-left] = tile[y0-y:y1-y, x0-x:x1-x]
            return output
        finally:
            with self.lock:
                self.foreground -= 1
                if consume:
                    self.consuming = False
                self._fill_next()
