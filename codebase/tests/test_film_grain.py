"""The film grain field: statistics, texture, film types and strip exactness."""

from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher import film_grain
from hdr_finisher.adjustments import FrameWindow, _apply_film_look
from hdr_finisher.models import AdjustmentState, PreviewKind

FRAME = (5320, 7968)


def _grain_log(level: float, film_type: str = "color_negative", *, chroma: float = 0.0, size: int = 256):
    state = AdjustmentState()
    look = state.sdr.film_look
    look.grain_amount = 60.0
    look.grain_chroma = chroma
    look.grain_film_type = film_type
    card = np.full((size, size, 3), level, dtype=np.float32)
    grained = _apply_film_look(card, state, PreviewKind.SDR, frame_window=FrameWindow(1500, 2500, *FRAME))
    return np.log2(grained / np.float32(level))


def _spectral_spike(field: np.ndarray) -> float:
    """A narrow spectral peak compared with its local spectral floor."""
    # The tent falls off faster along the axes than the diagonals near
    # Nyquist. Compare with nearby bins rather than dilute the expected
    # energy across a whole ring. A repeat still shows as a narrow peak.
    window = np.hanning(field.shape[0])[:, None] * np.hanning(field.shape[1])[None, :]
    spectrum = np.abs(np.fft.fftshift(np.fft.fft2((field - field.mean()) * window))) ** 2
    wrapped = np.pad(spectrum, 6, mode="wrap")
    neighbours = np.lib.stride_tricks.sliding_window_view(wrapped, (13, 13)).mean(axis=(-1, -2))
    ratio = spectrum / np.maximum(neighbours, 1e-30)
    centre = field.shape[0] // 2
    ratio[centre - 2:centre + 3, centre - 2:centre + 3] = 0
    return float(ratio.max())


@pytest.mark.parametrize("pitch", [0.07, 0.5, 1.3, 6.2])
def test_box_filter_matches_averaging_aligned_finer_pixels(pitch: float) -> None:
    # A wider pixel averages the very same field, including at Fit.
    seeded = film_grain.seed_hash(271828, 239)
    coarse = film_grain._layer_features(8, 14, 24, 31, np.float32(pitch), seeded)
    finer = film_grain._layer_features(24, 42, 72, 93, np.float32(3 * pitch), seeded)
    np.testing.assert_allclose(coarse, finer.reshape(24, 3, 31, 3, 2).mean(axis=(1, 3)), atol=3e-5)


@pytest.mark.parametrize("level", [0.05, 0.5, 0.85])
def test_grain_has_no_repeating_pattern(level: float) -> None:
    # White noise measures about 12 here; the first grain's sine hash
    # measured about 95 at every level, which is what showed as tiling.
    assert _spectral_spike(_grain_log(level, size=512)[..., 1]) < 25.0


def test_amount_keeps_the_first_grains_strength_at_mid_grey() -> None:
    # Amount 60 put 0.040 stops RMS on mid grey before the rework.
    assert float(_grain_log(0.18)[..., 1].std()) == pytest.approx(0.040, rel=0.2)


def test_texture_changes_with_exposure_not_only_strength() -> None:
    # Few grains develop in shadows: sparse specks, skewed bright. Highlights
    # are a dense cloud of merged grains with small gaps: skewed dark.
    def skew(values: np.ndarray) -> float:
        centred = values - values.mean()
        return float(np.mean(centred**3) / np.std(centred) ** 3)

    assert skew(_grain_log(0.005, size=384)[..., 1]) > 1.0
    assert skew(_grain_log(0.9, size=384)[..., 1]) < -0.25


def test_black_and_white_grain_is_achromatic_even_with_chroma() -> None:
    grain = _grain_log(0.18, "black_and_white", chroma=100.0)
    np.testing.assert_array_equal(grain[..., 0], grain[..., 1])
    np.testing.assert_array_equal(grain[..., 1], grain[..., 2])
    colour = _grain_log(0.18, "color_negative", chroma=100.0)
    assert float(np.abs(colour[..., 0] - colour[..., 2]).mean()) > 0.005


def test_black_and_white_is_a_different_field_from_color_negative() -> None:
    mono = _grain_log(0.18, "black_and_white")[..., 1]
    colour = _grain_log(0.18, "color_negative")[..., 1]
    assert abs(float(np.corrcoef(mono.ravel(), colour.ravel())[0, 1])) < 0.2


