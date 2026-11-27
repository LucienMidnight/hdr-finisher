from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import raw_import
from tools.denoise_eval.candidates.ai_highlights import (
    camera_develop, combine, model_sensor, protect_weight, reconstruction_support,
    region_blend, sensor_clip_ratio, settings, to_scene,
)
from tools.denoise_eval.candidates.rawnind import Prepared


def metadata(pattern=None):
    pattern = np.array([[0, 1], [3, 2]]) if pattern is None else pattern
    return raw_import.CameraLinearMetadata(
        black_level=np.full(3, 1024.), white_level=np.full(3, 17408.),
        raw_black_level=np.full(4, 1024.), raw_white_level=np.full(4, 17408.),
        raw_pattern=pattern, raw_channel_to_rgb=np.array([0, 1, 2, 1]),
        as_shot_wb=np.array([2., 1., 1.5]), camera_to_xyz_d65=np.eye(3),
        camera_to_acescg=np.eye(3), color_description='RGBG',
        normalization_basis='test', matrix_source='test', matrix_reference_white='D65',
        white_level_source='test', wb_channel_sources=('R', 'G', 'B'))


def test_weight_protects_near_clip_and_all_reconstruction_changes():
    ratio = np.zeros((64, 96), np.float32)
    ratio[22:30, 30:38] = .93
    changed = np.zeros_like(ratio, bool)
    changed[45, 72] = True
    weight = protect_weight(ratio, feather=8, changed=changed, demosaic_radius=2)
    assert np.all(weight[20:32, 28:40] == 1)
    assert weight[45, 72] == 1
    assert weight[0, 0] == 0
    assert np.all((weight >= 0) & (weight <= 1))
    assert 0 < weight[24, 24] < 1
    np.testing.assert_array_equal(protect_weight(np.zeros_like(ratio)), np.zeros_like(ratio))
    assert np.all(protect_weight(np.ones_like(ratio)) == 1)


@pytest.mark.parametrize('strength', [0, .5, 1])
def test_blend_preserves_exact_endpoints_signed_values_and_headroom(strength):
    rng = np.random.default_rng(22)
    normal = rng.uniform(-.1, 4, (20, 30, 3)).astype(np.float32)
    neural = rng.uniform(-.1, 3, normal.shape).astype(np.float32)
    weight = np.zeros(normal.shape[:2], np.float32)
    weight[:, 15:] = 1
    output = region_blend(neural, normal, weight, strength=strength)
    np.testing.assert_array_equal(output[:, 15:], normal[:, 15:])
    if strength == 0:
        np.testing.assert_array_equal(output, normal)
    elif strength == 1:
        np.testing.assert_array_equal(output[:, :15], neural[:, :15])
    else:
        np.testing.assert_allclose(output[:, :15], (neural[:, :15] + normal[:, :15]) * .5, atol=5e-7)
    assert output.min() < 0 and output.max() > 1


def test_rejects_invalid_blend_and_mask():
    normal = np.zeros((10, 10, 3), np.float32)
    with pytest.raises(ValueError):
        region_blend(normal, normal, np.full((10, 10), 2))
    with pytest.raises(ValueError):
        protect_weight(np.full((10, 10), np.nan))
    with pytest.raises(ValueError):
        reconstruction_support(normal, normal, tolerance=0)


def test_research_expand_uses_supported_production_range():
    for expand in (0., 1., 3.):
        assert settings('edge_colour_v1', expand).highlight_reconstruction.edge_colour_expand_percent == expand
    with pytest.raises(ValueError):
        settings('edge_colour_v1', 5.)


@pytest.mark.parametrize('rotation', range(4))
def test_clip_map_preserves_all_cfa_phases_and_model_white_convention(rotation):
    info = metadata(np.rot90(np.array([[0, 1], [3, 2]]), rotation).copy())
    sensor = np.full((32, 32), 512, np.uint16)
    sensor[15, 19] = 17408
    ratio = sensor_clip_ratio(sensor, info)
    assert np.all(ratio[14:16, 18:20] >= 1)
    normalized = model_sensor(sensor, info, 17408)
    assert normalized[15, 19] == 1
    assert normalized[0, 0] < 0
    info.raw_white_level[0] = 25600
    np.testing.assert_array_equal(normalized, model_sensor(sensor, info, 17408))


