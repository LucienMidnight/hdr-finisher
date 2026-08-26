from __future__ import annotations

import copy

import numpy as np
import pytest
from pydantic import ValidationError

import hdr_finisher.adjustments as adjustments_module

from hdr_finisher.adjustments import (
    _apply_hdr_adjustments,
    _apply_hdr_color,
    _apply_curve_set,
    _apply_saturation_vibrance,
    _apply_sdr_adjustments,
    _apply_sdr_tone_equalizer,
    _curve_domain_decode,
    _curve_domain_encode,
    _grain_pitch_pixels,
    _grain_value_noise,
    _compress_scene_highlights,
    _primary_zone_masks,
    apply_adjustments,
)
from hdr_finisher.analysis import classify_hdr
from hdr_finisher.color import rgb_primaries_adjustment_matrix
from hdr_finisher.models import AdjustmentState, FilmLookAdjustments, HDRAdjustments, PreviewKind, SDRAdjustments, SharedAdjustments, SourceLatitude, ToneEqualizerNode


def _tone_nodes(values: list[float]) -> list[ToneEqualizerNode]:
    return [ToneEqualizerNode(input_ev=index - 6, adjustment_ev=value) for index, value in enumerate(values)]


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_neutral_film_look_is_pixel_identical(kind: PreviewKind) -> None:
    rng = np.random.default_rng(912)
    image = rng.random((28, 36, 3), dtype=np.float32)
    if kind == PreviewKind.HDR:
        image *= np.float32(12.0)
    enabled = AdjustmentState()
    bypassed = enabled.model_copy(deep=True)
    getattr(bypassed, kind.value).film_look_section_enabled = False

    np.testing.assert_array_equal(
        apply_adjustments(image, enabled, kind),
        apply_adjustments(image, bypassed, kind),
    )


def test_film_grain_is_deterministic_and_seeded_from_shared_adjustments() -> None:
    image = np.full((32, 48, 3), 0.18, dtype=np.float32)
    state = AdjustmentState()
    state.hdr.film_look.grain_amount = 55
    state.hdr.film_look.grain_size = 45
    first = apply_adjustments(image, state, PreviewKind.HDR)
    second = apply_adjustments(image, state, PreviewKind.HDR)
    np.testing.assert_array_equal(first, second)

    changed_seed = state.model_copy(deep=True)
    changed_seed.shared.film_grain_seed += 1
    third = apply_adjustments(image, changed_seed, PreviewKind.HDR)
    assert not np.array_equal(first, third)


def test_physical_grain_pitch_grows_as_film_format_shrinks() -> None:
    look = AdjustmentState().hdr.film_look
    look.grain_size = 50
    pitches = []
    for film_format in ("65mm", "35mm", "16mm", "super8"):
        look.grain_film_format = film_format
        pitches.append(_grain_pitch_pixels(3840, 2160, look))

    assert pitches == sorted(pitches)
    assert pitches[0] < 2.0
    assert pitches[-1] > 9.0


def test_horizontal_linescan_anchors_grain_to_cross_scan_dimension() -> None:
    look = AdjustmentState().hdr.film_look
    look.grain_film_format = "35mm"
    look.grain_capture_geometry = "horizontal_strip"
    look.grain_size = 50

    strip_pitch = _grain_pitch_pixels(64_000, 4_000, look)
    expected = (4_000 / 24.0) * 0.018
    assert strip_pitch == pytest.approx(expected)

    look.grain_capture_geometry = "frame"
    assert _grain_pitch_pixels(64_000, 4_000, look) > strip_pitch * 10


def test_physical_grain_value_noise_has_spatial_correlation() -> None:
    yy, xx = np.indices((256, 256), dtype=np.float32)
    noise = _grain_value_noise(xx / np.float32(6.0), yy / np.float32(6.0), 271828, 0.0)
    horizontal_correlation = np.corrcoef(noise[:, :-1].ravel(), noise[:, 1:].ravel())[0, 1]
    vertical_correlation = np.corrcoef(noise[:-1, :].ravel(), noise[1:, :].ravel())[0, 1]

    assert horizontal_correlation > 0.9
    assert vertical_correlation > 0.9


