"""Phase 4: the bounded CPU strip path must equal the whole-frame path exactly.

The sprint's Phase 4 exit gate asks that *"CPU Full executes through a bounded
path"*. A bounded path that produced a slightly different picture would not be
the same preview, so these tests compare ``render_in_strips`` against
``apply_adjustments`` itself rather than against a remembered constant -- the
same standard ``test_geometry_region.py`` holds the Phase 3 tile extraction to.

They also pin the three properties that make the path worth having: it refuses
rather than silently disagreeing, it stops between strips when superseded, and
its peak transient allocation follows the budget instead of the frame.
"""

from __future__ import annotations

import sys
import tracemalloc
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from hdr_finisher.adjustments import apply_adjustments  # noqa: E402
from hdr_finisher.cpu_strips import (  # noqa: E402
    DEFAULT_STRIP_BUDGET_BYTES,
    StripCancelled,
    StripExecutionRefused,
    _PeakReducer,
    plan_strips,
    render_in_strips,
    strip_execution_refusals,
)
from hdr_finisher.finishing import geometry_resample_stage  # noqa: E402
from hdr_finisher.models import (  # noqa: E402
    AdjustmentState,
    CropRectangle,
    GeometryAdjustments,
    LocalAdjustment,
    PreviewKind,
    ToneEqualizerNode,
)

# The windowed projective resample perturbs float32 in its last bits, which
# `test_geometry_region.py` measures at 6e-08 absolute. That difference is in
# the strip's *input*, so the grade carries it forward; nothing else in this
# corpus is inexact.
WARP_ATOL = 1e-5
WARP_RTOL = 1e-5


