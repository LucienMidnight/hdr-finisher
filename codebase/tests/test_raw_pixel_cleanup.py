from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import raw_pixel_cleanup as cleanup
from hdr_finisher.models import RawImportSettings


def config(colours=(0, 1, 1, 2)):
    return dict(noise=[dict(a=.00003, b=.0000003)] * 4, black=[1000] * 4,
                spans=[12000] * 4, colours=list(colours),
                thresholds=[cleanup.HOT_SIGMA, cleanup.MINIMUM_EXCESS, cleanup.LIGHT_SIGMA, cleanup.CLIP_GUARD])


def metadata(pattern=((0, 1), (3, 2))):
    return SimpleNamespace(raw_pattern=np.asarray(pattern), raw_channel_to_rgb=np.asarray([0, 1, 2, 1]),
                           raw_black_level=np.full(4, 1000), raw_white_level=np.full(4, 13000))


@pytest.mark.parametrize('colours', [(0, 1, 1, 2), (2, 1, 1, 0), (1, 0, 2, 1), (1, 2, 0, 1)])
def test_production_filter_matches_research_and_removes_all_phases(colours):
    from tools.denoise_eval.candidates.hot_pixel import filter_sensor
    settings = config(colours)
    image = np.full((48, 48), -.002, np.float32)
    for row, column in ((10, 10), (10, 31), (31, 10), (31, 31)):
        image[row, column] = .5
    original = image.copy()
    expected, diagnostic = filter_sensor(image, dict(cfa=np.asarray(colours).reshape(2, 2),
        raw_cfa=[[0, 1], [3, 2]], black_levels=[1000] * 4, white_levels=[13000] * 4,
        noise_parameters=settings['noise']))
    actual = cleanup.filter_sensor(image, settings)
    assert diagnostic['repaired'] == 4
    np.testing.assert_array_equal(actual, expected)
    np.testing.assert_array_equal(image, original)
    assert np.all(actual == np.float32(-.002))


@pytest.mark.parametrize('colours', [(0, 1, 1, 2), (2, 1, 1, 0), (1, 0, 2, 1), (1, 2, 0, 1)])
def test_real_light_veto_clipping_border_and_cold_samples_stay_unchanged(colours):
    image = np.full((64, 64), -.001, np.float32)
    image[12, 12], image[12, 13] = .5, .15
    image[32, 32], image[33, 33] = .5, .98
    image[50, 50], image[0, 0], image[20, 40] = 1.1, .7, -.9
    np.testing.assert_array_equal(cleanup.filter_sensor(image, config(colours)), image)


def test_both_excess_thresholds_and_four_pixel_border_are_strict():
    image = np.zeros((48, 48), np.float32)
    settings = config()
    settings['noise'] = [dict(a=0, b=0)] * 4
    image[10, 10], image[20, 20] = .019, .021
    image[3, 16], image[4, 30] = .5, .5
    result = cleanup.filter_sensor(image, settings)
    assert result[10, 10] == image[10, 10] and result[20, 20] == 0
    assert result[3, 16] == .5 and result[4, 30] == 0
    settings['noise'] = [dict(a=0, b=(.1 / 8) ** 2)] * 4
    image[:] = 0
    image[10, 10], image[20, 20] = .09, .11
    result = cleanup.filter_sensor(image, settings)
    assert result[10, 10] == image[10, 10] and result[20, 20] == 0


def test_most_consistent_pair_is_read_from_original():
    image = np.full((32, 32), .1, np.float32)
    image[16, 16] = .7
    for first, second, direction in ((.03, .032, (0, 2)), (.02, .15, (2, 0)),
                                      (.01, .2, (2, 2)), (.02, .25, (2, -2))):
        row, column = direction
        image[16 - row, 16 - column], image[16 + row, 16 + column] = first, second
    result = cleanup.filter_sensor(image, config())
    assert result[16, 16] == pytest.approx(.031)
    assert np.count_nonzero(image != result) == 1


@pytest.mark.parametrize('shape', [(531, 95), (530, 96), (19, 21), (5, 5)])
def test_dn_repair_strips_equal_whole_mosaic_including_seams(shape):
    settings = config()
    sensor = np.full(shape, 1120, np.uint16)
    for row, column in ((10, 10), (251, 20), (254, 40), (257, 60), (510, 40)):
        if row < shape[0] and column < shape[1]:
            sensor[row, column] = 7000
    original = sensor.copy()
    normalized = cleanup._normalise(sensor, np.asarray(settings['black'], np.float32), np.asarray(settings['spans'], np.float32))
    expected = cleanup.filter_sensor(normalized, settings)
    changed = expected != normalized
    encoded = original.copy()
    encoded[changed] = np.rint(expected[changed].astype(float) * 12000 + 1000).astype(np.uint16)
    count = cleanup.apply(sensor, settings)
    np.testing.assert_array_equal(sensor, encoded)
    assert count == np.count_nonzero(original != encoded)