@pytest.mark.parametrize(
    ("field", "value"),
    [("grain_custom_width_mm", 0), ("grain_custom_height_mm", 501), ("grain_custom_width_mm", float("nan"))],
)
def test_custom_film_gate_dimensions_are_bounded_and_finite(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        FilmLookAdjustments(**{field: value})


def test_film_response_preserves_hdr_headroom_without_print_ceiling() -> None:
    levels = np.array([0.18, 1.8, 7.2, 18.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    state = AdjustmentState()
    look = state.hdr.film_look
    look.print_strength = 100
    look.print_contrast = 18
    look.print_toe = 10
    look.print_shoulder = 30
    look.color_density = 20
    output = apply_adjustments(image, state, PreviewKind.HDR)

    assert np.all(np.isfinite(output))
    assert float(output[0, -1, 0]) > 1.0
    assert np.all(np.diff(output[0, :, 0]) > 0.0)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_film_response_look_strength_is_a_single_linear_blend(kind: PreviewKind) -> None:
    image = np.array(
        [[[0.02, 0.03, 0.04], [0.18, 0.24, 0.12], [0.72, 0.58, 0.40]]],
        dtype=np.float32,
    )
    if kind == PreviewKind.HDR:
        image *= np.float32(4.0)
    state = AdjustmentState()
    look = getattr(state, kind.value).film_look
    look.print_strength = 80
    look.print_contrast = 45
    look.print_toe = 35
    look.print_shoulder = 55

    look.look_strength = 0
    bypass = apply_adjustments(image, state, kind)
    look.look_strength = 100
    authored = apply_adjustments(image, state, kind)
    look.look_strength = 50
    midpoint = apply_adjustments(image, state, kind)

    np.testing.assert_allclose(midpoint, bypass + (authored - bypass) * 0.5, rtol=2e-6, atol=2e-6)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_film_resolution_remains_active_when_grain_is_disabled(kind: PreviewKind) -> None:
    image = np.zeros((41, 41, 3), dtype=np.float32)
    image[20, 20] = 1.0
    state = AdjustmentState()
    look = getattr(state, kind.value).film_look
    look.film_resolution = 0
    look.grain_amount = 0

    look.grain_enabled = True
    grain_enabled = apply_adjustments(image, state, kind)
    look.grain_enabled = False
    grain_disabled = apply_adjustments(image, state, kind)

    np.testing.assert_array_equal(grain_disabled, grain_enabled)
    assert float(grain_disabled[20, 20, 0]) < float(apply_adjustments(image, AdjustmentState(), kind)[20, 20, 0])


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_inactive_film_spatial_stages_do_not_blur(monkeypatch: pytest.MonkeyPatch, kind: PreviewKind) -> None:
    image = np.full((24, 32, 3), 0.18, dtype=np.float32)
    state = AdjustmentState()
    look = getattr(state, kind.value).film_look
    look.halation_enabled = True
    look.halation_amount = 0
    look.bloom_enabled = True
    look.bloom_amount = 0
    look.image_structure_enabled = True
    look.image_softness = 0
    look.microcontrast = 0
    look.film_resolution = 100

    def unexpected_blur(*_args: object, **_kwargs: object) -> np.ndarray:
        raise AssertionError("An inactive Film Look stage attempted spatial blur work")

    monkeypatch.setattr(adjustments_module, "_box_blur", unexpected_blur)
    monkeypatch.setattr(adjustments_module, "_diffusion_blur", unexpected_blur)

    apply_adjustments(image, state, kind)


def test_halation_and_bloom_are_spatial_and_grain_remains_last() -> None:
    image = np.zeros((41, 41, 3), dtype=np.float32)
    image[20, 20] = 8.0
    state = AdjustmentState()
    look = state.hdr.film_look
    look.halation_amount = 70
    look.halation_radius = 2.0
    look.bloom_amount = 45
    look.bloom_radius = 3.0
    look.grain_amount = 30
    output = apply_adjustments(image, state, PreviewKind.HDR)

    assert float(np.max(output[18:23, 18:23])) > 0.0
    assert float(np.std(output[10:31, 10:31])) > 0.0


def test_bloom_highlight_detail_controls_real_core_diffusion() -> None:
    image = np.zeros((81, 81, 3), dtype=np.float32)
    image[38:43, 38:43] = 8.0
    detailed = AdjustmentState()
    look = detailed.hdr.film_look
    look.bloom_amount = 100
    look.bloom_radius = 4.0
    look.bloom_sensitivity = 100
    look.bloom_highlight_detail = 100
    look.halation_enabled = False

    diffused = detailed.model_copy(deep=True)
    diffused.hdr.film_look.bloom_highlight_detail = 0
    detailed_output = apply_adjustments(image, detailed, PreviewKind.HDR)
    diffused_output = apply_adjustments(image, diffused, PreviewKind.HDR)

    assert float(diffused_output[40, 40, 0]) < float(detailed_output[40, 40, 0])
    assert float(diffused_output[34, 40, 0]) > float(detailed_output[34, 40, 0])
    assert np.all(np.isfinite(diffused_output))
    assert float(diffused_output.min()) >= 0.0


def test_bloom_has_a_smooth_monotonic_hard_edge_profile() -> None:
    image = np.zeros((101, 101, 3), dtype=np.float32)
    image[:, :51] = 8.0
    state = AdjustmentState()
    look = state.hdr.film_look
    look.bloom_amount = 100
    look.bloom_radius = 4.0
    look.bloom_sensitivity = 100
    look.bloom_highlight_detail = 35
    look.halation_enabled = False

    output = apply_adjustments(image, state, PreviewKind.HDR)
    dark_side_profile = output[50, 51:71, 0]
    assert np.all(np.diff(dark_side_profile) <= 1e-6)
    assert len(np.unique(np.round(dark_side_profile, 5))) > 5


def test_gentle_contrast_at_max_slider_stays_in_range() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(contrast=0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.5
    output = _apply_sdr_adjustments(image, state)
    assert output.min() >= 0.0, "SDR contrast should not produce negative values"
    assert output.max() <= 1.0, "SDR contrast at max should not exceed 1.0"


def test_gentle_contrast_negative_at_max_slider_stays_in_range() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(contrast=-0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.5
    output = _apply_sdr_adjustments(image, state)
    assert output.min() >= 0.0, "SDR negative contrast should not produce negative values"
    assert output.max() <= 1.0, "SDR negative contrast should not exceed 1.0"


def test_sdr_contrast_is_gentle_for_scene_linear_midtones() -> None:
    levels = np.array([0.03, 0.08, 0.18, 0.35, 0.7], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )
    contrasted = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(contrast=0.25, highlight_recovery=0.0)),
    )

    assert np.all(np.diff(contrasted[0, :, 0]) > 0.0)
    assert 0.0 < float(np.max(np.abs(contrasted - baseline))) < 0.08


def test_sdr_lift_is_a_fine_perceptual_shadow_adjustment() -> None:
    image = np.full((2, 2, 3), 0.03, dtype=np.float32)
    baseline = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )
    lifted = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(lift=0.1, highlight_recovery=0.0)),
    )

    change = float(np.max(lifted - baseline))
    assert 0.0 < change < 0.02


def test_sdr_shadow_multiplier_is_gentle() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(shadow=1.0))
    image = np.ones((4, 4, 3), dtype=np.float32) * 0.3
    output = _apply_sdr_adjustments(image, state)
    assert output.max() <= 1.0, "SDR shadow at max should not clip to above 1.0"


def test_log_domain_hdr_curves_no_infinities_up_to_peak_10() -> None:
    image = np.array([[[1.0, 2.0, 5.0], [3.0, 8.0, 10.0]]], dtype=np.float32)
    encoded = _curve_domain_encode(image, PreviewKind.HDR)
    assert not np.any(np.isinf(encoded)), "Log HDR curves should not produce infinities"
    assert not np.any(np.isnan(encoded)), "Log HDR curves should not produce NaNs"
    assert encoded.max() <= 1.0, "Encoded HDR values should be normalized to 0-1"
    decoded = _curve_domain_decode(encoded, PreviewKind.HDR)
    assert not np.any(np.isinf(decoded)), "Decoded HDR curves should not produce infinities"
    assert not np.any(np.isnan(decoded)), "Decoded HDR curves should not produce NaNs"


def test_hdr_curves_preserve_high_values() -> None:
    image = np.array([[[10.0, 8.0, 6.0]]], dtype=np.float32)
    encoded = _curve_domain_encode(image, PreviewKind.HDR)
    decoded = _curve_domain_decode(encoded, PreviewKind.HDR)
    assert decoded[0, 0, 0] > 5.0, "HDR curve decode should preserve high values above 1.0"


def test_tiny_hdr_contrast_change_does_not_clamp_wide_exr_values() -> None:
    image = np.array([[[10.0, 50.0, 1000.0]]], dtype=np.float32)
    state = AdjustmentState(hdr=HDRAdjustments(contrast=0.005))

    output = _apply_hdr_adjustments(image, state)

    assert output.max() > 900.0
    assert output[0, 0, 2] > output[0, 0, 1] > output[0, 0, 0]


def test_identity_hdr_curves_preserve_values_above_curve_editor_range() -> None:
    image = np.array([[[10.0, 50.0, 1000.0]]], dtype=np.float32)
    state = AdjustmentState(hdr=HDRAdjustments())

    output = _apply_hdr_adjustments(image, state)

    np.testing.assert_allclose(output, image, rtol=1e-5, atol=1e-5)


def test_hdr_luma_curve_preserves_blue_rich_pixel_channel_ratios() -> None:
    image = np.array([[[0.08, 0.16, 1.8], [0.4, 0.7, 4.0]]], dtype=np.float32)
    adjustments = HDRAdjustments(
        luma_curve=[[0.0, 0.0], [0.25, 0.30], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]
    )

    output = _apply_curve_set(image, adjustments, PreviewKind.HDR)

    input_ratios = image / image[..., :1]
    output_ratios = output / output[..., :1]
    np.testing.assert_allclose(output_ratios, input_ratios, rtol=2e-5, atol=2e-5)
    assert not np.allclose(output, image), "The luma curve should still change luminance"


def test_default_curve_has_three_editable_control_points() -> None:
    expected = [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]

    assert HDRAdjustments().luma_curve == expected
    assert SDRAdjustments().luma_curve == expected


