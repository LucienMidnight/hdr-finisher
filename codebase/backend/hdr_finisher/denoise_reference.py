from __future__ import annotations

from dataclasses import dataclass

import numpy as np


ALGORITHM_VERSION = "compact-haar-residual-v1"
ACESCG_LUMINANCE = np.asarray((0.2722287, 0.6740818, 0.0536895), dtype=np.float32)
# Decimated Haar levels cover progressively larger image structures. Applying
# the full live strength at every level turns a three-level resolve into an
# 8x8 block average at aggressive settings. Keep fine-noise removal strong but
# taper medium/coarse evidence so larger photographic structure remains.
DENOISE_LEVEL_WEIGHTS = np.asarray((1.0, 0.55, 0.25, 0.1), dtype=np.float32)


@dataclass(frozen=True)
class AnalysisPreset:
    """Locked settings which define a reusable structural analysis."""

    name: str = "Photo / Fine"
    levels: int = 2
    noise_threshold: float = 3.0
    luma_sigma: float = 0.035
    chroma_sigma: float = 0.035
    luma_strength: float = 1.0
    chroma_strength: float = 1.25


ANALYSIS_PRESETS: dict[str, AnalysisPreset] = {
    "photo_fine": AnalysisPreset(),
    "photo_mixed": AnalysisPreset(
        name="Photo / Mixed", levels=3, noise_threshold=3.4, luma_sigma=0.05, chroma_sigma=0.07
    ),
    "render_fine": AnalysisPreset(
        name="Render / Fine", levels=2, noise_threshold=3.6, luma_sigma=0.025, chroma_sigma=0.025
    ),
    "render_coarse": AnalysisPreset(
        name="Render / Coarse", levels=4, noise_threshold=4.0, luma_sigma=0.065, chroma_sigma=0.065
    ),
}


@dataclass(frozen=True)
class ResolveControls:
    """Live reconstruction-only weights; none participate in analysis."""

    amount: float = 0.5
    luminance: float = 0.5
    color_noise: float = 0.5
    detail_recovery: float = 0.5


@dataclass(frozen=True)
class WaveletEvidenceLevel:
    source_shape: tuple[int, int]
    # Each orientation stores Y, R-Y, and B-Y removable evidence. Keeping the
    # three components at the decimated coefficient resolution makes this a
    # compact pyramid instead of a stack of full-resolution residual images.
    removable: tuple[np.ndarray, np.ndarray, np.ndarray]
    # One scalar per coefficient attenuates ambiguous/coherent evidence during
    # reconstruction when Detail Recovery is raised.
    coherent_detail: tuple[np.ndarray, np.ndarray, np.ndarray]


@dataclass(frozen=True)
class DenoiseAnalysis:
    algorithm_version: str
    preset: AnalysisPreset
    source_shape: tuple[int, int, int]
    levels: tuple[WaveletEvidenceLevel, ...]
    coefficient_samples: int


def analyze_denoise(
    image: np.ndarray,
    preset: AnalysisPreset = AnalysisPreset(),
) -> DenoiseAnalysis:
    """Build deterministic removable-noise evidence from scene-linear ACEScg."""

    source = _validated_source(image)
    if not 1 <= preset.levels <= 4:
        raise ValueError("Wavelet analysis supports one through four decimated levels.")
    if min(
        preset.noise_threshold,
        preset.luma_sigma,
        preset.chroma_sigma,
        preset.luma_strength,
        preset.chroma_strength,
    ) <= 0.0:
        raise ValueError("Analysis thresholds and strengths must be positive.")

    current = source[..., :3]
    evidence_levels: list[WaveletEvidenceLevel] = []
    coefficient_samples = 0
    for level_index in range(preset.levels):
        low, details, source_shape = _haar_forward(current)
        components = tuple(_rgb_to_components(detail) for detail in details)
        # A 2x2 Haar average divides independent source-noise sigma by two at
        # each level. Sigma is a locked noise-model setting, never a live
        # reconstruction control.
        level_scale = np.float32(0.5 ** (level_index + 1))
        sigmas = np.asarray(
            (
                preset.luma_sigma * level_scale,
                preset.chroma_sigma * level_scale,
                preset.chroma_sigma * level_scale,
            ),
            dtype=np.float32,
        )
        normalized_magnitudes = tuple(_normalized_magnitude(item, sigmas, preset) for item in components)
        magnitude_sum = np.maximum(sum(normalized_magnitudes), np.float32(1e-6))

        removable: list[np.ndarray] = []
        coherent: list[np.ndarray] = []
        for item, magnitude in zip(components, normalized_magnitudes, strict=True):
            ratio = magnitude / np.float32(preset.noise_threshold)
            noise_confidence = np.float32(1.0) / (np.float32(1.0) + np.square(np.square(ratio)))
            dominance = magnitude / magnitude_sum
            directional_evidence = np.clip(
                (dominance - np.float32(0.5)) / np.float32(0.4),
                np.float32(0.0),
                np.float32(1.0),
            )
            threshold_evidence = np.clip(
                np.float32(4.0) * noise_confidence * (np.float32(1.0) - noise_confidence),
                np.float32(0.0),
                np.float32(1.0),
            )
            removable.append((item * noise_confidence[..., None]).astype(np.float32, copy=False))
            coherent.append(np.maximum(directional_evidence, threshold_evidence).astype(np.float32, copy=False))

        evidence_levels.append(
            WaveletEvidenceLevel(
                source_shape=source_shape,
                removable=tuple(removable),  # type: ignore[arg-type]
                coherent_detail=tuple(coherent),  # type: ignore[arg-type]
            )
        )
        coefficient_samples += sum(int(item.shape[0] * item.shape[1]) for item in details)
        current = low

    return DenoiseAnalysis(
        algorithm_version=ALGORITHM_VERSION,
        preset=preset,
        source_shape=tuple(int(value) for value in source.shape),
        levels=tuple(evidence_levels),
        coefficient_samples=coefficient_samples,
    )


