"""Bounded CPU execution of the pointwise grade, one output strip at a time.

PRD 10, Phase 4: *"Add CPU tiled/strip execution foundation and cancellation"*,
exit gate *"CPU Full executes through a bounded path"*.

The whole-frame CPU route materializes the geometry-fixed frame and then every
intermediate ``apply_adjustments`` needs, so its peak host RAM follows the
selected tier. At Full on a 42 MP source that is hundreds of megabytes of
transient float32 for a picture the user may abandon mid-gesture.

This module renders the same result from a constant working set: the output
buffer the caller asked for, plus one strip's intermediates. Strips are
extracted post-geometry through ``apply_geometry_region`` (Phase 3), so no
whole transformed frame is built either.

**It is exact, or it refuses.** The refusals mirror the GPU tiled path's
(``tiledExecutionRefusals`` in ``webgpu-preview.js``) because they exist for
the same reason: a strip would silently treat itself as the whole image.
Vignette normalizes to the frame, grain seeds on absolute coordinates, Detail
derives its radii from the frame diagonal, and masks, Denoise and wider spatial
Film Look kernels need inputs this route does not carry.
Those are Phases 5 to 7.

The one thing a *pointwise* graph still takes from the whole frame is the
highlight anchor: Peak Fit fits its shoulder to the brightest pixel in the
image, and the HDR delivery ceiling picks between two branches on a whole-frame
maximum. Those are measured here in bounded reduction passes and injected
through ``HighlightAnchor``, which is why the result is byte-identical rather
than merely close.
"""

from __future__ import annotations

from .export_timing import stage as _stage, timed as _timed_stage
from contextlib import ExitStack, nullcontext
from dataclasses import dataclass
import math
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable, Sequence

import numpy as np

from .adjustments import (
    BW_GUIDE_REACH,
    FrameWindow,
    HighlightAnchor,
    _scan_sharpening_kernel,
    apply_fixed_source_adjustments,
    black_and_white_needs_guide,
    clip_hdr_output_target,
    compress_hdr_output_highlights,
    hdr_highlight_peak_signal,
    hdr_output_transport_signal,
    hdr_peak_nits_from_measured,
    sdr_highlight_peak_signal,
    apply_sdr_output_highlight_compression,
)
from .color_context import RenderColorContext
from .cpu_budget import CpuExecutor
from .delivery_frames import DeliveryFrame, transform_bands, transform_lines
from .detail import detail_is_neutral
from .finishing import apply_geometry_region, geometry_output_dimensions, geometry_resample_stage
from .models import AdjustmentState, LocalAdjustment, PreviewKind

# One strip's intermediates, as a multiple of the strip's own RGB float32 size.
# `apply_adjustments` keeps several full-size temporaries alive at once -- the
# working copy, a luma plane, zone masks, a ratio, and the `np.where` result --
# and the deepest stage is the Peak Fit shoulder. Measured against the real
# graph by `test_cpu_strips.py::test_peak_transient_bytes_match_the_plan`;
# raise this only with a measurement, never to make a number look better.
STRIP_WORKING_SET_MULTIPLIER = 14

# The default ceiling on one strip's transient working set. Small enough that a
# 42 MP Full render never holds more than a fraction of the frame in flight,
# large enough that a 4K-wide strip is still hundreds of rows.
DEFAULT_STRIP_BUDGET_BYTES = 48 * 1024 * 1024

_BYTES_PER_PIXEL = 3 * np.dtype(np.float32).itemsize

_ROBUST_QUANTILE = 0.9999


class StripExecutionRefused(RuntimeError):
    """The graph contains a node a strip cannot reproduce exactly.

    Carries every reason rather than the first, so a caller reporting to a
    developer can say what would have to land for this graph to run bounded.
    """

    def __init__(self, reasons: Sequence[str]) -> None:
        self.reasons = tuple(reasons)
        super().__init__("Bounded strip execution refused: " + ", ".join(self.reasons))


class StripCancelled(RuntimeError):
    """A newer generation superseded this render between strips."""


@dataclass(frozen=True)
class StripPlan:
    """How one bounded render is divided, decided before any pixel is touched."""

    width: int
    height: int
    strip_rows: int
    strips: tuple[tuple[int, int], ...]
    budget_bytes: int
    planned_transient_bytes: int
    output_bytes: int

    @property
    def strip_count(self) -> int:
        return len(self.strips)


