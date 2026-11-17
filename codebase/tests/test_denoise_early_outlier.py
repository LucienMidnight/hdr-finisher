from dataclasses import replace

import numpy as np
import pytest

from tools.denoise_eval.candidates.early_outlier import Controls, develop, tame_plane


def test_soft_clamp_preserves_sign_and_does_not_replace_with_median():
    plane = np.full((32, 32), .01, np.float32)
    plane[12, 12], plane[20, 20] = -.1, .12
    result, counts = tame_plane(plane, 0, .0001)
    assert -.1 < result[12, 12] < 0
    assert .01 < result[20, 20] < .12
    assert counts['changed'] == 2
    assert np.array_equal(result[0], plane[0])


def test_noise_inside_envelope_and_zero_strength_are_exact():
    plane = np.random.default_rng(12).uniform(-.015, .015, (32, 32)).astype('float32')
    assert np.array_equal(tame_plane(plane, 0, .0001)[0], plane)
    plane[16, 16] = .5
    assert np.array_equal(tame_plane(plane, 0, .0001, Controls(strength=0))[0], plane)


def test_support_preserves_repeated_detail_but_not_isolated_sample():
    plane = np.zeros((32, 32), np.float32)
    plane[12, 12:15] = .1
    plane[22, 22] = .1
    protected, counts = tame_plane(plane, 0, .0001)
    unprotected, _ = tame_plane(plane, 0, .0001, Controls(support=False))
    assert np.array_equal(protected[12, 12:15], plane[12, 12:15])
    assert np.all(unprotected[12, 12:15] < plane[12, 12:15])
    assert protected[22, 22] < plane[22, 22]
    assert counts['supported'] == 3


def test_size_limit_rejects_large_regions_and_strength_is_monotone():
    plane = np.zeros((32, 32), np.float32)
    plane[10:12, 10:14] = .1
    small = Controls(support=False, max_area=1)
    large = replace(small, max_area=10)
    assert np.array_equal(tame_plane(plane, 0, .0001, small)[0], plane)
    weak = tame_plane(plane, 0, .0001, replace(large, strength=.25))[0]
    strong = tame_plane(plane, 0, .0001, large)[0]
    assert np.all(strong <= weak)
    assert np.any(strong < weak)


@pytest.mark.parametrize('pattern', [[[0, 1], [1, 2]], [[2, 1], [1, 0]],
                                      [[1, 0], [2, 1]], [[1, 2], [0, 1]]])
def test_development_keeps_cfa_and_applies_exposure_once(pattern):
    from tools.denoise_eval.candidates.signed_shadows import develop_signed
    sensor = np.full((32, 32), -.005, np.float32)
    metadata = dict(cfa=pattern, white_balance=[1, 1, 1], camera_to_acescg=np.eye(3).tolist(),
                    noise_parameters=[dict(a=.001, b=.0001)] * 4)
    for stage in ('raw', 'rgb'):
        result, counts = develop(sensor, metadata, stage)
        assert np.array_equal(result, develop_signed(sensor, metadata))
        assert all(row['changed'] == 0 for row in counts)
        lifted, _ = develop(sensor, dict(metadata, exposure_stops=6), stage)
        assert np.array_equal(lifted, result * 64)


def test_missing_calibration_refuses_instead_of_guessing():
    with pytest.raises(ValueError, match='four sensor noise fits'):
        develop(np.zeros((32, 32), np.float32), dict(cfa=[[0, 1], [1, 2]]))


def test_correlated_clump_uses_outer_neighbours_not_its_own_centre():
    plane = np.zeros((48, 48), np.float32)
    plane[20:22, 20:22] = .1
    result, counts = tame_plane(plane, 0, .0001, correlated=True)
    assert counts['changed'] == 4
    assert np.all(result[20:22, 20:22] < plane[20:22, 20:22])


def test_finite_support_matches_interior_of_larger_plane():
    plane = np.random.default_rng(7).normal(0, .01, (96, 96)).astype('float32')
    plane[44, 44] = .3
    full = tame_plane(plane, 0, .0001)[0]
    cropped = tame_plane(plane[16:80, 16:80], 0, .0001)[0]
    assert np.array_equal(full[32:64, 32:64], cropped[16:48, 16:48])


def test_support_cannot_split_a_large_cluster_into_repairable_fragments():
    plane = np.zeros((48, 48), np.float32)
    plane[20, 20:28] = .1
    plane[21, 20] = .13
    unprotected = tame_plane(plane, 0, .0001, Controls(support=False))[0]
    protected = tame_plane(plane, 0, .0001, Controls(support=True))[0]
    assert np.all((protected != plane) <= (unprotected != plane))


def test_saturation_and_nearby_support_stay_unchanged():
    plane = np.zeros((32, 32), np.float32)
    plane[16, 16], plane[16, 17] = 1.1, .2
    result, counts = tame_plane(plane, 0, .0001, Controls(support=False))
    assert np.array_equal(result, plane)
    assert counts['changed'] == 0


@pytest.mark.parametrize('kwargs', [dict(strength=2), dict(threshold=1), dict(max_area=0),
                                    dict(threshold=float('nan'))])
def test_invalid_controls_refused(kwargs):
    with pytest.raises(ValueError):
        Controls(**kwargs)


def test_threshold_only_sweep_is_monotone_for_isolated_samples():
    from tools.denoise_eval.candidates.early_uniformity import threshold
    plane = np.zeros((64, 64), np.float32)
    plane[12, 12], plane[24, 24], plane[36, 36], plane[48, 48] = .021, -.027, .035, -.06
    previous = np.full_like(plane, np.inf)
    for value in (2., 2.5, 3., 4.):
        result = tame_plane(plane, 0, .0001, threshold(value).controls)[0]
        correction = abs(result-plane)
        assert np.all(correction <= previous)
        assert np.all(abs(result) <= abs(plane))
        previous = correction


def test_grain_variant_changes_only_luma_and_chroma_controls():
    from tools.denoise_eval.candidates.early_uniformity import threshold
    baseline, grain = threshold(2.5), threshold(2.5, grain=True)
    assert baseline.controls == grain.controls
    assert grain.denoise.controls == replace(baseline.denoise.controls, luminance=.25, color_noise=1.)
    assert grain.denoise.controls.strengths()[0] < baseline.denoise.controls.strengths()[0]
    assert grain.denoise.controls.strengths()[1] > baseline.denoise.controls.strengths()[1]