def _source(height: int = 61, width: int = 43, seed: int = 11) -> np.ndarray:
    """A source with real dynamic range, out-of-gamut colour and negatives.

    Negative ACEScg channels matter here: the HDR delivery ceiling picks between
    two branches that only disagree once a delivery channel is below zero, so a
    corpus of well-behaved pixels would not exercise the reason the anchor has
    to be measured over the whole frame at all.
    """
    rng = np.random.default_rng(seed)
    base = rng.random((height, width, 3), dtype=np.float32) * np.float32(6.0)
    base[:, : width // 4] *= np.float32(0.02)
    base[height // 3 : height // 3 + 3, :] = np.float32(48.0)
    base[..., 2] -= np.float32(0.35)
    return np.ascontiguousarray(base, dtype=np.float32)


def _tone_nodes(values):
    return [ToneEqualizerNode(input_ev=index - 6, adjustment_ev=value) for index, value in enumerate(values)]


def _graded_state(**overrides) -> AdjustmentState:
    state = AdjustmentState()
    state.hdr.exposure = 0.85
    state.hdr.contrast = 0.22
    state.hdr.saturation = 12.0
    state.hdr.lift = 0.1
    state.hdr.gamma = -0.15
    state.hdr.gain = 0.2
    state.hdr.tone_equalizer_section_enabled = True
    state.hdr.tone_equalizer_nodes = _tone_nodes([0.4, 0.2, 0.0, -0.3, 0.5, 0.1, 0.0, -0.2, 0.3, 0.0, 0.1, 0.0, -0.4])
    state.sdr.exposure = -0.4
    state.sdr.contrast = 0.3
    state.sdr.saturation = -8.0
    state.sdr.shadow = 15
    state.sdr.gain = 0.25
    for key, value in overrides.items():
        target, _, field = key.partition("__")
        setattr(getattr(state, target), field, value)
    return state


GEOMETRIES = {
    "identity": GeometryAdjustments(),
    "rotate90": GeometryAdjustments(rotation=90),
    "flip": GeometryAdjustments(flip_horizontal=True, flip_vertical=True),
    "crop": GeometryAdjustments(crop=CropRectangle(x=0.13, y=0.21, width=0.6, height=0.55)),
    "rotate180-crop": GeometryAdjustments(
        rotation=180, crop=CropRectangle(x=0.05, y=0.1, width=0.8, height=0.7)
    ),
    "perspective": GeometryAdjustments(perspective_horizontal=18.0, perspective_vertical=-9.0),
}


def _assert_matches(strips, reference, geometry, message):
    if geometry_resample_stage(geometry) == "perspective":
        np.testing.assert_allclose(strips, reference, atol=WARP_ATOL, rtol=WARP_RTOL, err_msg=message)
    else:
        np.testing.assert_array_equal(strips, reference, err_msg=message)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("geometry_name", sorted(GEOMETRIES))
@pytest.mark.parametrize("budget", [4096, 64 * 1024, DEFAULT_STRIP_BUDGET_BYTES])
def test_strip_render_equals_whole_frame(kind, geometry_name, budget):
    geometry = GEOMETRIES[geometry_name]
    state = _graded_state()
    state.shared.geometry = geometry
    state.hdr.highlight_section_enabled = True
    image = _source()

    reference = apply_adjustments(image, state, kind)
    strips, report = render_in_strips(image, state, kind, budget_bytes=budget)

    assert strips.shape == reference.shape
    _assert_matches(strips, reference, geometry, f"{kind}/{geometry_name}/budget={budget}")
    assert report.strips_rendered == report.plan.strip_count
    assert report.cancelled_at_strip is None


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
@pytest.mark.parametrize("mode", ["off", "peak_fit", "soft_ceiling", "clip"])
@pytest.mark.parametrize("measurement", ["maximum", "robust", "manual"])
@pytest.mark.parametrize("color_handling", ["smooth_rolloff", "path_to_white", "luminance"])
def test_every_highlight_configuration_is_exact(kind, mode, measurement, color_handling):
    """The highlight stages are the only whole-frame reductions in this graph.

    Peak Fit fits its shoulder to the brightest pixel in the image and the HDR
    ceiling branches on a whole-frame maximum, so each combination is a distinct
    chance for a strip to anchor on itself instead.
    """
    state = _graded_state()
    for branch in (state.hdr, state.sdr):
        branch.highlight_section_enabled = True
        branch.highlight_compression_mode = mode
        branch.highlight_compression_peak_measurement = measurement
        branch.highlight_compression_color_handling = color_handling
        branch.highlight_compression_softness = 40.0
    image = _source(height=37, width=29, seed=5)

    reference = apply_adjustments(image, state, kind)
    strips, report = render_in_strips(image, state, kind, budget_bytes=4096)

    assert report.plan.strip_count > 1, "the corpus must actually be divided"
    np.testing.assert_array_equal(
        strips, reference, err_msg=f"{kind}/{mode}/{measurement}/{color_handling}"
    )


@pytest.mark.parametrize("measurement", ["maximum", "robust"])
def test_hdr_anchor_equals_the_whole_frame_measurement(measurement):
    """The injected anchor must be the number the whole-frame path computes."""
    state = _graded_state()
    state.hdr.highlight_section_enabled = True
    state.hdr.highlight_compression_mode = "peak_fit"
    state.hdr.highlight_compression_peak_measurement = measurement
    image = _source(height=53, width=47, seed=3)

    _strips, report = render_in_strips(image, state, PreviewKind.HDR, budget_bytes=4096)

    from hdr_finisher.adjustments import _tone_adjusted_source_peak_nits, apply_fixed_source_adjustments
    from hdr_finisher.color_context import RenderColorContext
    from hdr_finisher.finishing import apply_geometry

    pre = apply_fixed_source_adjustments(
        apply_geometry(image, state.shared.geometry),
        state,
        PreviewKind.HDR,
        include_output_highlight_compression=False,
        apply_output_clamp=False,
    )
    expected = _tone_adjusted_source_peak_nits(
        pre, state.hdr, tone_enabled=False, color_context=RenderColorContext()
    )
    assert report.anchor is not None
    assert report.anchor.hdr_source_peak_nits == expected


def test_authored_sdr_base_is_exact():
    state = _graded_state()
    state.sdr.use_authored_base = True
    state.shared.geometry = GEOMETRIES["crop"]
    image = _source()
    reference_image = np.clip(_source(seed=21) / np.float32(6.0), 0.0, 1.0)

    reference = apply_adjustments(image, state, PreviewKind.SDR, sdr_reference_image=reference_image)
    strips, report = render_in_strips(
        image, state, PreviewKind.SDR, sdr_reference_image=reference_image, budget_bytes=4096
    )

    assert report.plan.strip_count > 1
    np.testing.assert_array_equal(strips, reference)


def test_legacy_sdr_rendering_is_exact():
    state = _graded_state()
    state.sdr.rendering_version = "legacy_base_v1"
    image = _source()

    reference = apply_adjustments(image, state, PreviewKind.SDR)
    strips, report = render_in_strips(image, state, PreviewKind.SDR, budget_bytes=4096)

    assert report.anchor is None, "the legacy curve has no Peak Fit anchor to measure"
    np.testing.assert_array_equal(strips, reference)


# --- refusals ---------------------------------------------------------------


def _local(identifier: str = "a") -> LocalAdjustment:
    return LocalAdjustment(id=identifier, name="local", enabled=True, opacity=1.0)


@pytest.mark.parametrize(
    ("configure", "expected"),
    [
        (lambda s: setattr(s.hdr.vignette, "amount", -40.0), "vignette"),
        (lambda s: setattr(s.hdr.film_look, "grain_amount", 30.0), "grain"),
        (lambda s: setattr(s.hdr.film_look, "halation_amount", 50.0), "spatial film effects"),
        (lambda s: setattr(s.hdr.film_look, "film_resolution", 80.0), "spatial film effects"),
        (lambda s: setattr(s.hdr.detail, "sharpen_amount", 40.0), "detail"),
        (lambda s: setattr(s.shared.geometry, "straighten_angle", 4.0), "roll geometry"),
    ],
)
def test_refusals_name_the_node(configure, expected):
    state = _graded_state()
    state.hdr.vignette_section_enabled = True
    state.hdr.film_look_section_enabled = True
    state.hdr.detail_section_enabled = True
    configure(state)

    reasons = strip_execution_refusals(state, PreviewKind.HDR)
    assert expected in reasons

    with pytest.raises(StripExecutionRefused) as raised:
        render_in_strips(_source(), state, PreviewKind.HDR)
    assert expected in raised.value.reasons


def test_zero_amount_grain_does_not_refuse():
    """Grain is section-enabled by default; only grain that contributes refuses."""
    state = _graded_state()
    state.hdr.film_look_section_enabled = True
    state.hdr.film_look.grain_enabled = True
    state.hdr.film_look.grain_amount = 0.0
    assert "grain" not in strip_execution_refusals(state, PreviewKind.HDR)


def test_local_adjustments_and_denoise_refuse():
    state = _graded_state()
    assert "local adjustments" in strip_execution_refusals(
        state, PreviewKind.HDR, local_adjustments=[_local()]
    )
    assert "denoise" in strip_execution_refusals(state, PreviewKind.HDR, denoise_active=True)


def test_post_geometry_downsample_refuses():
    """A per-strip downsample does not reproduce a whole-frame one at the seams."""
    state = _graded_state()
    reasons = strip_execution_refusals(
        state, PreviewKind.HDR, source_width=4000, source_height=3000, long_edge=1024
    )
    assert "post-geometry downsample" in reasons
    assert strip_execution_refusals(
        state, PreviewKind.HDR, source_width=800, source_height=600, long_edge=1024
    ) == []


def test_refusal_carries_every_reason():
    state = _graded_state()
    state.hdr.vignette_section_enabled = True
    state.hdr.vignette.amount = 30.0
    state.hdr.detail_section_enabled = True
    state.hdr.detail.clarity_amount = 25.0
    with pytest.raises(StripExecutionRefused) as raised:
        render_in_strips(_source(), state, PreviewKind.HDR)
    assert set(raised.value.reasons) >= {"vignette", "detail"}


# --- cancellation and bounds ------------------------------------------------


def test_cancellation_stops_between_strips():
    state = _graded_state()
    image = _source(height=97, width=53)
    plan = plan_strips(53, 97, budget_bytes=4096)
    assert plan.strip_count > 3

    calls = {"count": 0}

    def is_current() -> bool:
        calls["count"] += 1
        return calls["count"] <= 2

    with pytest.raises(StripCancelled):
        render_in_strips(image, state, PreviewKind.HDR, budget_bytes=4096, is_current=is_current)


def test_cancellation_abandons_at_most_one_strip_of_work():
    """Latest-wins has to be cheap, or it is not worth having."""
    state = _graded_state()
    state.hdr.highlight_section_enabled = False
    image = _source(height=120, width=64)
    rendered: list[int] = []

    def is_current() -> bool:
        return len(rendered) < 3

    plan = plan_strips(64, 120, budget_bytes=4096)
    seen = 0
    try:
        render_in_strips(
            image,
            state,
            PreviewKind.HDR,
            budget_bytes=4096,
            is_current=lambda: (rendered.append(1), len(rendered) <= 3)[1],
        )
    except StripCancelled:
        seen = len(rendered)
    assert seen == 4, "the check runs once per strip and stops on the first false"
    assert seen < plan.strip_count


def test_plan_divides_the_frame_without_gaps_or_overlap():
    plan = plan_strips(1000, 777, budget_bytes=256 * 1024)
    assert plan.strips[0][0] == 0
    assert plan.strips[-1][1] == 777
    for (_, previous_bottom), (next_top, _) in zip(plan.strips, plan.strips[1:]):
        assert previous_bottom == next_top
    assert plan.planned_transient_bytes <= plan.budget_bytes


def test_planned_transient_bytes_stay_flat_as_the_frame_grows():
    """The property the whole design is for: intermediates stop following the image."""
    planned = [
        plan_strips(width, height).planned_transient_bytes
        for width, height in ((1024, 683), (2048, 1365), (4096, 2731), (8192, 5462))
    ]
    assert max(planned) <= DEFAULT_STRIP_BUDGET_BYTES
    assert max(planned) - min(planned) < DEFAULT_STRIP_BUDGET_BYTES // 8


def test_peak_transient_bytes_follow_the_budget_not_the_frame():
    """Measured, not modelled: the strip path's peak must track its budget."""
    state = _graded_state()
    state.hdr.highlight_section_enabled = True
    image = _source(height=600, width=400, seed=9)

    def peak_for(budget: int | None) -> int:
        tracemalloc.start()
        tracemalloc.reset_peak()
        if budget is None:
            apply_adjustments(image, state, PreviewKind.HDR)
        else:
            render_in_strips(image, state, PreviewKind.HDR, budget_bytes=budget)
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return peak

    whole_frame = peak_for(None)
    small = peak_for(1 * 1024 * 1024)
    large = peak_for(8 * 1024 * 1024)

    assert small < whole_frame, (small, whole_frame)
    assert small < large, (small, large)


def test_peak_reducer_reproduces_numpy_quantile_exactly():
    rng = np.random.default_rng(4)
    for total in (997, 12_345, 250_000):
        values = (rng.standard_normal(total).astype(np.float32) * np.float32(9.0))
        reducer = _PeakReducer(total, robust=True)
        for chunk in np.array_split(values, 7):
            reducer.observe(chunk)
        assert reducer.value() == float(np.quantile(values, 0.9999)), total


def test_peak_reducer_maximum_is_exact():
    rng = np.random.default_rng(8)
    values = rng.standard_normal(5000).astype(np.float32)
    reducer = _PeakReducer(values.size, robust=False)
    for chunk in np.array_split(values, 11):
        reducer.observe(chunk)
    assert reducer.value() == float(np.max(values))