def test_hdr_shadow_lift_is_luminance_masked() -> None:
    state = AdjustmentState(hdr=HDRAdjustments(shadow_lift=0.3))
    dark_image = np.ones((4, 4, 3), dtype=np.float32) * 0.1
    bright_image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    dark_output = _apply_hdr_adjustments(dark_image, state)
    bright_output = _apply_hdr_adjustments(bright_image, state)
    dark_gain = dark_output.mean() / dark_image.mean()
    bright_gain = bright_output.mean() / bright_image.mean()
    assert dark_gain > bright_gain, "HDR shadow lift should affect dark areas more than bright ones"


def test_hdr_shadow_lift_does_not_clip() -> None:
    state = AdjustmentState(hdr=HDRAdjustments(shadow_lift=0.5))
    image = np.ones((4, 4, 3), dtype=np.float32) * 3.0
    output = _apply_hdr_adjustments(image, state)
    assert not np.any(np.isinf(output)), "HDR shadow lift should not produce infinities"


def test_neutral_hdr_tone_equalizer_is_identity() -> None:
    levels = np.geomspace(0.001, 18.0, 128, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    state = AdjustmentState(
        hdr=HDRAdjustments(
        )
    )

    output = _apply_hdr_adjustments(image, state)

    np.testing.assert_allclose(output, image, rtol=1e-6, atol=1e-7)


def test_removed_adjustment_toggles_are_not_part_of_the_schema() -> None:
    assert "tone_equalizer_enabled" not in HDRAdjustments.model_fields
    assert "curves_enabled" not in HDRAdjustments.model_fields
    assert "curves_enabled" not in SDRAdjustments.model_fields
    assert "match_hdr_color" not in SDRAdjustments.model_fields
    assert "active_focus" not in SharedAdjustments.model_fields
    assert "curves_enabled" not in SharedAdjustments.model_fields

    with pytest.raises(ValueError):
        HDRAdjustments.model_validate({"curves_enabled": True})
    with pytest.raises(ValueError):
        SDRAdjustments.model_validate({"match_hdr_color": True})


def test_direct_entry_headroom_is_accepted_by_adjustment_models() -> None:
    hdr = HDRAdjustments(
        exposure=8,
        highlight_compression_start_nits=9999,
        highlight_compression_target_nits=10000,
        contrast=2,
        contrast_pivot=18,
        white_balance_kelvin=25000,
        saturation=3,
        red_purity=400,
        lift_range=24,
        gain_pivot=12,
    )
    sdr = SDRAdjustments(
        exposure=-8,
        highlight_recovery=4,
        shadow=-2,
        contrast_pivot=0.999,
        white_balance_kelvin=1000,
        vibrance=3,
        gamma=-2,
        gamma_range=24,
    )

    assert hdr.highlight_compression_target_nits == 10000
    assert hdr.red_purity == 400
    assert sdr.highlight_recovery == 4
    assert sdr.gamma_range == 24


@pytest.mark.parametrize(
    ("model", "values"),
    [
        (HDRAdjustments, {"exposure": 8.01}),
        (HDRAdjustments, {"highlight_compression_start_nits": 10000, "highlight_compression_target_nits": 10000}),
        (HDRAdjustments, {"white_balance_kelvin": 25001}),
        (HDRAdjustments, {"saturation": 3.01}),
        (SDRAdjustments, {"highlight_recovery": 4.01}),
        (SDRAdjustments, {"contrast_pivot": 1.0}),
        (SDRAdjustments, {"gamma_range": 24.01}),
    ],
)
def test_direct_entry_safety_caps_reject_out_of_range_api_values(model, values) -> None:
    with pytest.raises(ValueError):
        model.model_validate(values)


def test_explicit_thirteen_node_equalizer_preserves_positions() -> None:
    bands = [round((index - 6) / 12, 4) for index in range(13)]
    authored = HDRAdjustments(tone_equalizer_nodes=_tone_nodes(bands))

    assert len(authored.tone_equalizer_nodes) == 13
    assert [node.input_ev for node in authored.tone_equalizer_nodes] == list(range(-6, 7))
    assert [node.adjustment_ev for node in authored.tone_equalizer_nodes] == bands

    sdr_authored = SDRAdjustments(tone_equalizer_nodes=_tone_nodes(bands))
    assert [node.input_ev for node in sdr_authored.tone_equalizer_nodes] == list(range(-6, 7))
    assert [node.adjustment_ev for node in sdr_authored.tone_equalizer_nodes] == bands


@pytest.mark.parametrize("model", [HDRAdjustments, SDRAdjustments])
@pytest.mark.parametrize("count", [1, 17])
def test_tone_equalizer_rejects_node_counts_outside_limits(model, count: int) -> None:
    with pytest.raises(ValueError):
        model.model_validate(
            {"tone_equalizer_nodes": [{"input_ev": -6 + index * 0.5, "adjustment_ev": 0} for index in range(count)]}
        )


def test_tone_equalizer_sorts_nodes_and_locks_endpoints() -> None:
    adjustments = HDRAdjustments.model_validate(
        {
            "tone_equalizer_nodes": [
                {"input_ev": 4, "adjustment_ev": 0.2},
                {"input_ev": -2, "adjustment_ev": -0.1},
                {"input_ev": 1, "adjustment_ev": 0.3},
            ]
        }
    )
    assert [node.input_ev for node in adjustments.tone_equalizer_nodes] == [-6.0, 1.0, 6.0]


def test_hdr_tone_equalizer_can_lift_lower_bands_while_protecting_highlights() -> None:
    input_ev = np.array([-4.0, -3.0, -2.0, -1.0, 0.0, 1.0, 4.0], dtype=np.float32)
    levels = np.float32(0.18) * np.exp2(input_ev)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    bands = [0.0] * 13
    bands[2] = 1.5  # -4 EV
    bands[3] = 1.5  # -3 EV
    bands[4] = 0.75  # -2 EV, returning smoothly to neutral by -1 EV
    state = AdjustmentState(
        hdr=HDRAdjustments(
            tone_equalizer_nodes=_tone_nodes(bands),
            tone_equalizer_smoothing=0.75,
        )
    )

    output = _apply_hdr_adjustments(image, state)[0, :, 0]

    assert output[0] / levels[0] > 2.7
    assert output[1] / levels[1] > 2.7
    np.testing.assert_allclose(output[3:], levels[3:], rtol=1e-5, atol=1e-6)


def test_hdr_tone_equalizer_preserves_luminance_order_for_aggressive_api_state() -> None:
    levels = np.geomspace(0.18 * (2.0**-7), 0.18 * (2.0**6.64), 1024, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    state = AdjustmentState(
        hdr=HDRAdjustments(
            tone_equalizer_nodes=_tone_nodes([2.0, -2.0, 2.0, -2.0, 2.0, -2.0, 2.0, -2.0, 2.0, -2.0, 2.0, -2.0, 2.0]),
            tone_equalizer_smoothing=1.0,
        )
    )

    output = _apply_hdr_adjustments(image, state)[0, :, 0]

    assert np.all(np.isfinite(output))
    assert np.all(np.diff(output) >= -1e-6)


def test_hdr_tone_equalizer_is_hue_preserving() -> None:
    image = np.array([[[0.03, 0.07, 0.12]]], dtype=np.float32)
    bands = [0.5] * 13
    state = AdjustmentState(
        hdr=HDRAdjustments(
            tone_equalizer_nodes=_tone_nodes(bands),
        )
    )

    output = _apply_hdr_adjustments(image, state)
    channel_gain = output[0, 0] / image[0, 0]

    np.testing.assert_allclose(channel_gain, np.repeat(channel_gain[0], 3), rtol=1e-6, atol=1e-6)


def test_sdr_tone_equalizer_is_independent_monotonic_and_hue_preserving() -> None:
    levels = np.geomspace(0.18 * (2.0**-6), 1.0, 512, dtype=np.float32)
    image = np.stack((levels * 0.7, levels * 0.9, levels), axis=-1)[None, ...]
    bands = [0.0] * 13
    bands[3:7] = [0.6, 0.8, 0.5, 0.2]
    sdr = SDRAdjustments(tone_equalizer_nodes=_tone_nodes(bands), tone_equalizer_smoothing=0.8)

    output = _apply_sdr_tone_equalizer(image, sdr)
    luma = output[0] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    assert np.all(np.isfinite(output))
    assert np.all(np.diff(luma) >= -1e-6)
    np.testing.assert_allclose(output[0, 128] / image[0, 128], np.repeat(output[0, 128, 0] / image[0, 128, 0], 3), rtol=1e-5)
    assert not np.array_equal(sdr.tone_equalizer_nodes, HDRAdjustments().tone_equalizer_nodes)


def test_sdr_tone_equalizer_bypass_is_identity_for_authored_sdr_reference() -> None:
    reference = np.linspace(0.01, 0.95, 48, dtype=np.float32).reshape(1, 16, 3)
    nodes = _tone_nodes([0.4] * 13)
    enabled = AdjustmentState(sdr=SDRAdjustments(tone_equalizer_nodes=nodes, highlight_recovery=0.0))
    bypassed = enabled.model_copy(deep=True)
    bypassed.sdr.tone_equalizer_section_enabled = False

    enabled_output = apply_adjustments(reference, enabled, PreviewKind.SDR, sdr_reference_image=reference)
    bypassed_output = apply_adjustments(reference, bypassed, PreviewKind.SDR, sdr_reference_image=reference)

    assert not np.array_equal(enabled_output, bypassed_output)
    assert np.all(np.isfinite(enabled_output))


def test_plus_six_tone_equalizer_band_controls_values_through_pq_ceiling() -> None:
    input_ev = np.array([6.0, np.log2(100.0)], dtype=np.float32)
    levels = np.float32(0.18) * np.exp2(input_ev)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    bands = [0.0] * 13
    bands[-1] = 0.5
    state = AdjustmentState(
        hdr=HDRAdjustments(
            tone_equalizer_nodes=_tone_nodes(bands),
        )
    )

    output = _apply_hdr_adjustments(image, state)[0, :, 0]

    np.testing.assert_allclose(output / levels, np.sqrt(2.0), rtol=1e-5, atol=1e-5)


def test_hdr_default_highlight_path_preserves_wide_exr_latitude_and_ordering() -> None:
    levels = np.array([1.0, 2.0, 10.0, 50.0, 1000.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)

    output = _apply_hdr_adjustments(image, AdjustmentState())

    assert output.max() > 500.0
    assert np.all(np.diff(output[0, :, 0]) > 0.0)


def test_hdr_compression_is_identity_when_off_and_below_start() -> None:
    levels = np.array([50, 203, 399, 400, 600, 1000], dtype=np.float32) * np.float32(0.18 / 203.0)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    np.testing.assert_array_equal(_compress_scene_highlights(image, 400.0, 1000.0, 0.0), image)
    rolled = _compress_scene_highlights(image, 400.0, 1000.0, 50.0)
    np.testing.assert_allclose(rolled[0, :4], image[0, :4], rtol=1e-6, atol=1e-7)
    assert np.all(np.diff(rolled[0, :, 0]) > 0.0)
    assert rolled[0, -1, 0] < image[0, -1, 0]


def test_highlight_compression_is_neutral_when_softness_is_off() -> None:
    image = np.repeat(np.array([0.18, 0.72, 1.8, 18.0], dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    np.testing.assert_array_equal(_compress_scene_highlights(image, 400.0, 1000.0, 0.0), image)


def test_highlight_compression_preserves_start_and_approaches_target_monotonically() -> None:
    levels = np.array([203, 400, 500, 1000, 10000, 1000000], dtype=np.float32) * np.float32(0.18 / 203.0)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    compressed = _compress_scene_highlights(image, 400.0, 1000.0, 60.0)[0, :, 0]

    np.testing.assert_allclose(compressed[:2], levels[:2], rtol=1e-6, atol=1e-7)
    assert np.all(np.diff(compressed) >= -1e-6)
    target_linear = 1000.0 * 0.18 / 203.0
    assert compressed[-1] <= target_linear + 1e-6
    assert compressed[-1] > target_linear * 0.99


def test_peak_fit_anchors_extreme_peak_and_preserves_positive_highlight_slope() -> None:
    source_peak_nits = 21676.7
    levels_nits = np.geomspace(10.0, source_peak_nits, 512).astype(np.float32)
    levels = levels_nits * np.float32(0.18 / 203.0)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    compressed = _compress_scene_highlights(
        image,
        100.0,
        1000.0,
        0.0,
        mode="peak_fit",
        source_peak_nits=source_peak_nits,
        peak_detail=35.0,
        bias=0.0,
    )[0, :, 0]
    compressed_nits = compressed * np.float32(203.0 / 0.18)

    np.testing.assert_allclose(compressed_nits[-1], 1000.0, rtol=2e-5)
    assert np.all(np.diff(compressed_nits) > 0.0)
    assert compressed_nits[-32] < compressed_nits[-1]


def test_peak_fit_anchor_is_applied_after_other_tone_controls() -> None:
    source_peak_nits = 17333.0
    source_peak = np.float32(source_peak_nits * 0.18 / 203.0)
    image = np.full((1, 1, 3), source_peak, dtype=np.float32)
    state = AdjustmentState(
        hdr=HDRAdjustments(
            exposure=-0.85,
            shadow_lift=-0.455,
            contrast=-0.187,
            contrast_pivot=0.02,
            highlight_compression_mode="peak_fit",
            highlight_compression_start_nits=400.0,
            highlight_compression_target_nits=1000.0,
            highlight_compression_source_peak_nits=source_peak_nits,
        )
    )

    output = _apply_hdr_adjustments(image, state)
    output_nits = output[0, 0, 0] * np.float32(203.0 / 0.18)

    np.testing.assert_allclose(output_nits, 1000.0, rtol=3e-5)


def test_highlights_section_bypass_is_independent_from_tone() -> None:
    source_peak_nits = 4000.0
    image = np.full((1, 1, 3), source_peak_nits * 0.18 / 203.0, dtype=np.float32)
    active = AdjustmentState(
        hdr=HDRAdjustments(
            exposure=-1.0,
            highlight_compression_mode="peak_fit",
            highlight_compression_target_nits=1000.0,
            highlight_compression_source_peak_nits=source_peak_nits,
        )
    )
    bypassed = active.model_copy(deep=True)
    bypassed.hdr.highlight_section_enabled = False

    active_output = _apply_hdr_adjustments(image, active)
    bypassed_output = _apply_hdr_adjustments(image, bypassed)

    np.testing.assert_allclose(active_output[0, 0, 0] * 203.0 / 0.18, 1000.0, rtol=3e-5)
    np.testing.assert_allclose(bypassed_output[0, 0, 0] * 203.0 / 0.18, 2000.0, rtol=3e-5)


def test_peak_fit_path_to_white_caps_saturated_peak_channels() -> None:
    image = np.array([[[0.0, 0.0, 3.0], [50.0, 5.0, 2.0]]], dtype=np.float32)
    source_peak_nits = float(image.max() * 203.0 / 0.18)
    preserved = _compress_scene_highlights(
        image,
        400.0,
        1000.0,
        mode="peak_fit",
        source_peak_nits=source_peak_nits,
        color_handling="preserve_color",
    )
    neutralized = _compress_scene_highlights(
        image,
        400.0,
        1000.0,
        mode="peak_fit",
        source_peak_nits=source_peak_nits,
        color_handling="path_to_white",
    )

    target_linear = 1000.0 * 0.18 / 203.0
    assert preserved.max() > target_linear
    assert neutralized[0, 0].max() <= target_linear + 2e-5
    assert neutralized[0, 1].max() <= target_linear + 2e-5
    np.testing.assert_allclose(neutralized[0, 1], [target_linear] * 3, rtol=3e-5, atol=3e-5)


def test_softness_without_mode_does_not_activate_compression() -> None:
    authored = HDRAdjustments(highlight_compression_softness=60.0)
    assert authored.highlight_compression_mode == "off"


def test_removed_rolloff_payload_is_rejected_without_migration() -> None:
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        HDRAdjustments(highlight_rolloff=0.5, highlight_rolloff_start_nits=500.0)


def test_highlight_compression_start_and_target_are_neutral_until_softness_changes() -> None:
    image = np.repeat(np.array([0.18, 0.72, 1.8, 18.0], dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    state = AdjustmentState(
        hdr=HDRAdjustments(
            highlight_compression_start_nits=100.0,
            highlight_compression_target_nits=200.0,
            highlight_compression_softness=0.0,
        )
    )

    np.testing.assert_array_equal(_apply_hdr_adjustments(image, state), image)


def test_hdr_curve_domain_places_graphics_white_and_peak_predictably() -> None:
    values = np.array([[[0.0, 0.09, 0.18], [0.36, 18.0, 36.0]]], dtype=np.float32)
    encoded = _curve_domain_encode(values, PreviewKind.HDR)
    expected_half_white = 0.5 * np.power(0.5, 1.0 / np.log(100.0))
    np.testing.assert_allclose(encoded[0, 0], [0.0, expected_half_white, 0.5], atol=1e-6)
    assert encoded[0, 1, 0] > 0.5
    np.testing.assert_allclose(encoded[0, 1, 1], 1.0, atol=1e-6)
    assert encoded[0, 1, 2] > 1.0
    np.testing.assert_allclose(_curve_domain_decode(encoded, PreviewKind.HDR), values, rtol=2e-6, atol=1e-6)


def test_hdr_curve_domain_has_matched_slope_at_reference_white() -> None:
    epsilon = np.float32(1e-4)
    encoded = np.array([0.5 - epsilon, 0.5, 0.5 + epsilon], dtype=np.float32)
    decoded = _curve_domain_decode(encoded, PreviewKind.HDR)
    lower_slope = (decoded[1] - decoded[0]) / epsilon
    upper_slope = (decoded[2] - decoded[1]) / epsilon

    assert lower_slope == pytest.approx(upper_slope, rel=2e-3)


def test_lgg_range_and_pivot_move_zone_masks() -> None:
    stops = np.linspace(-8, 8, 257, dtype=np.float32)
    defaults = HDRAdjustments()
    moved = HDRAdjustments(lift_pivot=1.0, lift_range=2.0, gamma_pivot=2.0, gamma_range=1.0, gain_pivot=4.0, gain_range=2.0)
    default_lift, default_gamma, default_gain = _primary_zone_masks(stops, defaults)
    moved_lift, moved_gamma, moved_gain = _primary_zone_masks(stops, moved)

    assert stops[np.argmin(np.abs(moved_lift - 0.5))] > stops[np.argmin(np.abs(default_lift - 0.5))]
    assert stops[np.argmax(moved_gamma)] > stops[np.argmax(default_gamma)]
    assert stops[np.argmin(np.abs(moved_gain - 0.5))] > stops[np.argmin(np.abs(default_gain - 0.5))]


def test_narrow_gain_range_preserves_useful_strength_inside_transition() -> None:
    stops = np.linspace(-2, 6, 1025, dtype=np.float32)
    narrow = HDRAdjustments(gain_pivot=2.0, gain_range=0.5)
    default = HDRAdjustments(gain_pivot=2.0, gain_range=4.0)
    narrow_gain = _primary_zone_masks(stops, narrow)[2]
    default_gain = _primary_zone_masks(stops, default)[2]
    pivot_index = int(np.argmin(np.abs(stops - 2.0)))

    assert narrow_gain[pivot_index] >= 0.7
    assert narrow_gain[pivot_index] > default_gain[pivot_index]
    assert np.all(np.diff(narrow_gain) >= -1e-7)
    assert narrow_gain[-1] == pytest.approx(1.0)


def test_hdr_section_bypass_retains_settings_but_removes_render_effect() -> None:
    image = np.array([[[0.04, 0.08, 0.16], [0.4, 0.7, 1.2], [2.0, 4.0, 8.0]]], dtype=np.float32)
    bypassed = AdjustmentState(
        hdr=HDRAdjustments(
            tone_section_enabled=False,
            highlight_section_enabled=False,
            tone_equalizer_section_enabled=False,
            color_section_enabled=False,
            primaries_section_enabled=False,
            curves_section_enabled=False,
            exposure=2,
            highlight_compression_mode="soft_ceiling",
            highlight_compression_softness=100,
            shadow_lift=0.4,
            tone_equalizer_nodes=[
                {"input_ev": -6, "adjustment_ev": 1},
                {"input_ev": 6, "adjustment_ev": -1},
            ],
            white_balance_kelvin=9000,
            tint=0.8,
            saturation=0.7,
            vibrance=0.5,
            red_hue=12,
            blue_purity=45,
            tint_hue=-80,
            tint_purity=8,
            lift=0.3,
            gamma=-0.4,
            gain=0.25,
            luma_curve=[[0, 0], [1, 0.5]],
        )
    )
    np.testing.assert_allclose(_apply_hdr_adjustments(image, bypassed), image, rtol=1e-6, atol=1e-7)


def test_rgb_primaries_defaults_are_identity_and_keep_gray_neutral() -> None:
    np.testing.assert_allclose(rgb_primaries_adjustment_matrix(), np.eye(3), atol=2e-6)
    matrix = rgb_primaries_adjustment_matrix(red_hue=8, red_purity=25, green_hue=-6, blue_purity=40)
    np.testing.assert_allclose(matrix @ np.ones(3), np.ones(3), atol=2e-6)


def test_rgb_primary_hue_and_tint_follow_darktable_style_semantics() -> None:
    red_toward_yellow = rgb_primaries_adjustment_matrix(red_hue=5) @ np.array([1.0, 0.0, 0.0])
    assert red_toward_yellow[1] > 0.0
    neutral = np.ones((1, 1, 3), dtype=np.float32) * 0.18
    red_tint = _apply_hdr_color(neutral, HDRAdjustments(tint_hue=0, tint_purity=8))[0, 0]
    blue_tint = _apply_hdr_color(neutral, HDRAdjustments(tint_hue=-120, tint_purity=8))[0, 0]
    green_tint = _apply_hdr_color(neutral, HDRAdjustments(tint_hue=120, tint_purity=8))[0, 0]
    assert red_tint[0] > red_tint[1] and red_tint[0] > red_tint[2]
    assert blue_tint[2] > blue_tint[0] and blue_tint[2] > blue_tint[1]
    assert green_tint[1] > green_tint[0] and green_tint[1] > green_tint[2]


def test_saturation_preserves_luma_and_vibrance_favors_low_chroma_colors() -> None:
    image = np.array([[[0.40, 0.45, 0.50], [0.05, 0.30, 0.80]]], dtype=np.float32)
    saturated = _apply_saturation_vibrance(image, 0.4, 0.0)
    weights = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
    np.testing.assert_allclose(saturated @ weights, image @ weights, atol=2e-6)

    vibrant = _apply_saturation_vibrance(image, 0.0, 0.8)
    luma = image @ weights
    original_chroma = np.linalg.norm(image - luma[..., None], axis=-1)
    vibrant_chroma = np.linalg.norm(vibrant - luma[..., None], axis=-1)
    boost = vibrant_chroma / original_chroma
    assert boost[0, 0] > boost[0, 1]


def test_minus_one_saturation_is_achromatic() -> None:
    image = np.array([[[0.2, 0.7, 1.3]]], dtype=np.float32)
    output = _apply_saturation_vibrance(image, -1.0, 0.6)
    np.testing.assert_allclose(output[..., 0], output[..., 1], atol=1e-7)
    np.testing.assert_allclose(output[..., 1], output[..., 2], atol=1e-7)


def test_sdr_color_grade_is_independent_by_default() -> None:
    image = np.array([[[0.12, 0.30, 0.65], [0.70, 0.24, 0.08]]], dtype=np.float32)
    linked = AdjustmentState(
        hdr=HDRAdjustments(saturation=0.35, red_hue=6, blue_purity=25),
        sdr=SDRAdjustments(highlight_recovery=0.0),
    )
    neutral = AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0))

    linked_output = apply_adjustments(image, linked, PreviewKind.SDR, sdr_reference_image=image)
    neutral_output = apply_adjustments(image, neutral, PreviewKind.SDR, sdr_reference_image=image)

    np.testing.assert_allclose(linked_output, neutral_output, rtol=1e-6, atol=1e-7)


def test_sdr_manual_color_is_independent_when_hdr_match_is_disabled() -> None:
    image = np.array([[[0.18, 0.35, 0.62]]], dtype=np.float32)
    first = AdjustmentState(
        hdr=HDRAdjustments(red_hue=15, saturation=0.8),
        sdr=SDRAdjustments(saturation=-0.25, green_hue=5, highlight_recovery=0.0),
    )
    second = copy.deepcopy(first)
    second.hdr.red_hue = -15
    second.hdr.saturation = -0.8

    first_output = apply_adjustments(image, first, PreviewKind.SDR, sdr_reference_image=image)
    second_output = apply_adjustments(image, second, PreviewKind.SDR, sdr_reference_image=image)

    np.testing.assert_allclose(first_output, second_output, atol=1e-7)


def test_sdr_color_section_bypass_is_independent_of_hdr_color() -> None:
    image = np.array([[[0.18, 0.35, 0.62]]], dtype=np.float32)
    state = AdjustmentState(
        hdr=HDRAdjustments(color_section_enabled=False, saturation=0.9, red_hue=18),
        sdr=SDRAdjustments(color_section_enabled=False, saturation=0.9, red_hue=18, highlight_recovery=0.0),
    )
    baseline = AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0))
    np.testing.assert_allclose(
        apply_adjustments(image, state, PreviewKind.SDR, sdr_reference_image=image),
        apply_adjustments(image, baseline, PreviewKind.SDR, sdr_reference_image=image),
        atol=1e-7,
    )


def test_single_hdr_highlight_compression_step_is_gradual() -> None:
    image = np.ones((1, 1, 3), dtype=np.float32) * 1000.0
    baseline = _apply_hdr_adjustments(image, AdjustmentState(hdr=HDRAdjustments(highlight_compression_mode="soft_ceiling", highlight_compression_softness=25)))
    stepped = _apply_hdr_adjustments(image, AdjustmentState(hdr=HDRAdjustments(highlight_compression_mode="soft_ceiling", highlight_compression_softness=30)))

    assert stepped[0, 0, 0] / baseline[0, 0, 0] > 0.9


@pytest.mark.parametrize(
    ("kind", "branch_name", "pivot_step"),
    [
        (PreviewKind.HDR, "hdr", 0.0005),
        (PreviewKind.SDR, "sdr", 0.005),
    ],
)
def test_active_contrast_pivot_step_is_gradual(kind: PreviewKind, branch_name: str, pivot_step: float) -> None:
    levels = np.geomspace(0.001, 100.0, 256, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    baseline_branch = getattr(baseline_state, branch_name)
    moved_branch = getattr(moved_state, branch_name)
    baseline_branch.contrast = 0.25
    moved_branch.contrast = 0.25
    moved_branch.contrast_pivot += pivot_step

    baseline = apply_adjustments(image, baseline_state, kind)
    moved = apply_adjustments(image, moved_state, kind)
    scale = max(float(np.max(np.abs(baseline))), 1e-6)

    assert np.all(np.isfinite(moved))
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6)
    assert float(np.max(np.abs(moved - baseline))) / scale < 0.01


def test_classify_heic_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {"heif_aux_types": ["hdr"]}, ".heic")
    assert analysis.source_latitude == SourceLatitude.NARROW


def test_classify_hdr_true_exr_returns_wide_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 2.0
    analysis = classify_hdr(image, {}, ".exr")
    assert analysis.source_latitude == SourceLatitude.WIDE


def test_classify_sdr_png_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {}, ".png")
    assert analysis.source_latitude == SourceLatitude.MEDIUM


def test_classify_sdr_tiff_returns_narrow_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {}, ".tif")
    assert analysis.source_latitude == SourceLatitude.NARROW