@dataclass
class StripReport:
    """What a bounded render actually did, for evidence rather than for control."""

    plan: StripPlan
    passes: tuple[str, ...] = ()
    strips_rendered: int = 0
    anchor: HighlightAnchor | None = None
    cancelled_at_strip: int | None = None
    refusals: tuple[str, ...] = ()
    measured_peak_transient_bytes: int | None = None
    scope_peak_value: float | None = None
    delivery_anchor: float | None = None
    linear_sdr_peak: float | None = None

    def payload(self) -> dict[str, object]:
        return {
            "width": self.plan.width,
            "height": self.plan.height,
            "strip_rows": self.plan.strip_rows,
            "strip_count": self.plan.strip_count,
            "budget_bytes": self.plan.budget_bytes,
            "planned_transient_bytes": self.plan.planned_transient_bytes,
            "measured_peak_transient_bytes": self.measured_peak_transient_bytes,
            "output_bytes": self.plan.output_bytes,
            "passes": list(self.passes),
            "strips_rendered": self.strips_rendered,
            "cancelled_at_strip": self.cancelled_at_strip,
            "refusals": list(self.refusals),
            "scope_peak_value": self.scope_peak_value,
            "highlight_anchor": None if self.anchor is None else {
                "hdr_source_peak_nits": self.anchor.hdr_source_peak_nits,
                "hdr_clip_transport_max": self.anchor.hdr_clip_transport_max,
                "hdr_output_transport_max": self.anchor.hdr_output_transport_max,
                "sdr_peak": self.anchor.sdr_peak,
            },
        }


def plan_strips(
    width: int,
    height: int,
    *,
    budget_bytes: int = DEFAULT_STRIP_BUDGET_BYTES,
    working_set_multiplier: int = STRIP_WORKING_SET_MULTIPLIER,
    halo_rows: int = 0,
) -> StripPlan:
    """Divide an output frame into strips whose intermediates fit the budget.

    Strips span the full width so every extraction keeps the whole-frame row
    pitch, which is what makes the region result equal to the corresponding
    slice of the whole-frame result. Reserve room above and below each band
    for any requested halo, subject to the one-output-row minimum.
    """
    width = max(1, int(width))
    height = max(1, int(height))
    budget = max(1, int(budget_bytes))
    multiplier = max(1, int(working_set_multiplier))
    row_bytes = width * _BYTES_PER_PIXEL * multiplier
    working_rows = budget // row_bytes
    strip_rows = height if working_rows >= height else max(1, working_rows - 2 * halo_rows)
    strips = tuple(
        (top, min(height, top + strip_rows)) for top in range(0, height, strip_rows)
    )
    return StripPlan(
        width=width,
        height=height,
        strip_rows=strip_rows,
        strips=strips,
        budget_bytes=budget,
        planned_transient_bytes=min(height, strip_rows + 2 * halo_rows) * row_bytes,
        output_bytes=width * height * _BYTES_PER_PIXEL,
    )


def strip_execution_refusals(
    adjustments: AdjustmentState,
    kind: PreviewKind,
    *,
    local_adjustments: Sequence[LocalAdjustment] | None = None,
    denoise_active: bool = False,
    source_width: int | None = None,
    source_height: int | None = None,
    long_edge: int | None = None,
) -> list[str]:
    """Name every reason this graph cannot run strip by strip and stay exact.

    Deliberately parallel to ``tiledExecutionRefusals`` on the GPU side. There
    is no silent fallback: a caller that ignores this list and renders anyway
    would be the "Direct-only Full" the PRD lists as a non-goal, in CPU form.
    """
    reasons: list[str] = []
    branch = adjustments.hdr if kind == PreviewKind.HDR or adjustments.sdr.linked_to_hdr else adjustments.sdr

    if any(local.enabled and local.opacity > 0.0 for local in (local_adjustments or [])):
        reasons.append("local adjustments")
    if branch.detail_section_enabled and not detail_is_neutral(branch.detail):
        reasons.append("detail")

    look = branch.film_look
    look_active = branch.film_look_section_enabled and float(look.look_strength) > 0.0
    if look_active:
        spatial = (
            (look.halation_enabled and (look.halation_view_map or (look.halation_amount > 0.0 and look.halation_radius > 0.0)))
            or look.lens_filter != "none"
            or look.film_resolution < 100.0
        )
        if spatial:
            reasons.append("spatial film effects")
    if branch.detail_section_enabled and (branch.detail.softness != 0.0 or branch.detail.microcontrast != 0.0):
        reasons.append("detail softness or microcontrast")
    # Grain and vignette are placed against the frame through ``FrameWindow``,
    # so a strip draws its share of the frame's vignette and samples the
    # frame's grain field rather than starting its own. Neither needs a
    # refusal any more; the GPU side lifted the same two in the same phase.
    if denoise_active:
        reasons.append("denoise")
    geometry = adjustments.shared.geometry
    geometry_stage = geometry_resample_stage(geometry)
    if geometry_stage == "roll":
        reasons.append("roll geometry")
    if geometry_stage == "perspective" and _grade_halo(branch, 1.0)[0]:
        reasons.append("perspective with spatial grade")
    if long_edge is not None and source_width and source_height:
        output_width, output_height = geometry_output_dimensions(source_width, source_height, geometry)
        if max(output_width, output_height) > int(long_edge):
            # The whole-frame path downsamples here, and a per-strip
            # downsample does not reproduce a whole-frame one at the seams.
            reasons.append("post-geometry downsample")
    return reasons


