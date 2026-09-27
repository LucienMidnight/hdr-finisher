"""The film grain field: statistics, texture, film types and strip exactness."""

from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher import film_grain
from hdr_finisher.adjustments import FrameWindow, apply_final_grain
from hdr_finisher.models import AdjustmentState, PreviewKind

FRAME = (5320, 7968)


def _grain_log(level: float, film_type: str = "color_negative", *, chroma: float = 0.0, size: int = 256):
    state = AdjustmentState()
    look = state.sdr.film_look
    look.grain_amount = 60.0
    look.grain_chroma = chroma
    look.grain_film_type = film_type
    card = np.full((size, size, 3), level, dtype=np.float32)
    grained = apply_final_grain(card, state, PreviewKind.SDR, frame_window=FrameWindow(1500, 2500, *FRAME))
    return np.log2(grained / np.float32(level))


def _spike_over_ring(field: np.ndarray) -> float:
    """The tallest spectral peak against the average power at its frequency."""
    spectrum = np.abs(np.fft.fftshift(np.fft.fft2(field - field.mean()))) ** 2
    centre = spectrum.shape[0] // 2
    yy, xx = np.indices(spectrum.shape)
    radius = np.hypot(yy - centre, xx - centre).astype(int)
    ring = np.bincount(radius.ravel(), spectrum.ravel()) / np.maximum(np.bincount(radius.ravel()), 1)
    ratio = spectrum / np.maximum(ring[radius], 1e-30)
    ratio[radius < 3] = 0.0
    return float(ratio.max())


@pytest.mark.parametrize("film_type", ["color_negative", "black_and_white"])
@pytest.mark.parametrize("softness", [0.0, 0.25, 1.0])
def test_closed_form_coverage_matches_the_simulated_field(film_type: str, softness: float) -> None:
    # Normalisation divides by these, so they must describe the field itself.
    kind = film_grain.film_type(film_type)
    flat = film_grain.FilmType(kind.layers, kind.opacity, 0.0, kind.edge_hard)  # no mottle: stationary
    edge = film_grain.edge_start(kind, softness)
    for level in (0.05, 0.5, 0.95):
        signal = np.full((320, 320), level, dtype=np.float32)
        coverage = film_grain.layer_coverage(signal, 3000, 2000, 4.0, 271828, kind.layers[0], flat, edge)
        mean, spread = film_grain.coverage_statistics(film_grain.develop_level(np.float64(level)), flat, edge)
        assert float(coverage.mean()) == pytest.approx(float(mean), abs=0.01)
        assert float(coverage.std()) == pytest.approx(float(spread), rel=0.03)


@pytest.mark.parametrize("level", [0.05, 0.5, 0.85])
def test_grain_has_no_repeating_pattern(level: float) -> None:
    # White noise measures about 12 here; the first grain's sine hash
    # measured about 95 at every level, which is what showed as tiling.
    assert _spike_over_ring(_grain_log(level, size=512)[..., 1]) < 25.0


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


@pytest.mark.parametrize("pitch", [1.0, 2.7, 9.3])
def test_strips_and_tiles_render_the_same_grain_bit_for_bit(pitch: float) -> None:
    kind = film_grain.film_type("color_negative")
    signal = np.random.default_rng(3).random((300, 257)).astype(np.float32)
    whole = film_grain.layer_coverage(signal, 40, 90, pitch, 7, kind.layers[0], kind, 0.6)
    rows = np.vstack([
        film_grain.layer_coverage(signal[a:b], 40, 90 + a, pitch, 7, kind.layers[0], kind, 0.6)
        for a, b in ((0, 37), (37, 170), (170, 300))
    ])
    cols = np.hstack([
        film_grain.layer_coverage(signal[:, a:b], 40 + a, 90, pitch, 7, kind.layers[0], kind, 0.6)
        for a, b in ((0, 100), (100, 257))
    ])
    np.testing.assert_array_equal(rows, whole)
    np.testing.assert_array_equal(cols, whole)


def test_threaded_row_chunks_match_a_single_pass() -> None:
    import hdr_finisher.adjustments as adjustments

    state = AdjustmentState()
    state.sdr.film_look.grain_amount = 60.0
    state.sdr.film_look.grain_chroma = 40.0
    image = np.random.default_rng(9).random((300, 200, 3)).astype(np.float32)
    chunked = apply_final_grain(image, state, PreviewKind.SDR)
    original = adjustments.GRAIN_CHUNK_ROWS
    try:
        adjustments.GRAIN_CHUNK_ROWS = 10_000
        single = apply_final_grain(image, state, PreviewKind.SDR)
    finally:
        adjustments.GRAIN_CHUNK_ROWS = original
    np.testing.assert_array_equal(chunked, single)


def test_hash_matches_the_shader_u32_arithmetic() -> None:
    # Reference values from the lowbias32 mix the shader runs in u32.
    def mix(x: int) -> int:
        x &= 0xFFFFFFFF
        x ^= x >> 16
        x = (x * 0x7FEB352D) & 0xFFFFFFFF
        x ^= x >> 15
        x = (x * 0x846CA68B) & 0xFFFFFFFF
        x ^= x >> 16
        return x

    seed, salt = 2_000_000_123, 223
    seeded = mix((seed + salt * 0x9E3779B9) & 0xFFFFFFFF)
    assert int(film_grain.seed_hash(seed, salt)) == seeded
    cell = mix(mix(seeded ^ (-1 & 0xFFFFFFFF)) ^ 5)
    assert int(film_grain.cell_hash(np.array([-1]), np.array([5]), np.uint64(seeded))[0]) == cell
    draw = (mix((cell + 3 * 0x85EBCA6B) & 0xFFFFFFFF) >> 8) / 16777216.0
    assert float(film_grain.uniform(np.array([cell], dtype=np.uint64), 3)[0]) == draw


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
        clean = apply_adjustments(scene, state, kind, include_grain=False)
        grained = apply_adjustments(scene, state, kind)
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