def test_classify_linear_exr_returns_wide_latitude() -> None:
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    analysis = classify_hdr(image, {"transfer_function": "LINEAR"}, ".exr")
    assert analysis.source_latitude == SourceLatitude.WIDE


def test_sdr_exposure_applied_before_tone_mapping_preserves_headroom() -> None:
    state = AdjustmentState(sdr=SDRAdjustments(exposure=2.0, tone_mapper="aces"))
    image = np.ones((4, 4, 3), dtype=np.float32) * 2.0
    output = _apply_sdr_adjustments(image, state)
    assert output.max() <= 1.0, "SDR exposure should tone-map back into display range"


def test_sdr_tone_mapping_preserves_wide_exr_highlight_ordering() -> None:
    levels = np.array([1.0, 2.0, 10.0, 50.0, 1000.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)

    output = _apply_sdr_adjustments(image, AdjustmentState())
    output_levels = output[0, :, 0]

    assert np.all(np.diff(output_levels) > 0.0)


def test_default_sdr_render_maps_scene_diffuse_white_to_display_reference_white() -> None:
    image = np.full((2, 2, 3), 0.18, dtype=np.float32)
    output = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
    )

    assert np.allclose(output, 100.0 / 203.0, atol=0.005)


@pytest.mark.parametrize("tone_mapper", ["filmic", "aces", "reinhard"])
def test_sdr_tone_mapper_defaults_share_reference_white_anchor(tone_mapper: str) -> None:
    image = np.full((2, 2, 3), 0.18, dtype=np.float32)
    output = _apply_sdr_adjustments(
        image,
        AdjustmentState(
            sdr=SDRAdjustments(tone_mapper=tone_mapper, highlight_recovery=0.0)
        ),
    )

    assert np.allclose(output, 100.0 / 203.0, atol=0.005)


