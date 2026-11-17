"""Behavioural regression cases for the isolated dark-noise research adapters."""
from dataclasses import replace

import numpy as np
import pytest

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval import metrics
from tools.denoise_eval.adapters import tiled
from tools.denoise_eval.candidates import dark_noise


def plateau_fixture(signal=.01):
    image = np.random.default_rng(904).normal(signal, .005, (256, 256, 3)).astype('float32')
    image[:, :112] = 1.25
    return image


@pytest.mark.parametrize('signal', [.01, .0002])
def test_censored_plateau_does_not_define_the_noise_of_its_dark_neighbour(signal):
    image = plateau_fixture(signal)
    original = image.copy()
    adapter = dark_noise.factory()
    state = adapter.prepare(image, {})
    current = adaptive.resolve_adaptive(image, adaptive.estimate_adaptive_model(image, workers=1))
    repaired = adapter.process(image, {}, state)
    interior = np.s_[32:-32, 176:-32]
    before = np.std(image[interior] @ adaptive.OPPONENT.T, axis=(0, 1))
    after = np.std(repaired[interior] @ adaptive.OPPONENT.T, axis=(0, 1))
    assert state[1]['informative_blocks'] < state[1]['blocks']
    assert np.max(after / before) < .5
    assert np.std(repaired[interior]) < np.std(current[interior])
    np.testing.assert_array_equal(image, original)


@pytest.mark.parametrize('factory', [dark_noise.factory, dark_noise.calibration_only, dark_noise.independent])
def test_research_keeps_bypass_alpha_zero_strength_and_signed_hdr(factory):
    image = np.empty((96, 96, 4), 'float32')
    image[..., :3] = [-.125, 1.5, 8.]
    image[..., 3] = np.linspace(0, 1, 96)[None, :]
    adapter = factory()
    state = adapter.prepare(image, {})
    output = adapter.process(image, {}, state)
    np.testing.assert_array_equal(output[..., 3], image[..., 3])
    np.testing.assert_allclose(output[..., :3], image[..., :3], atol=3e-6)
    np.testing.assert_array_equal(adapter.process(image, {}, state, bypass=True), image)
    adapter.controls = replace(adapter.controls, amount=0)
    np.testing.assert_array_equal(adapter.process(image, {}, state), image)
    adapter.controls = replace(adapter.controls, amount=.75, luminance=0, color_noise=0)
    np.testing.assert_array_equal(adapter.process(image, {}, state), image)


@pytest.mark.parametrize('factory', [dark_noise.factory, dark_noise.independent])
def test_same_preparation_survives_shifted_haloed_tiles(factory):
    image = plateau_fixture()
    adapter = factory()
    state = adapter.prepare(image, {})
    whole = adapter.process(image, {}, state)
    independent_tiles = tiled(adapter, image, {}, state, shift=31, tile=96)
    for lane in ('sdr', 'hdr'):
        difference = metrics.summary(metrics.colour_error(whole, independent_tiles, lane))
        assert difference['mean'] < 1
        assert difference['p99'] < 3


@pytest.mark.parametrize('scale', [1 / 64, 64])
def test_censored_calibration_is_exposure_covariant(scale):
    image = plateau_fixture()
    adapter = dark_noise.factory()
    prepared = adapter.prepare(image, {})
    expected = adapter.process(image, {}, prepared)
    scaled = image * np.float32(scale)
    actual = adapter.process(scaled, {}, adapter.prepare(scaled, {})) / scale
    for lane in ('sdr', 'hdr'):
        difference = metrics.summary(metrics.colour_error(expected, actual, lane))
        assert difference['mean'] < 1
        assert difference['p99'] < 3


def test_calibration_only_does_not_change_a_noncensored_model():
    image = np.random.default_rng(44).normal(.1, .003, (192, 192, 3)).astype('float32')
    original = adaptive.estimate_adaptive_model(image, workers=1)
    repaired, details = dark_noise.prepare_informative(image, stable_shape=False)
    assert details['informative_blocks'] == details['blocks']
    np.testing.assert_allclose(repaired.band_sigmas, original.band_sigmas, rtol=1e-6)


def test_signed_bayer_adapter_matches_direct_signed_rgb_processing():
    from tools.denoise_eval.candidates.signed_shadows import develop_signed
    sensor = np.random.default_rng(92).normal(.0002, .004, (96, 96)).astype('float32')
    metadata = dict(cfa=[[0, 1], [1, 2]], white_balance=[1, 1, 1],
                    camera_to_acescg=np.eye(3).tolist(), exposure_stops=0)
    rgb = develop_signed(sensor, metadata)
    assert rgb.min() < 0
    direct = dark_noise.factory()
    expected = direct.process(rgb, metadata, direct.prepare(rgb, metadata))
    wrapped = dark_noise.signed()
    actual = wrapped.process(sensor, metadata, wrapped.prepare(sensor, metadata))
    np.testing.assert_array_equal(actual, expected)
