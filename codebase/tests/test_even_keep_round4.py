"""Output checks for the standalone Round 4 Denoise experiments."""
import cv2
import numpy as np

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates import canon_ladder, colour_speck
from tools.denoise_eval.candidates import even_keep_round4 as round4
from tools.denoise_eval.marking_page import CONTROLS

MODEL = adaptive.AdaptiveNoiseModel(
    a=0, b=4e-6, c=0,
    band_sigmas=((.6, .4, .22, .13, .08),) * 3,
)


def test_even_keep_matches_production_at_zero_and_local_mean_without_energy_matching():
    rgb = np.random.default_rng(1).normal(.003, .002, (142, 146, 3)).astype(np.float32)
    baseline = adaptive.resolve_adaptive(rgb, MODEL, CONTROLS)
    np.testing.assert_array_equal(round4.resolve(rgb, MODEL, 0), baseline)
    comparand = canon_ladder.Trial("even", "brightness", 2)
    calibration = {(level, 18): (np.ones(3, np.float32), np.zeros(3, np.float32))
                   for level in canon_ladder.BANDS}
    original_local = canon_ladder.resolve(rgb, baseline, MODEL, comparand, calibration)
    fast = round4.resolve(rgb, MODEL, 18)
    np.testing.assert_allclose(fast, original_local, atol=2e-8, rtol=2e-6)
    np.testing.assert_allclose(fast @ adaptive.OPPONENT[1:].T,
                               baseline @ adaptive.OPPONENT[1:].T, atol=2e-8, rtol=2e-6)


def test_energy_matched_brightness_agrees_with_the_original_18_pixel_ladder():
    rng = np.random.default_rng(42)
    rgb = rng.normal(.004, .002, (144, 146, 3)).astype(np.float32)
    rgb[:, 70:80] += .02
    today = adaptive.resolve_adaptive(rgb, MODEL, CONTROLS)
    comparand = canon_ladder.Trial("even", "brightness", 2)
    old_match = canon_ladder.even_calibration(rgb, MODEL)
    expect = canon_ladder.resolve(rgb, today, MODEL, comparand, old_match)
    match = round4.calibrate_brightness(rgb, MODEL, round4.DISTANCES)
    result = round4.resolve(rgb, MODEL, 18, calibration=match)
    np.testing.assert_allclose(result, expect, atol=2e-8, rtol=2e-6)


def test_grain_weighted_keep_stays_finite_next_to_flat_bands():
    rgb = np.full((129, 136, 3), .125, np.float32)
    rgb[39:45, 54:61] = .33
    result = round4.resolve(rgb, MODEL, 18, True)
    assert np.isfinite(result).all()
    np.testing.assert_allclose(result[120, 120], rgb[120, 120], atol=2e-7)


def synthetic_hues():
    degree = np.full((121, 123), 135, np.float32)
    degree[:, 61:] = 150
    degree[60, 58:61] = (270, 125, 135)
    chroma = np.full_like(degree, .004)
    sigma = np.full_like(chroma, .0013)
    return degree, chroma, sigma


def test_hue_range_chooses_a_close_edge_and_leaves_supported_hues_alone():
    degree, chroma, sigma = synthetic_hues()
    toward, typical = round4.nearest_local_hue(degree, chroma, sigma)
    assert -121 < toward[60, 58] < -100
    assert 1 < toward[60, 59] < 6
    assert toward[60, 60] == 0
    assert typical[60, 58] > 0


def test_colour_pass_moves_a_green_island_but_keeps_luminance_and_real_colour():
    degree, chroma, _ = synthetic_hues()
    degree[58:63, 59:64] = 270
    degree[60, 58] = 135
    phase = degree * np.float32(np.pi/180)
    axes = chroma[..., None] * np.stack((np.cos(phase), np.sin(phase)), axis=-1)
    rgb = .05 + axes @ colour_speck.CHROMA_RGB
    fixed = round4.clean_colour(rgb, MODEL, "hue", 1)
    output_axes = fixed @ adaptive.OPPONENT[1:].T
    after_hue = cv2.phase(*cv2.split(output_axes), angleInDegrees=True)
    assert 142 < after_hue[60, 61] < 157
    np.testing.assert_array_equal(fixed[25, 80], rgb[25, 80])
    np.testing.assert_allclose(fixed @ adaptive.ACESCG_LUMINANCE,
                               rgb @ adaptive.ACESCG_LUMINANCE, atol=1e-8)


def test_dark_pass_lifts_a_clump_interior_and_leaves_the_rim_and_large_shape():
    rng = np.random.default_rng(21)
    field = (np.full((130, 132), .05) + rng.normal(0, .00036, (130, 132))).astype(np.float32)
    field[56:62, 57:63] -= .004
    field[70:115, 78:121] -= .004
    rgb = np.repeat(field[..., None], 3, axis=-1)
    edges = adaptive._Edges(True, True, True, True, *field.shape)
    centre = round4.break_dark(rgb, MODEL, edges, "centre", 1)
    medium = round4.break_dark(rgb, MODEL, edges, "medium", 1)
    for image in (centre, medium):
        assert image[59, 60, 0] - field[59, 60] > .0007
        assert image[90, 91, 0] == field[90, 91]
        assert image[55, 55, 0] == field[55, 55]
        np.testing.assert_array_equal(image[..., 0], image[..., 1])


def test_post_passes_keep_the_same_pixels_across_tile_boundaries():
    rng = np.random.default_rng(4)
    rgb = rng.normal(.05, .0012, (191, 194, 3)).astype(np.float32)
    rgb[95:100, 96:101] -= .0035
    rgb[86:91, 94:98] += np.array([-.003, .003, -.003], np.float32)
    for mode in ("hue", "local", "balance"):
        direct = round4.clean_colour(rgb, MODEL, mode, 1)
        tiled = colour_speck.tiled(rgb, round4.COLOUR_HALO,
                                   lambda tile, _rect, _edges: round4.clean_colour(tile, MODEL, mode, 1),
                                   tile=97)
        np.testing.assert_allclose(tiled, direct, atol=2e-7)
    for mode in ("centre", "medium"):
        edges = adaptive._Edges(True, True, True, True, *rgb.shape[:2])
        direct = round4.break_dark(rgb, MODEL, edges, mode, 1)
        tiled = colour_speck.tiled(rgb, round4.SHADOW_HALO,
                                   lambda tile, _rect, boundary: round4.break_dark(
                                       tile, MODEL, boundary, mode, 1), tile=97)
        np.testing.assert_allclose(tiled, direct, atol=2e-7)
