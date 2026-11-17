import numpy as np
import pytest

from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.signed_shadows import (
    alone, camera_ahd, develop_pedestal, develop_signed, with_denoise,
)
from tools.denoise_eval.inputs import develop


def metadata():
    return dict(cfa=[[0, 1], [1, 2]], white_balance=[1, 1, 1],
                camera_to_acescg=np.eye(3).tolist(), exposure_stops=0)


@pytest.mark.parametrize('cfa', [[[0, 1], [1, 2]], [[1, 0], [2, 1]],
                                [[1, 2], [0, 1]], [[2, 1], [1, 0]]])
def test_signed_sensor_samples_survive_all_bayer_phases(cfa):
    sensor = np.random.default_rng(12).normal(0, .002, (64, 64)).astype('float32')
    result = camera_ahd(sensor, cfa)
    for row in range(2):
        for column in range(2):
            np.testing.assert_allclose(result[row::2, column::2, cfa[row][column]],
                                       np.rint(sensor[row::2, column::2] * 65535) / 65535,
                                       atol=1e-8, rtol=0)
    assert result.min() < 0
    assert camera_ahd(sensor, cfa, clipped=True).min() >= 0


@pytest.mark.parametrize('level', [-.01, -.001, 0., .001, .1, .9])
def test_constant_signed_field_preserves_black_and_colour(level):
    sensor = np.full((64, 64), level, 'float32')
    output = camera_ahd(sensor, metadata()['cfa'])
    np.testing.assert_allclose(output, np.rint(level * 65535) / 65535, atol=1e-7, rtol=0)


def test_strips_equal_whole_context_without_internal_seams():
    sensor = np.random.default_rng(123).normal(.002, .002, (100, 80)).astype('float32')
    np.testing.assert_array_equal(camera_ahd(sensor, metadata()['cfa'], rows=16),
                                  camera_ahd(sensor, metadata()['cfa'], rows=256))


def test_signed_changes_only_lower_sensor_bound_not_the_highlight_transport_limit():
    sensor = np.full((32, 32), 1.5, 'float32')
    np.testing.assert_array_equal(camera_ahd(sensor, metadata()['cfa']),
                                  camera_ahd(sensor, metadata()['cfa'], clipped=True))
    assert camera_ahd(sensor, metadata()['cfa']).max() == 1


def test_clipped_control_matches_libraw_interior_within_quantisation():
    sensor = np.random.default_rng(3).uniform(.01, .8, (64, 64)).astype('float32')
    reference = develop(sensor, metadata())[12:-12, 12:-12]
    control = develop_signed(sensor, metadata(), clipped=True)[12:-12, 12:-12]
    np.testing.assert_allclose(control, reference, atol=2 / 65535, rtol=0)


def test_pedestal_reverses_constant_offset_and_rejects_uncovered_negatives():
    sensor = np.full((64, 64), -.001, 'float32')
    np.testing.assert_allclose(develop_pedestal(sensor, metadata()), -.001, atol=2 / 65535, rtol=0)
    with pytest.raises(ValueError, match='cover'):
        develop_pedestal(sensor, metadata(), pedestal=.0001)


def test_adapter_runs_shipping_denoise_unchanged_and_exposure_once():
    sensor = np.random.default_rng(1).normal(.001, .001, (80, 80)).astype('float32')
    info = {**metadata(), 'exposure_stops': 4}
    adapter = with_denoise()
    state = adapter.prepare(sensor, info)
    reference = AppDefault()
    expected = reference.process(state.rgb, info, reference.prepare(state.rgb, info))
    np.testing.assert_array_equal(adapter.process(sensor, info, state), expected)
    np.testing.assert_array_equal(state.rgb, develop_signed(sensor, metadata()) * 16)
    disabled = alone()
    disabled_state = disabled.prepare(sensor, info)
    np.testing.assert_array_equal(disabled.process(sensor, info, disabled_state), state.rgb)


@pytest.mark.parametrize('sensor,cfa', [(np.full((32, 32), np.nan), [[0, 1], [1, 2]]),
                                      (np.ones((8, 8)), [[0, 1], [1, 2]]),
                                      (np.ones((32, 32)), [[0, 0], [1, 2]])])
def test_bad_inputs_are_rejected_not_silently_clipped(sensor, cfa):
    with pytest.raises(ValueError):
        camera_ahd(sensor, cfa)
