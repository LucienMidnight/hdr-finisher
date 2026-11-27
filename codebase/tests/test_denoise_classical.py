"""Behavioural checks for non-shipping, CPU-only classical prototypes."""
import numpy as np
import pytest
from tools.denoise_eval.adapters import tiled
from tools.denoise_eval.candidates.darktable_profiled import DarktableProfiled, vst, inverse_vst
from tools.denoise_eval.candidates.galosh import Galosh, canonical
from tools.denoise_eval.candidates.build_galosh import BINARY
from tools.denoise_eval.candidates.denoise_v2_tuned import Tuned
from tools.denoise_eval.inputs import develop
from tools.denoise_eval.metrics import colour_error


def metadata():
    return dict(cfa=[[0, 1], [1, 2]], white_balance=[2., 1., 1.5],
                camera_to_acescg=np.eye(3).tolist(), exposure_stops=0., iso=6400,
                noise_parameters=[dict(a=.002, b=.000025)]*4)


def test_vst_algebraic_inverse_and_unbiased_mean():
    shot, read = np.float32(.002), np.float32(.000025)
    values = np.linspace(0, 4, 200, dtype=np.float32)
    assert np.max(np.abs(inverse_vst(vst(values, shot, read), shot, read, unbiased=False)-values)) < 2e-6
    rng = np.random.default_rng(12)
    for mean in (.02, .1, .5, 2.):
        noisy = rng.poisson(mean/shot, 100000)*shot + rng.normal(0, np.sqrt(read), 100000)
        restored = inverse_vst(np.mean(vst(noisy, shot, read)), shot, read)
        assert abs(float(restored)-mean) < max(.0002, .01*mean)


def test_wavelet_finite_exact_bypass_alpha_and_derived_halo():
    image = np.random.default_rng(3).uniform(.05, 2, (96, 112, 4)).astype(np.float32)
    adapter = DarktableProfiled()
    state = adapter.prepare(image, metadata())
    result = adapter.process(image, metadata(), state)
    assert np.isfinite(result).all()
    assert np.array_equal(result[..., 3], image[..., 3])
    assert np.array_equal(adapter.process(image, metadata(), state, bypass=True), image)
    assert adapter.margin == 2*(2**state['scales']-1)
    assert np.array_equal(DarktableProfiled(0).process(image, metadata(), state), image)


def test_wavelet_tile_seams_with_shared_global_thresholds():
    image = np.random.default_rng(4).normal(.3, .02, (160, 176, 3)).astype(np.float32)
    adapter = DarktableProfiled()
    state = adapter.prepare(image, metadata())
    direct = adapter.process(image, metadata(), state)
    shifted = tiled(adapter, image, metadata(), state, shift=32, tile=64)
    difference = colour_error(direct, shifted)
    assert np.mean(difference) < 1 and np.quantile(difference, .99) < 3


def test_profiled_hdr_negative_values_and_headroom_are_not_clamped():
    image = np.broadcast_to(np.array([-.125, 1.5, 8.], dtype=np.float32), (64, 64, 3)).copy()
    adapter = DarktableProfiled()
    state = adapter.prepare(image, metadata())
    result = adapter.process(image, metadata(), state)
    assert np.all(result[..., 0] == image[..., 0])
    assert np.all(result[..., 1:] > 1)


@pytest.mark.parametrize('criterion', ['psnr', 'sharp'])
def test_tuned_controls_finite_and_exact_bypass(criterion):
    image = np.random.default_rng(17).normal(.2, .02, (64, 80, 3)).astype(np.float32)
    adapter = Tuned(criterion)
    md = {**metadata(), 'iso':4000}
    state = adapter.prepare(image, md)
    assert np.isfinite(adapter.process(image, md, state)).all()
    assert np.array_equal(adapter.process(image, md, state, bypass=True), image)


def test_canonicalisation_keeps_every_site_and_is_involutive():
    image = np.arange(48, dtype=np.float32).reshape(6, 8)
    for cfa in ([[0, 1], [1, 2]], [[1, 0], [2, 1]], [[2, 1], [1, 0]], [[1, 2], [0, 1]]):
        md = dict(cfa=cfa)
        converted = canonical(image, md)
        assert np.array_equal(canonical(converted, md), image)
        red_row, red_column = np.argwhere(np.array(cfa) == 0)[0]
        assert set(converted[::2, ::2].ravel()) == set(image[red_row::2, red_column::2].ravel())


@pytest.mark.needs_native_helper
@pytest.mark.skipif(not BINARY.exists(), reason='Offline GALOSH binary not built')
def test_galosh_finite_bypass_matches_same_ahd_and_shared_fit():
    image = np.random.default_rng(9).normal(.2, .02, (64, 80)).astype(np.float32)
    md = metadata()
    adapter = Galosh()
    state = adapter.prepare(image, md)
    assert state['alpha'] == pytest.approx(.002)
    assert state['read'] == pytest.approx(.000025)
    result = adapter.process(image, md, state)
    assert result.shape == (64, 80, 3) and np.isfinite(result).all()
    assert np.array_equal(adapter.process(image, md, state, bypass=True), develop(image, md))
    assert np.array_equal(Galosh(0).process(image, md, state), develop(image, md))
    first = tiled(adapter, image, md, state, tile=32)
    second = tiled(adapter, image, md, state, tile=32, shift=16)
    difference = colour_error(first, second)
    assert np.mean(difference) < 1 and np.quantile(difference, .99) < 3


@pytest.mark.needs_native_helper
@pytest.mark.skipif(not BINARY.exists(), reason='Offline GALOSH binary not built')
def test_galosh_blind_fit_is_global_and_finite():
    image = np.random.default_rng(7).normal(.12, .015, (96, 96)).astype(np.float32)
    md = metadata()
    adapter = Galosh(blind=True)
    state = adapter.prepare(image, md)
    assert state['alpha'] > 0 and state['read'] >= 0
    assert np.isfinite(adapter.process(image, md, state)).all()


@pytest.mark.needs_native_helper
@pytest.mark.skipif(not BINARY.exists(), reason='Offline GALOSH binary not built')
def test_galosh_shifted_grid_has_real_internal_boundaries():
    image = np.random.default_rng(31).normal(.2, .02, (384, 400)).astype(np.float32)
    image[:, 200:] *= 2
    md = metadata()
    adapter = Galosh()
    state = adapter.prepare(image, md)
    first = tiled(adapter, image, md, state, tile=128)
    second = tiled(adapter, image, md, state, tile=128, shift=64)
    difference = colour_error(first[16:-16, 16:-16], second[16:-16, 16:-16])
    assert np.mean(difference) < 1 and np.quantile(difference, .99) < 3
