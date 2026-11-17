import numpy as np
import pytest
import json

from tools.denoise_eval.candidates import demosaic_noise as trial
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault


def metadata(pattern=None):
    return dict(cfa=[[0, 1], [1, 2]] if pattern is None else pattern,
                white_balance=[1, 1, 1], camera_to_acescg=np.eye(3).tolist(),
                noise_parameters=[dict(a=.001, b=.00004)] * 4)


@pytest.mark.parametrize('pattern', [[[0, 1], [1, 2]], [[2, 1], [1, 0]],
                                     [[1, 0], [2, 1]], [[1, 2], [0, 1]]])
@pytest.mark.parametrize('method', ['bilinear', 'lmmse'])
def test_constant_signed_planes_and_measured_samples(pattern, method):
    sensor = np.empty((65, 66), np.float32)
    values = [-.02, .07, 1.3]
    for row_phase in range(2):
        for column_phase in range(2):
            sensor[row_phase::2, column_phase::2] = values[pattern[row_phase][column_phase]]
    result = trial.camera_linear(sensor, pattern, method)
    np.testing.assert_allclose(result[12:-12, 12:-12], np.broadcast_to(values, (41, 42, 3)), atol=2e-7)
    for row_phase in range(2):
        for column_phase in range(2):
            component = pattern[row_phase][column_phase]
            np.testing.assert_array_equal(result[row_phase::2, column_phase::2, component],
                                          sensor[row_phase::2, column_phase::2])


def test_signed_stabilizer_is_invertible_and_continuous():
    values = np.array([-.3, -.00001, 0, .00001, .2, 2], np.float32)
    for shot in (0, .001, .1):
        transformed = trial.stabilize(values, shot, .00004)
        assert np.all(np.diff(transformed) > 0)
        np.testing.assert_allclose(trial.unstabilize(transformed, shot, .00004), values, atol=3e-7)


@pytest.mark.parametrize('method', ['bilinear', 'lmmse'])
def test_random_measured_sensor_sites_are_not_replaced(method):
    sensor = np.random.default_rng(80).normal(.02, .04, (64, 66)).astype('float32')
    pattern = metadata()['cfa']
    result = trial.camera_linear(sensor, pattern, method)
    for row_phase in range(2):
        for column_phase in range(2):
            np.testing.assert_array_equal(result[row_phase::2, column_phase::2, pattern[row_phase][column_phase]],
                                          sensor[row_phase::2, column_phase::2])


def test_raw_smoothing_zero_identity_and_flat_noise_reduction():
    sensor = np.random.default_rng(21).normal(-.02, .006, (128, 128)).astype('float32')
    info = metadata()
    np.testing.assert_array_equal(trial.raw_smooth(sensor, info, 0), sensor)
    result = trial.raw_smooth(sensor, info)
    assert result.std() < sensor.std()
    assert abs(float(result.mean() - sensor.mean())) < .0001
    assert np.any(result < 0)


@pytest.mark.parametrize('method', ['bilinear', 'lmmse'])
def test_independent_strip_development_matches_whole(method):
    sensor = np.random.default_rng(24).normal(.1, .02, (192, 66)).astype('float32')
    np.testing.assert_allclose(trial.develop(sensor, metadata(), method, rows=32),
                               trial.develop(sensor, metadata(), method, rows=256), atol=1e-7)


def test_raw_filter_tile_interior_matches_whole():
    sensor = np.random.default_rng(25).normal(.03, .02, (192, 192)).astype('float32')
    whole = trial.develop(sensor, metadata(), 'lmmse', .65)
    tile = trial.develop(sensor[32:160, 32:160], metadata(), 'lmmse', .65)
    np.testing.assert_allclose(whole[64:128, 64:128], tile[32:96, 32:96], atol=1e-7)


def test_adapter_keeps_shipping_controls_and_finite_result():
    sensor = np.random.default_rng(20).normal(.04, .01, (64, 64)).astype('float32')
    for adapter in (trial.bilinear(), trial.lmmse_fix(), trial.raw_ahd(), trial.raw_lmmse_fix()):
        assert adapter.current.controls == AppDefault().controls
        state = adapter.prepare(sensor, metadata())
        result = adapter.process(sensor, metadata(), state)
        assert result.shape == (64, 64, 3)
        assert np.isfinite(result).all()
        with pytest.raises(ValueError, match='upstream'):
            adapter.process(sensor, metadata(), state, bypass=True)


def test_uncalibrated_raw_smoothing_is_refused():
    with pytest.raises(ValueError, match='four provisional'):
        trial.raw_smooth(np.zeros((32, 32), np.float32), dict(cfa=[[0, 1], [1, 2]]))


@pytest.mark.parametrize('sensor,pattern', [(np.full((32, 32), np.nan), [[0, 1], [1, 2]]),
                                            (np.zeros((32, 32)), [[0, 1], [2, 2]])])
def test_invalid_sensor_input_is_rejected(sensor, pattern):
    with pytest.raises(ValueError):
        trial.camera_linear(sensor, pattern)


def test_review_deduplicates_identical_pngs_without_changing_pixels(tmp_path, monkeypatch):
    from tools.denoise_eval.candidates import demosaic_measure
    monkeypatch.setattr(demosaic_measure, 'OUTPUT', tmp_path)
    folder = tmp_path / 'decision' / 'test-row'
    folder.mkdir(parents=True)
    pixels = np.zeros((288, 288, 3), np.uint8)
    for name in ('current', 'current_fix'):
        demosaic_measure.decision_crops.save_png(pixels, folder / (name+'.png'))
    manifest = dict(cases=[dict(id='test-row', title='Signed test')])
    demosaic_measure.write(tmp_path / 'decision/manifest.json', manifest)
    demosaic_measure.review(['current', 'current_fix'])
    record = json.loads((tmp_path / 'decision/manifest.json').read_text())['cases'][0]
    assert record['images']['current'] == record['images']['current_fix']
    assert len(list(folder.glob('*.png'))) == 1
    demosaic_measure.review(['current', 'current_fix'])
    assert len(list(folder.glob('*.png'))) == 1
