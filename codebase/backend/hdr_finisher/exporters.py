from __future__ import annotations

from .export_timing import timed as _timed_stage
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, closing, contextmanager, nullcontext
from contextvars import ContextVar
from dataclasses import dataclass, field
import gc
from io import BytesIO
import os
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory, TemporaryFile
import subprocess
from time import perf_counter
from typing import BinaryIO, Callable
import zlib

import numpy as np

from .adjustments import (
    apply_adjustments,
    apply_hdr_output_highlight_compression,
    apply_sdr_output_highlight_compression,
)
from .binaries import resolve_binary
from .subprocess_utils import hidden_window_options
from .color import acescg_to_linear_bt2020
from .color_context import RenderColorContext, scene_linear_to_nits
from . import denoise_adaptive, gainmap_filter
from .delivery_frames import DeliveryFrame, row_bands
from .config import EXPORTS_DIR, SAMPLES_DIR
from .finishing import apply_output_finishing
from .peak_accuracy import measurement_warnings
from .gainmap_decoders import parse_jpeg_gain_map_probe
from .models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportResponse, ExportSettings, PreviewKind
from .jpegxl import (
    JPEGXLError,
    encode_hdr_jpegxl,
    encode_sdr_jpegxl,
    validate_jpegxl,
    validate_sdr_jpegxl,
    verify_lossless_jpegxl,
)
from .test_pattern import build_hdr_test_pattern
from .y4m import write_y4m_bands
from .hdr_ceiling import (
    ENCODING_ALLOWANCE,
    decoded_avif_ceiling,
    decoded_channel_nits,
    decoded_ultrahdr_ceiling,
    delivery_ceiling_nits,
    encode_within_ceiling,
)


SDR_WHITE_NITS = 203.0
# JPEG Ultra HDR stores its gain map in eight bits. Leave enough latitude for
# independently authored SDR/HDR color differences while preventing near-zero
# channel ratios from consuming libultrahdr's entire -14.3..15.6 stop range.
# A 16x difference in either direction is already generous for a publishing
# rendition; the positive bound expands further when the authored HDR peak
# requires it.
ULTRAHDR_CHROMATIC_LATITUDE_STOPS = 4.0
# Ultra HDR reconstructs multiplicatively, so a base code of zero carries no HDR
# detail at any gain. Two codes sit below the visible threshold in the SDR base
# and keep the shadow recoverable.
ULTRAHDR_BASE_FLOOR_CODE = 2
# A small guided filter removes pixel-scale HDR/SDR ratio noise before Safari
# and other viewers multiply it back into the SDR primary. The encoded SDR
# remains untouched, and the SDR image itself guides the filter so real edges
# are retained. These defaults were visually accepted on the DSC01286 Sony RAW
# fixture in both Safari and Chrome.
ULTRAHDR_GAIN_MAP_DENOISE_RADIUS = 2
ULTRAHDR_GAIN_MAP_DENOISE_EPSILON = 0.0025
ULTRAHDR_GAIN_MAP_DENOISE_AMOUNT = 0.75
ULTRAHDR_GAIN_MAP_DENOISE_STRIPE_ROWS = 256


class ExportBackend(ABC):
    name: str

    def __init__(self, capability: CapabilityInfo) -> None:
        self.capability = capability

    @abstractmethod
    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        raise NotImplementedError


class ExportOverwriteRequired(FileExistsError):
    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        super().__init__(f"A file already exists at {output_path}")


def _finishing_adjustments_for_export(session: object) -> AdjustmentState:
    """Strip viewer-only diagnostic maps without changing the saved grade."""
    adjustments = getattr(session, "adjustments").model_copy(deep=True)
    adjustments.hdr.film_look.halation_view_map = False
    adjustments.sdr.film_look.halation_view_map = False
    adjustments.hdr.film_look.grain_view_map = False
    adjustments.sdr.film_look.grain_view_map = False
    return adjustments


def denoise_settings_for_export(session: object, kind: PreviewKind) -> object | None:
    """The authored denoise for this lane, or None when it contributes nothing.

    Denoise is authored beside the grade rather than inside
    ``AdjustmentState``, which is why the export graph did not see it: it
    grades ``session.image`` through ``apply_adjustments``, and the settings
    are not reachable from there.

    ``LoadedSession`` holds them directly; an ``EditDocument`` holds them one
    level down. Both are read, because export is handed whichever the caller
    has, and a lookup that found neither would silently drop the denoise all
    over again.
    """
    denoise = getattr(session, "denoise", None)
    if denoise is None:
        document = getattr(session, "document", None)
        denoise = getattr(document, "denoise", None) if document is not None else None
    if denoise is None or not hasattr(denoise, "hdr"):
        return None
    lane = denoise.hdr if kind == PreviewKind.HDR else denoise.sdr
    if not lane.enabled:
        return None
    controls = lane.controls
    if controls.method == "micro_grain":
        return lane if controls.micro_luminance or controls.micro_color else None
    # The same short-circuit the reconstruction itself applies: zero amount, or
    # neither channel weighted, removes nothing.
    if controls.amount <= 0.0 or (controls.luminance <= 0.0 and controls.color_noise <= 0.0):
        return None
    return lane


def denoise_delivery_key(session: object) -> tuple:
    return tuple(
        lane.controls.model_dump_json() if (lane := denoise_settings_for_export(session, kind)) else None
        for kind in (PreviewKind.HDR, PreviewKind.SDR)
    )


def _resolve_export_denoise(image, model, controls, render_grain):
    if render_grain is None:
        return denoise_adaptive.resolve_adaptive(image, model, controls)
    return render_grain(lambda allocate: denoise_adaptive.resolve_adaptive(
        image, model, controls, allocate_output=allocate))


def _denoised_export_source(session: object, kind: PreviewKind, *, render_grain=None) -> np.ndarray:
    """Apply the authored denoise to the full-resolution source.

    The preview replaces its *source proxy* with the reconstruction and grades
    that, so export has to denoise before grading too, or the two would differ
    by where in the graph the noise was removed rather than by resolution.

    The noise model is measured at the export's own resolution, as the preview
    measures at its own: noise per pixel depends on the scale it is read at.
    """
    image = getattr(session, "image")
    lane = denoise_settings_for_export(session, kind)
    if lane is None:
        return image
    controls = lane.controls
    if controls.method == "micro_grain":
        from .denoise_micro_grain import MicroGrainControls, resolve_source
        return resolve_source(session, MicroGrainControls.from_settings(controls))
    from .denoise_measurement import cpu_delivery_model
    model = cpu_delivery_model(session)
    return _resolve_export_denoise(
        image, model, denoise_adaptive.AdaptiveControls(**controls.model_dump()), render_grain)


def _authored_sdr_base(session, kind, adjustments):
    return (kind == PreviewKind.SDR and getattr(session, "sdr_reference_image", None) is not None
            and adjustments.sdr.use_authored_base and not adjustments.sdr.linked_to_hdr)


def _delivery_source_filter(session, kind, adjustments, *, authored, render_grain=None):
    lane = denoise_settings_for_export(session, kind)
    if lane is None:
        return None
    if lane.controls.method == "micro_grain":
        return (lambda image, authored: image) if authored else None
    controls = denoise_adaptive.AdaptiveControls(**lane.controls.model_dump())
    experimental = controls.method == "clean_grain" and (
        controls.grain_evenness or (controls.clean_color and controls.color_splotches)
    )
    if not authored and not experimental:
        return None

    def resolve(image, authored):
        from .denoise_measurement import cpu_delivery_model
        model = cpu_delivery_model(session, authored_image=image if authored else None,
                                   geometry=adjustments.shared.geometry)
        return _resolve_export_denoise(image, model, controls, render_grain)

    return resolve


@dataclass
class _DeliveryGrain:
    session: object
    source: np.ndarray
    controls_key: str | None
    scratch: BinaryIO | None
    render_grain: Callable | None = None
    pixels: np.ndarray | None = None
    mapped_shape: tuple[int, ...] | None = None
    mapped_dtype: np.dtype | None = None

    def resolved(self) -> bool:
        return self.pixels is not None or self.mapped_shape is not None

    def resolve(self, render):
        if self.pixels is not None:
            return self.pixels
        if self.mapped_shape is not None:
            return np.memmap(self.scratch, dtype=self.mapped_dtype, mode="r", shape=self.mapped_shape)
        pixels = render()
        if self.scratch is None:
            self.pixels = pixels
        else:
            # Proof reuses the source across an encoder pass. The mapping is
            # held only by a render, so the encoder does not hold this frame.
            pixels.tofile(self.scratch)
            self.mapped_shape, self.mapped_dtype = pixels.shape, pixels.dtype
        return pixels


_delivery_grain: ContextVar[_DeliveryGrain | None] = ContextVar("delivery_grain", default=None)


def _delivery_grain_shared(session, adjustments) -> bool:
    """Whether HDR and SDR resolve one Grain source between them."""
    hdr = denoise_settings_for_export(session, PreviewKind.HDR)
    sdr = denoise_settings_for_export(session, PreviewKind.SDR)
    return (hdr is not None and sdr is not None and hdr.controls.method not in {"standard", "micro_grain"}
            and hdr.controls == sdr.controls and not _authored_sdr_base(session, PreviewKind.SDR, adjustments))


@contextmanager
def share_delivery_grain(session, adjustments, *, spans_encoding=False, render_grain=None):
    """Keep one resolved Grain source for the duration of an export or Proof."""
    active = _delivery_grain.get()
    if active is not None and active.session is session:
        yield
        return
    hdr = denoise_settings_for_export(session, PreviewKind.HDR)
    matched = _delivery_grain_shared(session, adjustments)
    if not matched and render_grain is None:
        yield
        return
    key = hdr.controls.model_dump_json() if matched else None
    with TemporaryFile() if spans_encoding and matched else nullcontext() as scratch:
        token = _delivery_grain.set(_DeliveryGrain(session, session.image, key, scratch, render_grain))
        try:
            yield
        finally:
            _delivery_grain.reset(token)


def delivery_denoise_inputs(session, kind, adjustments):
    authored = _authored_sdr_base(session, kind, adjustments)
    shared = _delivery_grain.get()
    if shared is not None and (shared.session is not session or shared.source is not session.image):
        shared = None
    render_grain = shared.render_grain if shared is not None else None
    source_filter = _delivery_source_filter(session, kind, adjustments, authored=authored, render_grain=render_grain)
    source = session.image
    if source_filter is None:
        def resolve_source():
            options = {"render_grain": render_grain} if render_grain is not None else {}
            return _denoised_export_source(session, kind, **options)

    lane = denoise_settings_for_export(session, kind) if shared is not None and shared.controls_key is not None else None
    if not authored and lane is not None and lane.controls.model_dump_json() == shared.controls_key:
        if source_filter is not None:
            resolve_source = source_filter
            source_filter = lambda image, authored: shared.resolve(lambda: resolve_source(image, authored))
            # A later rendition gets the shared pixels without its own geometry pass.
            source_filter.resolved = shared.resolved
        else:
            source = shared.resolve(resolve_source)
    elif source_filter is None:
        source = resolve_source()
    return source, getattr(session, "sdr_reference_image", None), source_filter


def _render_export_branch(session, settings, kind, adjustments, *, denoise_source=None, allocate_output=None,
                          delivery_path=None):
    from .export_timing import lane
    with lane(kind.value):
        return _render_branch_pixels(session, settings, kind, adjustments, denoise_source=denoise_source,
                                     allocate_output=allocate_output, watermark=True, delivery_path=delivery_path)


def _render_unwatermarked_branch(
    session, settings, kind, adjustments, *, denoise_source=None, allocate_output=None, delivery_path=None,
):
    return _render_branch_pixels(session, settings, kind, adjustments, denoise_source=denoise_source,
                                 allocate_output=allocate_output, delivery_path=delivery_path)


