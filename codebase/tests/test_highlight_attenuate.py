"""AgX-style Attenuate colour handling (prototype, October 2026): results, not wording."""
from __future__ import annotations

import numpy as np

from hdr_finisher.adjustments import _compress_scene_highlights, _compress_sdr_highlights
from hdr_finisher.color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
from hdr_finisher.models import SDRAdjustments

WHITE = 203


def nits_to_linear(nits: float) -> float:
    return nits * 0.18 / WHITE


def hdr(image: np.ndarray, color_handling: str, attenuation: float = 20.0, peak_nits: float = 4000.0) -> np.ndarray:
    return _compress_scene_highlights(
        image.astype(np.float32), 400.0, 1000.0, 0.0, mode="peak_fit", source_peak_nits=peak_nits,
        peak_detail=35.0, color_handling=color_handling, reference_white_nits=WHITE, attenuation=attenuation,
    )


def orange_ramp(peak_nits: float = 4000.0, count: int = 256) -> np.ndarray:
    """A saturated orange whose brightest BT.2020 channel runs from 50 nits to the peak."""
    levels = np.geomspace(nits_to_linear(50.0), nits_to_linear(peak_nits), count, dtype=np.float32)
    colour = np.array([1.0, 0.45, 0.12], dtype=np.float32)
    return linear_bt2020_to_acescg(levels[:, None] * colour[None, :])[None, :, :]


def test_pixels_below_the_shoulder_are_untouched() -> None:
    ramp = orange_ramp()
    out = hdr(ramp, "agx_attenuate")
    below = acescg_to_linear_bt2020(ramp).max(axis=-1) < nits_to_linear(300.0)
    assert np.array_equal(out[below], ramp[below])


def test_measured_peak_lands_on_target_and_stays_monotonic() -> None:
    ramp = orange_ramp()
    out_peak = acescg_to_linear_bt2020(hdr(ramp, "agx_attenuate")).max(axis=-1)[0]
    assert abs(out_peak[-1] - nits_to_linear(1000.0)) / nits_to_linear(1000.0) < 0.01
    assert np.all(np.diff(out_peak) >= -1e-6)


def test_attenuation_fades_colour_toward_white_gradually() -> None:
    ramp = orange_ramp()
    transport = acescg_to_linear_bt2020(hdr(ramp, "agx_attenuate", attenuation=30.0))[0]
    blue_share = transport[:, 2] / np.maximum(transport.max(axis=-1), 1e-12)
    assert blue_share[-1] > blue_share[0] + 0.1  # whiter at the top
    assert np.max(np.diff(blue_share)) < 0.02  # no step between neighbouring levels


def test_zero_attenuation_matches_smooth_color_rolloff() -> None:
    ramp = orange_ramp()
    np.testing.assert_allclose(hdr(ramp, "agx_attenuate", 0.0), hdr(ramp, "smooth_rolloff"), rtol=1e-5, atol=1e-7)


def test_sdr_lane_keeps_display_white_peak_and_untouched_shadows() -> None:
    levels = np.geomspace(0.05, 4.0, 128, dtype=np.float32)
    image = (levels[:, None] * np.array([1.0, 0.5, 0.15], dtype=np.float32))[None]
    sdr = SDRAdjustments(
        highlight_compression_color_handling="agx_attenuate", highlight_compression_attenuation=25.0,
        highlight_compression_start_percent=50.0,
    )
    out = _compress_sdr_highlights(image, sdr)[0]
    assert abs(out.max() - 1.0) < 0.01
    # Whatever Smooth color rolloff leaves alone (below the effective start),
    # Attenuate must leave alone too.
    smooth = _compress_sdr_highlights(image, sdr.model_copy(update={"highlight_compression_color_handling": "smooth_rolloff"}))[0]
    untouched = np.all(smooth == image[0], axis=-1)
    assert untouched.sum() > 10
    assert np.array_equal(out[untouched], image[0][untouched])
