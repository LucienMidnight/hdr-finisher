"""Smooth highlight rebuild (prototype, October 2026): results on a synthetic clipped light."""
from __future__ import annotations

import numpy as np

from hdr_finisher.highlight_rebuild import gaussian_blur, rebuild_highlights
from hdr_finisher.models import RawHighlightReconstructionSettings

SIZE = 600
CENTRE = SIZE // 2


def settings(**changes) -> RawHighlightReconstructionSettings:
    # The scene is small, so sizes are scaled to keep the sunset's proportions:
    # the clipped area (r=60 px) is about 1.7x the core size, as on IMG_3129.
    changes.setdefault("rebuild_core_size_percent", 6.0)
    return RawHighlightReconstructionSettings(method="smooth_rebuild_v1", **changes)


def sunset_scene() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A glow falling off from the centre, clipped flat inside r=60 with a slight sag
    at the middle (as opposed colour leaves it), plus a dark object below."""
    yy, xx = np.mgrid[:SIZE, :SIZE]
    radius = np.hypot(yy - CENTRE, xx - CENTRE).astype(np.float32)
    glow = np.float32(4.0) * np.exp(-radius / 90.0)
    clip_level = np.float32(4.0 * np.exp(-60.0 / 90.0))
    clipped_value = clip_level * (1.0 - 0.04 * np.exp(-(radius / 30.0) ** 2))
    brightness = np.where(radius < 60.0, clipped_value, glow)
    colour = np.array([1.0, 0.55, 0.2], dtype=np.float32)
    image = brightness[..., None] * colour
    dark = (yy > CENTRE + 90) & (np.abs(xx - CENTRE) < 120)
    image[dark] = 0.02
    clip_ratio = np.where(radius < 60.0, 1.0, glow / clip_level * 0.9).astype(np.float32)
    clip_ratio[dark] = 0.01
    return image.astype(np.float32), clip_ratio, radius


def upward_profile(image: np.ndarray) -> np.ndarray:
    """Brightest channel straight up from the centre (away from the dark object)."""
    return image[CENTRE::-1, CENTRE].max(axis=-1)


def test_nothing_clipped_is_returned_unchanged() -> None:
    image, _, _ = sunset_scene()
    out, diagnostics = rebuild_highlights(image, np.zeros(image.shape[:2], np.float32), settings())
    assert out is image
    assert diagnostics["applied"] is False


def test_sharp_rebuild_makes_the_centre_brightest_and_removes_the_sag() -> None:
    image, clip_ratio, _ = sunset_scene()
    before = upward_profile(image)
    assert before[0] < before[40]  # the sag that made rings
    out, _ = rebuild_highlights(image, clip_ratio, settings())
    profile = upward_profile(out)
    assert profile[0] >= profile.max() * 0.995
    assert np.all(np.diff(profile[:200]) <= profile[0] * 1e-3)  # falls (or holds) outward


def test_bloom_adds_light_without_a_ring_and_spill_protects_dark_objects() -> None:
    image, clip_ratio, _ = sunset_scene()
    sharp, _ = rebuild_highlights(image, clip_ratio, settings())
    bloom, _ = rebuild_highlights(image, clip_ratio, settings(
        rebuild_bloom_radius_percent=10.0, rebuild_bloom_amount_percent=60.0, rebuild_spill_percent=10.0))
    profile = upward_profile(bloom)
    assert np.all(np.diff(profile[:250]) <= profile[0] * 1e-3)
    assert profile[120] > upward_profile(sharp)[120]  # light reached the glow
    dark = (slice(CENTRE + 100, CENTRE + 110), slice(CENTRE - 5, CENTRE + 5))
    full_spill, _ = rebuild_highlights(image, clip_ratio, settings(
        rebuild_bloom_radius_percent=10.0, rebuild_bloom_amount_percent=60.0, rebuild_spill_percent=100.0))
    added_low = bloom[dark].mean() - sharp[dark].mean()
    added_full = full_spill[dark].mean() - sharp[dark].mean()
    # Spill is soft by design: the cut grows with how much darker the object
    # is than the bloom landing on it. Here it clearly reduces, not removes.
    assert 0.0 < added_low < added_full * 0.7


def test_gaussian_blur_keeps_the_mean_and_spreads_a_point() -> None:
    field = np.zeros((200, 200), np.float32)
    field[100, 100] = 1.0
    blurred = gaussian_blur(field, 12.0)
    assert abs(blurred.sum() - 1.0) < 0.02
    assert blurred[100, 100] < 0.01 and blurred[100, 120] > 0.0