def _render_branch_pixels(
    session: object, settings: ExportSettings, kind: PreviewKind, adjustments: AdjustmentState,
    *, denoise_source=None, allocate_output=None, watermark=False, delivery_path=None,
) -> np.ndarray | DeliveryFrame:
    from .gpu_delivery import grain_delivery_enabled, render_pair, streamed_delivery_enabled

    def finish(pixels, *, owned):
        if not watermark:
            return pixels
        from .watermark import apply_watermark
        return apply_watermark(pixels, settings.watermark, kind.value,
            getattr(session, "hdr_reference_white_nits", 203), delivery_ceiling_nits(adjustments), in_place=owned)

    object.__setattr__(settings, "_last_cpu_strips", False)
    bounded = _bounded_export_eligible(session, settings, kind, adjustments, prepared_denoise=denoise_source is not None)
    target_size, layout, defer_output = _delivery_finishing_plan(session, settings, adjustments)
    bounded = bounded and (not defer_output or delivery_path is not None)
    # AVIF's prepared source is only for CPU rendering. Its GPU admission
    # still uses the same graph and checks as before.
    avif = settings.format == "avif_gain_map"
    avif_denoise = avif and denoise_settings_for_export(session, kind) is not None
    gpu_prepared_denoise = not avif and denoise_source is not None
    gpu_bounded = bounded and not avif_denoise and not (
        gpu_prepared_denoise and settings.format in {"jpegxl_hdr", "sdr_jpegxl"})
    if gpu_bounded and not streamed_delivery_enabled(session, settings, adjustments) and (not gpu_prepared_denoise or settings.format == "sdr_jpeg" or all(
        _bounded_export_eligible(session, settings, lane, adjustments, prepared_denoise=True)
        for lane in (PreviewKind.HDR, PreviewKind.SDR)
    )):
        from . import app_memory
        height, width = session.image.shape[:2]
        from .finishing import geometry_output_dimensions
        output = geometry_output_dimensions(width, height, adjustments.shared.geometry)
        gpu_required = width * height * 12 + output[0] * output[1] * 76 + 288 * 1024**2
        # The hidden renderer has its own working set on top of the current
        # Grade window. Don't allocate its shared input and output arrays when
        # the measured desktop already leaves too little room for them.
        starting = app_memory.STARTING
        if gpu_prepared_denoise and os.environ.get("HDR_FINISHER_DESKTOP_PID"):
            memory = app_memory.snapshot()
            starting = max(starting, memory["totalBytes"] + memory["reservedBytes"])
            # The hidden renderer's readback and the main process's mapped
            # upload can coexist for the current float32 RGBA rendition.
            if not grain_delivery_enabled(session):
                gpu_required += output[0] * output[1] * 2 * 16
        if starting + gpu_required > app_memory.CEILING:
            object.__setattr__(settings, "_bounded_cpu_delivery", True)
    pair = render_pair(session, settings, adjustments)
    if pair is not None and kind.value in pair:
        result = pair[kind.value]
        if kind.value in settings.editing_measurements:
            from .scopes import scope_peak_value
            bands = (result[top:top + 128] for top in range(0, len(result), 128))
            if kind == PreviewKind.HDR:
                peak = (max(scope_peak_value(band, kind, session.color_context) for band in bands)
                        * .18 / session.hdr_reference_white_nits)
            else:
                weights = np.array([.2126, .7152, .0722], dtype=np.float32)
                peak = max(float(np.max(band @ weights)) for band in bands)
            settings._exact_measurements[kind.value] = {"peak": peak}
        return finish(result, owned=False)
    color_context = getattr(session, "color_context", RenderColorContext(getattr(session, "hdr_reference_white_nits", 203)))
    job = _staged_delivery.get()
    if (job is not None and job.session is session and delivery_path is not None
            and _staged_export_needed(session, kind, adjustments)
            and _bounded_export_eligible(session, settings, kind, adjustments, staged=True)):
        object.__setattr__(settings, "_last_cpu_strips", True)
        with TemporaryDirectory(prefix="stages-", dir=job.directory) as scratch:
            directory = Path(scratch)
            frame = job.grade(kind, adjustments, color_context, directory)
            return _finish_delivery_grade(delivery_path, frame, adjustments, kind, settings,
                color_context, target_size, layout, session, finish, directory)
    if bounded:
        if streamed_delivery_enabled(session, settings, adjustments):
            object.__setattr__(settings, "_bounded_cpu_delivery", True)
        from .cpu_strips import render_in_strips
        object.__setattr__(settings, "_last_cpu_strips", True)
        reference = getattr(session, "sdr_reference_image", None)
        source, strip_adjustments = session.image, adjustments
        if denoise_source is not None:
            source, reference, strip_adjustments = denoise_source(kind)
        if defer_output:
            return _finish_bounded_delivery(delivery_path, source, reference, strip_adjustments,
                kind, settings, color_context, target_size, layout, session, finish)
        measure_delivery = avif_denoise and kind.value in settings.editing_measurements
        image, report = render_in_strips(source, strip_adjustments, kind,
            sdr_reference_image=reference, color_context=color_context,
            allocate_output=allocate_output,
            parallel_sdr_output=True, measure_delivery=measure_delivery)
        if kind.value in settings.editing_measurements:
            peak = report.scope_peak_value
            if kind == PreviewKind.HDR:
                peak *= .18 / color_context.hdr_reference_white_nits
            measurement = {"peak": report.linear_sdr_peak if measure_delivery and kind == PreviewKind.SDR else peak}
            if measure_delivery:
                if report.delivery_anchor is not None:
                    measurement["anchor"] = report.delivery_anchor
            elif (anchor := report.anchor) is not None:
                measured = anchor.hdr_source_peak_nits if kind == PreviewKind.HDR else anchor.sdr_peak
                if measured is not None:
                    measurement["anchor"] = measured * .18 / color_context.hdr_reference_white_nits if kind == PreviewKind.HDR else measured
            settings._exact_measurements[kind.value] = measurement
        if not watermark:
            return image
        image.setflags(write=True)
        try:
            return finish(image, owned=True)
        finally:
            image.setflags(write=False)
    source, reference, source_filter = delivery_denoise_inputs(session, kind, adjustments)
    image = apply_adjustments(
        source,
        adjustments,
        kind,
        sdr_reference_image=reference,
        include_grain=True,
        include_output_highlight_compression=False,
        local_adjustments=adjustments.enabled_locals(getattr(session, "local_adjustments", None)),
        color_context=color_context,
        source_filter=source_filter,
    )
    del source, reference, source_filter
    # Grain now develops inside the negative, before print and scan. Delivery
    # resizing/sharpening therefore resamples the completed film, like a scan.
    # Output finishing resamples and sharpens for the delivered size, neither of
    # which the preview models. Running it before the limiter keeps its ringing
    # underneath the ceiling instead of on top of it.
    from .photo_framing import delivery_layout, compose, layer_colors
    layout = delivery_layout(session, settings, adjustments)
    image = apply_output_finishing(image, settings.output_finishing, kind,
        **({"target_size": layout.photo[2:]} if layout else {}))
    if kind == PreviewKind.HDR:
        result = apply_hdr_output_highlight_compression(image, adjustments, color_context=color_context)
    else:
        result = apply_sdr_output_highlight_compression(image, adjustments)
    lane = kind.value
    if lane not in settings.editing_measurements:
        del image
    if layout:
        result = compose(result, layout, layer_colors(session.framing, kind.value,
            color_context.hdr_reference_white_nits, delivery_ceiling_nits(adjustments)))
    if lane in settings.editing_measurements:
        from .adjustments import hdr_highlight_peak_signal, sdr_highlight_peak_signal
        from .finishing import apply_geometry
        if kind == PreviewKind.HDR:
            from .scopes import scope_peak_value
            peak = scope_peak_value(result, kind, color_context) * .18 / color_context.hdr_reference_white_nits
        else:
            peak = float(np.max(result[..., :3] @ np.array([.2126, .7152, .0722], dtype=np.float32)))
        measurement = {"peak": peak}
        if kind == PreviewKind.HDR:
            signal = hdr_highlight_peak_signal(image, adjustments.hdr)
        else:
            signal = sdr_highlight_peak_signal(image, adjustments.sdr)
        if signal is not None:
            robust = getattr(adjustments, lane).highlight_compression_peak_measurement == "robust"
            measurement["anchor"] = float(np.quantile(signal, .9999) if robust else np.max(signal))
        settings._exact_measurements[lane] = measurement
    return finish(result, owned=True)


def _staged_export_needed(session, kind, adjustments):
    from .cpu_strips import strip_execution_refusals
    from .finishing import geometry_is_identity

    return not geometry_is_identity(adjustments.shared.geometry) or bool(strip_execution_refusals(
        adjustments, kind, local_adjustments=adjustments.enabled_locals(getattr(session, "local_adjustments", None))))


def _bounded_export_eligible(session, settings, kind, adjustments, *, prepared_denoise=False, staged=False):
    """Select the bounded CPU graph only for qualified stages."""
    from .cpu_strips import strip_execution_refusals
    from .finishing import geometry_resample_stage
    if staged:
        def supported(expression):
            return (expression.leaf is None or expression.leaf.type not in {"sampled_point", "sampled_gradient"}) and all(
                supported(child) for child in expression.children)

        return all(supported(local.mask) for local in adjustments.enabled_locals(
            getattr(session, "local_adjustments", None)) or ())
    height, width = session.image.shape[:2]
    if (geometry_resample_stage(adjustments.shared.geometry) == "perspective"
            and _delivery_finishing_plan(session, settings, adjustments)[2]):
        return False
    return not strip_execution_refusals(adjustments, kind,
        local_adjustments=adjustments.enabled_locals(getattr(session, "local_adjustments", None)),
        denoise_active=not prepared_denoise and denoise_settings_for_export(session, kind) is not None,
        source_width=width, source_height=height)


def _delivery_finishing_plan(session, settings, adjustments):
    from .finishing import geometry_output_dimensions, resolve_output_dimensions
    from .photo_framing import delivery_layout

    height, width = session.image.shape[:2]
    native = geometry_output_dimensions(width, height, adjustments.shared.geometry)
    layout = delivery_layout(session, settings, adjustments, streaming=True)
    finishing = settings.output_finishing
    size = layout.photo[2:] if layout is not None else resolve_output_dimensions(*native, finishing)
    return size, layout, layout is not None or size != native or finishing.sharpening != "off"


def _finish_bounded_delivery(path, source, reference, adjustments, kind, settings, color_context,
                             target_size, layout, session, watermark):
    from .cpu_strips import render_in_strips

    with TemporaryDirectory(prefix="finishing-", dir=path.parent) as scratch:
        directory = Path(scratch)
        frame, _ = render_in_strips(
            source, adjustments, kind, sdr_reference_image=reference, color_context=color_context,
            delivery_frame_path=directory / "grade.rgb")
        return _finish_delivery_grade(path, frame, adjustments, kind, settings,
            color_context, target_size, layout, session, watermark, directory)


def _finish_delivery_grade(path, frame, adjustments, kind, settings, color_context,
                           target_size, layout, session, watermark, directory):
    from .cpu_strips import finish_output_highlights
    from .finishing import finish_delivery_frame
    from .photo_framing import layer_colors, stream_compose

    frame = finish_delivery_frame(frame, settings.output_finishing, kind, directory, target_size)
    measured = kind.value in settings.editing_measurements
    with frame.map("r+") as pixels:
        anchor = finish_output_highlights(pixels, adjustments, kind, color_context, measure=measured)
    if layout is not None:
        ceiling = delivery_ceiling_nits(adjustments)
        colors = layer_colors(session.framing, kind.value, color_context.hdr_reference_white_nits, ceiling)
        frame = stream_compose(frame, directory / "delivery.rgb", layout, colors)
    with frame.map("r+") as pixels:
        if measured:
            from .scopes import scope_peak_value
            if kind == PreviewKind.HDR:
                peak = max(scope_peak_value(band, kind, color_context) for band in row_bands(pixels, 128))
                peak = peak * .18 / color_context.hdr_reference_white_nits
            else:
                weights = np.array([.2126, .7152, .0722], dtype=np.float32)
                peak = max(float(np.max(band @ weights)) for band in row_bands(pixels, 128))
            settings._exact_measurements[kind.value] = {"peak": peak}
            if anchor is not None:
                settings._exact_measurements[kind.value]["anchor"] = anchor
        watermark(pixels, owned=True)
    frame.path.replace(path)
    return DeliveryFrame(path, frame.shape)


def _render_mapped(path, render):
    frame = mapped = None
    with ExitStack() as writer:
        def allocate(shape):
            nonlocal frame, mapped
            frame = DeliveryFrame(path, shape)
            mapped = writer.enter_context(frame.map("w+"))
            return mapped

        pixels = render(allocate)
        return frame if pixels is mapped else pixels


def _render_branch_to_file(path, render):
    pixels = _render_mapped(path, render)
    if isinstance(pixels, DeliveryFrame):
        return pixels
    return DeliveryFrame.spill(path, pixels)


