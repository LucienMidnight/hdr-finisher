"""Behavioural coverage for the isolated noise-model/RAW-speck research."""
from dataclasses import replace

import numpy as np
import pytest

from hdr_finisher import denoise_adaptive as adaptive
from tools.denoise_eval.candidates import noise_model_specks as candidate


def observations():
    return [dict(signal=signal, variance=.003*signal+2e-6, pixels=1000, zero_fraction=0.)
            for signal in (.001, .003, .01, .03, .1)]


def test_zero_bins_do_not_annihilate_informative_poisson_gaussian_fit():
    rows = [dict(signal=1e-6, variance=0., pixels=1000, zero_fraction=.6), *observations()]
    shape = candidate.constrained_shape(rows)
    assert shape == pytest.approx((.003, 2e-6, 0.), rel=1e-8)
    assert candidate.constrained_shape(rows[:1]) is None


def test_constrained_shape_is_nonnegative_and_exposure_covariant():
    shape = candidate.constrained_shape(observations())
    for scale in (1/64, 64):
        scaled = [dict(row, signal=row['signal']*scale, variance=row['variance']*scale**2)
                  for row in observations()]
        value = candidate.constrained_shape(scaled)
        assert min(value) >= 0
        assert value == pytest.approx((shape[0]*scale, shape[1]*scale**2, 0.), rel=1e-8)


def test_same_shape_recalibration_reproduces_existing_model():
    image = np.random.default_rng(33).normal(.1, .003, (192,192,3)).astype('float32')
    before = adaptive.estimate_adaptive_model(image, workers=1)
    after = candidate.calibrate_shape(image, (before.a,before.b,before.c), adaptive._sample_tiles(192,192))
    np.testing.assert_allclose(after.band_sigmas, before.band_sigmas, rtol=1e-6)


def test_corrected_model_preserves_bypass_alpha_and_hdr_values():
    image = np.empty((96,96,4), 'float32')
    image[...,:3] = [-.125, 1.5, 8.]
    image[...,3] = np.linspace(0,1,96)[None,:]
    adapter = candidate.factory()
    state = adapter.prepare(image, {})
    output = adapter.process(image, {}, state)
    assert np.array_equal(adapter.process(image, {}, state, bypass=True), image)
    assert np.array_equal(output[...,3], image[...,3])
    np.testing.assert_allclose(output, image, atol=3e-6)
    adapter.controls = replace(adapter.controls, amount=0)
    assert np.array_equal(adapter.process(image, {}, state), image)


def test_raw_repair_keeps_positive_points_supported_lines_and_other_cfa_planes():
    mosaic = np.empty((96,96), 'float32')
    for index, (row,column) in enumerate(((0,0),(0,1),(1,0),(1,1))):
        mosaic[row::2,column::2] = .05 + .1*index
    original = mosaic.copy()
    mosaic[40,40] = .001
    mosaic[60,60] = .5
    mosaic[20:40:2,20] = .001
    parameters = [dict(a=0.,b=.001**2)]*4
    output, count = candidate.repair_sensor(mosaic, parameters)
    assert count == 1
    assert output[40,40] == original[40,40]
    assert output[60,60] == mosaic[60,60]
    assert np.array_equal(output[20:40:2,20], mosaic[20:40:2,20])
    assert np.array_equal(output[1::2], mosaic[1::2])
    assert np.array_equal(output[::2,1::2], mosaic[::2,1::2])
    assert np.array_equal(mosaic[1::2], original[1::2])


def test_raw_repair_removes_real_dark_dots_too_not_a_truth_aware_oracle():
    mosaic = np.full((64,64), .05, 'float32')
    mosaic[32,32] = .001
    output, count = candidate.repair_sensor(mosaic, [dict(a=0.,b=1e-6)]*4)
    assert count == 1
    assert output[32,32] == .05


def test_raw_repair_independent_haloed_tiles_and_exposure_covariance():
    mosaic = np.random.default_rng(4).normal(.1,.01,(128,160)).astype('float32')
    parameters = [dict(a=.0001,b=1e-6)]*4
    whole, _ = candidate.repair_sensor(mosaic, parameters)
    tiled = np.empty_like(mosaic)
    for left in range(0,160,40):
        start, end = max(0,left-8),min(160,left+48)
        tile, _ = candidate.repair_sensor(mosaic[:,start:end], parameters)
        tiled[:,left:left+40] = tile[:,left-start:left-start+40]
    np.testing.assert_array_equal(tiled, whole)
    scaled, _ = candidate.repair_sensor(mosaic*16, [dict(a=.0016,b=.000256)]*4)
    np.testing.assert_allclose(scaled/16,whole,rtol=1e-6)


def test_sensor_profile_requires_evidence_not_just_iso_black_white():
    with pytest.raises(ValueError, match='Insufficient RAW flat samples'):
        candidate.sensor_parameters(np.zeros((32,32),'float32'), dict(iso=3200, black_levels=[2048]*4))


def test_adapters_are_described_as_research_only():
    assert candidate.raw().description()['input_kind'] == 'bayer'
    assert candidate.raw_corrected().description()['corrected_model']
