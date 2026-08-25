from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.denoise_reference import (
    ACESCG_LUMINANCE,
    ANALYSIS_PRESETS,
    ALGORITHM_VERSION,
    ResolveControls,
    analyze_denoise,
    resolve_denoise,
)


def _noisy_scene(seed: int = 7, height: int = 65, width: int = 97) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    x = np.linspace(-0.1, 6.0, width, dtype=np.float32)
    clean = np.empty((height, width, 3), dtype=np.float32)
    clean[..., 0] = x
    clean[..., 1] = x * np.float32(0.8)
    clean[..., 2] = x * np.float32(0.55)
    clean[:, width // 2 :, :] += np.asarray((1.5, 0.5, 2.0), dtype=np.float32)
    noise = rng.normal(0.0, 0.035, clean.shape).astype(np.float32)
    return clean + noise, clean


def test_neutral_resolve_is_bit_exact_and_preserves_rgba() -> None:
    rgb, _ = _noisy_scene()
    alpha = np.linspace(-0.25, 1.25, rgb.shape[0] * rgb.shape[1], dtype=np.float32).reshape(rgb.shape[:2])
    source = np.concatenate((rgb, alpha[..., None]), axis=-1)
    analysis = analyze_denoise(source)

    resolved = resolve_denoise(source, analysis, ResolveControls(amount=0.0))

    assert np.array_equal(resolved, source)
    assert np.array_equal(resolved[..., 3], alpha)


def test_reference_rejects_non_finite_inputs_and_controls() -> None:
    source, _ = _noisy_scene()
    source[3, 4, 1] = np.nan
    with pytest.raises(ValueError, match="finite"):
        analyze_denoise(source)

    finite, _ = _noisy_scene()
    analysis = analyze_denoise(finite)
    with pytest.raises(ValueError, match="amount"):
        resolve_denoise(finite, analysis, ResolveControls(amount=np.inf))


def test_negative_values_and_hdr_headroom_are_not_clipped_or_normalized() -> None:
    source, _ = _noisy_scene()
    analysis = analyze_denoise(source)
    resolved = resolve_denoise(source, analysis, ResolveControls(amount=0.8, luminance=0.7, color_noise=0.9))

    assert np.isfinite(resolved).all()
    assert float(resolved.min()) < 0.0
    assert float(resolved.max()) > 6.0


def test_compact_decimated_cache_is_deterministic_and_versioned() -> None:
    source, _ = _noisy_scene()
    first = analyze_denoise(source)
    second = analyze_denoise(source.copy())

    assert first.algorithm_version == ALGORITHM_VERSION
    assert first.coefficient_samples <= source.shape[0] * source.shape[1]
    assert len(first.levels) == 2
    for left_level, right_level in zip(first.levels, second.levels, strict=True):
        for left, right in zip(left_level.removable, right_level.removable, strict=True):
            assert np.array_equal(left, right)
        for left, right in zip(left_level.coherent_detail, right_level.coherent_detail, strict=True):
            assert np.array_equal(left, right)
    assert np.array_equal(resolve_denoise(source, first), resolve_denoise(source, second))


def test_wavelet_method_presets_cover_fine_mixed_and_coarse_scales() -> None:
    source, _ = _noisy_scene(height=96, width=128)
    expected_levels = {"photo_fine": 2, "photo_mixed": 3, "render_fine": 2, "render_coarse": 4}

    for name, level_count in expected_levels.items():
        analysis = analyze_denoise(source, ANALYSIS_PRESETS[name])
        assert len(analysis.levels) == level_count
        assert np.isfinite(resolve_denoise(source, analysis)).all()


def test_photo_mixed_maximum_strength_preserves_coarse_photographic_structure() -> None:
    # This is a pure third-level Haar structure: alternating four-pixel-wide
    # neutral bands. Treating the coarse level like fine noise removes almost
    # all of it and presents as visible 8x8 tiling in smooth photographed skin.
    x = np.arange(128)
    bands = np.where((x // 4) % 2 == 0, 0.012, -0.012).astype(np.float32)
    source = np.full((96, 128, 3), 0.5, dtype=np.float32)
    source += bands[None, :, None]
    analysis = analyze_denoise(source, ANALYSIS_PRESETS["photo_mixed"])

    resolved = resolve_denoise(
        source,
        analysis,
        ResolveControls(amount=1.0, luminance=1.0, color_noise=1.0, detail_recovery=0.0),
    )

    source_contrast = float(np.std(source[..., 0]))
    resolved_contrast = float(np.std(resolved[..., 0]))
    assert resolved_contrast >= source_contrast * 0.65


def test_cached_residual_reduces_noise_without_erasing_photo_boundary() -> None:
    noisy, clean = _noisy_scene()
    analysis = analyze_denoise(noisy)
    resolved = resolve_denoise(
        noisy,
        analysis,
        ResolveControls(amount=1.0, luminance=1.0, color_noise=1.0, detail_recovery=0.35),
    )
    before_error = noisy - clean
    after_error = resolved - clean
    boundary = noisy.shape[1] // 2

    assert float(np.std(after_error[:, : boundary - 3])) < float(np.std(before_error[:, : boundary - 3])) * 0.9
    clean_step = clean[:, boundary, :] - clean[:, boundary - 1, :]
    resolved_step = resolved[:, boundary, :].mean(axis=0) - resolved[:, boundary - 1, :].mean(axis=0)
    assert np.all(np.abs(resolved_step - clean_step.mean(axis=0)) < 0.08)


def test_luminance_and_chroma_are_independent_live_reconstruction_weights() -> None:
    rng = np.random.default_rng(19)
    neutral = np.full((64, 64, 3), 0.5, dtype=np.float32)
    luma_noise = rng.normal(0.0, 0.04, (64, 64, 1)).astype(np.float32)
    chroma_noise = rng.normal(0.0, 0.04, (64, 64, 3)).astype(np.float32)
    chroma_noise -= np.tensordot(chroma_noise, ACESCG_LUMINANCE, axes=([-1], [0]))[..., None]
    source = neutral + luma_noise + chroma_noise
    analysis = analyze_denoise(source)

    luma_only = resolve_denoise(source, analysis, ResolveControls(amount=1.0, luminance=1.0, color_noise=0.0))
    chroma_only = resolve_denoise(source, analysis, ResolveControls(amount=1.0, luminance=0.0, color_noise=1.0))
    luma_delta = source - luma_only
    chroma_delta = source - chroma_only

    assert float(np.mean(np.abs(np.tensordot(chroma_delta, ACESCG_LUMINANCE, axes=([-1], [0]))))) < 1e-6
    assert np.allclose(luma_delta[..., 0], luma_delta[..., 1], atol=1e-6)
    assert np.allclose(luma_delta[..., 1], luma_delta[..., 2], atol=1e-6)


def test_render_like_edges_survive_while_flat_field_noise_falls() -> None:
    rng = np.random.default_rng(41)
    clean = np.zeros((96, 128, 3), dtype=np.float32)
    clean[20:76, 28:100] = np.asarray((4.0, 1.0, 0.25), dtype=np.float32)
    noisy = clean + rng.normal(0.0, 0.025, clean.shape).astype(np.float32)
    analysis = analyze_denoise(noisy)
    resolved = resolve_denoise(
        noisy,
        analysis,
        ResolveControls(amount=1.0, luminance=1.0, color_noise=1.0, detail_recovery=0.7),
    )

    flat = np.s_[2:18, 2:26, :]
    assert float(np.std(resolved[flat] - clean[flat])) < float(np.std(noisy[flat] - clean[flat])) * 0.9
    edge_before = noisy[48, 28] - noisy[48, 27]
    edge_after = resolved[48, 28] - resolved[48, 27]
    assert np.max(np.abs(edge_after - edge_before)) < 0.08
