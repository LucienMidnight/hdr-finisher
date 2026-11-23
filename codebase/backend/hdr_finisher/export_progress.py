"""How far one export has got, for the progress bar, from the stage clock.

When an export starts, ``plan_export`` lists the stages that will actually run
in each lane, each with an expected cost from its measured seconds per
megapixel on the minimum Mac (``export_timing`` records, November 22). Stages
that will not run get no weight. While the export runs, a stage's share moves
with its loop ticks (Grain tiles, strips, Film Grain chunks, local tiles, Y4M
bands) or, where a stage has no loop, with its own elapsed time against its
expected cost. A stage that runs past its estimate keeps creeping towards
done without reaching it, so the bar never stalls; its lane finishing counts
it whole. The reported fraction never goes backwards.

The costs set only how the bar is divided between stages; a wrong estimate
moves the bar unevenly but cannot stall it or run it backwards.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
import threading
from time import monotonic

from .export_timing import ExportClock

# Seconds per megapixel of the source frame on the MacBook Neo, from the
# Sony Profile A/B export_timing records of November 22 after the speed
# changes (per rendition, except Clean Grain, which both share).
STAGE_COST = {
    "develop_raw": 0.10,
    "denoise": 0.15,
    "geometry": 0.08,
    "masks": 0.21,
    "tone_colour": 0.08,
    "hsl_selection": 1.25,
    "detail": 0.14,
    "local_stack": 0.055,
    "film_stock": 0.27,
    "halation": 0.075,
    "lens_filter": 0.22,
    "film_grain": 0.50,
    "vignette": 0.012,
    "output_finishing": 0.015,
    "strip_render": 0.035,
}
# Seconds per megapixel of the delivered file, both renditions.
ENCODE_COST = {"prepare_y4m": 0.044, "encode": 0.275, "validate": 0.015}
ENCODE_FIXED_S = 0.5

LABELS = {
    "source": "Developing RAW",
    "denoise": "Denoising",
    "hdr": "Rendering HDR",
    "sdr": "Rendering SDR",
    "encode": "Encoding",
    "finish": "Finishing",
}
_FINISHING = {"validate", "metadata", "ceiling_verify"}
_SDR_FORMATS = {"sdr_jpeg", "sdr_png", "sdr_jpegxl"}
_KNEE = 0.9  # Share of a stage reached at 90% of its expected time.


def default_render_label(export_format: str | None) -> str:
    return LABELS["sdr"] if export_format in _SDR_FORMATS else LABELS["hdr"]


def timed_share(elapsed: float, expected: float) -> float:
    """A stage's share from its own time: linear, then creeping towards done."""
    if expected <= 0.0:
        return 0.0
    ratio = elapsed / expected
    if ratio <= _KNEE:
        return ratio
    return 1.0 - (1.0 - _KNEE) * math.exp(-(ratio - _KNEE) / 0.5)


@dataclass
class ExportPlan:
    """Expected seconds for each (lane, stage) that will run."""
    items: dict[tuple[str, str], float] = field(default_factory=dict)
    default_label: str = LABELS["hdr"]

    def add(self, lane: str, stage: str, seconds: float) -> None:
        if seconds > 0.0:
            self.items[(lane, stage)] = self.items.get((lane, stage), 0.0) + seconds

    @property
    def total(self) -> float:
        return sum(self.items.values())


