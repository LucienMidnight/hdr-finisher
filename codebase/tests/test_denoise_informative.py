"""Shipping measurement rejects censored evidence without changing reconstruction."""
import numpy as np
import pytest

from hdr_finisher import denoise_adaptive as adaptive


def plateau(signal=.01):
    image = np.random.default_rng(904).normal(signal, .005, (256, 256, 3)).astype(np.float32)
    image[:, :112] = 1.25
    return image


@pytest.mark.parametrize("signal", [.01, .0002])
def test_clipped_flame_does_not_hide_shadow_noise(signal):
    image = plateau(signal)
    original = image.copy()
    model = adaptive.estimate_adaptive_model(image, workers=1)
    shadow = image[32:-32, 176:-32]
    shadow_model = adaptive.estimate_adaptive_model(shadow, workers=1)
    edges = adaptive._Edges(True, True, True, True, *shadow.shape[:2])
    sigma = np.sqrt(adaptive._noise_variance(shadow @ adaptive.ACESCG_LUMINANCE, model, edges))
    reference = np.sqrt(adaptive._noise_variance(shadow @ adaptive.ACESCG_LUMINANCE, shadow_model, edges))
    predicted = np.median(sigma) * np.asarray(model.band_sigmas)[:, 0]
    expected = np.median(reference) * np.asarray(shadow_model.band_sigmas)[:, 0]
    np.testing.assert_allclose(predicted, expected, rtol=.10)
    output = adaptive.resolve_adaptive(image, model)[32:-32, 176:-32]
    assert np.max(np.std(output, axis=(0, 1)) / np.std(shadow, axis=(0, 1))) < .5
    np.testing.assert_array_equal(image, original)


def test_ordinary_noise_model_matches_previous_estimator():
    image = np.random.default_rng(44).normal(.1, .003, (192, 192, 3)).astype(np.float32)
    previous, _ = adaptive._measure_model(image, informative=False)
    current, _ = adaptive._measure_model(image)
    np.testing.assert_allclose([current.a, current.b, current.c], [previous.a, previous.b, previous.c], rtol=.001, atol=1e-12)
    np.testing.assert_allclose(current.band_sigmas, previous.band_sigmas, rtol=.001)


@pytest.mark.parametrize("image", [np.full((128, 128, 3), 1.25, dtype=np.float32),
                                  np.zeros((128, 128, 3), dtype=np.float32),
                                  np.concatenate((np.zeros((128, 64, 3)), np.full((128, 64, 3), 1.25)), axis=1).astype(np.float32)])
def test_noiseless_flats_use_previous_estimation_without_recursion(image):
    observations, eligible = adaptive._variance_observations(image, adaptive._sample_tiles(*image.shape[:2]))
    assert not eligible.any()
    assert adaptive._fit_informative_variance(observations) is None
    model, _ = adaptive._measure_model(image)
    previous, _ = adaptive._measure_model(image, informative=False)
    assert model == previous
    np.testing.assert_allclose(adaptive.resolve_adaptive(image, model), image, atol=1e-6)


def test_too_few_informative_blocks_fall_back_together():
    image = np.full((128, 128, 3), 1.25, dtype=np.float32)
    image[32:48, 32:48] = np.random.default_rng(7).normal(.01, .005, (16, 16, 3))
    _, eligible = adaptive._variance_observations(image, adaptive._sample_tiles(*image.shape[:2]))
    assert 0 < eligible.sum() < adaptive.CALIBRATION_RULES["min_blocks"]
    model, _ = adaptive._measure_model(image)
    assert model == adaptive._measure_model(image, informative=False)[0]


@pytest.mark.parametrize("scale", [1/64, 1, 64])
def test_informative_fit_is_scaled_and_rejects_zero_bins(scale):
    rows = [dict(signal=signal*scale, variance=(.003*signal+2e-6)*scale**2,
                 pixels=1000, zero_fraction=0.) for signal in (.001, .003, .01, .03, .1)]
    rows.append(dict(signal=1.25*scale, variance=0., pixels=1000, zero_fraction=1.))
    assert adaptive._fit_informative_variance(rows) == pytest.approx((.003*scale, 2e-6*scale**2, 0.), rel=1e-8, abs=1e-14)