def _prepared_delivery_source(session, adjustments, kind):
    """Adapt the existing delivery denoise inputs for the fixed-source strips."""
    from .finishing import apply_geometry
    from .models import GeometryAdjustments

    source, reference, source_filter = delivery_denoise_inputs(session, kind, adjustments)
    if source_filter is None:
        return source, reference, adjustments
    geometry = adjustments.shared.geometry
    fixed_adjustments = adjustments.model_copy(update={"shared": adjustments.shared.model_copy(
        update={"geometry": GeometryAdjustments()})})
    if reference is not None and kind == PreviewKind.SDR and adjustments.sdr.use_authored_base:
        reference = apply_geometry(reference, geometry)
    if _authored_sdr_base(session, kind, adjustments):
        return apply_geometry(source, geometry), source_filter(reference, True), fixed_adjustments
    if getattr(source_filter, "resolved", lambda: False)():
        return source_filter(None, False), reference, fixed_adjustments
    return source_filter(apply_geometry(source, geometry), False), reference, fixed_adjustments


@dataclass
class _StagedDelivery:
    session: object
    directory: Path
    share_hdr: bool
    mapped_frames: dict = field(default_factory=dict)
    fixed: dict = field(default_factory=dict)
    masks: dict = field(default_factory=dict)
    prepared: dict = field(default_factory=dict)
    shared_hdr: DeliveryFrame | None = None

    def _frame(self, pixels, name):
        frame = self.mapped_frames.get(id(pixels))
        if frame is not None:
            return frame
        if (isinstance(pixels, np.memmap) and pixels.mode == "r" and pixels.offset == 0
                and pixels.flags.c_contiguous and isinstance(pixels.filename, (str, Path))
                and Path(pixels.filename).stat().st_size == pixels.nbytes):
            return DeliveryFrame(Path(pixels.filename), pixels.shape, pixels.dtype)
        return DeliveryFrame.spill(self.directory / name, pixels)

    def _fixed_frame(self, pixels, key, geometry, name):
        from .finishing import apply_geometry_to_frame, geometry_is_identity

        if key not in self.fixed:
            self.fixed[key] = (self._frame(pixels, name) if geometry_is_identity(geometry)
                               else apply_geometry_to_frame(pixels, geometry, self.directory / name))
        return self.fixed[key]

    def _sources(self, kind, adjustments):
        from .local_adjustments import compile_geometry_fixed_mask_to_frame, has_hue_mask

        session = self.session
        lane = denoise_settings_for_export(session, kind)
        controls = None if lane is None else lane.controls.model_dump_json()
        authored = _authored_sdr_base(session, kind, adjustments)
        shared = _delivery_grain.get()
        private_lane = kind if controls is not None and (shared is None or shared.session is not session) else None
        key = (authored, controls, private_lane)
        if key in self.prepared:
            return self.prepared[key]
        geometry = adjustments.shared.geometry
        locals_ = adjustments.enabled_locals(getattr(session, "local_adjustments", None)) or ()
        pixels, reference, source_filter = delivery_denoise_inputs(session, kind, adjustments)
        native_key = None if pixels is session.image else controls
        index = len(self.prepared)
        resolved = source_filter is not None and not authored and getattr(source_filter, "resolved", lambda: False)()
        if resolved:
            source = self._frame(source_filter(None, False), f"denoised-{index}.rgb")
        else:
            source = self._fixed_frame(pixels, (False, native_key), geometry,
                "fixed_source.rgb" if native_key is None else f"fixed_source-{index}.rgb")
        fixed_reference = (self._fixed_frame(reference, (True, None), geometry, "fixed_reference.rgb")
                           if authored else None)
        if native_key not in self.masks:
            self.masks[native_key] = {
                local.id: compile_geometry_fixed_mask_to_frame(pixels, local.mask, geometry,
                    self.directory / f"mask_{index}_{number}.u8", spatial_only=True)
                for number, local in enumerate(locals_)
                if local.enabled and local.opacity > 0 and not has_hue_mask(local.mask)
            }
        if source_filter is not None and not resolved:
            selected = fixed_reference if authored else source
            with selected.map("r") as original:
                filtered_pixels = source_filter(original, authored)
                filtered = selected if filtered_pixels is original else self._frame(filtered_pixels, f"denoised-{index}.rgb")
            if authored:
                fixed_reference = filtered
            else:
                source = filtered
        result = source, fixed_reference, locals_, self.masks[native_key]
        self.prepared[key] = result
        return result

    def grade(self, kind, adjustments, color_context, directory):
        from .cpu_strips import linked_sdr_to_frame, render_staged_grade
        from .delivery_frames import transform_bands
        from .export_timing import stage

        if kind == PreviewKind.SDR and self.shared_hdr is not None:
            common = self.shared_hdr
            result = linked_sdr_to_frame(common, DeliveryFrame(directory / "stage_a.rgb", common.shape), adjustments)
            common.path.unlink()
            self.shared_hdr = None
            return result
        source, reference, locals_, masks = self._sources(kind, adjustments)
        retain = kind == PreviewKind.HDR and self.share_hdr
        frame = render_staged_grade(source, reference, adjustments, kind, directory,
            local_adjustments=locals_, compiled_masks=masks, color_context=color_context,
            apply_output_clamp=not retain)
        if not retain:
            return frame
        retained_path = self.directory / "hdr_scene.rgb"
        frame.path.replace(retained_path)
        self.shared_hdr = DeliveryFrame(retained_path, frame.shape)
        with stage("tone_colour"):
            return transform_bands(self.shared_hdr, frame, lambda part, top: np.clip(part, 0.0, None))


_staged_delivery: ContextVar[_StagedDelivery | None] = ContextVar("staged_delivery", default=None)


def _render_delivery_files(session, settings, adjustments, directory, *, render=None,
                           lanes=(PreviewKind.HDR, PreviewKind.SDR), jpeg_denoise=False):
    render = render or _render_export_branch
    with TemporaryDirectory(prefix="grain-", dir=directory) as grains, ExitStack() as maps:
        key_hdr, key_sdr = denoise_delivery_key(session)
        share_hdr = (adjustments.sdr.linked_to_hdr and key_hdr == key_sdr
                     and tuple(lanes) == (PreviewKind.HDR, PreviewKind.SDR))
        job = _StagedDelivery(session, Path(grains), share_hdr)
        grain_index = 0

        def render_grain(render_pixels):
            nonlocal grain_index
            pixels = _render_mapped(job.directory / f"source-{grain_index}.rgb", render_pixels)
            grain_index += 1
            if not isinstance(pixels, DeliveryFrame):
                return pixels
            mapped = maps.enter_context(pixels.map("r"))
            job.mapped_frames[id(mapped)] = pixels
            return mapped

        def prepared(kind):
            return _prepared_delivery_source(session, adjustments, kind)

        denoise_source = None
        if any(denoise_settings_for_export(session, lane) is not None for lane in lanes):
            denoise_source = (_jpeg_denoise_source(session, adjustments, render_grain=render_grain)
                              if jpeg_denoise else prepared)
        token = _staged_delivery.set(job)
        try:
            with share_delivery_grain(session, adjustments, render_grain=render_grain):
                return tuple(
                    _render_branch_to_file(directory / f"{lane.value}.rgb", lambda allocate:
                        render(session, settings, lane, adjustments, denoise_source=denoise_source,
                               allocate_output=allocate, delivery_path=directory / f"{lane.value}.rgb"))
                    for lane in lanes)
        finally:
            _staged_delivery.reset(token)
            # Reduced Proof still renders its matrix endpoints after export.
            if not getattr(settings, "_keep_proof_delivery_cache", False):
                _release_delivery_pixels(session)


def _release_delivery_pixels(session):
    owner = getattr(session, "delivery_owner", session)
    with getattr(owner, "_delivery_lock", nullcontext()):
        cache = getattr(session, "_delivery_cache", None)
        if cache is not None and cache[1] is not None:
            if getattr(owner, "_delivery_cache", None) is cache:
                owner._delivery_cache = None
            session._delivery_cache = None


def _jpeg_denoise_source(session, adjustments, *, render_grain=None):
    """Hand the strip renderer one prepared source, shared by equal renditions."""
    from .finishing import apply_geometry
    from .models import GeometryAdjustments

    last_key = None
    last_pixels = None
    geometry = adjustments.shared.geometry
    fixed_adjustments = adjustments.model_copy(update={"shared": adjustments.shared.model_copy(
        update={"geometry": GeometryAdjustments()})})

    def prepared(kind):
        nonlocal last_key, last_pixels
        reference = getattr(session, "sdr_reference_image", None)
        lane = denoise_settings_for_export(session, kind)
        if lane is None:
            return session.image, reference, adjustments
        authored = _authored_sdr_base(session, kind, adjustments)
        source_filter = _delivery_source_filter(session, kind, adjustments, authored=authored,
                                                render_grain=render_grain)
        key = (authored, lane.controls.model_dump_json())
        if key != last_key:
            last_pixels = None
            if source_filter is not None:
                last_pixels = source_filter(apply_geometry(reference if authored else session.image, geometry), authored)
            else:
                last_pixels = _denoised_export_source(session, kind, render_grain=render_grain)
            last_key = key
        if source_filter is None:
            return last_pixels, reference, adjustments
        if authored:
            return apply_geometry(session.image, geometry), last_pixels, fixed_adjustments
        if reference is not None and kind == PreviewKind.SDR and adjustments.sdr.use_authored_base:
            reference = apply_geometry(reference, geometry)
        return last_pixels, reference, fixed_adjustments

    return prepared


@dataclass(frozen=True)
class _PreparedExport:
    staging_suffix: str
    write: Callable[[Path], None]
    validate: Callable[[Path], str | None]
    notes: list[str] = field(default_factory=list)


def _release_batch_source(session):
    if not getattr(session, "_release_batch_source_before_encode", False):
        return
    if session.render_cache is not None:
        session.render_cache.discard_grain_preparation()
        session.render_cache.close_micro_preview()
        session.render_cache = None
    session.image = session.sdr_reference_image = session.retouch_original = session._delivery_cache = None
    if (maps := getattr(session, "_batch_source_maps", None)) is not None:
        maps.close()
    gc.collect()


# Native 10.7 MP Neo measurement: 179.4 B/px HDR and 415.9 B/px
# generated SDR, plus 25%, rounded up. These are admission estimates, not
# larger budgets. Authored SDR avoids the generated-SDR working set.
_JXL_HDR_WORK_BYTES_PER_PIXEL = 225
_JXL_SDR_WORK_BYTES_PER_PIXEL = 525


def _reserve_high_fidelity_jxl(session, settings):
    """Admit the opt-in's whole render/encode/check before allocating pixels."""
    if not settings.jpegxl_high_fidelity or settings.format not in {"jpegxl_hdr", "sdr_jpegxl"}:
        return None
    from . import app_memory
    from .finishing import geometry_output_dimensions
    from .photo_framing import output_layout
    from .resource_preflight import detect_memory_resources, FULL_PREVIEW_FIXED_OVERHEAD_BYTES, GIB
    from threading import Event, Thread
    from uuid import uuid4
    height, width = session.image.shape[:2]
    width, height = geometry_output_dimensions(width, height, session.adjustments.shared.geometry)
    layout = output_layout(width, height, getattr(session, "framing", None), settings.output_finishing,
                           include=settings.export_with_frame)
    kind = PreviewKind.SDR if settings.format == "sdr_jpegxl" else PreviewKind.HDR
    bounded = _bounded_export_eligible(session, settings, kind, session.adjustments)
    pixels = max(width * height, layout.width * layout.height)
    # Existing source storage is already in the census. One output frame plus
    # 25%, the existing 48 MiB strip workspace and bounded codec scratch.
    cpu_required = pixels * 15 + FULL_PREVIEW_FIXED_OVERHEAD_BYTES + 48 * 1024**2
    # GPU delivery also owns both lane handoffs, shared source, output copies,
    # finishing textures and the creative graph's existing 256 MiB minimum.
    gpu_required = session.image.shape[0] * session.image.shape[1] * 12 + pixels * 76 + 288 * 1024**2
    total = app_memory.snapshot()["totalBytes"]
    from .delivery import preferences
    forced_cpu = preferences()["effective_force_cpu"]
    use_bounded_cpu = bounded and (forced_cpu or total + gpu_required > app_memory.CEILING)
    object.__setattr__(settings, "_bounded_cpu_delivery", use_bounded_cpu)
    if bounded:
        required = cpu_required if use_bounded_cpu else max(cpu_required, gpu_required)
    else:
        rate = (_JXL_SDR_WORK_BYTES_PER_PIXEL if kind == PreviewKind.SDR
                and getattr(session, "sdr_reference_image", None) is None else _JXL_HDR_WORK_BYTES_PER_PIXEL)
        required = pixels * rate + FULL_PREVIEW_FIXED_OVERHEAD_BYTES
    resources = detect_memory_resources()
    reserve = max(2 * GIB, int((resources.total_ram_bytes or 0) * .15))
    message = ("High fidelity JPEG XL needs more working memory for this photo. "
               "Free memory or raise the app memory setting before trying again.")
    if resources.available_ram_bytes is None or required > resources.available_ram_bytes - reserve:
        raise ValueError("High fidelity JPEG XL needs more free system memory for this photo. "
                         "Close other apps and try again.")
    key = "jxl-" + uuid4().hex
    if not app_memory.admit(key, required)["granted"]:
        raise ValueError(message)
    stop = Event()
    def renew():
        while not stop.wait(10):
            app_memory.admit(key, required)
    thread = Thread(target=renew, daemon=True, name="jxl-memory-lease")
    thread.start()
    return key, stop, thread