class ExportProgress:
    """Thread-safe reader of one clock against its plan."""

    def __init__(self, clock: ExportClock, plan: ExportPlan) -> None:
        self.clock, self.plan = clock, plan
        self._ticks: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()
        self._reported = 0.0
        self._started = monotonic()
        self._label = None
        self.done = False
        clock.progress = self

    def tick(self, done: int, total: int) -> None:
        key = self.clock.current()
        if key[1] is None:
            return
        with self._lock:
            self._ticks[key] = max(self._ticks.get(key, 0.0), min(1.0, done / total))

    def _key_fraction(self, key: tuple[str, str], expected: float) -> float:
        lane, stage = key
        if self.clock.lane_finished(lane):
            return 1.0
        if lane == "*":  # Shared Grain: whichever rendition lane computed it.
            elapsed = sum(self.clock.elapsed(name, stage) for name in ("hdr", "sdr", "source"))
            ticked = max((value for (other, name), value in self._ticks.items() if name == stage), default=0.0)
            finished = any(self.clock.lane_finished(name) and self.clock.elapsed(name, stage) > 0
                           for name in ("hdr", "sdr"))
            if finished:
                return 1.0
        else:
            elapsed = self.clock.elapsed(lane, stage)
            ticked = self._ticks.get(key, 0.0)
        return max(ticked, timed_share(elapsed, expected))

    def fraction(self) -> float:
        total = self.plan.total
        if self.done:
            value = 1.0
        elif total <= 0:
            value = 0.0
        else:
            with self._lock:
                credited = sum(expected * self._key_fraction(key, expected)
                               for key, expected in self.plan.items.items())
            value = min(0.99, credited / total)
        with self._lock:
            self._reported = max(self._reported, value)
            return self._reported

    def label(self) -> str:
        with self._lock:
            lane, stage = self.clock.current()
            if stage == "denoise":
                self._label = LABELS["denoise"]
            elif lane == "encode":
                self._label = LABELS["finish"] if stage in _FINISHING else LABELS["encode"]
            elif lane in ("hdr", "sdr"):
                self._label = LABELS[lane]
            elif stage == "develop_raw":
                self._label = LABELS["source"]
            # Between renditions keep the last label. In Grade the RAW
            # is already developed when the export clock opens.
            return self._label or self.plan.default_label

    def snapshot(self) -> dict:
        fraction = self.fraction()
        elapsed = monotonic() - self._started
        return {"fraction": round(fraction, 4), "label": self.label(), "elapsed_s": round(elapsed, 2),
                "eta_s": estimate_remaining(fraction, elapsed)}


def estimate_remaining(fraction: float, elapsed: float) -> int | None:
    """Seconds left once there is enough to go on: 5% and three seconds."""
    if fraction >= 1.0:
        return 0
    if fraction < 0.05 or elapsed < 3.0:
        return None
    return max(1, round(elapsed / fraction * (1.0 - fraction)))