def _grade_halo(branch, source_pixel_scale):
    from .hsl import recipe_active
    from .hsl_selection import MIN_SCALE, geometry

    reach = BW_GUIDE_REACH if (branch.black_and_white_section_enabled
                              and black_and_white_needs_guide(branch.black_and_white)) else 0
    active = [channel.recipe for channel in branch.hsl.channels
              if branch.hsl_section_enabled and recipe_active(channel.recipe)]
    if not active:
        return reach, 1
    scale = min(1.0, max(MIN_SCALE, float(source_pixel_scale)))
    geo = geometry(scale)
    edge = max(math.ceil(abs(recipe.edge) * scale) for recipe in active)
    feather = max(math.ceil(4 * recipe.edge_feather * scale / 2) for recipe in active)
    return reach + geo.reach + edge + feather + geo.cell, geo.cell


def scan_sharpening_halo(branch, source_pixel_scale):
    look = branch.film_look
    if (not branch.film_look_section_enabled or look.look_strength <= 0
            or look.scan_sharpening <= 0 or (look.grain_enabled and look.grain_view_map)):
        return 0
    return _scan_sharpening_kernel(source_pixel_scale)[1]


def _halation_to_frame(source, destination, look, kind, rows):
    from . import adjustments as grade
    from .export_timing import tick

    height, width = source.shape[:2]
    with TemporaryDirectory(prefix="halation-", dir=destination.path.parent) as directory, _stage("halation"):
        scratch = Path(directory)
        shape = (height, width)
        edge = DeliveryFrame(scratch / "edge", shape)
        plane_a = DeliveryFrame(scratch / "blur-a", shape)
        plane_b = DeliveryFrame(scratch / "blur-b", shape)
        with source.map("r") as pixels:
            radius = max(1, grade._film_radius_pixels(pixels, look, look.halation_radius))
        edge_radius = max(1, min(radius // 4, 16))
        offsets, weights = grade._diffusion_kernel(radius)
        exact = radius <= grade._DIFFUSION_EXACT_RADIUS
        box_radii = [] if exact else list(grade._box_cascade_radii(float(np.sum(weights * offsets * offsets, dtype=np.float64))))
        total_steps = 2 + (2 if exact else 2 * len(box_radii))
        completed_steps = 0

        def report_step(done, total):
            if total > 0:
                tick(completed_steps * 1000 + int(1000 * min(total, done) / total), total_steps * 1000)

        transform_bands(source, edge, lambda part, top: grade._halation_edge_rows(part, kind, 75.0, edge_radius),
                        rows=rows, halo=edge_radius, progress=report_step)
        completed_steps += 1
        if exact:
            transform_lines(edge, plane_a, 1, lambda part: grade._weighted_blur_axis(part, offsets, weights, 1), progress=report_step)
            completed_steps += 1
            transform_lines(plane_a, plane_b, 0, lambda part: grade._weighted_blur_axis(part, offsets, weights, 0), progress=report_step)
            completed_steps += 1
        else:
            previous = edge
            for box in box_radii:
                transform_lines(previous, plane_a, 1, lambda part: grade._box_blur_axis(part, box, 1), progress=report_step)
                completed_steps += 1
                transform_lines(plane_a, plane_b, 0, lambda part: grade._box_blur_axis(part, box, 0), progress=report_step)
                completed_steps += 1
                previous = plane_b
        tint = grade._halation_tint(look.halation_hue_offset, look.halation_saturation, kind)
        amount = np.float32(0.42 * look.halation_amount / 100.0) * np.float32(1)
        with edge.map("r") as qualified, plane_b.map("r") as blurred:
            def finish(part, top):
                region = slice(top, top + len(part))
                scatter = np.maximum(blurred[region] - qualified[region] * np.float32(.15), 0.0)
                return grade._halation_map(scatter, kind) if look.halation_view_map else (
                    part + (scatter[..., None] * tint) * amount).astype(np.float32, copy=False)

            transform_bands(source, destination, finish, rows=rows, progress=report_step)
    return destination


def apply_film_to_frame(source, scratch, state, kind, *, rows=128, source_pixel_scale=1.0):
    from . import adjustments as grade
    from .lens_filter import apply_filter_to_frame

    height, width = source.shape[:2]
    branch = state.hdr if kind == PreviewKind.HDR else state.sdr
    look = branch.film_look
    if branch.black_and_white_section_enabled:
        look = grade.black_and_white_neutral_film_look(look)
    strength = np.float32(look.look_strength / 100.0)
    full = np.float32(1)
    grain = look.grain_enabled and look.grain_amount > 0
    grain_map = look.grain_enabled and look.grain_view_map
    halation = look.halation_enabled and (
        (look.halation_amount > 0 and look.halation_radius > 0) or look.halation_view_map)
    lens = look.lens_filter != "none"
    stock = grade._film_stock_is_active(look)
    active = branch.film_look_section_enabled and strength > 0 and (
        stock or lens or halation or grain or grain_map or look.scan_sharpening > 0 or look.film_resolution < 100)
    initial = source
    pre_film = None

    def advance():
        nonlocal source, scratch
        source, scratch = scratch, initial if source == pre_film else source

    def run(name, transform, halo=0):
        with _stage(name):
            transform_bands(source, scratch, transform, rows=rows, halo=halo)
        advance()

    def grain_pass(master, diagnostic=False):
        arguments = dict(preview_scale=source_pixel_scale, view_map=diagnostic, clip_output=diagnostic)
        if stock and not diagnostic:
            renderer = grade._film_stock_renderer(look, kind, full)
            if renderer is None:
                return
            scratch.write(source.bands(rows))
            with scratch.map("r+") as output:
                grade._apply_density_grain(output, look, kind, state.shared.film_grain_seed, master,
                                           density_delta=True, stock_render=renderer, **arguments)
        else:
            with source.map("r") as pixels, scratch.map("w+") as output:
                grade._apply_density_grain(pixels, look, kind, state.shared.film_grain_seed, master,
                                           output=output, **arguments)
        advance()

    if active:
        with TemporaryDirectory(prefix="film-", dir=scratch.path.parent) as directory:
            if not (look.halation_view_map and halation or grain_map):
                pre_film = DeliveryFrame(Path(directory) / "pre-film.rgb", source.shape)
                source.path.replace(pre_film.path)
                source = pre_film
            if lens:
                with _stage("lens_filter"):
                    apply_filter_to_frame(source, scratch, look.lens_filter, look.lens_strength, look.lens_size,
                                          grade._film_pixels_per_mm(width, height, look), source_pixel_scale)
                advance()
            if look.film_resolution < 100:
                loss = np.float32((100 - look.film_resolution) / 100.0)
                with source.map("r") as pixels:
                    radius = max(1, grade._film_radius_pixels(pixels, look, .04 + .08 * float(loss), maximum=32))
                run("film_resolution", lambda part, top: grade._apply_film_resolution(part, look, full, radius=radius), radius)
            if halation:
                _halation_to_frame(source, scratch, look, kind, rows)
                advance()
            if grain_map and not (halation and look.halation_view_map):
                grain_pass(strength, diagnostic=True)
            if not (halation and look.halation_view_map or grain_map):
                if grain:
                    grain_pass(full)
                elif stock:
                    scratch.write(source.bands(rows))
                    with scratch.map("r+") as pixels:
                        grade._apply_film_stock(pixels, look, kind, full)
                    advance()
                if look.scan_sharpening > 0:
                    run("scan_sharpening", lambda part, top: grade._apply_scan_sharpening(
                        part, look.scan_sharpening / 100, source_pixel_scale),
                        _scan_sharpening_kernel(source_pixel_scale)[1])
                with pre_film.map("r") as original:
                    def blend(part, top):
                        base = original[top:top + len(part)]
                        return base + (part - base) * strength

                    run("look_strength", blend)

    if grade._structure_is_active(branch) and not (active and (halation and look.halation_view_map or grain_map)):
        with source.map("r") as pixels:
            radius = max(1, grade._radius_pixels(pixels, .06, maximum=24))
        run("image_structure", lambda part, top: grade._apply_image_structure(part, branch.detail, kind, radius=radius), radius)
    if branch.vignette_section_enabled:
        run("vignette", lambda part, top: grade._apply_vignette(part, branch.vignette, kind,
            frame_window=FrameWindow(left=0, top=top, width=width, height=height)))
    return source


def render_staged_grade(source, reference, adjustments, kind, directory, *, local_adjustments=(),
                        compiled_masks=None, color_context=None, rows=None, apply_output_clamp=True):
    from .local_adjustments import apply_local_stack_to_frame, has_hue_mask
    from .models import GeometryAdjustments
    from .detail import apply_detail_to_frame

    color_context = color_context or RenderColorContext()
    geometry = adjustments.shared.geometry
    linked = kind == PreviewKind.SDR and adjustments.sdr.linked_to_hdr
    lane = PreviewKind.HDR if linked else kind
    branch = getattr(adjustments, lane.value)
    height, width = source.shape[:2]
    needs_hue = any(local.enabled and local.opacity > 0 and has_hue_mask(local.mask)
                    for local in local_adjustments)
    stage_a = DeliveryFrame(directory / "stage_a.rgb", source.shape)
    stage_b = DeliveryFrame(directory / "stage_b.rgb", source.shape)
    hue = DeliveryFrame(directory / "hue.rgb", source.shape) if needs_hue else None
    prefix_branch = branch.model_copy(update=dict(detail_section_enabled=False, film_look_section_enabled=False,
                                                  vignette_section_enabled=False))
    prefix = adjustments.model_copy(update={lane.value: prefix_branch,
        "shared": adjustments.shared.model_copy(update={"geometry": GeometryAdjustments()})})
    budget = DEFAULT_STRIP_BUDGET_BYTES if rows is None else rows * width * _BYTES_PER_PIXEL * STRIP_WORKING_SET_MULTIPLIER
    rows = rows or plan_strips(width, height, budget_bytes=budget).strip_rows
    with ExitStack() as stack:
        pixels = stack.enter_context(source.map("r"))
        authored = None if reference is None or linked else stack.enter_context(reference.map("r"))
        hue_output = None if hue is None else stack.enter_context(hue.map("w+"))
        render_in_strips(pixels, prefix, lane, sdr_reference_image=authored, color_context=color_context,
                         budget_bytes=budget, delivery_frame_path=stage_a.path, pre_hsl_output=hue_output,
                         apply_delivery_grade_clamp=False, geometry_fixed=True)

    result = stage_a
    if branch.detail_section_enabled and not detail_is_neutral(branch.detail):
        result = apply_detail_to_frame(result, stage_b, branch.detail, lane, rows=rows)
    if local_adjustments:
        grade_options = (dict(reference_white_nits=color_context.hdr_reference_white_nits,
                              target_peak_nits=adjustments.hdr.highlight_compression_target_nits)
                         if lane == PreviewKind.HDR else {})
        result = apply_local_stack_to_frame(result, stage_b if result == stage_a else stage_a, source,
            local_adjustments, lane, geometry, compiled_masks=compiled_masks or {}, hue_source=hue,
            rows=rows, **grade_options)
    if hue is not None:
        hue.path.unlink()
    result = apply_film_to_frame(result, stage_b if result == stage_a else stage_a, adjustments, lane, rows=rows)
    other = stage_b if result == stage_a else stage_a
    if linked:
        result = linked_sdr_to_frame(result, other, adjustments, rows=rows)
        other = stage_b if result == stage_a else stage_a
    if kind == PreviewKind.HDR and apply_output_clamp:
        with _stage("tone_colour"):
            result = transform_bands(result, other, lambda part, top: np.clip(part, 0.0, None), rows=rows)
        other = stage_b if result == stage_a else stage_a
    other.path.unlink(missing_ok=True)
    return result


def linked_sdr_to_frame(source, destination, adjustments, *, rows=128):
    from .adjustments import SDR_SCENE_TO_DISPLAY_SCALE
    from .color import acescg_to_linear_srgb

    gain = np.float32(2.0 ** adjustments.sdr.output_exposure)
    with _stage("tone_colour"):
        return transform_bands(source, destination, lambda part, top:
            (acescg_to_linear_srgb(part) * SDR_SCENE_TO_DISPLAY_SCALE) * gain, rows=rows)


class _PeakReducer:
    """Exact whole-frame maximum or 0.9999 quantile from bounded state.

    ``np.quantile`` at 0.9999 only reads the two order statistics either side
    of ``0.9999 * (n - 1)``, so retaining the largest ``k`` samples reproduces
    it bit for bit -- about 4,200 float32 values for a 42 MP frame, whatever
    the frame's size. ``test_cpu_strips.py`` asserts the equality directly.
    """

    def __init__(self, total_samples: int, *, robust: bool) -> None:
        self._total = max(0, int(total_samples))
        self._robust = bool(robust)
        self._maximum: float | None = None
        self._retain = 0
        self._top: np.ndarray | None = None
        if self._robust and self._total:
            index = _ROBUST_QUANTILE * (self._total - 1)
            self._retain = min(self._total, self._total - int(np.floor(index)) + 2)

    def observe(self, signal: np.ndarray) -> None:
        if signal.size == 0:
            return
        flat = np.asarray(signal, dtype=np.float32).reshape(-1)
        strip_max = float(np.max(flat))
        self._maximum = strip_max if self._maximum is None else max(self._maximum, strip_max)
        if not self._robust:
            return
        if flat.size > self._retain:
            flat = np.partition(flat, flat.size - self._retain)[flat.size - self._retain:]
        merged = flat if self._top is None else np.concatenate([self._top, flat])
        if merged.size > self._retain:
            merged = np.partition(merged, merged.size - self._retain)[merged.size - self._retain:]
        self._top = merged

    def value(self) -> float | None:
        if self._maximum is None:
            return None
        if not self._robust:
            return self._maximum
        descending = np.sort(self._top)[::-1]
        index = _ROBUST_QUANTILE * (self._total - 1)
        lower = int(np.floor(index))
        upper = int(np.ceil(index))
        fraction = index - lower
        # numpy's own linear interpolation, including the branch it takes at
        # or above the midpoint, so the two agree to the last bit.
        low_value = descending[self._total - 1 - lower]
        high_value = descending[self._total - 1 - upper]
        difference = high_value - low_value
        if fraction >= 0.5:
            return float(high_value - difference * (1.0 - fraction))
        return float(low_value + difference * fraction)


@_timed_stage("strip_render")
def render_in_strips(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    *,
    sdr_reference_image: np.ndarray | None = None,
    color_context: RenderColorContext | None = None,
    source_pixel_scale: float = 1.0,
    long_edge: int | None = None,
    local_adjustments: Sequence[LocalAdjustment] | None = None,
    denoise_active: bool = False,
    budget_bytes: int = DEFAULT_STRIP_BUDGET_BYTES,
    is_current: Callable[[], bool] | None = None,
    allocate_output: Callable[[tuple[int, int, int]], np.ndarray] | None = None,
    parallel_sdr_output: bool = False,
    measure_delivery: bool = False,
    delivery_frame_path: Path | None = None,
    pre_hsl_output: np.ndarray | None = None,
    apply_delivery_grade_clamp: bool = True,
    geometry_fixed: bool = False,
) -> tuple[np.ndarray | DeliveryFrame, StripReport]:
    """Render the selected lane strip by strip and return the whole frame.

    Raises ``StripExecutionRefused`` before allocating anything when the graph
    contains a node this phase cannot reproduce exactly, and ``StripCancelled``
    as soon as ``is_current`` goes false -- between strips, so the abandoned
    work is bounded by one strip rather than by the frame.
    """
    color_context = color_context or RenderColorContext()
    geometry = adjustments.shared.geometry
    source_height, source_width = image.shape[:2]
    refusals = strip_execution_refusals(
        adjustments,
        kind,
        local_adjustments=local_adjustments,
        denoise_active=denoise_active,
        source_width=source_width,
        source_height=source_height,
        long_edge=long_edge,
    )
    if refusals:
        raise StripExecutionRefused(refusals)

    authored_reference = (
        sdr_reference_image is not None
        and kind == PreviewKind.SDR
        and adjustments.sdr.use_authored_base
        and not adjustments.sdr.linked_to_hdr
    )
    output_width, output_height = geometry_output_dimensions(source_width, source_height, geometry)
    branch = adjustments.hdr if kind == PreviewKind.HDR or adjustments.sdr.linked_to_hdr else adjustments.sdr
    scan_halo = scan_sharpening_halo(branch, source_pixel_scale)
    plan = plan_strips(output_width, output_height, budget_bytes=budget_bytes, halo_rows=scan_halo)
    report = StripReport(plan=plan)

    checks = iter(range(1, 1 << 30))
    # Count full visits to the strips, including the final scope peak pass.
    if delivery_frame_path is not None:
        passes_per_strip = 1
    elif kind == PreviewKind.SDR:
        passes_per_strip = 3  # Render/measure, finish, scope.
    else:
        passes_per_strip = 4 if adjustments.hdr.highlight_section_enabled else 2
    passes_expected = passes_per_strip * len(plan.strips)

    def check(index: int) -> None:
        from .export_timing import tick
        tick(next(checks), passes_expected)
        if is_current is not None and not is_current():
            report.cancelled_at_strip = index
            raise StripCancelled("A newer adjustment replaced this render.")

    range_cache = {}

    def region(source: np.ndarray, top: int, bottom: int) -> np.ndarray:
        if geometry_fixed:
            return source[top:bottom]
        key = id(source)
        with _stage("geometry"):
            return apply_geometry_region(source, geometry, (0, top, output_width, bottom),
                                         range_cache=range_cache.setdefault(key, {}), range_cache_key=key)

    halo, cell = _grade_halo(branch, source_pixel_scale)
    # Scan Sharpening runs after B&W and HSL. Its input neighbours need their
    # own guide halo too, before snapping the band to the HSL grid.
    halo += scan_halo

    def grade(top, bottom, *, clamp):
        from .hsl_sampling import observe_stage_input

        first = max(0, (top - halo) // cell * cell)
        last = min(output_height, (bottom + halo + cell - 1) // cell * cell)
        reference = region(sdr_reference_image, first, last) if authored_reference else None
        def write_hue(part):
            pre_hsl_output[top:bottom] = part[top - first:bottom - first]

        with observe_stage_input(write_hue) if pre_hsl_output is not None else nullcontext():
            pixels = apply_fixed_source_adjustments(
                region(image, first, last), adjustments, kind, fixed_sdr_reference=reference,
                color_context=color_context, source_pixel_scale=source_pixel_scale,
                include_output_highlight_compression=False, apply_output_clamp=clamp,
                frame_window=FrameWindow(left=0, top=first, width=output_width, height=output_height),
                selection_origin=(0, first),
            )
        if delivery_frame_path is not None:
            from .export_timing import tick
            with _stage("tone_colour"):
                tick(bottom, output_height)
        report.strips_rendered += 1
        return pixels[top - first:bottom - first]

    shape = (output_height, output_width, 3)
    if delivery_frame_path is not None:
        if allocate_output is not None:
            raise ValueError("Sequential delivery writes own their output allocation.")

        def bands():
            for index, (top, bottom) in enumerate(plan.strips):
                if not geometry_fixed:
                    check(index)
                with _stage("tone_colour") if geometry_fixed else nullcontext():
                    yield grade(top, bottom, clamp=apply_delivery_grade_clamp)
                    if geometry_fixed:
                        check(index)

        frame = DeliveryFrame(delivery_frame_path, shape)
        frame.write(bands())
        report.passes = ("render",)
        return frame, report

    output = np.empty(shape, dtype=np.float32) if allocate_output is None else allocate_output(shape)
    passes: list[str] = []
    anchor: HighlightAnchor | None = None

    if kind == PreviewKind.SDR:
        passes.append("render")
        sdr = adjustments.sdr
        reducer = _PeakReducer(plan.width * plan.height, robust=sdr.highlight_compression_peak_measurement == "robust")
        for index, (top, bottom) in enumerate(plan.strips):
            check(index)
            output[top:bottom] = grade(top, bottom, clamp=False)
            if sdr.highlight_section_enabled or measure_delivery:
                signal = sdr_highlight_peak_signal(output[top:bottom], sdr)
                if signal is not None:
                    reducer.observe(signal)
        measured = reducer.value()
        if measure_delivery:
            report.delivery_anchor = measured
        if measured is not None and sdr.highlight_section_enabled:
            anchor = HighlightAnchor(sdr_peak=measured)
            passes.append("sdr-anchor")

        def finish(rows: slice) -> np.ndarray:
            return apply_sdr_output_highlight_compression(output[rows], adjustments, anchor=anchor)

        with CpuExecutor() as pool:
            for index, (top, bottom) in enumerate(plan.strips):
                check(index)
                if parallel_sdr_output and bottom - top > 1:
                    # Two half-strips fit the existing one-strip scratch budget.
                    middle = (top + bottom) // 2
                    bands = (slice(top, middle), slice(middle, bottom))
                    for rows, pixels in zip(bands, pool.map(finish, bands)):
                        output[rows] = pixels
                    del pixels
                else:
                    rows = slice(top, bottom)
                    output[rows] = finish(rows)
        passes.append("sdr-output")
    else:
        anchor, passes_used = _render_hdr_strips(
            grade, adjustments, plan, check, output, color_context, report,
            measure_delivery=measure_delivery,
        )
        passes.extend(passes_used)

    # The bounded render has the only native-resolution CPU pixels in hand.
    # Reduce the delivery-critical scope maximum now, one strip at a time, so
    # a later proxy-sized histogram can report the peak of the frame that was
    # actually presented without retaining another full-frame intermediate.
    from .scopes import scope_peak_value

    peak = 0.0
    weights = np.array([.2126, .7152, .0722], dtype=np.float32) if measure_delivery and kind == PreviewKind.SDR else None
    linear_peak = -np.inf
    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        pixels = output[top:bottom]
        peak = max(peak, scope_peak_value(pixels, kind, color_context))
        if weights is not None:
            linear_peak = np.maximum(linear_peak, np.max(pixels @ weights))
    report.scope_peak_value = peak
    if weights is not None:
        report.linear_sdr_peak = float(linear_peak)
    passes.append("scope-peak")

    report.passes = tuple(passes)
    report.anchor = anchor
    output.setflags(write=False)
    return output, report


def _render_hdr_strips(
    grade: Callable,
    adjustments: AdjustmentState,
    plan: StripPlan,
    check: Callable[[int], None],
    output: np.ndarray,
    color_context: RenderColorContext,
    report: StripReport,
    *,
    measure_delivery: bool,
) -> tuple[HighlightAnchor | None, list[str]]:
    """Render the HDR lane, staging the output highlight pass over the buffer.

    The HDR shoulder measures the *finished* picture, so the graph runs once
    into the output buffer with the output stage withheld, the anchor is
    reduced from what landed there, and the two halves of the output stage then
    run back over the same buffer. One graph pass, two cheap ones -- never the
    graph twice.
    """
    hdr = adjustments.hdr
    robust = hdr.highlight_compression_peak_measurement == "robust"
    delivery_peak = _PeakReducer(plan.width * plan.height, robust=robust) if measure_delivery else None
    if not hdr.highlight_section_enabled:
        for index, (top, bottom) in enumerate(plan.strips):
            check(index)
            output[top:bottom] = grade(top, bottom, clamp=True)
            if delivery_peak is not None:
                signal = hdr_highlight_peak_signal(output[top:bottom], hdr)
                if signal is not None:
                    delivery_peak.observe(signal)
        if delivery_peak is not None:
            report.delivery_anchor = delivery_peak.value()
        return None, ["render"]

    mode = str(hdr.highlight_compression_mode)
    peak_reducer = _PeakReducer(plan.width * plan.height, robust=robust)
    clip_reducer = _PeakReducer(plan.width * plan.height * 3, robust=False)
    measured_peak = False

    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        graded = grade(top, bottom, clamp=False)
        output[top:bottom] = graded
        signal = hdr_highlight_peak_signal(graded, hdr)
        if signal is not None and signal.size:
            measured_peak = True
            peak_reducer.observe(signal)
        if delivery_peak is not None and signal is not None:
            # Whole-frame export measures after the HDR grade has clamped RGB.
            # The strip shoulder still uses its original unclamped anchor.
            del signal
            delivery_signal = hdr_highlight_peak_signal(np.maximum(graded, 0.0), hdr)
            delivery_peak.observe(delivery_signal)
            del delivery_signal
        if mode == "clip":
            clip_reducer.observe(hdr_output_transport_signal(graded))

    if delivery_peak is not None:
        report.delivery_anchor = delivery_peak.value()
    peak_nits = None
    if measured_peak:
        measured = peak_reducer.value()
        if measured is not None:
            peak_nits = hdr_peak_nits_from_measured(measured, color_context)
    anchor = HighlightAnchor(
        hdr_source_peak_nits=peak_nits,
        hdr_clip_transport_max=clip_reducer.value() if mode == "clip" else None,
    )
    anchor = _finish_hdr_strips(output, adjustments, color_context, plan, anchor, check,
                                ceiling=mode != "off", clamp=True)
    return anchor, ["render", "hdr-shoulder", "hdr-ceiling"]


def _finish_hdr_strips(output, adjustments, color_context, plan, anchor, check, *, ceiling, clamp):
    output_reducer = _PeakReducer(plan.width * plan.height * 3, robust=False)
    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        compressed = compress_hdr_output_highlights(
            output[top:bottom], adjustments, color_context=color_context, anchor=anchor
        )
        output[top:bottom] = compressed
        if ceiling:
            output_reducer.observe(hdr_output_transport_signal(compressed))

    anchor = HighlightAnchor(
        hdr_source_peak_nits=anchor.hdr_source_peak_nits,
        hdr_clip_transport_max=anchor.hdr_clip_transport_max,
        hdr_output_transport_max=output_reducer.value() if ceiling else None,
    )

    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        strip = output[top:bottom]
        if ceiling:
            strip = clip_hdr_output_target(
                strip, adjustments, color_context=color_context, anchor=anchor
            )
        output[top:bottom] = np.clip(strip, 0.0, None) if clamp else strip
    return anchor


@_timed_stage("highlight_compression")
def finish_output_highlights(pixels, adjustments, kind, color_context, *, measure=False):
    """Limit a writable, finished photo using the full-frame peak in each domain."""
    from .export_timing import tick

    height, width = pixels.shape[:2]
    plan = plan_strips(width, height)
    hdr = kind == PreviewKind.HDR
    branch = adjustments.hdr if hdr else adjustments.sdr
    enabled = branch.highlight_section_enabled
    if hdr and not enabled and not measure:
        return None
    passes = 1 + (2 if enabled else 0) if hdr else 2
    visits = iter(range(1, passes * plan.strip_count + 1))

    def check(_index):
        tick(next(visits), passes * plan.strip_count)

    reducer = _PeakReducer(width * height, robust=branch.highlight_compression_peak_measurement == "robust")
    clip_reducer = _PeakReducer(width * height * 3, robust=False)
    signal = hdr_highlight_peak_signal if hdr else sdr_highlight_peak_signal
    clip = hdr and enabled and branch.highlight_compression_mode == "clip"
    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        band = pixels[top:bottom]
        if enabled or measure:
            values = signal(band, branch)
            if values is not None:
                reducer.observe(values)
        if clip:
            clip_reducer.observe(hdr_output_transport_signal(band))
    measured = reducer.value()
    if hdr and enabled:
        anchor = HighlightAnchor(
            hdr_source_peak_nits=None if measured is None else hdr_peak_nits_from_measured(measured, color_context),
            hdr_clip_transport_max=clip_reducer.value(),
        )
        _finish_hdr_strips(pixels, adjustments, color_context, plan, anchor, check, ceiling=True, clamp=False)
    elif not hdr:
        anchor = HighlightAnchor(sdr_peak=measured)
        for index, (top, bottom) in enumerate(plan.strips):
            check(index)
            pixels[top:bottom] = apply_sdr_output_highlight_compression(pixels[top:bottom], adjustments, anchor=anchor)
    return measured