@pytest.mark.parametrize("tone_mapper", ["filmic", "aces", "reinhard"])
def test_sdr_tone_mapper_defaults_are_monotonic_and_retain_headroom(tone_mapper: str) -> None:
    levels = np.geomspace(0.001, 1000.0, 512, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    output = _apply_sdr_adjustments(
        image,
        AdjustmentState(
            sdr=SDRAdjustments(tone_mapper=tone_mapper, highlight_recovery=0.0)
        ),
    )[0, :, 0]

    assert np.all(np.isfinite(output))
    assert np.all(np.diff(output) >= -1e-6)
    assert output[np.searchsorted(levels, 0.18)] < 1.0
    assert output[-1] <= 1.0


def test_filmic_curve_contrast_changes_steepness_around_middle_gray() -> None:
    levels = np.array([0.04, 0.18, 1.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    soft = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_contrast=0.6, highlight_recovery=0.0)),
    )[0, :, 0]
    strong = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_contrast=1.4, highlight_recovery=0.0)),
    )[0, :, 0]

    assert strong[0] < soft[0]
    assert np.isclose(strong[1], soft[1], atol=0.005)
    assert strong[2] > soft[2]


def test_filmic_skew_moves_emphasis_between_shadows_and_highlights() -> None:
    levels = np.array([0.04, 0.18, 1.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    toward_shadows = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_skew=-0.8, highlight_recovery=0.0)),
    )[0, :, 0]
    toward_highlights = _apply_sdr_adjustments(
        image,
        AdjustmentState(sdr=SDRAdjustments(tone_skew=0.8, highlight_recovery=0.0)),
    )[0, :, 0]

    assert toward_highlights[0] > toward_shadows[0]
    assert np.isclose(toward_highlights[1], toward_shadows[1], atol=0.005)
    assert toward_highlights[2] > toward_shadows[2]


