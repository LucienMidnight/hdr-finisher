import numpy as np
import pytest

from tools.denoise_eval.candidates.hot_pixel import filter_sensor


def metadata(pattern=((0, 1), (1, 2))):
    return dict(cfa=pattern, raw_cfa=((0, 1), (3, 2)),
                black_levels=[2048] * 4, white_levels=[16384] * 4,
                noise_parameters=[dict(a=.00003, b=.0000003)] * 4)


@pytest.mark.parametrize('pattern', [((0, 1), (1, 2)), ((2, 1), (1, 0)),
                                    ((1, 0), (2, 1)), ((1, 2), (0, 1))])
def test_isolated_hot_sites_all_phases(pattern):
    source = np.full((48, 48), .01, np.float32)
    locations = [(10, 10), (10, 31), (31, 10), (31, 31)]
    for row, column in locations:
        source[row, column] = .5
    before = source.copy()
    result, diagnostic = filter_sensor(source, metadata(pattern))
    assert diagnostic['repaired'] == 4
    assert np.all(result == np.float32(.01))
    assert np.array_equal(source, before)


def test_other_colour_light_veto_and_clipped_context():
    source = np.full((48, 48), .01, np.float32)
    source[12, 12] = .5
    source[12, 13] = .15
    source[32, 32] = .5
    source[33, 33] = 1.
    result, diagnostic = filter_sensor(source, metadata())
    assert np.array_equal(result, source)
    assert diagnostic['light_veto'] >= 1
    assert diagnostic['clipping_veto'] >= 1


def test_saturation_border_cold_and_signed_noise_are_preserved():
    source = np.full((48, 48), -.002, np.float32)
    source[12, 12] = 1.
    source[0, 0] = .7
    source[32, 32] = -.9
    result, diagnostic = filter_sensor(source, metadata())
    assert np.array_equal(result, source)
    assert diagnostic['repaired'] == 0
    with pytest.raises(ValueError, match='Cold-pixel'):
        filter_sensor(source, metadata(), cold=True)


def test_unsupported_profile_and_checkbox_are_noops():
    source = np.full((32, 32), .01, np.float32)
    source[16, 16] = .6
    for settings, enabled in [(metadata(), False), ({}, True),
                              (dict(metadata(), cfa=[[0]]), True),
                              (dict(metadata(), white_levels=[0] * 4), True)]:
        result, diagnostic = filter_sensor(source, settings, enabled=enabled)
        assert np.array_equal(result, source)
        assert diagnostic['repaired'] == 0


def test_directional_repair_uses_original_support():
    source = np.full((32, 32), .1, np.float32)
    source[16, 16] = .7
    source[16, 14], source[16, 18] = .03, .032
    source[14, 16], source[18, 16] = .02, .15
    source[14, 14], source[18, 18] = .01, .2
    source[14, 18], source[18, 14] = .02, .25
    result, diagnostic = filter_sensor(source, metadata())
    assert diagnostic['repaired'] == 1
    assert result[16, 16] == pytest.approx(.031)
    assert np.count_nonzero(result != source) == 1


def test_strip_and_even_tile_results_agree_on_interior():
    source = np.full((530, 96), .01, np.float32)
    for row, column in ((258, 20), (260, 40), (262, 60), (510, 40)):
        source[row, column] = .6
    whole, diagnostic = filter_sensor(source, metadata())
    assert diagnostic['repaired'] == 4
    for top in (0, 250, 254):
        tile = source[top:top + 276]
        result, diagnostic = filter_sensor(tile, dict(metadata(), tile_origin=(top, 0)))
        assert np.array_equal(result[4:-4, 4:-4], whole[top+4:top+len(tile)-4, 4:-4])
        assert all(item['y'] >= top + 4 for item in diagnostic['changed'])
    with pytest.raises(ValueError, match='even sensor phase'):
        filter_sensor(source, dict(metadata(), tile_origin=(1, 0)))


def test_shot_noise_at_observed_signal_prevents_overconfidence():
    source = np.zeros((32, 32), np.float32)
    source[16, 16] = .03
    noisy_profile = dict(metadata(), noise_parameters=[dict(a=.003, b=.0001)] * 4)
    assert filter_sensor(source, noisy_profile)[1]['repaired'] == 0


def test_undersampled_single_colour_light_is_intrinsically_ambiguous():
    source = np.zeros((32, 32), np.float32)
    source[16, 16] = .5
    result, diagnostic = filter_sensor(source, metadata())
    assert diagnostic['repaired'] == 1
    assert result[16, 16] == 0
    assert 'not proven' in diagnostic['classification']


def test_invalid_samples_rejected():
    with pytest.raises(ValueError, match='finite'):
        filter_sensor(np.full((16, 16), np.nan), metadata())
