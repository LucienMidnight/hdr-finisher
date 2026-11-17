import numpy as np
import pytest

from tools.denoise_eval.candidates import lmmse_demosaic as trial
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault


PATTERNS = [[[0, 1], [1, 2]], [[2, 1], [1, 0]], [[1, 0], [2, 1]], [[1, 2], [0, 1]]]


def metadata(pattern=PATTERNS[0]):
    return dict(cfa=pattern, white_balance=[1, 1, 1], camera_to_acescg=np.eye(3).tolist())


@pytest.mark.parametrize('pattern', PATTERNS)
@pytest.mark.parametrize('level', [-.02, .02, .4, 1.2])
def test_signed_constant_neutral_is_preserved(pattern, level):
    sensor = np.full((81, 83), level, np.float32)
    actual = trial.camera_lmmse(sensor, pattern)
    np.testing.assert_allclose(actual[32:-32, 32:-32], level, atol=3e-6)


@pytest.mark.parametrize('iterations', [0, 1, 2, 3, 4])
def test_independent_strip_seams_match_whole(iterations):
    sensor = np.random.default_rng(20261117).normal(.02, .04, (194, 85)).astype('float32')
    strips = trial.camera_lmmse(sensor, PATTERNS[0], iterations=iterations, rows=32)
    whole = trial.camera_lmmse(sensor, PATTERNS[0], iterations=iterations, rows=None)
    np.testing.assert_array_equal(strips, whole)


@pytest.mark.parametrize('pattern', PATTERNS)
def test_unfiltered_lmmse_retains_signed_measured_sites(pattern):
    sensor = np.random.default_rng(17).normal(.02, .03, (65, 67)).astype('float32')
    result = trial.camera_lmmse(sensor, pattern, iterations=1)
    for row_phase in range(2):
        for column_phase in range(2):
            component = pattern[row_phase][column_phase]
            np.testing.assert_allclose(result[row_phase::2, column_phase::2, component],
                                       sensor[row_phase::2, column_phase::2], atol=1e-8)


def test_stock_control_clips_signed_sensor_and_signed_extension_does_not():
    sensor = np.full((80, 80), -.01, np.float32)
    stock = trial.camera_lmmse(sensor, PATTERNS[0], signed=False)
    signed = trial.camera_lmmse(sensor, PATTERNS[0])
    np.testing.assert_array_equal(stock, 0)
    assert np.max(signed[24:-24, 24:-24]) < -.009


def test_stock_and_signed_agree_when_range_gates_inactive():
    sensor = np.random.default_rng(1).uniform(.15, .2, (80, 80)).astype('float32')
    stock = trial.camera_lmmse(sensor, PATTERNS[0], signed=False)
    signed = trial.camera_lmmse(sensor, PATTERNS[0])
    np.testing.assert_array_equal(stock[24:-24, 24:-24], signed[24:-24, 24:-24])


@pytest.mark.parametrize('iterations', [0, 1, 2, 3, 4, 5, 6, 7, 8])
def test_stock_mode_matches_separately_compiled_unmodified_upstream_body(iterations):
    sensor = np.random.default_rng(73).uniform(-.04, 1.04, (65, 67)).astype('float32')
    for pattern in PATTERNS:
        actual = trial.camera_lmmse(sensor, pattern, iterations=iterations, signed=False, rows=None)
        original = trial.camera_lmmse(sensor, pattern, iterations=iterations, signed=False,
                                      rows=None, upstream_control=True)
        np.testing.assert_array_equal(actual, original)


def test_research_ahd_bridge_uses_installed_production_core():
    from hdr_finisher.signed_raw import demosaic
    sensor = np.full((80, 80), 512, np.uint16)
    sensor[32:48, 32:48] = 2048
    normalized = (sensor.astype('float32') - 1024) / np.float32(65535)
    expected = demosaic(sensor, PATTERNS[0], np.full((2, 2), 1024), np.eye(3)) / np.float32(65535)
    actual = trial.develop_ahd(normalized, metadata())
    np.testing.assert_allclose(actual, expected, atol=1e-9)


def test_exposure_applies_once_and_controls_stay_shipping():
    sensor = np.random.default_rng(2).normal(.06, .01, (80, 80)).astype('float32')
    plain = trial.develop(sensor, metadata())
    bright = trial.develop(sensor, dict(metadata(), exposure_stops=6))
    np.testing.assert_array_equal(bright, plain * 64)
    adapter = trial.factory()
    assert adapter.current.controls == AppDefault().controls
    state = adapter.prepare(sensor, metadata())
    actual = adapter.process(sensor, metadata(), state)
    assert actual.shape == plain.shape and np.isfinite(actual).all()
    with pytest.raises(ValueError):
        adapter.process(sensor, metadata(), state, bypass=True)


@pytest.mark.parametrize('sensor,pattern,options', [
    (np.zeros((8, 32)), PATTERNS[0], {}),
    (np.full((32, 32), np.nan), PATTERNS[0], {}),
    (np.full((32, 32), 3), PATTERNS[0], {}),
    (np.zeros((32, 32)), [[0, 0], [1, 2]], {}),
    (np.zeros((32, 32)), PATTERNS[0], dict(rows=31)),
    (np.zeros((32, 32)), PATTERNS[0], dict(iterations=9)),
    (np.zeros((32, 32)), PATTERNS[0], dict(iterations=5)),
])
def test_invalid_sensor_or_configuration_refuses(sensor, pattern, options):
    with pytest.raises(ValueError):
        trial.camera_lmmse(sensor, pattern, **options)