def test_default_sdr_render_compresses_wide_gamut_colors_without_clipping_hue() -> None:
    image = np.array([[[2.0, 0.15, 0.02], [0.02, 1.5, 0.1], [0.05, 0.2, 3.0]]], dtype=np.float32)
    output = _apply_sdr_adjustments(image, AdjustmentState())

    assert np.all(np.isfinite(output))
    assert float(output.min()) >= 0.0
    assert float(output.max()) <= 1.0
    assert np.all(np.sum(output, axis=-1) > 0.0)


def test_sdr_highlight_recovery_is_visible_and_targets_highlights() -> None:
    levels = np.array([0.18, 0.5, 1.0, 4.0], dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)))
    recovered = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(highlight_recovery=1.0)))
    baseline_levels = baseline[0, :, 0]
    recovered_levels = recovered[0, :, 0]

    assert recovered_levels[0] == pytest.approx(baseline_levels[0], abs=1e-6)
    assert baseline_levels[-1] - recovered_levels[-1] > 0.02
    assert np.all(np.diff(recovered_levels) > 0.0)


def test_sdr_reference_highlight_recovery_holds_mid_gray_and_recovers_white() -> None:
    levels = np.array([0.05, 0.18, 0.75, 1.0], dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    baseline = apply_adjustments(
        scene,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
        PreviewKind.SDR,
        sdr_reference_image=reference,
    )
    recovered = apply_adjustments(
        scene,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=1.0)),
        PreviewKind.SDR,
        sdr_reference_image=reference,
    )

    assert abs(float(recovered[0, 1, 0]) - float(baseline[0, 1, 0])) < 1e-6
    assert float(baseline[0, -2, 0] - recovered[0, -2, 0]) > 0.02
    assert recovered[0, -1, 0] == pytest.approx(1.0, abs=1e-6)
    assert np.all(np.diff(recovered[0, :, 0]) > 0.0)