def _release_high_fidelity_jxl(lease):
    if lease is not None:
        from . import app_memory
        key, stop, thread = lease
        stop.set()
        thread.join()
        app_memory.admit(key, 0, release=True)


def _execute_export(
    backend: ExportBackend,
    session: object,
    settings: ExportSettings,
    *,
    suffix: str,
    prepare: Callable[[], _PreparedExport],
    success_message: Callable[[Path, str | None], str],
    failure_prefix: str | None,
    timings_ms: dict[str, float] | None = None,
) -> ExportResponse:
    """Run the shared prepare/write/validate/replace export lifecycle."""
    from .delivery import renderer_record
    rendering = renderer_record()
    output_path: Path | None = None
    staged_output: Path | None = None
    timings = timings_ms if timings_ms is not None else {}
    jxl_lease = None
    try:
        output_path = Path(
            _resolve_output_path(getattr(session, "session_id", "session"), settings, suffix)
        )
        _require_overwrite_permission(output_path, settings)
        jxl_lease = _reserve_high_fidelity_jxl(session, settings)
        _start_progress(session, settings)
        from .local_adjustments import share_fixed_masks
        with share_fixed_masks():
            prepared = prepare()
        from .retouch_routes import delivery_record
        rendering = delivery_record(session, getattr(session, "_delivery_record", rendering))
        _release_batch_source(session)
        with NamedTemporaryFile(
            prefix=f".{output_path.stem}.",
            suffix=prepared.staging_suffix,
            dir=output_path.parent,
            delete=False,
        ) as staged_file:
            staged_output = Path(staged_file.name)
        from .export_timing import lane
        with lane("encode"):
            prepared.write(staged_output)
            from .export_metadata import write_metadata
            metadata_started = perf_counter()
            write_metadata(staged_output, session, settings)
            timings["metadata"] = round((perf_counter() - metadata_started) * 1000, 3)
            _fsync_path(staged_output)
            validation = prepared.validate(staged_output)
        os.replace(staged_output, output_path)
        staged_output = None
    except ExportOverwriteRequired:
        raise
    except (ExportProcessError, JPEGXLError, OSError, ValueError) as exc:
        message = str(exc) if failure_prefix is None else f"{failure_prefix}: {exc}"
        return ExportResponse(
            accepted=False,
            **rendering,
            backend=backend.name,
            message=message,
            output_path=str(output_path) if output_path is not None else settings.output_path,
            timings_ms=timings,
        )
    finally:
        _release_high_fidelity_jxl(jxl_lease)
        _remove_incomplete_output(staged_output)
    message = success_message(output_path, validation)
    if prepared.notes:
        message = f"{message} {' '.join(prepared.notes)}"
    response = ExportResponse(
        accepted=True,
        **rendering,
        backend=backend.name,
        message=message,
        delivery_notes=list(prepared.notes),
        output_path=str(output_path),
        timings_ms=timings,
        measurement_warnings=measurement_warnings(settings.editing_measurements, settings._exact_measurements),
    )
    from .export_timing import active_clock
    clock = active_clock()
    if clock is not None and clock.progress is not None:
        clock.progress.done = True
    return response


def _start_progress(session, settings) -> None:
    """Give a timed export its progress plan. A plan failure never stops it."""
    from .export_timing import active_clock
    clock = active_clock()
    if clock is None or clock.progress is not None:
        return
    from .export_progress import ExportPlan, ExportProgress, default_render_label, plan_export
    try:
        plan = plan_export(session, settings, _finishing_adjustments_for_export(session))
    except Exception as error:  # noqa: BLE001 - progress is advisory
        from .diagnostics import log
        log("export", "progress_plan_failed", level="warn", reason="progress_plan_failed", error=type(error).__name__)
        plan = ExportPlan(default_label=default_render_label(settings.format))
    ExportProgress(clock, plan)


def _fsync_path(path: Path) -> None:
    with path.open("ab") as handle:
        handle.flush()
        os.fsync(handle.fileno())


def _validate_pillow_output(path: Path, expected_pixels: int | None = None) -> None:
    from PIL import Image, JpegImagePlugin, PngImagePlugin

    opener = Image.open
    if (expected_pixels is not None and Image.MAX_IMAGE_PIXELS is not None
            and expected_pixels > Image.MAX_IMAGE_PIXELS):
        opener = {".jpg": JpegImagePlugin.JpegImageFile, ".png": PngImagePlugin.PngImageFile}[path.suffix.lower()]
    with path.open("rb") as file, opener(file) as decoded:
        if expected_pixels is not None and decoded.width * decoded.height != expected_pixels:
            raise ExportProcessError("The encoded image does not match the exported size.")
        decoded.verify()


class SDRPNGExportBackend(ExportBackend):
    name = "sdr_png"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            finishing_adjustments = _finishing_adjustments_for_export(session)
            directory = Path(scratch.enter_context(TemporaryDirectory(prefix="png-delivery-")))
            image, = _render_delivery_files(session, settings, finishing_adjustments, directory, lanes=(PreviewKind.SDR,))

            def write(staged):
                with image.map("r") as pixels:
                    _write_sdr_png(staged, pixels, bit_depth=settings.sdr_png_bit_depth,
                                   dithering=settings.dithering, exif_payload=None)

            return _PreparedExport(
                ".sdr.tmp.png",
                write,
                lambda staged: _validate_pillow_output(staged, image.shape[0] * image.shape[1]),
            )

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".png",
                prepare=prepare,
                success_message=lambda path, _validation: f"SDR PNG exported to {path}",
                failure_prefix="SDR PNG export failed",
            )


class SDRJPEGExportBackend(ExportBackend):
    name = "sdr_jpeg"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            finishing_adjustments = _finishing_adjustments_for_export(session)
            directory = Path(scratch.enter_context(TemporaryDirectory(prefix="jpeg-delivery-")))
            image, = _render_delivery_files(session, settings, finishing_adjustments, directory,
                                            lanes=(PreviewKind.SDR,), jpeg_denoise=True)
            return _PreparedExport(
                ".sdr.tmp.jpg",
                lambda staged: _write_sdr_jpeg(
                    staged,
                    image,
                    quality=settings.quality,
                    chroma_subsampling=settings.jpeg_chroma_subsampling,
                    dithering=settings.dithering,
                    exif_payload=None,
                ),
                lambda staged: _validate_pillow_output(staged, image.shape[0] * image.shape[1]),
            )

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".jpg",
                prepare=prepare,
                success_message=lambda path, _validation: f"SDR JPEG exported to {path}",
                failure_prefix="SDR JPEG export failed",
            )


class SDRJPEGXLExportBackend(ExportBackend):
    """Encode the authored SDR branch as conventional 8-bit sRGB JPEG XL."""

    name = "sdr_jpegxl"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            finishing_adjustments = _finishing_adjustments_for_export(session)
            directory = Path(scratch.enter_context(TemporaryDirectory(prefix="jxl-delivery-")))
            sdr_image, = _render_delivery_files(session, settings, finishing_adjustments, directory,
                                               lanes=(PreviewKind.SDR,))
            shape = sdr_image.shape[:2]

            @_timed_stage("encode")
            def write(staged: Path) -> None:
                with sdr_image.map("r") as pixels:
                    payload = encode_sdr_jpegxl(pixels, int(settings.quality), dithering=settings.dithering,
                                               exif_payload=None)
                    if settings.jpegxl_high_fidelity:
                        verify_lossless_jpegxl(payload, pixels, hdr=False)
                staged.write_bytes(payload)

            @_timed_stage("validate")
            def validate(staged: Path) -> str:
                return validate_sdr_jpegxl(staged.read_bytes(), shape)

            return _PreparedExport(".sdr.tmp.jxl", write, validate)

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".jxl",
                prepare=prepare,
                success_message=lambda path, validation: f"JPEG XL SDR exported to {path}. {validation}",
                failure_prefix="JPEG XL SDR export failed",
            )


def write_avif_gainmap_renditions(staged_output, hdr_image, sdr_image, settings, reference_white_nits=203, *, gainmaputil=None, timings_ms=None, ceiling_nits=None, encoding_allowance=0.0, notes=None):
    """Encode finished renditions; also used by Library pictures. No rendering.

    The decoded peak is checked with the selected encoding allowance (hdr_ceiling).
    """
    def encode(hdr):
        _write_avif_gainmap_once(staged_output, hdr, sdr_image, settings, reference_white_nits,
            gainmaputil=gainmaputil, timings_ms=timings_ms)
        return Path(staged_output)
    encode_within_ceiling(hdr_image, reference_white_nits, encode,
        lambda written: decoded_avif_ceiling(written, ceiling_nits), ceiling_nits, notes,
        encoding_allowance=encoding_allowance)


def _write_avif_gainmap_once(staged_output, hdr_image, sdr_image, settings, reference_white_nits=203, *, gainmaputil=None, timings_ms=None):
    gainmaputil = gainmaputil or resolve_binary("avifgainmaputil")
    timings_ms = timings_ms if timings_ms is not None else {}
    with TemporaryDirectory(prefix="hdr_finisher_export_", ignore_cleanup_errors=True) as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        base_y4m_path = temp_dir / "base_sdr.y4m"
        hdr_y4m_path = temp_dir / "alternate_hdr.y4m"
        started = perf_counter()
        _write_sdr_y4m(
            base_y4m_path,
            sdr_image,
            bit_depth=settings.avif_bit_depth,
            chroma_subsampling=settings.avif_chroma_subsampling,
            dithering=settings.dithering,
        )
        _write_hdr_y4m(
            hdr_y4m_path,
            hdr_image,
            bit_depth=settings.avif_bit_depth,
            chroma_subsampling="444",
            reference_white_nits=reference_white_nits,
        )
        timings_ms["prepare_y4m"] = round((perf_counter() - started) * 1000.0, 3)
        started = perf_counter()
        _run_command(
            [
                str(gainmaputil), "combine", str(base_y4m_path), str(hdr_y4m_path),
                str(staged_output), "--cicp-base", "1/13/1", "--cicp-alternate", "9/16/9",
                "--depth-gain-map", "10", "--yuv-gain-map",
                settings.avif_gain_map_chroma_subsampling, "--qgain-map",
                str(int(settings.avif_gain_map_quality or settings.quality)), "--downscaling",
                "1" if settings.avif_gain_map_scale == "full" else "2", "--max-headroom", "0",
                "-q", str(int(settings.quality)), "-d", str(settings.avif_bit_depth),
                "-y", settings.avif_chroma_subsampling,
            ]
        )
        timings_ms["encode"] = round((perf_counter() - started) * 1000.0, 3)

