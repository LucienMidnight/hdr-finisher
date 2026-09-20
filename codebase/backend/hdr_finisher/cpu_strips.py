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
derives its radii from the frame diagonal, and masks, Denoise and the spatial
Film Look kernels need halos or full-frame inputs this phase does not carry.
Those are Phases 5 to 7.

The one thing a *pointwise* graph still takes from the whole frame is the
highlight anchor: Peak Fit fits its shoulder to the brightest pixel in the
image, and the HDR delivery ceiling picks between two branches on a whole-frame
maximum. Those are measured here in bounded reduction passes and injected
through ``HighlightAnchor``, which is why the result is byte-identical rather
than merely close.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

from .adjustments import (
    FrameWindow,
    HighlightAnchor,
    apply_fixed_source_adjustments,
    clip_hdr_output_target,
    compress_hdr_output_highlights,
    hdr_highlight_peak_signal,
    hdr_output_transport_signal,
    hdr_peak_nits_from_measured,
    sdr_highlight_peak_signal,
    sdr_highlight_stage_input,
)
from .color_context import RenderColorContext
from .detail import detail_is_neutral
from .finishing import apply_geometry_region, geometry_output_dimensions, geometry_resample_stage
from .models import AdjustmentState, LocalAdjustment, PreviewKind, SdrMatchState

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
) -> StripPlan:
    """Divide an output frame into strips whose intermediates fit the budget.

    Strips span the full width so every extraction keeps the whole-frame row
    pitch, which is what makes the region result equal to the corresponding
    slice of the whole-frame result.
    """
    width = max(1, int(width))
    height = max(1, int(height))
    budget = max(1, int(budget_bytes))
    multiplier = max(1, int(working_set_multiplier))
    row_bytes = width * _BYTES_PER_PIXEL * multiplier
    strip_rows = max(1, min(height, budget // max(1, row_bytes)))
    strips = tuple(
        (top, min(height, top + strip_rows)) for top in range(0, height, strip_rows)
    )
    return StripPlan(
        width=width,
        height=height,
        strip_rows=strip_rows,
        strips=strips,
        budget_bytes=budget,
        planned_transient_bytes=strip_rows * row_bytes,
        output_bytes=width * height * _BYTES_PER_PIXEL,
    )


def strip_execution_refusals(
    adjustments: AdjustmentState,
    kind: PreviewKind,
    *,
    local_adjustments: Sequence[LocalAdjustment] | None = None,
    sdr_match: SdrMatchState | None = None,
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
    branch = adjustments.hdr if kind == PreviewKind.HDR else adjustments.sdr

    if any(local.enabled and local.opacity > 0.0 for local in (local_adjustments or [])):
        reasons.append("local adjustments")
    if branch.detail_section_enabled and not detail_is_neutral(branch.detail):
        reasons.append("detail")

    look = branch.film_look
    look_active = branch.film_look_section_enabled and float(look.look_strength) > 0.0
    if look_active:
        spatial = (
            (look.halation_enabled and (look.halation_view_map or (look.halation_amount > 0.0 and look.halation_radius > 0.0)))
            or (look.bloom_enabled and look.bloom_amount > 0.0 and look.bloom_radius > 0.0)
            or (look.image_structure_enabled and (look.image_softness != 0.0 or look.microcontrast != 0.0))
            or look.film_resolution < 100.0
        )
        if spatial:
            reasons.append("spatial film effects")
    # Grain and vignette are placed against the frame through ``FrameWindow``,
    # so a strip draws its share of the frame's vignette and samples the
    # frame's grain field rather than starting its own. Neither needs a
    # refusal any more; the GPU side lifted the same two in the same phase.
    if denoise_active:
        reasons.append("denoise")
    if sdr_match is not None and sdr_match.active:
        reasons.append("matched SDR")

    geometry = adjustments.shared.geometry
    if geometry_resample_stage(geometry) == "roll":
        # `Image.rotate(expand=True)` owns the expansion and safe-inset
        # geometry, so a windowed roll still materializes the whole rotated
        # frame. Exact, but not bounded, which is the property this path sells.
        reasons.append("roll geometry")
    if long_edge is not None and source_width and source_height:
        output_width, output_height = geometry_output_dimensions(source_width, source_height, geometry)
        if max(output_width, output_height) > int(long_edge):
            # The whole-frame path downsamples here, and a per-strip
            # downsample does not reproduce a whole-frame one at the seams.
            reasons.append("post-geometry downsample")
    return reasons


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
    sdr_match: SdrMatchState | None = None,
    denoise_active: bool = False,
    budget_bytes: int = DEFAULT_STRIP_BUDGET_BYTES,
    is_current: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, StripReport]:
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
        sdr_match=sdr_match,
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
    )
    output_width, output_height = geometry_output_dimensions(source_width, source_height, geometry)
    plan = plan_strips(output_width, output_height, budget_bytes=budget_bytes)
    report = StripReport(plan=plan)

    def check(index: int) -> None:
        if is_current is not None and not is_current():
            report.cancelled_at_strip = index
            raise StripCancelled("A newer adjustment replaced this render.")

    def region(source: np.ndarray, top: int, bottom: int) -> np.ndarray:
        return apply_geometry_region(source, geometry, (0, top, output_width, bottom))

    def window(top: int) -> FrameWindow:
        """Where this strip sits in the frame, for the stages that are placed."""
        return FrameWindow(left=0, top=top, width=output_width, height=output_height)

    output = np.empty((output_height, output_width, 3), dtype=np.float32)
    passes: list[str] = []
    anchor: HighlightAnchor | None = None

    if kind == PreviewKind.SDR:
        anchor = _measure_sdr_anchor(
            image,
            sdr_reference_image if authored_reference else None,
            adjustments,
            plan,
            region,
            check,
            passes,
            authored_reference=authored_reference,
        )
        passes.append("render")
        for index, (top, bottom) in enumerate(plan.strips):
            check(index)
            reference = region(sdr_reference_image, top, bottom) if authored_reference else None
            output[top:bottom] = apply_fixed_source_adjustments(
                region(image, top, bottom),
                adjustments,
                kind,
                fixed_sdr_reference=reference,
                color_context=color_context,
                source_pixel_scale=source_pixel_scale,
                highlight_anchor=anchor,
                frame_window=window(top),
            )
            report.strips_rendered += 1
    else:
        anchor, passes_used = _render_hdr_strips(
            image, adjustments, plan, region, check, output, color_context, source_pixel_scale, report, window
        )
        passes.extend(passes_used)

    report.passes = tuple(passes)
    report.anchor = anchor
    output.setflags(write=False)
    return output, report


def _measure_sdr_anchor(
    image: np.ndarray,
    reference_image: np.ndarray | None,
    adjustments: AdjustmentState,
    plan: StripPlan,
    region: Callable[[np.ndarray, int, int], np.ndarray],
    check: Callable[[int], None],
    passes: list[str],
    *,
    authored_reference: bool,
) -> HighlightAnchor | None:
    """Reduce the SDR Peak Fit anchor over the whole frame, in strips.

    The SDR shoulder sits early in the chain, so this pass runs only the few
    pointwise stages ahead of it rather than the whole graph.
    """
    sdr = adjustments.sdr
    if sdr.rendering_version == "legacy_base_v1" or not sdr.highlight_section_enabled:
        return None
    if str(getattr(sdr, "highlight_compression_mode", "peak_fit")) != "peak_fit":
        return None
    if str(getattr(sdr, "highlight_compression_peak_measurement", "maximum")) == "manual":
        return None
    robust = str(getattr(sdr, "highlight_compression_peak_measurement", "maximum")) == "robust"
    probe_source = reference_image if authored_reference else image
    reducer = _PeakReducer(plan.width * plan.height, robust=robust)
    passes.append("sdr-anchor")
    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        stage_input = sdr_highlight_stage_input(
            region(probe_source, top, bottom), adjustments, authored_reference=authored_reference
        )
        signal = sdr_highlight_peak_signal(stage_input, sdr)
        if signal is None:
            # `sdr_highlight_peak_signal` already agreed above that this graph
            # measures; disagreeing now would mean the two had drifted apart.
            raise AssertionError("the SDR highlight stage stopped measuring mid-frame")
        reducer.observe(signal)
    peak = reducer.value()
    return None if peak is None else HighlightAnchor(sdr_peak=peak)


def _render_hdr_strips(
    image: np.ndarray,
    adjustments: AdjustmentState,
    plan: StripPlan,
    region: Callable[[np.ndarray, int, int], np.ndarray],
    check: Callable[[int], None],
    output: np.ndarray,
    color_context: RenderColorContext,
    source_pixel_scale: float,
    report: StripReport,
    window: Callable[[int], FrameWindow],
) -> tuple[HighlightAnchor | None, list[str]]:
    """Render the HDR lane, staging the output highlight pass over the buffer.

    The HDR shoulder measures the *finished* picture, so the graph runs once
    into the output buffer with the output stage withheld, the anchor is
    reduced from what landed there, and the two halves of the output stage then
    run back over the same buffer. One graph pass, two cheap ones -- never the
    graph twice.
    """
    hdr = adjustments.hdr
    if not hdr.highlight_section_enabled:
        for index, (top, bottom) in enumerate(plan.strips):
            check(index)
            output[top:bottom] = apply_fixed_source_adjustments(
                region(image, top, bottom),
                adjustments,
                PreviewKind.HDR,
                color_context=color_context,
                source_pixel_scale=source_pixel_scale,
                frame_window=window(top),
            )
            report.strips_rendered += 1
        return None, ["render"]

    mode = str(hdr.highlight_compression_mode)
    robust = str(getattr(hdr, "highlight_compression_peak_measurement", "maximum")) == "robust"
    peak_reducer = _PeakReducer(plan.width * plan.height, robust=robust)
    clip_reducer = _PeakReducer(plan.width * plan.height * 3, robust=False)
    measured_peak = False

    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        graded = apply_fixed_source_adjustments(
            region(image, top, bottom),
            adjustments,
            PreviewKind.HDR,
            color_context=color_context,
            source_pixel_scale=source_pixel_scale,
            include_output_highlight_compression=False,
            apply_output_clamp=False,
            frame_window=window(top),
        )
        output[top:bottom] = graded
        signal = hdr_highlight_peak_signal(graded, hdr)
        if signal is not None and signal.size:
            measured_peak = True
            peak_reducer.observe(signal)
        if mode == "clip":
            clip_reducer.observe(hdr_output_transport_signal(graded))
        report.strips_rendered += 1

    peak_nits = None
    if measured_peak:
        measured = peak_reducer.value()
        if measured is not None:
            peak_nits = hdr_peak_nits_from_measured(measured, color_context)
    anchor = HighlightAnchor(
        hdr_source_peak_nits=peak_nits,
        hdr_clip_transport_max=clip_reducer.value() if mode == "clip" else None,
    )

    output_reducer = _PeakReducer(plan.width * plan.height * 3, robust=False)
    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        compressed = compress_hdr_output_highlights(
            output[top:bottom], adjustments, color_context=color_context, anchor=anchor
        )
        output[top:bottom] = compressed
        if mode != "off":
            output_reducer.observe(hdr_output_transport_signal(compressed))

    anchor = HighlightAnchor(
        hdr_source_peak_nits=anchor.hdr_source_peak_nits,
        hdr_clip_transport_max=anchor.hdr_clip_transport_max,
        hdr_output_transport_max=output_reducer.value() if mode != "off" else None,
    )

    for index, (top, bottom) in enumerate(plan.strips):
        check(index)
        strip = output[top:bottom]
        if mode != "off":
            strip = clip_hdr_output_target(
                strip, adjustments, color_context=color_context, anchor=anchor
            )
        output[top:bottom] = np.clip(strip, 0.0, None)

    return anchor, ["render", "hdr-shoulder", "hdr-ceiling"]
