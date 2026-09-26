"""Adaptive denoise: the contracts the preview and export both rely on."""

from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher import denoise_adaptive as da


def _scene(height: int = 300, width: int = 700, seed: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """A gradient with a few hard edges and texture, plus affine luminance noise."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    base = 0.02 + 0.3 * xx / width
    base += 0.15 * ((xx // 90 + yy // 70) % 2)
    base *= 1.0 + 0.05 * np.sin(xx / 3.0) * np.sin(yy / 4.0)
    clean = np.stack([base, base * 0.9, base * 0.8], axis=-1).astype(np.float32)
    sigma = np.sqrt(4e-4 * clean + 1e-5)
    return clean, (clean + rng.standard_normal(clean.shape).astype(np.float32) * sigma).astype(np.float32)


def test_tiles_equal_the_whole_frame(monkeypatch) -> None:
    _, noisy = _scene()
    model = da.estimate_adaptive_model(noisy)
    tiled = da.resolve_adaptive(noisy, model)
    monkeypatch.setattr(da, "TILE_SIZE", 100_000)
    whole = da.resolve_adaptive(noisy, model)
    np.testing.assert_allclose(tiled, whole, rtol=0, atol=1e-6)


def test_zero_strength_returns_the_input_exactly() -> None:
    _, noisy = _scene()
    model = da.estimate_adaptive_model(noisy)
    for controls in (da.AdaptiveControls(amount=0.0), da.AdaptiveControls(luminance=0.0, color_noise=0.0)):
        np.testing.assert_array_equal(da.resolve_adaptive(noisy, model, controls), noisy)


def test_alpha_passes_through() -> None:
    _, noisy = _scene(96, 128)
    rgba = np.concatenate([noisy, np.full(noisy.shape[:2] + (1,), 0.25, dtype=np.float32)], axis=-1)
    out = da.resolve_adaptive(rgba, da.estimate_adaptive_model(rgba))
    np.testing.assert_array_equal(out[..., 3], rgba[..., 3])


def test_defaults_are_the_measured_result() -> None:
    controls = da.AdaptiveControls()
    assert controls.strengths() == (1.0, 1.0)
    assert controls.fine_band_multiplier() == 1.0
    assert controls.fine_band_floor() == 0.0
    assert da.AdaptiveControls(amount=1.0).strengths() == (2.0, 2.0)
    assert da.AdaptiveControls(detail_recovery=1.0).fine_band_floor() == pytest.approx(0.3)
    assert da.AdaptiveControls(detail_recovery=0.0).fine_band_multiplier() == pytest.approx(1.5)


def test_each_noise_size_is_its_own_control() -> None:
    _, noisy = _scene()
    model = da.estimate_adaptive_model(noisy)
    default = da.resolve_adaptive(noisy, model)
    for key in ("fine_noise", "medium_noise", "coarse_noise"):
        changed = da.resolve_adaptive(noisy, model, da.AdaptiveControls(**{key: 1.0}))
        assert not np.array_equal(changed, default), key
    # All three at zero is the same as removing nothing.
    untouched = da.resolve_adaptive(noisy, model, da.AdaptiveControls(fine_noise=0.0, medium_noise=0.0, coarse_noise=0.0))
    np.testing.assert_allclose(untouched, noisy, rtol=0, atol=1e-6)


def test_denoising_moves_towards_the_clean_picture() -> None:
    clean, noisy = _scene()
    out = da.resolve_adaptive(noisy, da.estimate_adaptive_model(noisy))
    before = float(np.sqrt(np.mean((noisy - clean) ** 2)))
    after = float(np.sqrt(np.mean((out - clean) ** 2)))
    assert after < 0.6 * before, (before, after)


def test_the_model_grows_with_brightness_and_reads_the_noise_level() -> None:
    rng = np.random.default_rng(9)
    flat = np.tile(np.linspace(0.02, 0.6, 512, dtype=np.float32), (512, 1))
    clean = np.stack([flat] * 3, axis=-1)
    noisy = (clean + rng.standard_normal(clean.shape).astype(np.float32) * np.sqrt(4e-4 * clean + 1e-5)).astype(np.float32)
    model = da.estimate_adaptive_model(noisy)
    dark = np.sqrt(model.c * 0.05 ** 2 + model.a * 0.05 + model.b)
    bright = np.sqrt(model.c * 0.5 ** 2 + model.a * 0.5 + model.b)
    assert bright > 1.5 * dark
    # Independent per-channel noise is ~uncorrelated across the opponent basis,
    # so every component's finest band reads close to the white-noise factor.
    for row in model.band_sigmas:
        assert 0.6 < row[0] / 0.8908 < 1.6, model.band_sigmas
        assert row[1] < row[0] and row[4] < row[3]


def test_the_model_round_trips_through_its_json_shape() -> None:
    _, noisy = _scene(128, 128)
    shape = da.estimate_adaptive_model(noisy).as_dict()
    assert shape["algorithm_version"] == da.ALGORITHM_VERSION
    assert len(shape["band_sigmas"]) == 3 and all(len(row) == da.LEVELS for row in shape["band_sigmas"])
