from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.sdr_gamut import (
    CHROMA_EPS,
    GAMUT_EPS,
    SDR_GAMUT_ALPHA,
    SDR_GAMUT_HIGHLIGHT_ALPHA,
    SDR_GAMUT_HIGHLIGHT_START,
    SDR_GAMUT_LOW_SAT_HIGHLIGHT_START,
    SDR_GAMUT_SATURATION_HIGH,
    SDR_GAMUT_SATURATION_LOW,
    _find_cusp,
    compress_to_srgb_gamut,
    linear_srgb_to_oklab,
    oklab_to_linear_srgb,
)


def _hue_degrees(lab: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))


def _hue_difference(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return np.abs((left - right + 180.0) % 360.0 - 180.0)


def test_inclusive_in_gamut_values_are_bit_exact_identity() -> None:
    rng = np.random.default_rng(2908)
    random_values = rng.random((4096, 3), dtype=np.float32)
    boundaries = np.array(
        [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float32,
    )
    source = np.concatenate((boundaries, random_values), axis=0)
    np.testing.assert_array_equal(compress_to_srgb_gamut(source), source)


@pytest.mark.parametrize(
    "source",
    [
        [-0.25, 0.3, 0.8],
        [1.001, 0.5, 0.3],
        [3.947, 1.087, 1.346],
        [0.05, 0.2, 3.0],
        [2.0, 2.0, 2.0],
        [-0.5, -0.5, -0.5],
    ],
)
def test_out_of_gamut_values_map_to_finite_legal_rgb(source: list[float]) -> None:
    result = compress_to_srgb_gamut(np.array([source], dtype=np.float32))
    assert result.dtype == np.float32
    assert np.all(np.isfinite(result))
    assert float(result.min()) >= 0.0
    assert float(result.max()) <= 1.0


def test_chromatic_mapping_preserves_oklch_hue() -> None:
    source = np.array(
        [
            [-0.25, 0.3, 0.8],
            [1.4, 0.2, 0.05],
            [0.05, 1.25, 0.3],
            [0.05, 0.2, 3.0],
            [3.947, 1.087, 1.346],
        ],
        dtype=np.float32,
    )
    before = linear_srgb_to_oklab(source)
    after = linear_srgb_to_oklab(compress_to_srgb_gamut(source))
    chroma = np.hypot(after[:, 1], after[:, 2])
    chromatic = chroma >= CHROMA_EPS
    assert np.count_nonzero(chromatic) == 4
    assert float(np.max(_hue_difference(_hue_degrees(before[chromatic]), _hue_degrees(after[chromatic])))) <= 0.02


def test_mild_out_of_gamut_intrusions_preserve_oklab_lightness() -> None:
    legal = np.array(
        [[1.0, 0.2, 0.1], [0.2, 1.0, 0.3], [0.1, 0.2, 1.0], [0.0, 0.4, 0.7]],
        dtype=np.float32,
    )
    intruded = legal.copy()
    intruded[0, 0] += np.float32(0.001)
    intruded[1, 1] += np.float32(0.001)
    intruded[2, 2] += np.float32(0.001)
    intruded[3, 0] -= np.float32(0.001)
    before = linear_srgb_to_oklab(intruded)[:, 0]
    after = linear_srgb_to_oklab(compress_to_srgb_gamut(intruded))[:, 0]
    assert float(np.max(np.abs(after - before))) <= 0.005


def test_cusp_estimate_matches_dense_float64_boundary_oracle() -> None:
    # The oracle searches the complete (L,C) slice and does not assume a
    # two-line wedge, including dense samples around the blue vertex.
    hues = np.concatenate(
        (
            np.linspace(-np.pi, np.pi, 96, endpoint=False),
            np.linspace(np.deg2rad(-120.0), np.deg2rad(-80.0), 81),
        )
    )
    aa = np.cos(hues).astype(np.float32)
    bb = np.sin(hues).astype(np.float32)
    cusp_lightness, cusp_chroma = _find_cusp(aa, bb)

    # At the analytic cusp, one lower channel and one upper channel should
    # meet the cube to float32 residue precision.
    cusp_rgb = oklab_to_linear_srgb(
        np.stack((cusp_lightness, cusp_chroma * aa, cusp_chroma * bb), axis=-1)
    )
    assert float(np.max(np.maximum(-cusp_rgb, cusp_rgb - 1.0))) <= float(GAMUT_EPS)
    assert float(np.max(np.min(np.abs(np.stack((cusp_rgb, cusp_rgb - 1.0), axis=-1)), axis=(1, 2)))) <= 2e-4


def test_dense_edges_neutrals_and_blue_vertex_are_continuous_and_legal() -> None:
    neutral = np.linspace(-0.1, 1.1, 2001, dtype=np.float32)
    neutral_rgb = np.repeat(neutral[:, None], 3, axis=1)
    blue_edge = np.stack(
        (
            np.linspace(-0.002, 0.002, 2001, dtype=np.float32),
            np.zeros(2001, dtype=np.float32),
            np.ones(2001, dtype=np.float32),
        ),
        axis=-1,
    )
    sectors = np.stack(
        (
            np.full(4096, 1.25, dtype=np.float32),
            np.linspace(-0.1, 1.1, 4096, dtype=np.float32),
            np.linspace(1.1, -0.1, 4096, dtype=np.float32),
        ),
        axis=-1,
    )
    for source in (neutral_rgb, blue_edge, sectors):
        result = compress_to_srgb_gamut(source)
        assert np.all(np.isfinite(result))
        assert float(result.min()) >= 0.0
        assert float(result.max()) <= 1.0
    assert float(np.max(np.abs(np.diff(compress_to_srgb_gamut(neutral_rgb), axis=0)))) < 0.01
    assert float(np.max(np.abs(np.diff(compress_to_srgb_gamut(sectors), axis=0)))) < 0.01
    # The sRGB cube has a real non-convex constant-OKLab-hue notch at the blue
    # vertex. The residue-sized neighborhood must nevertheless be smooth.
    blue_residue = blue_edge[np.abs(blue_edge[:, 0]) <= float(GAMUT_EPS)]
    assert float(np.max(np.abs(np.diff(compress_to_srgb_gamut(blue_residue), axis=0)))) < 0.01


def test_production_alpha_is_from_declared_sweep() -> None:
    assert float(SDR_GAMUT_ALPHA) in {0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0}


def test_highlight_policy_constants_are_float32_and_corpus_selected() -> None:
    assert SDR_GAMUT_HIGHLIGHT_START.dtype == np.dtype(np.float32)
    assert SDR_GAMUT_HIGHLIGHT_ALPHA.dtype == np.dtype(np.float32)
    assert float(SDR_GAMUT_HIGHLIGHT_START) == pytest.approx(0.85)
    assert float(SDR_GAMUT_HIGHLIGHT_ALPHA) == pytest.approx(0.05)
    assert float(SDR_GAMUT_LOW_SAT_HIGHLIGHT_START) == pytest.approx(0.70)
    assert float(SDR_GAMUT_SATURATION_LOW) == pytest.approx(0.08)
    assert float(SDR_GAMUT_SATURATION_HIGH) == pytest.approx(0.20)


def test_positive_exposure_drives_upper_highlights_toward_white() -> None:
    # Increasing exposure must not pin a bright chromatic source to a pastel
    # gamut edge.  The upper-highlight policy progressively gives up chroma
    # while retaining the source hue until it becomes powerless near white.
    base = np.array([1.0, 0.24, 0.055], dtype=np.float32)
    stops = np.array([0.75, 1.5, 3.0, 5.0], dtype=np.float32)
    source = base[None, :] * np.exp2(stops)[:, None]
    mapped_lab = linear_srgb_to_oklab(compress_to_srgb_gamut(source))
    mapped_chroma = np.hypot(mapped_lab[:, 1], mapped_lab[:, 2])
    assert np.all(np.diff(mapped_chroma) < 0.0)
    assert np.all(np.diff(mapped_lab[:, 0]) > 0.0)
    assert float(mapped_chroma[-1]) < 0.02


def test_low_saturation_upper_highlights_prefer_neutral_axis() -> None:
    # At the same near-white lightness, a weakly chromatic excursion should
    # preserve more lightness and less chroma than a saturated one. This
    # prevents pale clipped boundaries from becoming colored rings without
    # desaturating genuinely colorful fire or skin.
    lightness = np.float32(0.93)
    hue = np.deg2rad(np.float32(-110.0))
    chroma = np.array([0.055, 0.24], dtype=np.float32)
    source_lab = np.stack(
        (
            np.full(2, lightness, dtype=np.float32),
            chroma * np.cos(hue),
            chroma * np.sin(hue),
        ),
        axis=-1,
    )
    source = oklab_to_linear_srgb(source_lab)
    assert np.all(np.any((source < 0.0) | (source > 1.0), axis=-1))
    mapped_lab = linear_srgb_to_oklab(compress_to_srgb_gamut(source))
    mapped_chroma = np.hypot(mapped_lab[:, 1], mapped_lab[:, 2])
    assert abs(float(mapped_lab[0, 0] - lightness)) < abs(float(mapped_lab[1, 0] - lightness))
    assert float(mapped_chroma[0]) < 0.04
    assert float(mapped_chroma[1]) > 0.08