def test_off_is_bit_identical_without_noise_estimation(monkeypatch):
    sensor = np.random.default_rng(8).integers(0, 16000, (48, 50), dtype=np.uint16)
    before = sensor.copy()
    monkeypatch.setattr(cleanup, 'configuration', lambda *args, **kwargs: pytest.fail('Off estimated noise'))
    diagnostic = cleanup.apply_raw(SimpleNamespace(raw_image_visible=sensor), metadata(), RawImportSettings())
    assert diagnostic['enabled'] is False
    np.testing.assert_array_equal(sensor, before)


@pytest.mark.parametrize('enabled', [False, True])
def test_decode_cleans_before_highlight_evidence_and_demosaic(tmp_path, monkeypatch, enabled):
    from contextlib import nullcontext
    from hdr_finisher import raw_import
    sensor = np.full((48, 48), 1120, np.uint16)
    sensor[16, 16] = 7000
    camera = metadata()
    raw = SimpleNamespace(raw_image_visible=sensor, raw_pattern=camera.raw_pattern)
    rawpy = SimpleNamespace(imread=lambda path: nullcontext(raw))
    monkeypatch.setattr(cleanup, 'configuration', lambda *args, **kwargs: config())
    monkeypatch.setattr(raw_import, '_camera_linear_metadata_from_libraw', lambda raw: camera)
    monkeypatch.setattr(raw_import, '_read_libraw_metadata', lambda raw: {})
    observed = []

    def highlights(raw, *args, **kwargs):
        observed.append(('highlights', int(raw.raw_image_visible[16, 16])))

    def develop(raw, *args, **kwargs):
        observed.append(('demosaic', int(raw.raw_image_visible[16, 16])))
        return np.repeat(raw.raw_image_visible[..., None], 3, axis=2).astype(np.float32)

    monkeypatch.setattr(raw_import, '_apply_raw_highlight_reconstruction', highlights)
    monkeypatch.setattr(raw_import, '_develop_libraw_camera_rgb', develop)
    result = raw_import._execute_raw_decode(tmp_path / 'sensor.ARW',
        RawImportSettings(pixel_cleanup={'remove_hot_pixels': enabled}),
        SimpleNamespace(exif={}), SimpleNamespace(rawpy=rawpy, opcode_plan=None), progress=None, cancelled=None)
    expected = 1120 if enabled else 7000
    assert observed == [('highlights', expected), ('demosaic', expected)]
    assert result.developed[16, 16, 0] == expected
    assert result.pixel_cleanup_diagnostics['repaired'] == int(enabled)


def test_unsupported_cfa_and_unmeasurable_noise_leave_input_unchanged():
    sensor = np.full((48, 48), 1100, np.uint16)
    before = sensor.copy()
    camera = metadata()
    assert cleanup.configuration(sensor, camera) is None
    camera.raw_pattern = np.ones((6, 6), dtype=int)
    assert cleanup.configuration(sensor, camera) is None
    enabled = RawImportSettings(pixel_cleanup={'remove_hot_pixels': True})
    assert cleanup.apply_raw(SimpleNamespace(raw_image_visible=sensor), camera, enabled)['supported'] is False
    cleanup.apply(sensor, None)
    np.testing.assert_array_equal(sensor, before)


def test_noise_estimation_keeps_four_sensor_phases_and_is_repeatable():
    random = np.random.default_rng(90)
    camera = metadata()
    row_signal = np.linspace(.005, .5, 192, dtype=np.float32)[:, None]
    normalized = np.broadcast_to(row_signal, (192, 192)).copy()
    for phase in range(4):
        plane = normalized[phase // 2::2, phase % 2::2]
        plane += random.normal(size=plane.shape) * np.sqrt(.00002 * (phase + 1) * plane + .0000004)
    sensor = np.rint(normalized * 12000 + 1000).astype(np.uint16)
    result = cleanup.configuration(sensor, camera)
    assert result is not None and len(result['noise']) == 4
    assert result == cleanup.configuration(sensor, camera)
    assert result['noise'][3]['a'] > result['noise'][0]['a']
    assert result['thresholds'] == config()['thresholds']


def test_cancelled_cleanup_does_not_process_a_strip():
    with pytest.raises(InterruptedError, match='cancelled'):
        cleanup.apply(np.full((48, 48), 1120, np.uint16), config(), cancelled=lambda: True)