def test_sdr_reference_neutral_base_rendition_is_identity() -> None:
    levels = np.linspace(0.0, 1.0, 257, dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    state = AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0))

    output = apply_adjustments(scene, state, PreviewKind.SDR, sdr_reference_image=reference)

    np.testing.assert_array_equal(output, reference)


def test_sdr_reference_filmic_controls_change_the_render() -> None:
    levels = np.linspace(0.01, 0.99, 257, dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    baseline = apply_adjustments(
        scene,
        AdjustmentState(sdr=SDRAdjustments(highlight_recovery=0.0)),
        PreviewKind.SDR,
        sdr_reference_image=reference,
    )

    for state in (
        AdjustmentState(sdr=SDRAdjustments(tone_contrast=1.4, highlight_recovery=0.0)),
        AdjustmentState(sdr=SDRAdjustments(tone_skew=-0.8, highlight_recovery=0.0)),
    ):
        output = apply_adjustments(scene, state, PreviewKind.SDR, sdr_reference_image=reference)
        assert float(np.max(np.abs(output - baseline))) > 0.02
        assert np.all(np.diff(output[0, :, 0]) >= -1e-6)


def test_sdr_reference_tone_mapper_selection_changes_the_render() -> None:
    levels = np.linspace(0.01, 0.99, 257, dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    outputs = {
        mapper: apply_adjustments(
            scene,
            AdjustmentState(sdr=SDRAdjustments(tone_mapper=mapper, highlight_recovery=0.0)),
            PreviewKind.SDR,
            sdr_reference_image=reference,
        )
        for mapper in ("filmic", "aces", "reinhard")
    }

    assert float(np.max(np.abs(outputs["aces"] - outputs["filmic"]))) > 0.02
    assert float(np.max(np.abs(outputs["reinhard"] - outputs["filmic"]))) > 0.02


def test_sdr_reference_base_rendition_bypass_disables_retone_mapping() -> None:
    levels = np.linspace(0.0, 1.0, 257, dtype=np.float32)
    reference = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    scene = np.ones_like(reference)
    state = AdjustmentState(
        sdr=SDRAdjustments(
            base_section_enabled=False,
            tone_mapper="aces",
            tone_contrast=1.5,
            tone_skew=1.0,
            highlight_recovery=0.0,
        )
    )

    output = apply_adjustments(scene, state, PreviewKind.SDR, sdr_reference_image=reference)

    np.testing.assert_array_equal(output, reference)


def test_single_sdr_exposure_step_is_continuous_for_wide_exr() -> None:
    levels = np.geomspace(0.001, 1000.0, 128, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(exposure=0.0)))
    stepped = _apply_sdr_adjustments(image, AdjustmentState(sdr=SDRAdjustments(exposure=0.1)))

    assert np.max(np.abs(stepped - baseline)) < 0.06
    assert np.mean(np.abs(stepped - baseline)) > 0.0


@pytest.mark.parametrize(
    ("kind", "path", "step"),
    [
        (PreviewKind.HDR, "hdr.exposure", 0.05),
        (PreviewKind.HDR, "hdr.highlight_compression_softness", 1),
        (PreviewKind.HDR, "hdr.shadow_lift", 0.005),
        (PreviewKind.HDR, "hdr.lift", 0.005),
        (PreviewKind.HDR, "hdr.gamma", 0.005),
        (PreviewKind.HDR, "hdr.gain", 0.005),
        (PreviewKind.HDR, "hdr.contrast", 0.001),
        (PreviewKind.HDR, "hdr.white_balance_kelvin", 50),
        (PreviewKind.HDR, "hdr.tint", 0.01),
        (PreviewKind.HDR, "hdr.saturation", 0.01),
        (PreviewKind.HDR, "hdr.vibrance", 0.01),
        (PreviewKind.HDR, "hdr.red_hue", 0.1),
        (PreviewKind.HDR, "hdr.red_purity", 0.5),
        (PreviewKind.SDR, "sdr.exposure", 0.05),
        (PreviewKind.SDR, "sdr.highlight_recovery", 0.01),
        (PreviewKind.SDR, "sdr.shadow", 0.01),
        (PreviewKind.SDR, "sdr.lift", 0.002),
        (PreviewKind.SDR, "sdr.gamma", 0.005),
        (PreviewKind.SDR, "sdr.gain", 0.005),
        (PreviewKind.SDR, "sdr.contrast", 0.001),
    ],
)
def test_one_slider_step_is_finite_ordered_and_gradual(kind: PreviewKind, path: str, step: float) -> None:
    levels = np.geomspace(1e-6, 1000.0, 512, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    branch_name, field_name = path.split(".")
    branch = getattr(moved_state, branch_name)
    setattr(branch, field_name, getattr(branch, field_name) + step)

    baseline = apply_adjustments(image, baseline_state, kind)
    moved = apply_adjustments(image, moved_state, kind)
    scale = max(float(np.max(baseline) - np.min(baseline)), 1e-6)

    assert np.all(np.isfinite(moved)), f"{path} produced non-finite pixels"
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6), f"{path} inverted grayscale luminance ordering"
    assert float(np.max(np.abs(moved - baseline))) / scale < 0.12, f"{path} changed too much in one UI step"


@pytest.mark.parametrize(
    ("path", "step"),
    [
        ("sdr.exposure", 0.05),
        ("sdr.highlight_recovery", 0.01),
        ("sdr.shadow", 0.01),
        ("sdr.lift", 0.002),
        ("sdr.gamma", 0.005),
        ("sdr.gain", 0.005),
        ("sdr.contrast", 0.001),
    ],
)
def test_sdr_reference_slider_step_is_finite_ordered_and_gradual(path: str, step: float) -> None:
    scene_levels = np.geomspace(1e-6, 1000.0, 512, dtype=np.float32)
    scene_image = np.repeat(scene_levels.reshape(1, -1, 1), 3, axis=2)
    reference_levels = np.linspace(0.0, 1.0, 512, dtype=np.float32)
    reference_image = np.repeat(reference_levels.reshape(1, -1, 1), 3, axis=2)
    baseline_state = AdjustmentState()
    moved_state = copy.deepcopy(baseline_state)
    branch_name, field_name = path.split(".")
    branch = getattr(moved_state, branch_name)
    setattr(branch, field_name, getattr(branch, field_name) + step)

    baseline = apply_adjustments(scene_image, baseline_state, PreviewKind.SDR, sdr_reference_image=reference_image)
    moved = apply_adjustments(scene_image, moved_state, PreviewKind.SDR, sdr_reference_image=reference_image)

    assert np.all(np.isfinite(moved)), f"{path} produced non-finite SDR-reference pixels"
    assert np.all(np.diff(moved[0, :, 0]) >= -1e-6), f"{path} inverted SDR-reference luminance ordering"
    assert float(np.max(np.abs(moved - baseline))) < 0.12, f"{path} changed too much in one UI step"


@pytest.mark.parametrize(
    ("kind", "branch_name", "field_name", "values"),
    [
        (PreviewKind.HDR, "hdr", "exposure", (-1.3, 1.3)),
        (PreviewKind.HDR, "hdr", "highlight_compression_softness", (0.0, 75.0)),
        (PreviewKind.HDR, "hdr", "shadow_lift", (-0.13, 0.13)),
        (PreviewKind.HDR, "hdr", "lift", (-0.16, 0.16)),
        (PreviewKind.HDR, "hdr", "gamma", (-0.32, 0.32)),
        (PreviewKind.HDR, "hdr", "gain", (-0.16, 0.16)),
        (PreviewKind.HDR, "hdr", "contrast", (-0.32, 0.32)),
        (PreviewKind.HDR, "hdr", "contrast_pivot", (0.08, 0.4)),
        (PreviewKind.HDR, "hdr", "white_balance_kelvin", (3900, 9100)),
        (PreviewKind.HDR, "hdr", "tint", (-0.65, 0.65)),
        (PreviewKind.SDR, "sdr", "exposure", (-1.3, 1.3)),
        (PreviewKind.SDR, "sdr", "highlight_recovery", (0.0, 1.3)),
        (PreviewKind.SDR, "sdr", "tone_contrast", (0.68, 1.32)),
        (PreviewKind.SDR, "sdr", "tone_skew", (-0.65, 0.65)),
        (PreviewKind.SDR, "sdr", "shadow", (-0.32, 0.32)),
        (PreviewKind.SDR, "sdr", "lift", (-0.16, 0.16)),
        (PreviewKind.SDR, "sdr", "gamma", (-0.32, 0.32)),
        (PreviewKind.SDR, "sdr", "gain", (-0.16, 0.16)),
        (PreviewKind.SDR, "sdr", "contrast", (-0.32, 0.32)),
        (PreviewKind.SDR, "sdr", "contrast_pivot", (0.19, 0.81)),
    ],
)
def test_representative_slider_travel_remains_display_safe_and_ordered(
    kind: PreviewKind,
    branch_name: str,
    field_name: str,
    values: tuple[float, float],
) -> None:
    levels = np.geomspace(1e-6, 1000.0, 512, dtype=np.float32)
    image = np.repeat(levels.reshape(1, -1, 1), 3, axis=2)

    for value in values:
        state = AdjustmentState()
        setattr(getattr(state, branch_name), field_name, value)
        output = apply_adjustments(image, state, kind)
        luma = output[0].mean(axis=1)

        assert np.all(np.isfinite(output)), f"{branch_name}.{field_name} produced non-finite output at {value}"
        assert float(output.min()) >= 0.0, f"{branch_name}.{field_name} produced negative output at {value}"
        assert np.all(np.diff(luma) >= -1e-5), f"{branch_name}.{field_name} inverted tone ordering at {value}"
        if kind == PreviewKind.SDR:
            assert float(output.max()) <= 1.0, f"{branch_name}.{field_name} escaped the SDR display range at {value}"