@pytest.mark.parametrize("scale", [0.15, 0.52, 1.0])
def test_strips_and_tiles_render_the_same_grain_bit_for_bit(scale: float) -> None:
    state = AdjustmentState()
    look = state.sdr.film_look
    look.grain_amount, look.grain_size, look.grain_chroma = 70, 75, 50
    signal = np.random.default_rng(3).random((200, 157, 3), dtype=np.float32)
    def render(y, x):
        return _apply_film_look(signal[y, x], state, PreviewKind.SDR,
            frame_window=FrameWindow(1500 + (x.start or 0), 2500 + (y.start or 0), *FRAME),
            source_pixel_scale=scale)
    all_pixels = slice(None)
    whole = render(all_pixels, all_pixels)
    rows = np.vstack([render(slice(a, b), all_pixels) for a, b in ((0, 37), (37, 170), (170, 200))])
    cols = np.hstack([render(all_pixels, slice(a, b)) for a, b in ((0, 100), (100, 157))])
    np.testing.assert_array_equal(rows, whole)
    np.testing.assert_array_equal(cols, whole)


def test_threaded_row_chunks_match_a_single_pass() -> None:
    import hdr_finisher.adjustments as adjustments

    state = AdjustmentState()
    state.sdr.film_look.grain_amount = 60.0
    state.sdr.film_look.grain_chroma = 40.0
    image = np.random.default_rng(9).random((300, 200, 3)).astype(np.float32)
    chunked = _apply_film_look(image, state, PreviewKind.SDR)
    original = adjustments.GRAIN_CHUNK_ROWS
    try:
        adjustments.GRAIN_CHUNK_ROWS = 10_000
        single = _apply_film_look(image, state, PreviewKind.SDR)
    finally:
        adjustments.GRAIN_CHUNK_ROWS = original
    np.testing.assert_array_equal(chunked, single)


def test_full_seed_changes_the_field_without_moving_it() -> None:
    first = film_grain.seed_hash(271828, 223)
    second = film_grain.seed_hash(271828 + (1 << 16), 223)
    def draw(key):
        return film_grain._layer_features(2000, 3000, 128, 128, np.float32(0.63), key)[..., 0]
    a, b = draw(first), draw(second)
    np.testing.assert_array_equal(draw(first), a)
    assert abs(float(np.corrcoef(a.ravel(), b.ravel())[0, 1])) < 0.05


def test_hdr_and_sdr_develop_the_same_grain() -> None:
    # A gain map is the ratio of the two renditions; grain that differs
    # between them would be written into it. Each lane's tone curve places a
    # pixel differently, so both develop from one SDR-scaled signal.
    from hdr_finisher.adjustments import apply_adjustments
    from hdr_finisher.color import acescg_to_linear_srgb

    height, width = 384, 512
    exposure = np.geomspace(0.003, 3.0, width, dtype=np.float32)
    scene = np.repeat(np.repeat(exposure[None, :, None], height, axis=0), 3, axis=2)
    scene[height // 2:] *= np.array([1.4, 0.8, 0.5], dtype=np.float32)
    state = AdjustmentState()
    for lane in (state.hdr, state.sdr):
        lane.film_look.grain_amount = 60.0
        lane.film_look.grain_size = 100.0
        lane.film_look.grain_film_format = "super8"  # grain several pixels across

    def grain(kind: PreviewKind) -> np.ndarray:
        clean = apply_adjustments(scene, state, kind, include_grain=False, include_output_highlight_compression=False)
        grained = apply_adjustments(scene, state, kind, include_output_highlight_compression=False)
        if kind == PreviewKind.HDR:
            clean, grained = acescg_to_linear_srgb(clean), acescg_to_linear_srgb(grained)
        luma = lambda image: np.maximum(image @ np.float32([0.2126, 0.7152, 0.0722]), 1e-5)  # noqa: E731
        return np.log2(luma(grained) / luma(clean)), luma(clean)

    hdr, _ = grain(PreviewKind.HDR)
    sdr, sdr_luma = grain(PreviewKind.SDR)
    valid = (sdr_luma > 0.003) & (sdr_luma < 0.97)
    # What a gain map would carry. The first grain left 0.0004 stops RMS here
    # and 0.007 at p99.9; an 8-bit gain map step is about 0.02 stops.
    difference = (hdr - sdr)[valid]
    assert float(difference.std()) < 0.0015
    assert float(np.percentile(np.abs(difference), 99.9)) < 0.015