def plan_export(session, settings, adjustments, *, develop_megapixels: float = 0.0) -> ExportPlan:
    """The stages this export will run, with their expected seconds."""
    from .exporters import (_bounded_export_eligible, _delivery_finishing_plan, _delivery_grain_shared,
                            _staged_export_needed, denoise_delivery_key, denoise_settings_for_export)
    from .finishing import geometry_output_dimensions, geometry_is_identity, resolve_output_dimensions
    from .local_adjustments import has_hue_mask
    from .models import PreviewKind

    plan = ExportPlan(default_label=default_render_label(settings.format))
    height, width = session.image.shape[:2]
    megapixels = width * height / 1e6
    plan.add("source", "develop_raw", STAGE_COST["develop_raw"] * develop_megapixels)
    geometry = adjustments.shared.geometry
    locals_ = adjustments.enabled_locals(getattr(session, "local_adjustments", None)) or []
    lanes = [PreviewKind.HDR, PreviewKind.SDR]
    if settings.format in _SDR_FORMATS:
        lanes = [PreviewKind.SDR]
    elif settings.format == "jpegxl_hdr" and getattr(settings, "_proof_endpoint_directory", None) is None:
        lanes = [PreviewKind.HDR]
    shared_grain = _delivery_grain_shared(session, adjustments)
    target, layout, defer_output = _delivery_finishing_plan(session, settings, adjustments)
    denoise_hdr, denoise_sdr = denoise_delivery_key(session)
    linked_equal = len(lanes) == 2 and adjustments.sdr.linked_to_hdr and denoise_hdr == denoise_sdr
    staged_lanes = {kind for kind in lanes if _staged_export_needed(session, kind, adjustments)
                    and _bounded_export_eligible(session, settings, kind, adjustments, staged=True)}
    linked_shared = linked_equal and len(staged_lanes) == 2
    same_source = denoise_hdr == denoise_sdr and not (
        getattr(session, "sdr_reference_image", None) is not None and adjustments.sdr.use_authored_base
        and not adjustments.sdr.linked_to_hdr)
    for position, kind in enumerate(lanes):
        lane = kind.value
        staged = kind in staged_lanes
        linked_tail = linked_shared and kind == PreviewKind.SDR
        if not linked_tail and denoise_settings_for_export(session, kind) is not None:
            plan.add("*" if shared_grain else lane, "denoise",
                     STAGE_COST["denoise"] * megapixels / (2 if shared_grain and len(lanes) > 1 and not linked_shared else 1))
        if not staged and _bounded_export_eligible(session, settings, kind, adjustments, prepared_denoise=True):
            plan.add(lane, "strip_render", STAGE_COST["strip_render"] * megapixels)
            if not defer_output:
                continue
        if staged or defer_output:
            delivered_cost = STAGE_COST["output_finishing"] * target[0] * target[1] / 1e6
            if kind == PreviewKind.SDR or adjustments.hdr.highlight_section_enabled:
                plan.add(lane, "highlight_compression", delivered_cost)
            if layout is not None:
                plan.add(lane, "framing", STAGE_COST["output_finishing"] * layout.width * layout.height / 1e6)
            if staged and settings.watermark.mode != "off":
                plan.add(lane, "watermark", delivered_cost)
        if linked_tail:
            plan.add(lane, "tone_colour", STAGE_COST["output_finishing"] * megapixels)
            plan.add(lane, "output_finishing", STAGE_COST["output_finishing"] * megapixels)
            continue
        shared_fixed = position != 0 and (shared_grain or (staged and same_source and lanes[0] in staged_lanes))
        if not geometry_is_identity(geometry) and not shared_fixed:
            plan.add(lane, "geometry", STAGE_COST["geometry"] * megapixels)
        for local in locals_:
            if local.enabled and local.opacity > 0.0:
                if position == 0 or (staged and (not shared_fixed or has_hue_mask(local.mask))):
                    plan.add(lane, "masks", STAGE_COST["masks"] * megapixels)
                plan.add(lane, "local_stack", STAGE_COST["local_stack"] * megapixels)
        branch = adjustments.hdr if kind == PreviewKind.HDR or adjustments.sdr.linked_to_hdr else adjustments.sdr
        from .hsl import recipe_active
        hsl_active = branch.hsl_section_enabled and any(recipe_active(c.recipe) for c in branch.hsl.channels)
        tone_cost = STAGE_COST["tone_colour"] + (STAGE_COST["hsl_selection"] if hsl_active else 0.0)
        plan.add(lane, "tone_colour", tone_cost * megapixels)
        if branch.detail_section_enabled and _detail_active(branch.detail):
            plan.add(lane, "detail", STAGE_COST["detail"] * megapixels)
        look = branch.film_look
        if branch.film_look_section_enabled and look.look_strength > 0:
            from .adjustments import _film_stock_is_active
            grain = look.grain_enabled and look.grain_amount > 0
            grain_map = look.grain_enabled and look.grain_view_map
            if _film_stock_is_active(look) and not grain_map:
                plan.add(lane, "film_grain" if grain else "film_stock", STAGE_COST["film_stock"] * megapixels)
            if look.halation_enabled and look.halation_amount > 0 and look.halation_radius > 0:
                plan.add(lane, "halation", STAGE_COST["halation"] * megapixels)
            if grain or grain_map:
                plan.add(lane, "film_grain", STAGE_COST["film_grain"] * megapixels)
            if staged:
                effects = {"lens_filter": look.lens_filter != "none", "film_resolution": look.film_resolution < 100,
                           "scan_sharpening": look.scan_sharpening > 0}
                for name, active in effects.items():
                    if active:
                        plan.add(lane, name, STAGE_COST.get(name, STAGE_COST["detail"]) * megapixels)
                if any(effects.values()) or grain or _film_stock_is_active(look) or look.halation_enabled and look.halation_amount > 0:
                    if not grain_map and not (look.halation_enabled and look.halation_view_map):
                        plan.add(lane, "look_strength", STAGE_COST["output_finishing"] * megapixels)
        if staged:
            from .adjustments import _structure_is_active
            if _structure_is_active(branch):
                plan.add(lane, "image_structure", STAGE_COST["detail"] * megapixels)
        if branch.vignette_section_enabled:
            plan.add(lane, "vignette", STAGE_COST["vignette"] * megapixels)
        plan.add(lane, "output_finishing", STAGE_COST["output_finishing"] * megapixels)
    output = resolve_output_dimensions(*geometry_output_dimensions(width, height, geometry), settings.output_finishing)
    output_megapixels = output[0] * output[1] / 1e6
    for stage, cost in ENCODE_COST.items():
        plan.add("encode", stage, cost * output_megapixels * (len(lanes) / 2 if stage != "encode" else 1))
    plan.add("encode", "encode", ENCODE_FIXED_S)
    return plan


def _detail_active(detail) -> bool:
    from .detail import detail_is_neutral
    return not detail_is_neutral(detail)