@pytest.mark.parametrize('method', ['opposed_color_v1', 'edge_colour_v1'])
def test_combination_uses_original_sensor_anchor_and_real_reconstruction(method):
    info = metadata()
    sensor = np.full((64, 64), 6000, np.uint16)
    sensor[24:40:2, 24:40:2] = 17408
    original = sensor.copy()
    captured = {}

    class RecordingModel:
        def prepare(self, image, model_metadata, *, camera_anchor_mean):
            captured.update(image=image.copy(), anchor=camera_anchor_mean)
            return Prepared(np.full((*image.shape, 3), -.03, np.float32), 1., {}, {})

        def state_description(self, state):
            return dict(gain=state.gain)

    result = combine(sensor, info, np.eye(3), 17408, method=method, model=RecordingModel())
    np.testing.assert_array_equal(sensor, original)
    np.testing.assert_array_equal(captured['image'], model_sensor(original, info, 17408))
    camera = camera_develop(original, info, np.eye(3))
    assert captured['anchor'] == float(camera.mean(dtype=np.float64))
    repaired = original.copy()
    raw_import._apply_raw_highlight_reconstruction(SimpleNamespace(raw_image_visible=repaired),
                                                  info, settings(method))
    camera = camera_develop(repaired, info, np.eye(3))
    ratio = camera.max(axis=-1) / np.float32(raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY)
    normal = to_scene(camera, info)
    if method == 'edge_colour_v1':
        from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour
        normal, _ = reconstruct_edge_colour(normal, ratio, 1.)
    np.testing.assert_array_equal(result.image[result.weight == 1], normal[result.weight == 1])
    assert result.diagnostics['reconstruction']['applied']


def test_boundary_measure_does_not_miss_a_horizontal_join():
    from tools.denoise_eval.candidates.ai_highlights_measure import seam_measure
    normal = np.full((32, 32, 3), .18, np.float32)
    neural = normal + .02
    weight = np.broadcast_to(np.linspace(0, 1, 32, dtype=np.float32)[:, None], (32, 32))
    combined = region_blend(neural, normal, weight)
    result = seam_measure(combined, normal, neural, weight, np.zeros_like(weight))
    assert result['views']['0']['cross_boundary_excess_delta_e']['count'] == 32
    assert result['views']['0']['inside_band_delta_e']['count'] > 0
    assert result['views']['0']['outside_band_delta_e']['count'] > 0


def test_mapped_scratch_reopens_without_losing_pixels(tmp_path):
    from tools.denoise_eval.candidates.ai_highlights_measure import disk_copy, release_pages
    image = np.arange(96, dtype=np.float32).reshape(8, 4, 3)
    stored = disk_copy(tmp_path, 'test', image)
    reopened, = release_pages(stored)
    np.testing.assert_array_equal(reopened, image)
    assert not reopened.flags.writeable


def test_review_keeps_guarded_partial_without_duplicating_completed_photo(tmp_path, monkeypatch):
    import json
    from tools.denoise_eval.candidates import ai_highlights_measure as measure
    monkeypatch.setattr(measure, 'OUTPUT', tmp_path)
    monkeypatch.setattr(measure, 'REVIEW', tmp_path / 'review')
    measure.REVIEW.mkdir()
    measure.record_image('preview', np.full((8, 8, 3), .18, np.float32))
    filename = next(measure.REVIEW.glob('*.png')).name
    row = dict(name='Guarded Opposed only \u2212 caf\u00e9', images=[['Normal', filename]])
    measure.write_json(tmp_path / 'real-finished.json', dict(name='finished', review_rows=[row]))
    measure.write_json(tmp_path / 'partial-finished.json', dict(name='finished', review_rows=[row]))
    measure.write_json(tmp_path / 'partial-guarded.json', dict(name='guarded', review_rows=[row]))
    measure.write_json(tmp_path / 'synthetic-guard.json', dict(returncode=0))
    measure.review()
    manifest = json.loads((measure.REVIEW / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['records'] == ['finished', 'guarded']
    assert len(manifest['rows']) == 2

    assert row['name'] in (measure.REVIEW / 'index.html').read_text(encoding='utf-8')