def resolve_denoise(
    image: np.ndarray,
    analysis: DenoiseAnalysis,
    controls: ResolveControls = ResolveControls(),
) -> np.ndarray:
    """Reconstruct a denoised proxy using only cached evidence and live weights."""

    source = _validated_source(image)
    if tuple(source.shape) != analysis.source_shape:
        raise ValueError("Denoise analysis does not match the source shape.")
    if analysis.algorithm_version != ALGORITHM_VERSION:
        raise ValueError("Denoise analysis algorithm version is not supported.")

    amount = _bounded_control("amount", controls.amount)
    luminance = _bounded_control("luminance", controls.luminance)
    color_noise = _bounded_control("color_noise", controls.color_noise)
    detail_recovery = _bounded_control("detail_recovery", controls.detail_recovery)
    if amount == 0.0 or (luminance == 0.0 and color_noise == 0.0):
        return source.copy()

    last = analysis.levels[-1].removable[0]
    residual = np.zeros((last.shape[0], last.shape[1], 3), dtype=np.float32)
    for level_index in range(len(analysis.levels) - 1, -1, -1):
        level = analysis.levels[level_index]
        level_weight = DENOISE_LEVEL_WEIGHTS[min(level_index, len(DENOISE_LEVEL_WEIGHTS) - 1)]
        weighted_details: list[np.ndarray] = []
        for components, coherent in zip(level.removable, level.coherent_detail, strict=True):
            detail_scale = np.float32(1.0) - np.float32(detail_recovery) * coherent
            weighted = np.empty_like(components)
            weighted[..., 0] = components[..., 0] * np.float32(luminance) * detail_scale
            weighted[..., 1:] = components[..., 1:] * np.float32(color_noise) * detail_scale[..., None]
            weighted_details.append(_components_to_rgb(weighted) * np.float32(amount) * level_weight)
        residual = _haar_inverse(residual, tuple(weighted_details), level.source_shape)

    result = source.copy()
    result[..., :3] -= residual
    if not np.isfinite(result).all():
        raise FloatingPointError("Denoise reconstruction produced a non-finite value.")
    return result


def _validated_source(image: np.ndarray) -> np.ndarray:
    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3 or source.shape[2] not in (3, 4):
        raise ValueError("Denoise input must be an H x W scene-linear RGB or RGBA array.")
    if source.shape[0] < 2 or source.shape[1] < 2:
        raise ValueError("Denoise input must be at least 2 x 2 pixels.")
    if not np.isfinite(source).all():
        raise ValueError("Denoise input must contain only finite scene-linear values.")
    return source


def _bounded_control(name: str, value: float) -> float:
    result = float(value)
    if not np.isfinite(result) or not 0.0 <= result <= 1.0:
        raise ValueError(f"{name} must be finite and between 0 and 1.")
    return result


def _haar_forward(image: np.ndarray) -> tuple[np.ndarray, tuple[np.ndarray, np.ndarray, np.ndarray], tuple[int, int]]:
    height, width = image.shape[:2]
    padded = np.pad(image, ((0, height % 2), (0, width % 2), (0, 0)), mode="edge")
    a = padded[0::2, 0::2]
    b = padded[0::2, 1::2]
    c = padded[1::2, 0::2]
    d = padded[1::2, 1::2]
    scale = np.float32(0.25)
    low = (a + b + c + d) * scale
    horizontal = (a - b + c - d) * scale
    vertical = (a + b - c - d) * scale
    diagonal = (a - b - c + d) * scale
    return low, (horizontal, vertical, diagonal), (height, width)


def _haar_inverse(
    low: np.ndarray,
    details: tuple[np.ndarray, np.ndarray, np.ndarray],
    source_shape: tuple[int, int],
) -> np.ndarray:
    horizontal, vertical, diagonal = details
    height, width = source_shape
    restored = np.empty((low.shape[0] * 2, low.shape[1] * 2, 3), dtype=np.float32)
    restored[0::2, 0::2] = low + horizontal + vertical + diagonal
    restored[0::2, 1::2] = low - horizontal + vertical - diagonal
    restored[1::2, 0::2] = low + horizontal - vertical - diagonal
    restored[1::2, 1::2] = low - horizontal - vertical + diagonal
    return restored[:height, :width]


def _rgb_to_components(detail: np.ndarray) -> np.ndarray:
    luminance = np.tensordot(detail, ACESCG_LUMINANCE, axes=([-1], [0])).astype(np.float32, copy=False)
    return np.stack((luminance, detail[..., 0] - luminance, detail[..., 2] - luminance), axis=-1)


def _components_to_rgb(components: np.ndarray) -> np.ndarray:
    luminance = components[..., 0]
    red = luminance + components[..., 1]
    blue = luminance + components[..., 2]
    green = (
        luminance - ACESCG_LUMINANCE[0] * red - ACESCG_LUMINANCE[2] * blue
    ) / ACESCG_LUMINANCE[1]
    return np.stack((red, green, blue), axis=-1).astype(np.float32, copy=False)


def _normalized_magnitude(components: np.ndarray, sigmas: np.ndarray, preset: AnalysisPreset) -> np.ndarray:
    scaled = components / sigmas
    luma = scaled[..., 0] / np.float32(preset.luma_strength)
    chroma = scaled[..., 1:] / np.float32(preset.chroma_strength)
    return np.sqrt(np.square(luma) + np.sum(np.square(chroma), axis=-1)).astype(np.float32, copy=False)
