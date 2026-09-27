"""BW-01 Black & White: a per-rendition monochrome conversion with an
8-colour response mixer, run straight after Color and before highlight
limiting measures the picture.
"""

from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.adjustments import (
    BW_ACESCG_TO_LMS,
    BW_HUE_CENTRES_DEG,
    BW_LMS_TO_OKLAB,
    BW_RESPONSE_STOPS,
    BW_SLIDERS,
    _apply_black_and_white,
    apply_adjustments,
    sdr_highlight_stage_input,
)
from hdr_finisher.color import acescg_to_linear_bt2020, linear_srgb_to_acescg
from hdr_finisher.models import (
    AdjustmentState,
    BlackAndWhiteAdjustments,
    HDRAdjustments,
    PreviewKind,
    SDRAdjustments,
)

NITS = 0.18 / 203.0  # scene-linear per nit, 203-nit reference white
# The app's ACEScg/sRGB/BT.2020 matrices return a grey to within ~1.6e-4 of
# grey (7.0 -> 6.9989, 7.0007, 7.0005): under a tenth of an 8-bit level. A
# "neutral" picture that has passed through them is neutral to this much.
NEUTRAL_TOLERANCE = 5e-4


def _colourful(seed: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (rng.random((32, 48, 3)) ** 2 * 3.0).astype(np.float32)


def _sliders(value: float) -> BlackAndWhiteAdjustments:
    return BlackAndWhiteAdjustments(**{name: value for name in BW_SLIDERS})


def _oklab_hue_sweep(samples: int, lightness: float = 0.7, chroma: float = 0.1) -> np.ndarray:
    """Colours evenly spaced in Oklab hue, back in ACEScg."""
    hue = np.radians(np.arange(samples) * 360.0 / samples)
    lab = np.stack([np.full(samples, lightness), chroma * np.cos(hue), chroma * np.sin(hue)], axis=-1)
    lms = (lab @ np.linalg.inv(BW_LMS_TO_OKLAB.astype(np.float64)).T) ** 3
    return (lms @ np.linalg.inv(BW_ACESCG_TO_LMS.astype(np.float64)).T).astype(np.float32).reshape(1, samples, 3)


def test_new_and_old_documents_have_black_and_white_off() -> None:
    state = AdjustmentState()
    assert state.hdr.black_and_white_section_enabled is False
    assert state.sdr.black_and_white_section_enabled is False
    # A project saved before BW-01 carries neither field.
    old = HDRAdjustments.model_validate({"exposure": 0.5})
    assert old.black_and_white_section_enabled is False
    assert old.black_and_white == BlackAndWhiteAdjustments()


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_on_with_sliders_at_zero_is_pixel_identical_to_saturation_minus_100(kind: PreviewKind) -> None:
    image = _colourful()
    saturation = AdjustmentState()
    getattr(saturation, kind.value).saturation = -1.0
    bw = AdjustmentState()
    getattr(bw, kind.value).black_and_white_section_enabled = True
    np.testing.assert_array_equal(apply_adjustments(image, bw, kind), apply_adjustments(image, saturation, kind))


def test_neutral_pixels_do_not_move_whatever_the_sliders() -> None:
    greys = np.repeat(np.geomspace(1e-5, 60.0, 64, dtype=np.float32)[None, :, None], 3, axis=2)
    rng = np.random.default_rng(11)
    for _ in range(20):
        bw = BlackAndWhiteAdjustments(**{name: float(rng.uniform(-100, 100)) for name in BW_SLIDERS})
        np.testing.assert_allclose(_apply_black_and_white(greys, bw), greys, rtol=1e-5)


def test_a_slider_moves_its_colour_and_leaves_the_opposite_colour() -> None:
    red = linear_srgb_to_acescg(np.array([[[0.6, 0.02, 0.02]]], dtype=np.float32))
    blue = linear_srgb_to_acescg(np.array([[[0.02, 0.02, 0.6]]], dtype=np.float32))
    plain = BlackAndWhiteAdjustments()
    reds_up = BlackAndWhiteAdjustments(reds=100)
    ratio = lambda image, bw: float(_apply_black_and_white(image, bw)[0, 0, 0] / _apply_black_and_white(image, plain)[0, 0, 0])
    assert ratio(red, reds_up) > 3.0
    assert ratio(blue, reds_up) == pytest.approx(1.0, abs=1e-6)


@pytest.mark.parametrize("preset", [
    {"reds": 55, "oranges": 45, "yellows": 15, "greens": -30, "aquas": -60, "blues": -85, "purples": -50, "magentas": 25},
    {"reds": -100, "oranges": 100, "yellows": -100, "greens": 100, "aquas": -100, "blues": 100, "purples": -100, "magentas": 100},
])
def test_a_hue_sweep_changes_smoothly_with_no_steps(preset: dict) -> None:
    """Brightness rises and falls with hue as a filter's does, but never jumps.

    Between two hue centres the response follows a smoothstep, whose slope is
    at most 1.5x the straight line between the two sliders. So no step between
    neighbouring samples may exceed that slope times the sample spacing; a
    seam or a step at a boundary would.
    """
    samples = 2880
    sweep = _oklab_hue_sweep(samples)
    bw = BlackAndWhiteAdjustments(**preset)
    stops = np.log2(_apply_black_and_white(sweep, bw)[0, :, 0] / _apply_black_and_white(sweep, BlackAndWhiteAdjustments())[0, :, 0])
    values = [preset[name] / 100.0 * BW_RESPONSE_STOPS for name in BW_SLIDERS]
    centres = list(BW_HUE_CENTRES_DEG) + [BW_HUE_CENTRES_DEG[0] + 360.0]
    slope = max(
        abs(values[(i + 1) % 8] - values[i]) * 1.5 / (centres[i + 1] - centres[i]) for i in range(8)
    )
    steps = np.abs(np.diff(np.concatenate([stops, stops[:1]])))
    assert float(steps.max()) <= slope * (360.0 / samples) * 1.05 + 1e-4, (float(steps.max()), slope)


def test_extreme_hdr_colours_stay_within_the_slider_range_and_do_not_spike() -> None:
    """Saturated primaries and secondaries at 1,000-10,000 nits, sliders at +/-100."""
    hues = [(1, 0, 0), (1, 0.5, 0), (1, 1, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1), (0.5, 0, 1), (1, 0, 1)]
    nits = [1000.0, 4000.0, 10000.0]
    patch = np.array([[np.array(h, np.float32) * n * NITS for h in hues] for n in nits], dtype=np.float32)
    image = linear_srgb_to_acescg(patch)
    plain = _apply_black_and_white(image, BlackAndWhiteAdjustments())[..., 0]
    for value in (100.0, -100.0):
        out = _apply_black_and_white(image, _sliders(value))[..., 0]
        ratio = out / plain
        assert np.isfinite(out).all()
        assert float(ratio.max()) <= 2.0 ** BW_RESPONSE_STOPS * (1 + 1e-5)
        assert float(ratio.min()) >= 2.0 ** -BW_RESPONSE_STOPS * (1 - 1e-5)
    # A saturated highlight beside neutral pixels: the neighbours are untouched.
    frame = np.full((9, 9, 3), 600.0 * NITS, dtype=np.float32)
    frame[4, 4] = linear_srgb_to_acescg(np.array([[[1.0, 0.0, 0.0]]], np.float32))[0, 0] * np.float32(8000.0 * NITS)
    out = _apply_black_and_white(frame, _sliders(100.0))
    mask = np.ones((9, 9), bool)
    mask[4, 4] = False
    np.testing.assert_allclose(out[mask], frame[mask], rtol=1e-5)


@pytest.mark.parametrize(
    ("mean", "sigma", "allowed"),
    [
        # About 7 stops under mid grey, colour noise as large as the signal:
        # the shadow fade leaves it as the plain conversion has it.
        (0.0008, 0.0006, 1.25),
        # About 5 stops under, 40% colour noise: partly faded. Measured 2.0x
        # (5.1x without the fade). Denoise before B&W removes most of it.
        (0.005, 0.002, 2.2),
    ],
)
def test_dark_colour_noise_is_held_down(mean: float, sigma: float, allowed: float) -> None:
    rng = np.random.default_rng(3)
    noisy = np.clip(mean + rng.normal(0.0, sigma, (64, 64, 3)), 0.0, None).astype(np.float32)
    plain = _apply_black_and_white(noisy, BlackAndWhiteAdjustments())[..., 0]
    for trial in range(6):
        bw = BlackAndWhiteAdjustments(**{name: 100.0 * rng.choice([-1.0, 1.0]) for name in BW_SLIDERS})
        out = _apply_black_and_white(noisy, bw)[..., 0]
        assert float(out.std()) <= float(plain.std()) * allowed, trial


def test_ordinary_colours_keep_their_full_response_a_few_stops_down() -> None:
    sky = linear_srgb_to_acescg(np.array([[[0.10, 0.27, 0.69]]], np.float32))
    for ev in (0.0, -2.0, -4.0):
        pixel = sky * np.float32(2.0 ** ev)
        ratio = _apply_black_and_white(pixel, BlackAndWhiteAdjustments(blues=-100))[0, 0, 0] / _apply_black_and_white(pixel, BlackAndWhiteAdjustments())[0, 0, 0]
        assert float(np.log2(ratio)) < -1.8, ev


def test_the_output_ceiling_holds_with_every_slider_at_plus_100() -> None:
    target_nits = 1000.0
    image = np.full((6, 6, 3), 300.0 * NITS, dtype=np.float32)
    image[1:3, 1:3] = linear_srgb_to_acescg(np.array([[[1.0, 0.05, 0.02]]], np.float32))[0, 0] * np.float32(6000.0 * NITS)
    image[3:5, 3:5] = linear_srgb_to_acescg(np.array([[[0.02, 0.05, 1.0]]], np.float32))[0, 0] * np.float32(9000.0 * NITS)
    for mode in ("peak_fit", "soft_ceiling", "clip"):
        state = AdjustmentState(hdr=HDRAdjustments(
            highlight_section_enabled=True,
            highlight_compression_mode=mode,
            highlight_compression_target_nits=target_nits,
            black_and_white_section_enabled=True,
            black_and_white=_sliders(100.0),
        ))
        out = apply_adjustments(image, state, PreviewKind.HDR)
        assert float(np.max(acescg_to_linear_bt2020(out))) <= target_nits * NITS + 2e-5, mode


def test_film_look_adds_no_colour_back_when_black_and_white_is_on() -> None:
    image = np.full((48, 48, 3), 0.05, dtype=np.float32)
    image[20:28, 20:28] = 12.0  # a bright source for halation
    state = AdjustmentState()
    state.hdr.black_and_white_section_enabled = True
    look = state.hdr.film_look
    look.halation_amount = 80
    look.halation_saturation = 100
    look.red_response = 60
    look.blue_response = -60
    look.grain_amount = 40
    look.grain_chroma = 80
    out = apply_adjustments(image, state, PreviewKind.HDR)
    spread = out.max(axis=-1) - out.min(axis=-1)
    assert float(spread.max()) <= NEUTRAL_TOLERANCE * max(1.0, float(out.max()))
    # The saved values are left as they were.
    assert look.halation_saturation == 100 and look.grain_chroma == 80 and look.red_response == 60


@pytest.mark.parametrize("authored_reference", [False, True])
def test_the_sdr_highlight_stage_sees_the_grey_picture_on_both_paths(authored_reference: bool) -> None:
    image = _colourful(9)
    sdr = SDRAdjustments(black_and_white_section_enabled=True, black_and_white=BlackAndWhiteAdjustments(blues=-80))
    stage_input = sdr_highlight_stage_input(image, AdjustmentState(sdr=sdr), authored_reference=authored_reference)
    spread = stage_input.max(axis=-1) - stage_input.min(axis=-1)
    assert float(spread.max()) <= NEUTRAL_TOLERANCE * max(1.0, float(stage_input.max()))
    off = sdr_highlight_stage_input(image, AdjustmentState(), authored_reference=authored_reference)
    assert not np.allclose(stage_input, off)


def test_black_and_white_is_per_rendition() -> None:
    image = _colourful(2)
    state = AdjustmentState()
    state.hdr.black_and_white_section_enabled = True
    sdr = apply_adjustments(image, state, PreviewKind.SDR)
    assert float((sdr.max(axis=-1) - sdr.min(axis=-1)).max()) > 0.05