def write_jpeg_gainmap_renditions(staged_output, hdr_image, sdr_image, settings, reference_white_nits=203, *, ultrahdr_app=None, exif_payload=None, ceiling_nits=None, encoding_allowance=0.0, notes=None, photo_rect=None, correct_in_place=False):
    """Encode finished renditions with the same writer as JPEG export.

    The decoded peak is checked with the selected encoding allowance (hdr_ceiling).
    """
    if photo_rect is not None and (settings.jpeg_gain_map_scale != "full" or settings.jpeg_gain_map_quality != 100):
        settings = settings.model_copy(update={"jpeg_gain_map_scale": "full", "jpeg_gain_map_quality": 100})
        if notes is not None:
            notes.append("Framed Ultra HDR JPEG uses a full-resolution, maximum-quality gain map to preserve frame edges.")
    with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_", ignore_cleanup_errors=True) as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        inputs = _JpegGainMapInputs(
            temp_dir, _write_temporary_exif(temp_dir, exif_payload),
            track_floor=ceiling_nits is not None and float(ceiling_nits) > 0.0,
        )

        def encode(hdr):
            _write_jpeg_gainmap_once(staged_output, hdr, sdr_image, settings, reference_white_nits,
                inputs=inputs, ultrahdr_app=ultrahdr_app, exif_payload=exif_payload, photo_rect=photo_rect)
            return Path(staged_output)

        encode_within_ceiling(hdr_image, reference_white_nits, encode,
            lambda written: decoded_ultrahdr_ceiling(written, ceiling_nits), ceiling_nits, notes,
            encoding_allowance=encoding_allowance, correct_in_place=correct_in_place)


_ULTRAHDR_INPUT_BAND_ROWS = 128


@dataclass
class _JpegGainMapInputs:
    directory: Path
    exif_path: Path | None
    track_floor: bool
    positive_mask: np.ndarray | None = None

    def can_reuse_sdr(self, hdr_image: np.ndarray | DeliveryFrame) -> bool:
        if self.positive_mask is None:
            return False
        # The SDR base floor is the only part of staging that depends on HDR.
        # Even a positive correction scale can round a tiny HDR channel to zero.
        with closing(row_bands(hdr_image, _ULTRAHDR_INPUT_BAND_ROWS)) as bands:
            for index, band in enumerate(bands):
                top = index * _ULTRAHDR_INPUT_BAND_ROWS
                if not np.array_equal(_ultrahdr_positive_mask(band), self.positive_mask[top:top + len(band)]):
                    return False
        return True


def _ultrahdr_positive_mask(hdr_band: np.ndarray) -> np.ndarray:
    return np.packbits(hdr_band[..., :3] > 0.0, axis=1)


def _write_jpeg_gainmap_once(staged_output, hdr_image, sdr_image, settings, reference_white_nits=203, *, inputs: _JpegGainMapInputs, ultrahdr_app=None, exif_payload=None, photo_rect=None):
    ultrahdr_app = ultrahdr_app or resolve_binary("ultrahdr_app")
    hdr_raw_path = inputs.directory / "hdr_bt2020_linear_rgba_f16.raw"
    sdr_raw_path = inputs.directory / "sdr_srgb_rgba8888.raw"
    sdr_jpeg_path = inputs.directory / "sdr_primary.jpg"
    unfiltered_path = inputs.directory / "unfiltered_ultrahdr.jpg"
    height, width = hdr_image.shape[:2]
    target_peak_nits = 203.0
    sdr_rgb = None
    if not inputs.can_reuse_sdr(hdr_image):
        sdr_rgb = np.empty((*sdr_image.shape[:2], 3), dtype=np.uint8)
        if inputs.track_floor and inputs.positive_mask is None:
            inputs.positive_mask = np.empty((height, (width + 7) // 8, 3), dtype=np.uint8)
    with (hdr_raw_path.open("wb") as hdr_raw,
          closing(row_bands(hdr_image, _ULTRAHDR_INPUT_BAND_ROWS)) as hdr_bands,
          closing(row_bands(sdr_image, _ULTRAHDR_INPUT_BAND_ROWS)) as sdr_bands):
        for index, hdr_band in enumerate(hdr_bands):
            hdr_rgba, peak = _prepare_hdr_linear_rgba_f16(hdr_band, reference_white_nits)
            hdr_raw.write(memoryview(hdr_rgba).cast("B"))
            target_peak_nits = max(target_peak_nits, peak)
            if sdr_rgb is not None:
                top = index * _ULTRAHDR_INPUT_BAND_ROWS
                rows = slice(top, top + len(hdr_band))
                sdr_rgb[rows] = _floor_ultrahdr_base(
                    _linear_to_srgb8(next(sdr_bands)[..., :3], dither=settings.dithering, top=top),
                    hdr_band,
                )
                if inputs.positive_mask is not None:
                    inputs.positive_mask[rows] = _ultrahdr_positive_mask(hdr_band)
    if sdr_rgb is not None:
        _write_sdr_jpeg_pixels(
            sdr_jpeg_path,
            sdr_rgb,
            quality=int(settings.quality),
            chroma_subsampling=settings.jpeg_chroma_subsampling,
            exif_payload=exif_payload,
        )
        if photo_rect is not None:
            # Compensate the pixels a decoder actually sees, including JPEG's
            # ringing at the photo/mat boundary, rather than the pre-JPEG base.
            from PIL import Image
            with Image.open(sdr_jpeg_path) as primary:
                sdr_rgb = np.asarray(primary.convert("RGB"))
        _write_sdr_rgba8888_pixels(sdr_raw_path, sdr_rgb)
        del sdr_rgb
    command = _build_ultrahdr_encode_command(
        ultrahdr_app,
        hdr_raw_path,
        sdr_raw_path,
        unfiltered_path,
        sdr_jpeg_path=sdr_jpeg_path,
        exif_path=inputs.exif_path,
        width=int(width),
        height=int(height),
        quality=int(settings.quality),
        gain_map_quality=100,
        gain_map_scale=settings.jpeg_gain_map_scale,
        target_peak_nits=target_peak_nits,
    )
    _run_command(command)
    _denoise_ultrahdr_gain_map(
        unfiltered_path,
        staged_output,
        ultrahdr_app,
        gain_map_quality=int(settings.jpeg_gain_map_quality),
        photo_rect=photo_rect,
    )


class AVIFGainMapExportBackend(ExportBackend):
    name = "avif_gain_map"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        gainmaputil = resolve_binary("avifgainmaputil")
        if gainmaputil is None:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="AVIF gain map export requires avifgainmaputil.",
            )

        timings_ms: dict[str, float] = {}
        proof_directory = getattr(settings, "_proof_endpoint_directory", None)
        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            notes: list[str] = []
            finishing_adjustments = _finishing_adjustments_for_export(session)
            phase_started = perf_counter()
            directory = proof_directory or Path(scratch.enter_context(TemporaryDirectory(prefix="avif-delivery-", ignore_cleanup_errors=True)))
            hdr_image, sdr_image = _render_delivery_files(session, settings, finishing_adjustments, directory,
                                                          render=_render_export_branch)
            if proof_directory is not None:
                object.__setattr__(settings, "_proof_endpoints", (hdr_image, sdr_image))
            timings_ms["render_renditions"] = round((perf_counter() - phase_started) * 1000.0, 3)

            def write(staged_output: Path) -> None:
                write_avif_gainmap_renditions(staged_output, hdr_image, sdr_image, settings,
                    getattr(session, "hdr_reference_white_nits", 203),
                    gainmaputil=gainmaputil, timings_ms=timings_ms,
                    ceiling_nits=_peak_ceiling(settings, finishing_adjustments),
                    encoding_allowance=_peak_allowance(finishing_adjustments), notes=notes)

            def validate(staged_output: Path) -> str | None:
                started = perf_counter()
                result = _validate_avif_output(
                    staged_output,
                    expected_bit_depth=settings.avif_bit_depth,
                    expected_chroma=settings.avif_chroma_subsampling,
                    expected_gain_map_chroma=settings.avif_gain_map_chroma_subsampling,
                )
                timings_ms["validate"] = round((perf_counter() - started) * 1000.0, 3)
                return result

            return _PreparedExport(".gainmap.tmp.avif", write, validate, notes)

        def success(path: Path, validation: str | None) -> str:
            message = f"AVIF gain map export finished at {path}"
            return f"{message}. {validation}" if validation else message

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".avif",
                prepare=prepare,
                success_message=success,
                failure_prefix=None,
                timings_ms=timings_ms,
            )


class JPEGUltraHDRExportBackend(ExportBackend):
    """Encode an SDR-first JPEG with an embedded HDR gain map using libultrahdr."""

    name = "jpeg_ultrahdr"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        ultrahdr_app = resolve_binary("ultrahdr_app")
        if ultrahdr_app is None:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="JPEG Ultra HDR export requires a working ultrahdr_app binary in bin/ or on PATH.",
            )

        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            notes: list[str] = []
            finishing_adjustments = _finishing_adjustments_for_export(session)
            proof_directory = getattr(settings, "_proof_endpoint_directory", None)
            directory = proof_directory or Path(scratch.enter_context(TemporaryDirectory(prefix="jpeg-delivery-")))
            hdr_image, sdr_image = _render_delivery_files(session, settings, finishing_adjustments, directory,
                                                          jpeg_denoise=True)
            if hdr_image.shape != sdr_image.shape or len(hdr_image.shape) != 3 or hdr_image.shape[2] < 3:
                raise ExportProcessError(
                    "The independently authored HDR and SDR renditions must have matching RGB dimensions."
                )

            from .photo_framing import delivery_layout
            layout = delivery_layout(session, settings, finishing_adjustments, streaming=True)
            photo_rect = layout.photo if layout is not None and layout.inset else None

            def write(staged_output: Path) -> None:
                write_jpeg_gainmap_renditions(staged_output, hdr_image, sdr_image, settings,
                    getattr(session, "hdr_reference_white_nits", 203), ultrahdr_app=ultrahdr_app,
                    exif_payload=None,
                    ceiling_nits=_peak_ceiling(settings, finishing_adjustments),
                    encoding_allowance=_peak_allowance(finishing_adjustments), notes=notes, photo_rect=photo_rect)
                if proof_directory is not None:
                    object.__setattr__(settings, "_proof_endpoints", (hdr_image, sdr_image))

            return _PreparedExport(
                ".ultrahdr.tmp.jpg",
                write,
                lambda staged: _validate_ultrahdr_output(staged, ultrahdr_app),
                notes,
            )

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".jpg",
                prepare=prepare,
                success_message=lambda path, validation: f"JPEG Ultra HDR exported to {path}. {validation}",
                failure_prefix="JPEG Ultra HDR export failed",
            )


class JPEGXLHDRExportBackend(ExportBackend):
    """Encode direct-HDR Rec.2020 PQ JPEG XL at the selected precision."""

    name = "jpegxl_hdr"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        scratch = ExitStack()

        def prepare() -> _PreparedExport:
            notes: list[str] = []
            finishing_adjustments = _finishing_adjustments_for_export(session)
            proof_directory = getattr(settings, "_proof_endpoint_directory", None)
            reference_white_nits = getattr(session, "hdr_reference_white_nits", 203)

            def encode_samples(frame, quality, precision):
                with frame.map("r") as pixels:
                    return encode_hdr_jpegxl(pixels, quality, precision, reference_white_nits=reference_white_nits)

            def encode(hdr_image):
                if settings.jpegxl_high_fidelity:
                    payload = encode_samples(hdr_image, 100, "uint12")
                    with hdr_image.map("r") as pixels:
                        verify_lossless_jpegxl(payload, pixels, hdr=True,
                            reference_white_nits=reference_white_nits,
                            ceiling_nits=_peak_ceiling(settings, finishing_adjustments),
                            encoding_allowance=_peak_allowance(finishing_adjustments))
                    return payload
                return encode_within_ceiling(
                    hdr_image, reference_white_nits,
                    lambda hdr: encode_samples(hdr, int(settings.quality), settings.jpegxl_precision),
                    _decoded_jpegxl_channel_nits, _peak_ceiling(settings, finishing_adjustments), notes,
                    encoding_allowance=_peak_allowance(finishing_adjustments))

            directory = proof_directory or Path(scratch.enter_context(TemporaryDirectory(prefix="jxl-delivery-")))
            lanes = (PreviewKind.HDR,) if proof_directory is None else (PreviewKind.HDR, PreviewKind.SDR)
            endpoints = _render_delivery_files(session, settings, finishing_adjustments, directory, lanes=lanes)
            shape = endpoints[0].shape[:2]

            @_timed_stage("encode")
            def write(staged: Path) -> None:
                payload = encode(endpoints[0])
                if proof_directory is not None:
                    object.__setattr__(settings, "_proof_endpoints", endpoints)
                staged.write_bytes(payload)

            @_timed_stage("validate")
            def validate(staged: Path) -> str:
                return validate_jpegxl(staged.read_bytes(), shape, settings.jpegxl_precision)

            return _PreparedExport(".tmp.jxl", write, validate, notes)

        with scratch:
            return _execute_export(
                self,
                session,
                settings,
                suffix=".jxl",
                prepare=prepare,
                success_message=lambda path, validation: f"JPEG XL HDR exported to {path}. {validation}",
                failure_prefix="JPEG XL HDR export failed",
            )


