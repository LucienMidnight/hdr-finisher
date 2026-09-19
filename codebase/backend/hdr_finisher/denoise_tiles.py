"""Bounded tiled execution of the wavelet denoise reference.

Why this is exact rather than approximate
-----------------------------------------

The denoise model is a **Haar** decomposition over non-overlapping 2x2 blocks.
Level 0 reads the source at ``[2q, 2q+1]``, level 1 reads the level-0 low band
at ``[2r, 2r+1]`` -- which is source ``[4r .. 4r+3]`` -- and so on. No stage
reads outside its own block, so a tile needs **no halo at all**, unlike Detail.
What a tile does need is to sit on the same block grid the whole image uses: if
a tile began at an odd column, its level-0 blocks would straddle the whole-image
ones and every coefficient would differ.

That gives one rule, and it is the whole contract:

    a tile origin must be a multiple of ``2 ** levels``

with tiles laid out contiguously so the last tile in each row and column runs to
the image edge. Edge padding then behaves identically too, because
``_haar_forward`` pads only when a dimension is odd, and the only tile with an
odd dimension is the one that ends at the image edge -- exactly where the whole
image would pad.

The consequence worth stating plainly: tiled analysis and tiled reconstruction
are **bit-identical** to the whole-image routines, not merely close. The tests
assert equality, not a tolerance.

What this bounds
----------------

Whole-image analysis holds every level's low band at once. Tiled analysis holds
one tile's chain, so scratch follows the tile rather than the image. Evidence
itself is still produced for the whole image -- that is what live reconstruction
without re-analysis requires -- but it is produced and can be stored per tile,
which is what lets a cache bound it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from .denoise_reference import (
    ALGORITHM_VERSION,
    AnalysisPreset,
    DenoiseAnalysis,
    ResolveControls,
    WaveletEvidenceLevel,
    analyze_denoise,
    resolve_denoise,
)

__all__ = [
    "TileRect",
    "denoise_cache_identity",
    "tile_alignment",
    "aligned_denoise_tiles",
    "analyze_denoise_tiled",
    "resolve_denoise_tiled",
    "tiled_analysis_scratch_samples",
]


@dataclass(frozen=True)
class TileRect:
    """One tile in whole-image pixel coordinates."""

    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    def key(self) -> str:
        return f"{self.x},{self.y},{self.width},{self.height}"


def tile_alignment(levels: int) -> int:
    """The grid a tile origin must land on for ``levels`` Haar scales."""

    if not 1 <= levels <= 4:
        raise ValueError("Wavelet analysis supports one through four decimated levels.")
    return 2**levels


def denoise_cache_identity(
    source_identity: str,
    preset: AnalysisPreset,
    *,
    tile: TileRect | None = None,
) -> str:
    """The identity an analysis result is cached under.

    Deliberately excludes the live reconstruction controls -- Amount,
    Luminance, Color Noise and Detail Recovery -- because they consume evidence
    and never create it. Including them would make every slider drag a cache
    miss, which is the behaviour this whole design exists to avoid. Everything
    that changes the coefficients is in: the source, the algorithm version and
    every locked analysis setting.

    The GPU renderer builds the same string, so a CPU and a GPU analysis of the
    same document agree on what is cached and on when it is stale.
    """

    parts = [
        source_identity,
        ALGORITHM_VERSION,
        f"levels={int(preset.levels)}",
        f"noise={float(preset.noise_threshold):.6g}",
        f"luma_sigma={float(preset.luma_sigma):.6g}",
        f"chroma_sigma={float(preset.chroma_sigma):.6g}",
        f"luma_strength={float(preset.luma_strength):.6g}",
        f"chroma_strength={float(preset.chroma_strength):.6g}",
    ]
    if tile is not None:
        parts.append(f"tile={tile.key()}")
    return "|".join(parts)


def aligned_denoise_tiles(width: int, height: int, tile_size: int, levels: int) -> list[TileRect]:
    """Cover the image with tiles whose origins sit on the ``2 ** levels`` grid.

    The requested tile size is rounded up to the alignment so the interior grid
    is exact. Only the final tile in each row and column is short, and it runs
    to the image edge, which is the one place edge padding is allowed to differ
    from an interior block -- and there it matches the whole image.
    """

    if width <= 0 or height <= 0:
        raise ValueError("Denoise tiling requires a positive image size.")
    alignment = tile_alignment(levels)
    if tile_size <= 0:
        raise ValueError("Denoise tile size must be positive.")
    step = ((tile_size + alignment - 1) // alignment) * alignment

    columns = _spans(width, step)
    rows = _spans(height, step)
    return [TileRect(x, y, span_w, span_h) for (y, span_h) in rows for (x, span_w) in columns]


def _spans(extent: int, step: int) -> list[tuple[int, int]]:
    """Cut one axis into aligned spans, absorbing a too-short trailing remainder.

    A trailing span of one pixel is both wasteful and unanalysable -- the Haar
    transform needs at least a 2x2 block. Folding it into the previous span
    leaves every origin on the alignment grid, because only the last span's
    length changes, and keeps the image covered exactly once.
    """

    offsets = list(range(0, extent, step))
    spans = [(offset, min(step, extent - offset)) for offset in offsets]
    if len(spans) > 1 and spans[-1][1] < 2:
        start, length = spans[-2]
        spans[-2] = (start, length + spans[-1][1])
        spans.pop()
    return spans


def tiled_analysis_scratch_samples(tile_size: int, levels: int) -> int:
    """Pixel samples one tile's transient low-band chain needs.

    This is the figure that makes tiled analysis worth doing: it depends on the
    tile, not on the image, so it does not grow when the source does.
    """

    alignment = tile_alignment(levels)
    step = ((tile_size + alignment - 1) // alignment) * alignment
    samples = 0
    extent = step
    for _ in range(levels):
        extent = (extent + 1) // 2
        samples += extent * extent
    return samples


def _tile_view(image: np.ndarray, tile: TileRect) -> np.ndarray:
    return image[tile.y : tile.bottom, tile.x : tile.right]


def _scaled_rect(tile: TileRect, level_index: int) -> tuple[int, int, int, int]:
    """Where a tile's coefficients land in the whole-image band at a level.

    The band for level ``i`` is at scale ``2 ** (i + 1)``. Origins divide
    exactly because they are aligned; extents use ceiling division so the tile
    that ends at the image edge claims the partial block the whole image also
    produces there.
    """

    scale = 2 ** (level_index + 1)
    x = tile.x // scale
    y = tile.y // scale
    return x, y, x + (tile.width + scale - 1) // scale, y + (tile.height + scale - 1) // scale


def analyze_denoise_tiled(
    image: np.ndarray,
    preset: AnalysisPreset = AnalysisPreset(),
    *,
    tile_size: int = 256,
) -> DenoiseAnalysis:
    """Analyse tile by tile, assembling evidence identical to the whole-image run.

    Each tile is decomposed on its own, so the transient low-band chain is
    bounded by the tile. The coefficients are written straight into the
    whole-image bands at their aligned positions.
    """

    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3 or source.shape[2] not in (3, 4):
        raise ValueError("Denoise input must be an H x W scene-linear RGB or RGBA array.")
    height, width = source.shape[:2]
    tiles = aligned_denoise_tiles(width, height, tile_size, preset.levels)

    bands: list[list[np.ndarray]] = []
    coherence: list[list[np.ndarray]] = []
    source_shapes: list[tuple[int, int]] = []
    extent_height, extent_width = height, width
    for _ in range(preset.levels):
        source_shapes.append((extent_height, extent_width))
        extent_height = (extent_height + 1) // 2
        extent_width = (extent_width + 1) // 2
        bands.append([np.zeros((extent_height, extent_width, 3), dtype=np.float32) for _ in range(3)])
        coherence.append([np.zeros((extent_height, extent_width), dtype=np.float32) for _ in range(3)])

    coefficient_samples = 0
    for tile in tiles:
        # Each tile runs the unmodified reference. That is deliberate: the tiled
        # path must not carry its own copy of the maths, or the two could drift
        # and the equality test below would be comparing a function with itself.
        tile_analysis = analyze_denoise(_tile_view(source, tile), preset)
        coefficient_samples += tile_analysis.coefficient_samples
        for level_index, level in enumerate(tile_analysis.levels):
            x0, y0, x1, y1 = _scaled_rect(tile, level_index)
            for orientation in range(3):
                removable = level.removable[orientation]
                coherent = level.coherent_detail[orientation]
                if removable.shape[0] != y1 - y0 or removable.shape[1] != x1 - x0:
                    raise AssertionError(
                        f"Tile {tile.key()} produced a {removable.shape[:2]} band at level "
                        f"{level_index}, but the aligned grid expects {(y1 - y0, x1 - x0)}."
                    )
                bands[level_index][orientation][y0:y1, x0:x1] = removable
                coherence[level_index][orientation][y0:y1, x0:x1] = coherent

    levels = tuple(
        WaveletEvidenceLevel(
            source_shape=source_shapes[index],
            removable=(bands[index][0], bands[index][1], bands[index][2]),
            coherent_detail=(coherence[index][0], coherence[index][1], coherence[index][2]),
        )
        for index in range(preset.levels)
    )
    return DenoiseAnalysis(
        algorithm_version=ALGORITHM_VERSION,
        preset=preset,
        source_shape=tuple(int(value) for value in source.shape),
        levels=levels,
        coefficient_samples=coefficient_samples,
    )


def resolve_denoise_tiled(
    image: np.ndarray,
    analysis: DenoiseAnalysis,
    controls: ResolveControls = ResolveControls(),
    *,
    tile_size: int = 256,
    region: TileRect | None = None,
) -> np.ndarray:
    """Reconstruct tile by tile from cached evidence.

    With ``region`` this resolves only that rectangle, which is what makes
    zoom and pan cheap: the visible part of the frame is reconstructed from
    evidence that is already resident, and no analysis runs.
    """

    source = np.asarray(image, dtype=np.float32)
    if tuple(source.shape) != analysis.source_shape:
        raise ValueError("Denoise analysis does not match the source shape.")
    height, width = source.shape[:2]
    levels = analysis.preset.levels
    alignment = tile_alignment(levels)

    if region is None:
        region = TileRect(0, 0, width, height)
    if region.x % alignment or region.y % alignment:
        raise ValueError(f"A resolve region must start on the {alignment}px wavelet grid.")
    if region.x < 0 or region.y < 0 or region.right > width or region.bottom > height:
        raise ValueError("A resolve region must lie inside the image.")

    result = source.copy()
    for tile in aligned_denoise_tiles(region.width, region.height, tile_size, levels):
        placed = TileRect(region.x + tile.x, region.y + tile.y, tile.width, tile.height)
        tile_analysis = _analysis_for_tile(analysis, placed)
        resolved = resolve_denoise(_tile_view(source, placed), tile_analysis, controls)
        result[placed.y : placed.bottom, placed.x : placed.right] = resolved
    return result


def _analysis_for_tile(analysis: DenoiseAnalysis, tile: TileRect) -> DenoiseAnalysis:
    """Slice whole-image evidence down to one tile's coefficients.

    Slices are views, so this costs no copy. The per-level ``source_shape`` is
    the tile's own extent at that level, which is what tells the inverse
    transform how much of the final restored block to keep -- the mechanism
    that makes an odd-sized edge tile reconstruct correctly.
    """

    levels: list[WaveletEvidenceLevel] = []
    extent_height, extent_width = tile.height, tile.width
    for level_index, level in enumerate(analysis.levels):
        x0, y0, x1, y1 = _scaled_rect(tile, level_index)
        levels.append(
            WaveletEvidenceLevel(
                source_shape=(extent_height, extent_width),
                removable=tuple(item[y0:y1, x0:x1] for item in level.removable),  # type: ignore[arg-type]
                coherent_detail=tuple(item[y0:y1, x0:x1] for item in level.coherent_detail),  # type: ignore[arg-type]
            )
        )
        extent_height = (extent_height + 1) // 2
        extent_width = (extent_width + 1) // 2

    channels = analysis.source_shape[2]
    return replace(
        analysis,
        source_shape=(tile.height, tile.width, channels),
        levels=tuple(levels),
    )
