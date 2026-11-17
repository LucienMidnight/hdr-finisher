from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import raw_pixel_cleanup as hot, raw_speck_cleanup as specks
from hdr_finisher.models import RawImportSettings
from test_raw_pixel_cleanup import config, metadata


def test_soft_clamp_tames_both_signs_without_replacing_median():
    source = np.full((64, 64), -.002, np.float32)
    source[20, 20], source[40, 40] = .1, -.07
    actual = specks.filter_sensor(source, config())
    assert -.002 < actual[20, 20] < .1
    assert -.07 < actual[40, 40] < -.002
    assert np.count_nonzero(actual != source) == 2
    assert source[20, 20] == np.float32(.1)


def test_supported_gaussian_star_and_large_features_are_preserved():
    y, x = np.indices((64, 64))
    star = (.15 * np.exp(-((x - 32)**2 + (y - 32)**2) / (2 * 1.8**2))).astype(np.float32)
    np.testing.assert_array_equal(specks.filter_sensor(star, config()), star)
    source = np.zeros((64, 64), np.float32)
    source[30, 20:32:2] = .2
    np.testing.assert_array_equal(specks.filter_sensor(source, config()), source)
    source[:] = 0
    source[30, 30], source[30, 32], source[32, 30] = .1, .1, .1
    np.testing.assert_array_equal(specks.filter_sensor(source, config()), source)


def test_near_saturation_context_and_research_border_are_untouched():
    source = np.zeros((64, 64), np.float32)
    source[24, 24], source[24, 26], source[40, 40], source[6, 20] = .98, .1, 1.1, .2
    np.testing.assert_array_equal(specks.filter_sensor(source, config()), source)


@pytest.mark.parametrize('shape', [(531, 95), (530, 96), (19, 21), (5, 5)])
def test_strip_seams_equal_whole_sensor_with_component_and_mad_context(shape):
    settings = config()
    sensor = np.random.default_rng(5).integers(970, 1030, shape, dtype=np.uint16)
    for row in (10, 240, 250, 254, 256, 260, 270, 510):
        if row < shape[0] - 4:
            sensor[row, 20] = 7000
    if shape[0] > 280:
        sensor[242:278:2, 40] = 7000
    original = sensor.copy()
    normalized = hot._normalise(sensor, np.array(settings['black'], np.float32), np.array(settings['spans'], np.float32))
    expected = specks.filter_sensor(normalized, settings)
    changed = expected != normalized
    encoded = original.copy()
    encoded[changed] = np.clip(np.rint(expected[changed].astype(float) * 12000 + 1000), 0, 65535).astype(np.uint16)
    count = specks.apply(sensor, settings)
    np.testing.assert_array_equal(sensor, encoded)
    assert count == np.count_nonzero(original != encoded)


@pytest.mark.parametrize('hot_enabled', [False, True])
def test_new_option_off_is_bit_identical_to_previous_hot_path(monkeypatch, hot_enabled):
    settings = config()
    sensor = np.random.default_rng(4).integers(960, 1100, (68, 70), dtype=np.uint16)
    sensor[24, 24] = 7000
    previous = sensor.copy()
    if hot_enabled:
        hot.apply(previous, settings)
    monkeypatch.setattr(hot, 'configuration', lambda *a, **k: settings if hot_enabled else pytest.fail('Off estimated noise'))
    monkeypatch.setattr(specks, 'apply', lambda *a, **k: pytest.fail('Off ran clamp'))
    for payload in ({'remove_hot_pixels': hot_enabled}, {'remove_hot_pixels': hot_enabled, 'even_out_specks': False, 'speck_threshold': 4}):
        actual = sensor.copy()
        hot.apply_raw(SimpleNamespace(raw_image_visible=actual), metadata(), RawImportSettings(pixel_cleanup=payload))
        np.testing.assert_array_equal(actual, previous)
        from hdr_finisher.signed_raw import demosaic
        np.testing.assert_array_equal(demosaic(actual, [[0, 1], [1, 2]], np.full((2, 2), 1000), np.eye(3)),
                                      demosaic(previous, [[0, 1], [1, 2]], np.full((2, 2), 1000), np.eye(3)))


def test_cleanup_order_is_hot_then_specks(monkeypatch):
    observed = []
    monkeypatch.setattr(hot, 'configuration', lambda *a, **k: config())
    monkeypatch.setattr(hot, 'apply', lambda *a, **k: observed.append('hot') or 1)
    monkeypatch.setattr(specks, 'apply', lambda *a, **k: observed.append('specks') or 2)
    diagnostic = hot.apply_raw(SimpleNamespace(raw_image_visible=np.zeros((32, 32), np.uint16)), metadata(),
                              RawImportSettings(pixel_cleanup={'remove_hot_pixels': True, 'even_out_specks': True}))
    assert observed == ['hot', 'specks']
    assert diagnostic['repaired'] == 1 and diagnostic['tamed'] == 2