class ExportProcessError(RuntimeError):
    """Raised when an external export command fails."""


def _peak_allowance(adjustments: AdjustmentState) -> float:
    return ENCODING_ALLOWANCE if adjustments.hdr.highlight_section_enabled else 0.0


def _peak_ceiling(settings: ExportSettings, adjustments: AdjustmentState) -> float | None:
    """Enforce an active target even when the optional codec-limit check is off."""
    return delivery_ceiling_nits(adjustments) if adjustments.hdr.highlight_section_enabled or settings.guarantee_hdr_peak else None


def _decoded_jpegxl_channel_nits(payload: bytes) -> np.ndarray:
    from .jpegxl import _probe_basic_info
    info = _probe_basic_info(payload)
    bits = info.get("bits_per_sample")
    if bits in (10, 12, 16) and not info.get("exponent_bits_per_sample"):
        from .jpegxl_stream import decode
        from .color import normalize_to_acescg
        from .hdr_ceiling import channel_nits
        shape = (info["height"], info["width"])
        result = np.empty(shape, dtype=np.float32)
        def visit(x, y, pixels):
            samples = pixels[None].astype(np.float32)
            samples *= np.float32(1.0 / ((1 << bits) - 1))
            image = normalize_to_acescg(samples, "BT.2020", "PQ")
            result[y, x:x + len(pixels)] = channel_nits(image)[0]
        decode(payload, visit, expected_shape=shape, bits=bits)
        return result
    with TemporaryDirectory(prefix="hdr_finisher_ceiling_") as temp_dir:
        path = Path(temp_dir) / "check.jxl"
        path.write_bytes(payload)
        return decoded_channel_nits(path, "jpegxl_hdr")


def _resolve_output_path(session_id: str, settings: ExportSettings, suffix: str) -> str:
    if settings.output_path:
        target = Path(settings.output_path)
        if target.suffix.lower() != suffix:
            target = target.with_suffix(suffix)
        if not target.is_absolute():
            target = EXPORTS_DIR / target
    else:
        target = EXPORTS_DIR / f"{session_id}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    return str(target.resolve())


def _require_overwrite_permission(output_path: Path, settings: ExportSettings) -> None:
    if output_path.exists() and not settings.overwrite:
        raise ExportOverwriteRequired(output_path)


def _write_sdr_png(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int = 8,
    dithering: str = "off",
    exif_payload: bytes | None = None,
) -> None:
    if bit_depth == 8:
        try:
            from PIL import Image
        except ImportError as exc:
            raise ExportProcessError("Pillow is required to write SDR export intermediates.") from exc
        save_options = {"format": "PNG"}
        if exif_payload:
            save_options["exif"] = exif_payload
        Image.fromarray(_linear_to_srgb8(image, dither=dithering)).save(path, **save_options)
        return
    if bit_depth != 16:
        raise ValueError(f"Unsupported SDR PNG bit depth: {bit_depth}")
    try:
        import imagecodecs

        payload = bytes(imagecodecs.png_encode(_linear_to_srgb16(image)))
    except Exception as exc:
        raise ExportProcessError(f"The 16-bit SDR PNG encoder failed: {exc}") from exc
    if exif_payload:
        payload = _png_with_exif(payload, exif_payload)
    path.write_bytes(payload)


def _write_sdr_jpeg(
    path: Path,
    image: np.ndarray | DeliveryFrame,
    *,
    quality: int,
    chroma_subsampling: str = "420",
    dithering: str = "off",
    exif_payload: bytes | None = None,
) -> None:
    image_8bit = np.empty((*image.shape[:2], 3), dtype=np.uint8)
    with closing(row_bands(image, 128)) as bands:
        for index, pixels in enumerate(bands):
            top = index * 128
            image_8bit[top:top + len(pixels)] = _linear_to_srgb8(pixels[..., :3], dither=dithering, top=top)
    _write_sdr_jpeg_pixels(
        path,
        image_8bit,
        quality=quality,
        chroma_subsampling=chroma_subsampling,
        exif_payload=exif_payload,
    )


@_timed_stage("encode")
def _write_sdr_jpeg_pixels(
    path: Path,
    image_8bit: np.ndarray,
    *,
    quality: int,
    chroma_subsampling: str = "420",
    exif_payload: bytes | None = None,
) -> None:
    """Write already-quantized sRGB pixels without repeating transfer encoding."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ExportProcessError("Pillow is required to write SDR exports.") from exc

    height, width = image_8bit.shape[:2]
    # Pillow's bundled libjpeg-turbo deliberately reserves a small margin below
    # JPEG's 16-bit SOF limit (65,535), and reports JPEG_MAX_DIMENSION as 65,500.
    max_dimension = 65_500
    if width > max_dimension or height > max_dimension:
        raise ExportProcessError(
            f"SDR JPEG supports dimensions up to {max_dimension:,} pixels with the bundled encoder; "
            f"the finished image is {width:,} x {height:,}. Resize the export or use SDR PNG."
        )
    subsampling_values = {"420": 2, "422": 1, "444": 0}
    try:
        pillow_subsampling = subsampling_values[chroma_subsampling]
    except KeyError as exc:
        raise ValueError(f"Unsupported JPEG chroma subsampling: {chroma_subsampling}") from exc
    try:
        save_options = {
            "format": "JPEG",
            "quality": int(quality),
            "subsampling": pillow_subsampling,
        }
        if exif_payload:
            save_options["exif"] = exif_payload
        Image.fromarray(image_8bit).save(path, **save_options)
    except OSError as exc:
        raise ExportProcessError(f"The SDR JPEG encoder could not write {width:,} x {height:,} pixels: {exc}") from exc


def _linear_to_srgb8(image: np.ndarray, *, dither: bool | str = False, top: int = 0) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    dither_mode = "auto" if dither is True else "off" if dither is False else str(dither)
    if dither_mode != "off":
        _dither_srgb_in_place(srgb, amplitude_lsb=0.5 if dither_mode == "subtle" else 1.0, top=top)
    return np.clip(np.round(srgb * 255.0), 0.0, 255.0).astype(np.uint8)


def _linear_to_srgb16(image: np.ndarray) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 65535.0), 0.0, 65535.0).astype(np.uint16)


def _dither_srgb_in_place(
    srgb: np.ndarray, *, amplitude_lsb: float = 1.0, chunk_rows: int = 256, top: int = 0
) -> None:
    """Apply decorrelated, repeatable one-LSB RGB dither with bounded scratch memory."""
    height, width, channel_count = srgb.shape
    x = np.arange(width, dtype=np.uint32)[None, :]
    for row_start in range(0, height, chunk_rows):
        row_end = min(height, row_start + chunk_rows)
        y = np.arange(top + row_start, top + row_end, dtype=np.uint32)[:, None]
        for channel in range(channel_count):
            channel_seed = np.uint32(((channel + 1) * 0x9E3779B9) & 0xFFFFFFFF)
            value = x * np.uint32(0x1F123BB5) ^ y * np.uint32(0x5F356495) ^ channel_seed
            value ^= value >> np.uint32(16)
            value *= np.uint32(0x7FEB352D)
            value ^= value >> np.uint32(15)
            noise = (
                ((value & np.uint32(0xFFFF)).astype(np.float32) / np.float32(65535.0) - 0.5)
                * np.float32((2.0 * amplitude_lsb) / 255.0)
            )
            srgb[row_start:row_end, :, channel] += noise


def _write_temporary_exif(directory: Path, payload: bytes | None) -> Path | None:
    if not payload:
        return None
    path = directory / "source.exif"
    path.write_bytes(payload)
    return path


def _png_with_exif(payload: bytes, exif_payload: bytes) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    if not payload.startswith(signature):
        raise ExportProcessError("The 16-bit PNG encoder returned an invalid stream.")
    tiff_payload = exif_payload[6:] if exif_payload.startswith(b"Exif\x00\x00") else exif_payload
    chunk_type = b"eXIf"
    chunk = (
        len(tiff_payload).to_bytes(4, "big")
        + chunk_type
        + tiff_payload
        + (zlib.crc32(chunk_type + tiff_payload) & 0xFFFFFFFF).to_bytes(4, "big")
    )
    offset = len(signature)
    while offset + 12 <= len(payload):
        length = int.from_bytes(payload[offset : offset + 4], "big")
        if payload[offset + 4 : offset + 8] == b"IEND":
            return payload[:offset] + chunk + payload[offset:]
        offset += 12 + length
    raise ExportProcessError("The 16-bit PNG stream is missing its IEND chunk.")


def _floor_ultrahdr_base(sdr_rgb: np.ndarray, hdr_image: np.ndarray) -> np.ndarray:
    """Keep the Ultra HDR base above zero wherever the HDR grade has signal.

    The gain map is a multiplier, so a base channel of zero decodes to black
    however bright the HDR grade was there. Shadow blocking in the 8-bit base
    drives whole JPEG blocks to zero once the SDR grade is dark -- which is what
    turns an HDR shadow into scattered black squares, and why matching a dark
    SDR grade makes it worse. Channels the HDR grade leaves at zero stay at zero,
    so deliberate black is still black.
    """
    if sdr_rgb.dtype != np.uint8:
        raise ValueError("Ultra HDR base flooring expects 8-bit sRGB channels.")
    hdr_rgb = hdr_image[..., :3]
    if hdr_rgb.shape[:2] != sdr_rgb.shape[:2]:
        return sdr_rgb
    floor = np.uint8(ULTRAHDR_BASE_FLOOR_CODE)
    return np.where((hdr_rgb > 0.0) & (sdr_rgb < floor), floor, sdr_rgb).astype(np.uint8, copy=False)


def _write_sdr_rgba8888_pixels(path: Path, rgb: np.ndarray) -> None:
    """Write already-quantized sRGB pixels as libultrahdr's RGBA intent."""
    with path.open("wb") as handle:
        for top in range(0, rgb.shape[0], 128):
            rows = rgb[top:top + 128]
            rgba = np.empty((*rows.shape[:2], 4), dtype=np.uint8)
            rgba[..., :3] = rows
            rgba[..., 3] = 255
            handle.write(memoryview(rgba).cast("B"))


def _prepare_hdr_linear_rgba_f16(
    image: np.ndarray, reference_white_nits: int = 203
) -> tuple[np.ndarray, float]:
    """Prepare libultrahdr's HDR intent and measure its peak in one gamut pass."""
    linear_bt2020 = _acescg_to_bt2020_linear(image[..., :3])
    target_peak_nits = _target_hdr_peak_nits_from_bt2020(linear_bt2020, reference_white_nits)
    # libultrahdr's linear API defines 1.0 as 203 nits. Convert once from
    # project scene-linear placement into that codec-interface convention.
    linear_bt2020 = scene_linear_to_nits(linear_bt2020, reference_white_nits) / np.float32(203.0)
    linear_bt2020 = np.nan_to_num(linear_bt2020, nan=0.0, posinf=10000.0 / 203.0, neginf=0.0)
    linear_bt2020 = np.clip(linear_bt2020, 0.0, 10000.0 / 203.0)
    alpha = np.ones((*linear_bt2020.shape[:2], 1), dtype=np.float32)
    rgba = np.concatenate([linear_bt2020, alpha], axis=-1).astype("<f2")
    return rgba, target_peak_nits


def _acescg_to_bt2020_linear(image: np.ndarray) -> np.ndarray:
    try:
        return acescg_to_linear_bt2020(image)
    except ImportError as exc:
        raise ExportProcessError("colour-science is required for JPEG Ultra HDR color conversion.") from exc


