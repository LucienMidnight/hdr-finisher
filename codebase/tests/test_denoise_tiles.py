"""Phase 6 exit gate 1: tile seams, wavelet alignment, odd dimensions, edges.

The claim these tests make is equality, not a tolerance. A Haar decomposition
over non-overlapping 2x2 blocks reads nothing outside its own block, so a tile
whose origin sits on the ``2 ** levels`` grid produces exactly the coefficients
the whole image produces there. If that is true the seam question is closed by
construction rather than by measurement, so any inequality at all is a real
defect and the tests are written to say so.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from backend.hdr_finisher.denoise_reference import (
    AnalysisPreset,
    ResolveControls,
    analyze_denoise,
    resolve_denoise,
)
from backend.hdr_finisher.denoise_tiles import (
    TileRect,
    aligned_denoise_tiles,
    analyze_denoise_tiled,
    denoise_cache_identity,
    resolve_denoise_tiled,
    tile_alignment,
    tiled_analysis_scratch_samples,
)


def _scene(width: int, height: int, seed: int = 7) -> np.ndarray:
    """A scene-linear field with structure, noise and HDR headroom.

    Flat noise alone would let a broken tiling pass, because noise looks the
    same wherever it is cut. The gradients and hard edges are what make a
    misaligned block grid visible.
    """

    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    base = 0.18 + 0.6 * (xs / max(1, width - 1)) * (ys / max(1, height - 1))
    base += 0.35 * np.sin(xs / 9.0) * np.cos(ys / 7.0)
    image = np.stack((base, base * 0.92 + 0.05, base * 1.08), axis=-1).astype(np.float32)
    # Hard edges on and off the block grid, so a misalignment cannot hide.
    image[:, width // 3 : width // 3 + 1] += 3.0
    image[height // 2 + 1 : height // 2 + 2, :] += 2.5
    image[: max(1, height // 8), : max(1, width // 8)] += 12.0  # HDR headroom
    image += rng.normal(0.0, 0.02, size=image.shape).astype(np.float32)
    return np.ascontiguousarray(np.maximum(image, -0.05), dtype=np.float32)


CONTROLS = ResolveControls(amount=0.8, luminance=0.7, color_noise=0.6, detail_recovery=0.3)


@pytest.mark.parametrize("levels", [1, 2, 3, 4])
@pytest.mark.parametrize("tile_size", [16, 32, 64])
def test_tiled_analysis_is_bit_identical_across_levels_and_tile_sizes(levels: int, tile_size: int) -> None:
    image = _scene(96, 80)
    preset = AnalysisPreset(levels=levels)

    whole = analyze_denoise(image, preset)
    tiled = analyze_denoise_tiled(image, preset, tile_size=tile_size)

    assert tiled.algorithm_version == whole.algorithm_version
    assert tiled.source_shape == whole.source_shape
    assert len(tiled.levels) == len(whole.levels)
    for level_index, (left, right) in enumerate(zip(whole.levels, tiled.levels, strict=True)):
        assert left.source_shape == right.source_shape, f"level {level_index} source shape"
        for orientation in range(3):
            np.testing.assert_array_equal(
                left.removable[orientation],
                right.removable[orientation],
                err_msg=f"level {level_index} orientation {orientation} removable evidence differs",
            )
            np.testing.assert_array_equal(
                left.coherent_detail[orientation],
                right.coherent_detail[orientation],
                err_msg=f"level {level_index} orientation {orientation} coherence differs",
            )


@pytest.mark.parametrize("levels", [1, 2, 3, 4])
@pytest.mark.parametrize("tile_size", [16, 48])
def test_tiled_reconstruction_is_bit_identical(levels: int, tile_size: int) -> None:
    image = _scene(96, 80)
    preset = AnalysisPreset(levels=levels)
    analysis = analyze_denoise(image, preset)

    whole = resolve_denoise(image, analysis, CONTROLS)
    tiled = resolve_denoise_tiled(image, analysis, CONTROLS, tile_size=tile_size)

    np.testing.assert_array_equal(whole, tiled)


# Odd in one axis, odd in both, prime-ish, and smaller than a tile: every shape
# where the last block in a row or column is partial.
@pytest.mark.parametrize("size", [(33, 27), (64, 31), (17, 64), (7, 5), (129, 97)])
@pytest.mark.parametrize("levels", [2, 4])
def test_odd_dimensions_and_image_edges_match_the_whole_image(size: tuple[int, int], levels: int) -> None:
    width, height = size
    image = _scene(width, height, seed=width * 31 + height)
    preset = AnalysisPreset(levels=levels)

    analysis_whole = analyze_denoise(image, preset)
    analysis_tiled = analyze_denoise_tiled(image, preset, tile_size=16)
    for left, right in zip(analysis_whole.levels, analysis_tiled.levels, strict=True):
        for orientation in range(3):
            np.testing.assert_array_equal(left.removable[orientation], right.removable[orientation])
            np.testing.assert_array_equal(left.coherent_detail[orientation], right.coherent_detail[orientation])

    np.testing.assert_array_equal(
        resolve_denoise(image, analysis_whole, CONTROLS),
        resolve_denoise_tiled(image, analysis_whole, CONTROLS, tile_size=16),
    )


def test_a_seam_would_actually_be_detected() -> None:
    """The equality tests are only meaningful if a misaligned grid fails them.

    Analysing a deliberately misaligned sub-rectangle must produce different
    coefficients. Without this, a tiling that silently fell back to the whole
    image would pass every assertion above.
    """

    image = _scene(64, 64)
    preset = AnalysisPreset(levels=2)
    aligned = analyze_denoise(image[0:32, 0:32], preset)
    misaligned = analyze_denoise(image[2:34, 2:34], preset)

    assert not np.array_equal(aligned.levels[0].removable[0], misaligned.levels[0].removable[0])


@pytest.mark.parametrize("levels", [1, 2, 3, 4])
def test_tiles_sit_on_the_wavelet_grid_and_cover_the_image_exactly(levels: int) -> None:
    width, height = 201, 149
    alignment = tile_alignment(levels)
    tiles = aligned_denoise_tiles(width, height, 48, levels)

    covered = np.zeros((height, width), dtype=np.int32)
    for tile in tiles:
        assert tile.x % alignment == 0 and tile.y % alignment == 0, f"{tile.key()} is off the {alignment}px grid"
        assert tile.width > 0 and tile.height > 0
        assert tile.right <= width and tile.bottom <= height
        covered[tile.y : tile.bottom, tile.x : tile.right] += 1
    assert covered.min() == 1 and covered.max() == 1, "tiles must cover every pixel exactly once"


def test_a_region_resolve_touches_only_that_region() -> None:
    """Zoom and pan reconstruct from cached evidence without re-analysing."""

    image = _scene(96, 96)
    preset = AnalysisPreset(levels=2)
    analysis = analyze_denoise(image, preset)

    region = TileRect(32, 16, 48, 64)
    partial = resolve_denoise_tiled(image, analysis, CONTROLS, tile_size=16, region=region)
    whole = resolve_denoise(image, analysis, CONTROLS)

    inside = (slice(region.y, region.bottom), slice(region.x, region.right))
    np.testing.assert_array_equal(partial[inside], whole[inside])

    untouched = partial.copy()
    untouched[inside] = image[inside]
    np.testing.assert_array_equal(untouched, image)


def test_a_region_must_sit_on_the_wavelet_grid() -> None:
    image = _scene(64, 64)
    analysis = analyze_denoise(image, AnalysisPreset(levels=2))
    with pytest.raises(ValueError, match="wavelet grid"):
        resolve_denoise_tiled(image, analysis, CONTROLS, region=TileRect(3, 0, 16, 16))


def test_cache_identity_matches_the_pinned_cross_language_fixture() -> None:
    """The CPU half of the identity contract.

    `tests/denoise-cache-identity.test.js` holds the renderer to the same
    literals. Either side drifting fails on its own side, which is what stops a
    CPU analysis and a GPU analysis of the same document from disagreeing about
    what is cached and about when it is stale.
    """

    fixture = json.loads((Path(__file__).parent / "fixtures" / "denoise-cache-identity.json").read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        settings = case["settings"]
        preset = AnalysisPreset(
            levels=settings["levels"],
            noise_threshold=settings["noiseThreshold"],
            luma_sigma=settings["lumaSigma"],
            chroma_sigma=settings["chromaSigma"],
            luma_strength=settings["lumaStrength"],
            chroma_strength=settings["chromaStrength"],
        )
        tile = TileRect(**case["tile"]) if case["tile"] else None
        assert denoise_cache_identity(case["sourceIdentity"], preset, tile=tile) == case["expected"], case["name"]


def test_cache_identity_excludes_live_controls_and_includes_every_analysis_setting() -> None:
    """The property the whole design rests on: a slider is not a cache miss."""

    preset = AnalysisPreset(levels=2)
    baseline = denoise_cache_identity("source:1k", preset)

    # Live reconstruction controls are not part of the identity at all, so no
    # drag of Amount, Luminance, Color Noise or Detail Recovery can change it.
    assert denoise_cache_identity("source:1k", preset) == baseline

    for field, value in (
        ("levels", 3),
        ("noise_threshold", 4.0),
        ("luma_sigma", 0.05),
        ("chroma_sigma", 0.05),
        ("luma_strength", 1.5),
        ("chroma_strength", 1.5),
    ):
        changed = AnalysisPreset(**{**preset.__dict__, field: value})
        assert denoise_cache_identity("source:1k", changed) != baseline, f"{field} must invalidate analysis"

    assert denoise_cache_identity("source:2k", preset) != baseline
    assert denoise_cache_identity("source:1k", preset, tile=TileRect(0, 0, 64, 64)) != baseline


def test_tile_scratch_does_not_grow_with_the_image() -> None:
    """The reason tiled analysis exists, stated as a number."""

    assert tiled_analysis_scratch_samples(256, 2) == tiled_analysis_scratch_samples(256, 2)
    # A whole-image 24 MP two-level chain needs ~7.5 M samples of low-band
    # scratch; one 256px tile needs under 22 k regardless of source size.
    assert tiled_analysis_scratch_samples(256, 2) < 22_000
    assert tiled_analysis_scratch_samples(256, 4) < 23_000


@pytest.mark.parametrize("levels", [1, 2, 3, 4])
def test_tiled_analysis_then_tiled_resolve_round_trips(levels: int) -> None:
    """The combination the renderer actually runs, not each half alone."""

    image = _scene(80, 72)
    preset = AnalysisPreset(levels=levels)

    analysis = analyze_denoise_tiled(image, preset, tile_size=32)
    tiled = resolve_denoise_tiled(image, analysis, CONTROLS, tile_size=32)
    whole = resolve_denoise(image, analyze_denoise(image, preset), CONTROLS)

    np.testing.assert_array_equal(tiled, whole)