def test_invalid_metadata_and_cancelled_clamp():
    with pytest.raises(ValueError):
        specks.tame_plane(np.zeros((32, 32), np.float32), 0, 0)
    with pytest.raises(InterruptedError):
        specks.apply(np.full((32, 32), 1000, np.uint16), config(), cancelled=lambda: True)


def test_saved_fields_default_off_and_threshold_validation():
    import json
    from pydantic import ValidationError
    old = RawImportSettings.model_validate({'pixel_cleanup': {'remove_hot_pixels': True}})
    assert old.pixel_cleanup.remove_hot_pixels and not old.pixel_cleanup.even_out_specks
    assert old.pixel_cleanup.speck_threshold == 2.5
    for threshold in (2, 2.5, 4):
        settings = RawImportSettings(pixel_cleanup={'even_out_specks': True, 'speck_threshold': threshold})
        saved = RawImportSettings.model_validate(json.loads(settings.model_dump_json()))
        assert saved.pixel_cleanup.even_out_specks and saved.pixel_cleanup.speck_threshold == threshold
    for threshold in (1.9, 4.1, float('nan'), float('inf')):
        with pytest.raises(ValidationError):
            RawImportSettings(pixel_cleanup={'speck_threshold': threshold})


@pytest.mark.parametrize('enabled', [False, True])
@pytest.mark.parametrize('hot_enabled', [False, True])
def test_gpu_sensor_transport_equals_cpu_cleanup(tmp_path, monkeypatch, enabled, hot_enabled):
    from contextlib import nullcontext
    import rawpy
    from hdr_finisher import library_gpu_raw as gpu, raw_import
    sensor = np.random.default_rng(9).integers(970, 1030, (48, 50), dtype=np.uint16)
    sensor[20, 20], sensor[30, 30] = 7000, 200
    camera = metadata()
    camera.black_level = np.full(3, 1000)
    camera.white_level = np.full(3, 13000)
    camera.as_shot_wb = np.ones(3)
    camera.camera_to_acescg = np.eye(3)
    raw = SimpleNamespace(raw_image_visible=sensor, raw_colors_visible=camera.raw_pattern,
        sizes=SimpleNamespace(flip=0), open_file=lambda p: None, unpack=lambda: None)
    monkeypatch.setattr(rawpy, 'RawPy', lambda: nullcontext(raw))
    monkeypatch.setattr(raw_import, '_read_raw_exif', lambda p: ({}, None))
    monkeypatch.setattr(raw_import, '_read_libraw_metadata', lambda r: {})
    monkeypatch.setattr(raw_import, '_camera_linear_metadata_from_libraw', lambda r: camera)
    monkeypatch.setattr(raw_import, '_ahd_lab_matrix', lambda r: np.eye(3))
    monkeypatch.setattr(gpu, 'fuji_dynamic_range', lambda p: None)
    monkeypatch.setattr(gpu, '_lens_grid', lambda *a: None)
    monkeypatch.setattr(hot, 'configuration', lambda *a, **k: config())
    path = tmp_path / 'sensor.ARW'
    path.write_bytes(b'sensor fixture')
    controls = RawImportSettings(pixel_cleanup={'even_out_specks': enabled, 'remove_hot_pixels': hot_enabled})
    expected = sensor.copy()
    if enabled:
        hot.apply_raw(SimpleNamespace(raw_image_visible=expected), camera, controls)
    header, parts = gpu.sensor(path, controls)
    transported = np.frombuffer(parts[0], '<u2').reshape(sensor.shape)
    np.testing.assert_array_equal(transported, expected)
    np.testing.assert_array_equal(raw.raw_image_visible, sensor)
    assert header['pixel_cleanup_applied'] is enabled
    assert bool(header['pixel_cleanup']) is (hot_enabled and not enabled)


def test_absolute_floor_keeps_small_clean_deviations_but_not_large_specks():
    source = np.zeros((48, 48), np.float32)
    source[16, 16], source[30, 30] = .004, .02
    parameters = dict(noise=[dict(a=0, b=1e-8)] * 4, colours=[0, 1, 1, 2])
    without = specks.filter_sensor(source, parameters, absolute_floor=0)
    actual = specks.filter_sensor(source, parameters)
    assert without[16, 16] < source[16, 16] == actual[16, 16]
    assert actual[30, 30] == without[30, 30] < source[30, 30]


@pytest.mark.parametrize('sign', [-1, 1])
@pytest.mark.parametrize('distance', [2.4, 3.0, 4.0])
def test_smoothstep_and_fixed_envelope_strength(sign, distance):
    source = np.zeros((32, 32), np.float32)
    sigma = .01
    source[16, 16] = sign * distance * sigma
    actual = specks.tame_plane(source, 0, sigma**2)
    ramp = np.clip((distance - 2.5) / (2.5 - 1.5), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    expected = sign * (distance * sigma - .75 * ramp * max((distance - 1.5) * sigma, 0))
    assert actual[16, 16] == pytest.approx(expected)
