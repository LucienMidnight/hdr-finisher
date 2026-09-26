"""Denoise benchmark corpus: clean scene-linear references plus modelled noise.

Clean references are crops of the local test EXRs, box-downsampled 4x so the
source's own grain falls well below the noise added on top. Each reference is
then degraded three ways, matching what the app actually receives:

``processed``  A finished EXR export (Affinity, darktable). Measured on
               DSC06898: variance affine in signal, almost entirely luminance
               (channel correlation 0.99), and lightly sharpened.
``raw``        A LibRaw development with no noise reduction: independent
               per-channel Poisson-Gaussian noise pushed through a colour
               matrix, which is what makes chroma blotches, plus the mild
               spatial correlation demosaicing leaves.
``render``     Monte Carlo render noise: relative (variance proportional to
               signal squared), heavy-tailed, with occasional fireflies.

Noise strength is set relative to each crop's own median luminance so that
exposure differences between sources do not change how hard a case is.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
MEDIA = ROOT / "local-test-media" / "inputs"
CACHE = ROOT / "output" / "denoise_lab" / "corpus"
LUMA = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)

# (name, source file, y0, x0, size in source pixels, downsample factor)
# 8x box downsampling cuts the source's own grain by 8, which keeps it well
# below the added noise; ``reference_grain_ratio`` checks that per case.
CROPS = (
    ("beach-sand-plant", "Affinity_DSC06898_DisplayP3_Linear_32f.exr", 2848, 0, 5120, 8),
    ("beach-sky-tree", "Affinity_DSC06898_DisplayP3_Linear_32f.exr", 0, 200, 5120, 8),
    ("taipei-signs", "Darktable-highlight-reconstruction_DSC06451.exr", 0, 2860, 5120, 8),
    ("taipei-street", "Darktable-highlight-reconstruction_DSC06451.exr", 200, 0, 5120, 8),
    ("blender-render", "Blender_5.2_TestScene_LinearRec709_32f.exr", 14, 14, 512, 1),
)


@dataclass(frozen=True)
class NoiseCase:
    name: str
    kind: str
    # Noise standard deviation at the crop's median luminance, as a fraction
    # of that luminance.
    relative_sigma: float


NOISE_CASES = (
    NoiseCase("processed-mild", "processed", 0.06),
    NoiseCase("processed-strong", "processed", 0.15),
    NoiseCase("raw-high-iso", "raw", 0.12),
    NoiseCase("render", "render", 0.12),
)


def _load_source(filename: str) -> np.ndarray:
    import sys

    sys.path.insert(0, str(ROOT / "backend"))
    from hdr_finisher import loader  # noqa: PLC0415 - heavy import, bench only

    image = loader.load_image(MEDIA / filename)[0]
    return np.asarray(image[..., :3], dtype=np.float32)


def clean_references() -> dict[str, np.ndarray]:
    """Clean crops, built once and cached as .npy."""
    CACHE.mkdir(parents=True, exist_ok=True)
    result: dict[str, np.ndarray] = {}
    sources: dict[str, np.ndarray] = {}
    for name, filename, y0, x0, size, factor in CROPS:
        path = CACHE / f"clean-{name}.npy"
        if not path.exists():
            if filename not in sources:
                sources[filename] = _load_source(filename)
            crop = sources[filename][y0:y0 + size, x0:x0 + size]
            if factor > 1:
                out = size // factor
                crop = crop[:out * factor, :out * factor].reshape(out, factor, out, factor, 3).mean(axis=(1, 3))
            np.save(path, np.maximum(crop, 0.0).astype(np.float32))
        result[name] = np.load(path)
    return result


def _median_luma(image: np.ndarray) -> float:
    return float(max(np.median(image @ LUMA), 1e-4))


def _blur3(field: np.ndarray, weight: float) -> np.ndarray:
    """A small symmetric 3x3 blur (weight>0) or sharpen (weight<0) per channel."""
    kernel = np.array([weight, 1.0 - 2.0 * weight, weight], dtype=np.float32)
    padded = np.pad(field, ((1, 1), (0, 0), (0, 0)), mode="reflect")
    field = sum(kernel[i] * padded[i:i + field.shape[0]] for i in range(3))
    padded = np.pad(field, ((0, 0), (1, 1), (0, 0)), mode="reflect")
    return sum(kernel[i] * padded[:, i:i + field.shape[1]] for i in range(3))


def add_noise(clean: np.ndarray, case: NoiseCase, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    median = _median_luma(clean)
    sigma_at_median = case.relative_sigma * median
    x = np.maximum(clean, 0.0)
    if case.kind == "processed":
        # Read noise sets the floor at a third of the median-level variance,
        # shot noise the rest; measured DSC06898 has the same split.
        b = (sigma_at_median ** 2) / 3.0
        a = (sigma_at_median ** 2 - b) / median
        y = x @ LUMA
        luma_noise = rng.standard_normal(y.shape).astype(np.float32) * np.sqrt(a * y + b)
        chroma = rng.standard_normal(x.shape).astype(np.float32) * (0.1 * np.sqrt(a * x + b))
        noise = luma_noise[..., None] + chroma
        noise = _blur3(noise, -0.08)  # the light sharpening the measured file carries
        return (x + noise).astype(np.float32)
    if case.kind == "raw":
        matrix = np.array([[1.75, -0.55, -0.20], [-0.25, 1.55, -0.30], [0.02, -0.52, 1.50]], dtype=np.float32)
        b = (sigma_at_median ** 2) / 4.0
        a = (sigma_at_median ** 2 - b) / median
        camera = np.maximum(x @ np.linalg.inv(matrix).T, 0.0)
        noise = rng.standard_normal(x.shape).astype(np.float32) * np.sqrt(a * camera + b)
        noise = _blur3(noise, 0.18)  # demosaic correlation
        return ((camera + noise) @ matrix.T).astype(np.float32)
    if case.kind == "render":
        relative = rng.standard_normal(x.shape[:2]).astype(np.float32)
        heavy = np.exp(case.relative_sigma * 1.1 * relative) - 1.0
        per_channel = rng.standard_normal(x.shape).astype(np.float32) * case.relative_sigma * 0.35
        noisy = x * (1.0 + heavy[..., None] + per_channel)
        fireflies = rng.random(x.shape[:2]) < 0.0004
        noisy[fireflies] += median * rng.uniform(20.0, 200.0, size=(int(fireflies.sum()), 1)).astype(np.float32)
        return np.maximum(noisy, 0.0).astype(np.float32)
    raise ValueError(case.kind)


def cases():
    """Yield (reference name, noise case, clean, noisy) for the whole corpus."""
    references = clean_references()
    for reference_index, (name, clean) in enumerate(references.items()):
        for case_index, case in enumerate(NOISE_CASES):
            if case.kind == "render" and not name.startswith("blender"):
                continue
            if name.startswith("blender") and case.kind != "render":
                continue
            yield name, case, clean, add_noise(clean, case, seed=1000 * reference_index + case_index)