def _target_hdr_peak_nits_from_bt2020(bt2020: np.ndarray, reference_white_nits: int = 203) -> float:
    bt2020 = np.clip(bt2020, 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    peak_nits = float(scene_linear_to_nits(float(np.max(luma, initial=0.0)), reference_white_nits))
    return float(np.clip(peak_nits, 203.0, 10000.0))


def _ultrahdr_content_boost_bounds(target_peak_nits: float) -> tuple[float, float]:
    """Bound an 8-bit publishing gain map without limiting authored HDR headroom.

    Separate SDR/HDR grades can legitimately differ in color as well as luma,
    so the map retains four stops of per-channel latitude around unity. The
    upper bound grows to include the full authored peak when it exceeds that
    latitude. Ratios outside this range predominantly come from division by a
    channel value below the useful precision of the 8-bit SDR base; encoding
    them reduces precision everywhere else and produces visible patching.
    """
    if not np.isfinite(target_peak_nits):
        raise ValueError("Ultra HDR target peak must be finite.")
    target_boost = float(np.clip(target_peak_nits, SDR_WHITE_NITS, 10000.0) / SDR_WHITE_NITS)
    latitude_boost = float(2.0**ULTRAHDR_CHROMATIC_LATITUDE_STOPS)
    return 1.0 / latitude_boost, max(latitude_boost, target_boost)


def _format_cli_float(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _format_metadata_float(value: float) -> str:
    """Retain small gain-map offsets as well as ordinary boost values."""
    return f"{value:.9g}"


def _split_ultrahdr_jpegs(payload: bytes) -> tuple[bytes, bytes]:
    """Return the primary and embedded gain-map JPEG codestreams."""
    primary_end = payload.find(b"\xff\xd9")
    if primary_end < 0:
        raise ExportProcessError("The intermediate Ultra HDR primary is missing its JPEG end marker.")
    primary_end += 2
    gain_start = payload.find(b"\xff\xd8", primary_end)
    gain_end = payload.find(b"\xff\xd9", gain_start)
    if gain_start < 0 or gain_end < 0:
        raise ExportProcessError("The intermediate Ultra HDR file has no embedded gain-map JPEG.")
    return payload[:primary_end], payload[gain_start : gain_end + 2]


def _box_blur_float(values: np.ndarray, radius: int) -> np.ndarray:
    """Ordered float32 box blur with edge padding."""
    if radius == 2:
        filtered = gainmap_filter.box5(values)
        if filtered is not None:
            return filtered
    window = radius * 2 + 1
    horizontal_padding = np.pad(values, ((0, 0), (radius, radius)), mode="edge")
    horizontal_sum = np.pad(
        np.cumsum(horizontal_padding, axis=1, dtype=np.float32),
        ((0, 0), (1, 0)),
        mode="constant",
    )
    horizontal = (horizontal_sum[:, window:] - horizontal_sum[:, :-window]) / np.float32(window)
    vertical_padding = np.pad(horizontal, ((radius, radius), (0, 0)), mode="edge")
    vertical_sum = np.pad(
        np.cumsum(vertical_padding, axis=0, dtype=np.float32),
        ((1, 0), (0, 0)),
        mode="constant",
    )
    return (vertical_sum[window:] - vertical_sum[:-window]) / np.float32(window)


def _guided_filter_gain_map_region(
    guide: np.ndarray,
    gain: np.ndarray,
    *,
    radius: int,
    epsilon: float,
    amount: float,
) -> np.ndarray:
    mean_guide = _box_blur_float(guide, radius)
    variance_guide = _box_blur_float(guide * guide, radius) - mean_guide * mean_guide
    def filter_channel(channel: int) -> np.ndarray:
        source = gain[..., channel]
        mean_source = _box_blur_float(source, radius)
        covariance = _box_blur_float(guide * source, radius) - mean_guide * mean_source
        coefficient = covariance / (variance_guide + np.float32(epsilon))
        intercept = mean_source - coefficient * mean_guide
        return _box_blur_float(coefficient, radius) * guide + _box_blur_float(intercept, radius)

    # The channels are mathematically independent. NumPy releases the GIL for
    # the cumulative sums, so processing them together shortens this CPU-bound
    # post-pass without changing a single per-channel operation or coefficient.
    # Three independent colour channels; more workers have no work.
    with ThreadPoolExecutor(max_workers=min(3, max(1, os.cpu_count() or 1)), thread_name_prefix="ultrahdr-gain-map") as pool:
        filtered = np.stack(list(pool.map(filter_channel, range(3))), axis=-1)
    return gain + np.float32(amount) * (filtered - gain)


def _denoised_ultrahdr_gain_map_jpeg(
    primary_jpeg: bytes,
    gain_map_jpeg: bytes,
    *,
    quality: int,
    radius: int = ULTRAHDR_GAIN_MAP_DENOISE_RADIUS,
    epsilon: float = ULTRAHDR_GAIN_MAP_DENOISE_EPSILON,
    amount: float = ULTRAHDR_GAIN_MAP_DENOISE_AMOUNT,
    stripe_rows: int = ULTRAHDR_GAIN_MAP_DENOISE_STRIPE_ROWS,
    photo_rect: tuple[int, int, int, int] | None = None,
) -> bytes:
    """Denoise log-gain samples, guided by the unchanged SDR primary."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ExportProcessError("Pillow is required for Ultra HDR gain-map denoising.") from exc
    if not 1 <= quality <= 100:
        raise ValueError("Ultra HDR gain-map quality must be between 1 and 100.")
    if radius < 1 or stripe_rows < 1:
        raise ValueError("Ultra HDR gain-map denoise radius and stripe height must be positive.")

    try:
        with Image.open(BytesIO(gain_map_jpeg)) as encoded_gain:
            gain = encoded_gain.convert("RGB")
        with Image.open(BytesIO(primary_jpeg)) as encoded_primary:
            primary_size = encoded_primary.size
            guide = encoded_primary.convert("L").resize(gain.size, Image.Resampling.LANCZOS)
    except OSError as exc:
        raise ExportProcessError(f"Could not decode the intermediate Ultra HDR gain map: {exc}") from exc

    result = Image.new("RGB", gain.size)
    width, height = gain.size
    if photo_rect is not None:
        x, y, w, h = photo_rect
        if primary_size != gain.size or min(x, y) < 0 or min(w, h) < 1 or x+w > width or y+h > height:
            raise ValueError("Frame boundary protection requires a full-resolution gain map and a valid photo rectangle.")
    # A guided filter contains two radius-wide box-filter stages. Keeping that
    # much overlap makes stripe boundaries numerically equivalent to a single
    # full-frame pass while bounding scratch memory on large RAW exports.
    halo = radius * 2
    def filter_stripe(row_start):
        row_end = min(height, row_start + stripe_rows)
        crop_start = max(0, row_start - halo)
        crop_end = min(height, row_end + halo)
        box = (0, crop_start, width, crop_end)
        gain_region = np.asarray(gain.crop(box), dtype=np.float32) / np.float32(255.0)
        guide_region = np.asarray(guide.crop(box), dtype=np.float32) / np.float32(255.0)
        filtered = _guided_filter_gain_map_region(
            guide_region,
            gain_region,
            radius=radius,
            epsilon=epsilon,
            amount=amount,
        )
        if photo_rect is not None:
            # Two box-filter stages reach 2r pixels. Retain the generated gain
            # throughout the mats and that halo, so denoising cannot erase the
            # compensation for JPEG ringing at the authored sharp boundary.
            x, y, w, h = photo_rect
            columns = np.arange(width)
            rows = np.arange(crop_start, crop_end)
            interior = ((columns >= x+halo) & (columns < x+w-halo))[None, :] & ((rows >= y+halo) & (rows < y+h-halo))[:, None]
            filtered = np.where(interior[..., None], filtered, gain_region)
        core_start = row_start - crop_start
        core_end = core_start + (row_end - row_start)
        encoded = np.clip(
            np.round(filtered[core_start:core_end] * np.float32(255.0)), 0, 255
        ).astype(np.uint8)
        return row_start, encoded

    # Two stripes bound scratch and overlap NumPy work without changing the
    # filter, its overlap, operation order, or the serial JPEG writer. Keep at
    # most two results in flight even for very tall originals.
    from collections import deque
    rows = iter(range(0, height, stripe_rows))
    # Memory bound: preserve the existing two-stripe scratch allowance.
    with ThreadPoolExecutor(max_workers=min(2, max(1, os.cpu_count() or 1)), thread_name_prefix="ultrahdr-stripe") as pool:
        pending = deque(pool.submit(filter_stripe, row) for row in [next(rows, None), next(rows, None)] if row is not None)
        while pending:
            row_start, encoded = pending.popleft().result()
            result.paste(Image.fromarray(encoded), (0, row_start))
            row = next(rows, None)
            if row is not None:
                pending.append(pool.submit(filter_stripe, row))

    buffer = BytesIO()
    # Multi-channel Ultra HDR maps must retain full chroma resolution.
    result.save(buffer, format="JPEG", quality=int(quality), subsampling=0)
    return buffer.getvalue()


def _ultrahdr_metadata_config(probe_text: str) -> str:
    metadata = parse_jpeg_gain_map_probe(probe_text)
    capacity_max = metadata.hdr_capacity_max
    if metadata.hdr_capacity_min == capacity_max == 1.0:
        # A valid HDR rendition need not exceed SDR white. libultrahdr's raw
        # encoder emits a 1/1 capacity range for it, but its JPEG repackager
        # requires a positive range. This is the smallest step above unity
        # retained by the CLI's six-significant-digit metadata probe. Only the
        # display transition changes; both encoded pixel endpoints are kept.
        capacity_max = 1.00001
    return "\n".join(
        [
            f"--maxContentBoost {_format_metadata_float(metadata.max_content_boost)}",
            f"--minContentBoost {_format_metadata_float(metadata.min_content_boost)}",
            f"--gamma {_format_metadata_float(metadata.gamma)}",
            f"--offsetSdr {_format_metadata_float(metadata.offset_sdr)}",
            f"--offsetHdr {_format_metadata_float(metadata.offset_hdr)}",
            f"--hdrCapacityMin {_format_metadata_float(metadata.hdr_capacity_min)}",
            f"--hdrCapacityMax {_format_metadata_float(capacity_max)}",
            f"--useBaseColorSpace {1 if metadata.use_base_color_space else 0}",
            "",
        ]
    )


def _denoise_ultrahdr_gain_map(
    source_path: Path,
    output_path: Path,
    ultrahdr_app: Path,
    *,
    gain_map_quality: int,
    photo_rect: tuple[int, int, int, int] | None = None,
) -> None:
    """Filter only the generated map, then repackage the untouched SDR JPEG."""
    primary_jpeg, gain_map_jpeg = _split_ultrahdr_jpegs(source_path.read_bytes())
    denoised_gain_map = _denoised_ultrahdr_gain_map_jpeg(
        primary_jpeg, gain_map_jpeg, quality=gain_map_quality, photo_rect=photo_rect
    )
    probe = _run_command([str(ultrahdr_app), "-m", "1", "-j", str(source_path), "-P"])
    metadata_config = _ultrahdr_metadata_config(f"{probe.stdout}\n{probe.stderr}")

    with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_denoise_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        primary_path = temp_dir / "sdr_primary.jpg"
        gain_map_path = temp_dir / "gain_map_denoised.jpg"
        metadata_path = temp_dir / "gain_map_metadata.cfg"
        primary_path.write_bytes(primary_jpeg)
        gain_map_path.write_bytes(denoised_gain_map)
        metadata_path.write_text(metadata_config, encoding="utf-8")
        _run_command(
            [
                str(ultrahdr_app),
                "-m",
                "0",
                "-i",
                str(primary_path),
                "-g",
                str(gain_map_path),
                "-f",
                str(metadata_path),
                "-z",
                str(output_path),
            ]
        )


def _build_ultrahdr_encode_command(
    ultrahdr_app: Path,
    hdr_raw_path: Path,
    sdr_raw_path: Path,
    output_path: Path,
    *,
    sdr_jpeg_path: Path | None = None,
    exif_path: Path | None = None,
    width: int,
    height: int,
    quality: int,
    gain_map_quality: int,
    gain_map_scale: str,
    target_peak_nits: float,
) -> list[str]:
    if width <= 0 or height <= 0:
        raise ValueError("Ultra HDR dimensions must be positive.")
    if not 1 <= quality <= 100:
        raise ValueError("Ultra HDR quality must be between 1 and 100.")
    if not 1 <= gain_map_quality <= 100:
        raise ValueError("Ultra HDR gain-map quality must be between 1 and 100.")
    if gain_map_scale not in {"full", "half"}:
        raise ValueError("Ultra HDR gain-map scale must be 'full' or 'half'.")
    min_content_boost, max_content_boost = _ultrahdr_content_boost_bounds(target_peak_nits)
    command = [
        str(ultrahdr_app),
        "-m",
        "0",
        "-p",
        str(hdr_raw_path),
        "-y",
        str(sdr_raw_path),
        "-w",
        str(width),
        "-h",
        str(height),
        "-a",
        "4",  # 64-bit RGBA half-float HDR intent
        "-b",
        "3",  # 32-bit RGBA8888 SDR intent
        "-C",
        "2",  # BT.2100 / BT.2020 HDR gamut
        "-c",
        "0",  # BT.709 / sRGB SDR gamut
        "-t",
        "0",  # linear HDR transfer
        "-q",
        str(quality),
        "-Q",
        str(gain_map_quality),
        "-s",
        "1" if gain_map_scale == "full" else "2",
        "-M",
        "1",
        "-G",
        "1.0",
        "-k",
        _format_cli_float(min_content_boost),
        "-K",
        _format_cli_float(max_content_boost),
        "-D",
        "1",
        "-L",
        _format_cli_float(float(np.clip(target_peak_nits, 203.0, 10000.0))),
    ]
    if sdr_jpeg_path is not None:
        command.extend(["-i", str(sdr_jpeg_path)])
    if exif_path is not None:
        command.extend(["-x", str(exif_path)])
    command.extend(["-z", str(output_path)])
    return command


@dataclass(frozen=True)
class UltraHDRMarkers:
    jpeg_images: int
    ultra_hdr_v1: bool
    iso_21496_1: bool


def _inspect_ultrahdr_markers(path: Path) -> UltraHDRMarkers:
    payload = path.read_bytes()
    return UltraHDRMarkers(
        jpeg_images=payload.count(b"\xff\xd8"),
        ultra_hdr_v1=(b"http://ns.adobe.com/hdr-gain-map/1.0/" in payload and b"hdrgm:Version" in payload),
        iso_21496_1=b"urn:iso:std:iso:ts:21496:-1" in payload,
    )


def _validate_ultrahdr_output(path: Path, ultrahdr_app: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        raise ExportProcessError("The encoder did not create an output file.")
    if path.read_bytes()[:2] != b"\xff\xd8":
        raise ExportProcessError("The encoder output is not a valid JPEG stream.")

    try:
        from PIL import Image

        with Image.open(path) as legacy_image:
            legacy_image.load()
            if legacy_image.format != "JPEG":
                raise ExportProcessError("The SDR fallback is not decodable as a legacy JPEG.")
    except ExportProcessError:
        raise
    except Exception as exc:
        raise ExportProcessError(f"The SDR fallback failed legacy JPEG decoding: {exc}") from exc

    markers = _inspect_ultrahdr_markers(path)
    if markers.jpeg_images < 2:
        raise ExportProcessError("No embedded JPEG gain-map image was found.")
    if not markers.ultra_hdr_v1 or not markers.iso_21496_1:
        missing = []
        if not markers.ultra_hdr_v1:
            missing.append("Ultra HDR v1 XMP")
        if not markers.iso_21496_1:
            missing.append("ISO 21496-1")
        raise ExportProcessError(
            "Missing "
            + " and ".join(missing)
            + " metadata. Rebuild libultrahdr with UHDR_WRITE_XMP=ON and UHDR_WRITE_ISO=ON."
        )

    probe = _run_command([str(ultrahdr_app), "-m", "1", "-j", str(path), "-P"])
    probe_text = f"{probe.stdout}\n{probe.stderr}".lower()
    if "maxcontentboost" not in probe_text or "hdrcapacitymax" not in probe_text:
        raise ExportProcessError("libultrahdr decoded the file but did not report gain-map metadata.")
    return "Validated as legacy JPEG plus embedded gain map with Ultra HDR v1 and ISO 21496-1 metadata."


def _remove_incomplete_output(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


_AVIF_Y4M_BAND_ROWS = 128  # A multiple of the 4:2:0 vertical subsampling factor.


@_timed_stage("prepare_y4m")
def _write_sdr_y4m(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int,
    chroma_subsampling: str,
    dithering: str = "off",
) -> None:
    if bit_depth not in {8, 10, 12}:
        raise ValueError(f"Unsupported AVIF bit depth: {bit_depth}")
    from .export_parallel import rows_in_parts
    with closing(row_bands(image, _AVIF_Y4M_BAND_ROWS)) as pixels:
        bands = (
            rows_in_parts(lambda rows, top: _linear_sdr_to_yuv(rows, bit_depth, dithering, top),
                          band, index * _AVIF_Y4M_BAND_ROWS)
            for index, band in enumerate(pixels)
        )
        write_y4m_bands(path, *image.shape[:2], bands, bit_depth=bit_depth, chroma_subsampling=chroma_subsampling)


def _linear_sdr_to_yuv(image: np.ndarray, bit_depth: int, dithering: str, top: int) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    if bit_depth == 8 and dithering != "off":
        _dither_srgb_in_place(srgb, amplitude_lsb=0.5 if dithering == "subtle" else 1.0, top=top)

    r, g, b = srgb[..., 0], srgb[..., 1], srgb[..., 2]
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cb = (b - y) / 1.8556
    cr = (r - y) / 1.5748
    scale = float(1 << max(0, bit_depth - 8))
    y_code = np.clip(np.round(16.0 * scale + y * 219.0 * scale), 16.0 * scale, 235.0 * scale)
    cb_code = np.clip(np.round(128.0 * scale + cb * 224.0 * scale), 16.0 * scale, 240.0 * scale)
    cr_code = np.clip(np.round(128.0 * scale + cr * 224.0 * scale), 16.0 * scale, 240.0 * scale)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    return np.stack([y_code, cb_code, cr_code], axis=-1).astype(dtype)


@_timed_stage("prepare_y4m")
def _write_hdr_y4m(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int = 10,
    chroma_subsampling: str = "444",
    reference_white_nits: int = 203,
) -> None:
    if bit_depth not in {8, 10, 12}:
        raise ValueError(f"Unsupported AVIF bit depth: {bit_depth}")
    if chroma_subsampling not in {"420", "422", "444"}:
        raise ValueError(f"Unsupported AVIF chroma subsampling: {chroma_subsampling}")
    from .export_parallel import rows_in_parts
    with closing(row_bands(image, _AVIF_Y4M_BAND_ROWS)) as pixels:
        bands = (rows_in_parts(lambda rows, top: _linear_to_bt2020_pq_yuv(rows, bit_depth, reference_white_nits), band, 0)
                 for band in pixels)
        write_y4m_bands(path, *image.shape[:2], bands, bit_depth=bit_depth, chroma_subsampling=chroma_subsampling)


def _linear_to_pq_rgb10(image: np.ndarray, reference_white_nits: int = 203) -> np.ndarray:
    return _linear_to_pq_rgb(image, 10, reference_white_nits)


def _linear_to_pq_rgb(image: np.ndarray, bit_depth: int, reference_white_nits: int = 203) -> np.ndarray:
    linear = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    nits = np.clip(scene_linear_to_nits(linear, reference_white_nits), 0.0, 10000.0)
    pq = _pq_oetf(nits / 10000.0)
    maximum = float((1 << bit_depth) - 1)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    return np.clip(np.round(pq * maximum), 0.0, maximum).astype(dtype)


def _linear_to_bt2020_pq_yuv10(image: np.ndarray, reference_white_nits: int = 203) -> np.ndarray:
    return _linear_to_bt2020_pq_yuv(image, 10, reference_white_nits)


def _linear_to_bt2020_pq_yuv(image: np.ndarray, bit_depth: int, reference_white_nits: int = 203) -> np.ndarray:
    linear_bt2020 = _acescg_to_bt2020_linear(image)
    maximum = float((1 << bit_depth) - 1)
    pq_rgb = _linear_to_pq_rgb(linear_bt2020, bit_depth, reference_white_nits).astype(np.float32) / maximum

    r = pq_rgb[..., 0]
    g = pq_rgb[..., 1]
    b = pq_rgb[..., 2]

    kr = np.float32(0.2627)
    kb = np.float32(0.0593)
    kg = np.float32(1.0 - kr - kb)

    y = kr * r + kg * g + kb * b
    cb = (b - y) / (2.0 * (1.0 - kb))
    cr = (r - y) / (2.0 * (1.0 - kr))

    scale = float(1 << max(0, bit_depth - 8))
    y_min, y_span, y_max = 16.0 * scale, 219.0 * scale, 235.0 * scale
    c_min, c_span, c_mid, c_max = 16.0 * scale, 224.0 * scale, 128.0 * scale, 240.0 * scale
    y_code = np.clip(np.round(y_min + y * y_span), y_min, y_max)
    cb_code = np.clip(np.round(c_mid + cb * c_span), c_min, c_max)
    cr_code = np.clip(np.round(c_mid + cr * c_span), c_min, c_max)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    return np.stack([y_code, cb_code, cr_code], axis=-1).astype(dtype)


def _pq_oetf(normalized_luminance: np.ndarray) -> np.ndarray:
    m1 = 2610.0 / 16384.0
    m2 = 2523.0 / 32.0
    c1 = 3424.0 / 4096.0
    c2 = 2413.0 / 128.0
    c3 = 2392.0 / 128.0
    lm1 = np.power(np.clip(normalized_luminance, 0.0, None), m1)
    numerator = c1 + c2 * lm1
    denominator = 1.0 + c3 * lm1
    return np.power(numerator / denominator, m2)


@_timed_stage("encode")
def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    from .delivery import log_delivery

    started = perf_counter()
    helper = Path(command[0]).name
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            **hidden_window_options(),
        )
    except OSError as exc:
        log_delivery("encoder_helper_finished", level="error", route="refused",
                   reason="encoder_launch_failed", helper=helper, duration_ms=round((perf_counter() - started) * 1000))
        raise ExportProcessError(f"Could not start {Path(command[0]).name}: {exc}") from exc
    log_delivery("encoder_helper_finished", level="error" if result.returncode else "info",
               route="refused" if result.returncode else "cpu", helper=helper, exit_code=result.returncode,
               reason="encoder_exit_failed" if result.returncode else "encoder_completed",
               duration_ms=round((perf_counter() - started) * 1000))
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"Command failed with exit code {result.returncode}."
        raise ExportProcessError(detail)
    return result


@_timed_stage("validate")
def _validate_avif_output(
    path: Path,
    *,
    expected_bit_depth: int | None = None,
    expected_chroma: str | None = None,
    expected_gain_map_chroma: str | None = None,
) -> str | None:
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        return None
    result = subprocess.run(
        [str(avifdec), "--jobs", "1", "--info", str(path)],
        capture_output=True,
        text=True,
        check=False,
        **hidden_window_options(),
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "avifdec could not decode the result."
        raise ExportProcessError(f"AVIF validation failed: {detail}")
    if "Gain map" not in result.stdout or "Gain map       : Absent" in result.stdout:
        raise ExportProcessError("AVIF validation did not find an embedded gain map.")
    if expected_bit_depth is not None and f"Bit Depth      : {expected_bit_depth}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected primary bit depth.")
    if expected_chroma is not None and f"Format         : YUV{expected_chroma}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected chroma subsampling.")
    if expected_gain_map_chroma is not None and f"YUV{expected_gain_map_chroma}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected gain-map chroma subsampling.")
    return "Validated with avifdec."


def export_sample_hdr_reference(output_path: Path | None = None) -> ExportResponse:
    session = type(
        "SampleSession",
        (),
        {
            "session_id": "hdr_reference",
            "image": build_hdr_test_pattern(),
            "adjustments": AdjustmentState(),
        },
    )()
    target_path = output_path or (SAMPLES_DIR / "hdr_reference.avif")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    settings = ExportSettings(format="avif_gain_map", quality=90, output_path=str(target_path))
    backend = AVIFGainMapExportBackend(
        CapabilityInfo(name="avif gain map export", status=CapabilityStatus.AVAILABLE, detail="Sample export")
    )
    return backend.export(session, settings)


def build_export_backends(capabilities: dict[str, CapabilityInfo]) -> dict[str, ExportBackend]:
    return {
        "avif_gain_map": AVIFGainMapExportBackend(capabilities["avif_gain_map_encoder"]),
        "jpeg_ultrahdr": JPEGUltraHDRExportBackend(capabilities["ultrahdr_encoder"]),
        "jpegxl_hdr": JPEGXLHDRExportBackend(capabilities["jpegxl_export"]),
        "sdr_jpegxl": SDRJPEGXLExportBackend(capabilities["jpegxl_export"]),
        "sdr_jpeg": SDRJPEGExportBackend(capabilities["pillow"]),
        "sdr_png": SDRPNGExportBackend(capabilities["pillow"]),
    }
