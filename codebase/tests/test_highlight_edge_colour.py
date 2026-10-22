"""Edge-colour highlight reconstruction (prototype, October 2026): results on a synthetic clip."""
from __future__ import annotations

import numpy as np

from hdr_finisher.color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour

SIZE = 400


def scene():
    """Pink glow with a pale-green clipped blob in the middle and a dark bar beside it."""
    yy, xx = np.mgrid[:SIZE, :SIZE]
    radius = np.hypot(yy - SIZE / 2, xx - SIZE / 2)
    brightness = (4.0 * np.exp(-radius / 120.0)).astype(np.float32)
    transport = brightness[..., None] * np.array([1.0, 0.7, 0.9], np.float32)       # pink glow
    clipped = radius < 50
    transport[clipped] = brightness[clipped][:, None] * np.array([0.8, 1.0, 0.8], np.float32)  # wrong, greenish
    bar = (np.abs(xx - SIZE / 2 - 80) < 6)
    transport[bar] = 0.02
    clip_ratio = np.where(clipped, 1.0, 0.5).astype(np.float32)
    clip_ratio[bar] = 0.01
    return linear_bt2020_to_acescg(transport), clip_ratio, clipped, bar


def chroma(rgb):
    return rgb / np.maximum(rgb.sum(-1, keepdims=True), 1e-12)


def test_nothing_clipped_is_returned_unchanged() -> None:
    image, _, _, _ = scene()
    out, diagnostics = reconstruct_edge_colour(image, np.zeros(image.shape[:2], np.float32), 0.5)
    assert out is image and diagnostics["applied"] is False


def test_clipped_colour_moves_to_its_surroundings_and_brightness_is_kept() -> None:
    image, clip_ratio, clipped, _ = scene()
    out, _ = reconstruct_edge_colour(image, clip_ratio, 1.0)
    before, after = acescg_to_linear_bt2020(image), acescg_to_linear_bt2020(out)
    glow = chroma(np.array([1.0, 0.7, 0.9], np.float32))
    centre = (SIZE // 2, SIZE // 2)
    assert np.abs(chroma(after[centre]) - glow).max() < 0.03          # pink now, not green
    assert np.abs(chroma(before[centre]) - glow).max() > 0.05
    luma = np.array([0.2627, 0.6780, 0.0593], np.float32)
    inner = clipped & (np.hypot(*np.mgrid[:SIZE, :SIZE] - SIZE / 2) < 30)
    np.testing.assert_allclose((after[inner] @ luma), (before[inner] @ luma), rtol=1e-3)


def test_dark_objects_beside_the_light_stay_untouched() -> None:
    image, clip_ratio, _, bar = scene()
    out, _ = reconstruct_edge_colour(image, clip_ratio, 1.5)
    np.testing.assert_allclose(out[bar], image[bar], rtol=1e-4, atol=1e-6)
