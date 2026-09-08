from __future__ import annotations

import numpy as np

from backend.hdr_finisher.detail import apply_detail
from backend.hdr_finisher.models import DetailAdjustments, PreviewKind


def _detail_fixture(size: int = 128) -> np.ndarray:
    y, x = np.mgrid[:size, :size].astype(np.float32)
    edge = np.tanh((x - size * 0.5 + 0.18 * (y - size * 0.5)) / 2.5)
    texture = 0.08 * np.sin(x * 0.71) * np.cos(y * 0.43)
    luminance = np.float32(0.18) * np.exp2(0.28 * edge + texture)
    return np.repeat(luminance[..., None], 3, axis=2).astype(np.float32)


def _mean_change(source: np.ndarray, result: np.ndarray) -> float:
    return float(np.mean(np.abs(result - source)))


def _horizontal_gradient(image: np.ndarray) -> float:
    return float(np.mean(np.abs(np.diff(image[..., 1], axis=1))))


def test_sharpen_amount_is_continuous_and_increases_edge_energy() -> None:
    image = _detail_fixture()
    changes = []
    results = []
    for amount in (1.0, 10.0, 80.0):
        result = apply_detail(
            image,
            DetailAdjustments(sharpen_amount=amount, sharpen_radius_px=0.8, sharpen_threshold=10.0),
            PreviewKind.HDR,
        )
        changes.append(_mean_change(image, result))
        results.append(result)

    assert 0.0 < changes[0] < changes[1] < changes[2]
    assert _horizontal_gradient(results[-1]) > _horizontal_gradient(image)


def test_sharpen_radius_and_threshold_have_independent_effects() -> None:
    image = _detail_fixture()
    small_radius = apply_detail(
        image,
        DetailAdjustments(sharpen_amount=80.0, sharpen_radius_px=0.3, sharpen_threshold=0.0),
        PreviewKind.HDR,
    )
    large_radius = apply_detail(
        image,
        DetailAdjustments(sharpen_amount=80.0, sharpen_radius_px=3.0, sharpen_threshold=0.0),
        PreviewKind.HDR,
    )
    high_threshold = apply_detail(
        image,
        DetailAdjustments(sharpen_amount=80.0, sharpen_radius_px=3.0, sharpen_threshold=100.0),
        PreviewKind.HDR,
    )

    assert _mean_change(small_radius, large_radius) > 1e-5
    assert _mean_change(image, high_threshold) < _mean_change(image, large_radius)


def test_sharpen_preserves_flat_fields_exactly() -> None:
    image = np.full((64, 64, 3), 0.18, dtype=np.float32)
    result = apply_detail(
        image,
        DetailAdjustments(sharpen_amount=200.0, sharpen_radius_px=3.0, sharpen_threshold=0.0),
        PreviewKind.HDR,
    )

    np.testing.assert_array_equal(result, image)


def test_texture_does_not_halo_thin_high_contrast_wires() -> None:
    height, width = 32, 2048
    center = width // 2

    for background, wire in ((0.5, 0.02), (0.05, 1.0)):
        image = np.full((height, width, 3), background, dtype=np.float32)
        image[:, center, :] = wire
        result = apply_detail(
            image,
            DetailAdjustments(texture_amount=100.0),
            PreviewKind.HDR,
        )

        neighboring_change = np.abs(np.delete(result - image, center, axis=1))
        assert float(np.max(neighboring_change)) < 0.005


def test_texture_edge_protection_retains_low_amplitude_surface_detail() -> None:
    height, width = 64, 2048
    y, x = np.mgrid[:height, :width].astype(np.float32)
    luminance = np.float32(0.18) * np.exp2(0.08 * np.sin(x * 0.71) * np.cos(y * 0.43))
    image = np.repeat(luminance[..., None], 3, axis=2).astype(np.float32)

    result = apply_detail(
        image,
        DetailAdjustments(texture_amount=100.0),
        PreviewKind.HDR,
    )

    assert _mean_change(image, result) > 0.001
    assert float(np.std(result[..., 1])) > float(np.std(image[..., 1]))


def test_sharpen_halo_stays_within_the_local_neighbourhood_bound() -> None:
    """A specular edge must not be sharpened into a value the picture never held.

    The final-output highlight limiter anchors its shoulder on the finished
    image, so unbounded sharpening ringing would silently reshape the delivered
    highlight rolloff.
    """
    image = np.full((64, 64, 3), 1e-6, dtype=np.float32)
    image[24:40, 24:40, :] = 12.0

    result = apply_detail(
        image,
        DetailAdjustments(sharpen_amount=100.0, sharpen_radius_px=0.8, sharpen_threshold=10.0),
        PreviewKind.HDR,
    )

    # 0.25 EV is the absolute halo allowance. Without it the range-relative
    # fence reads the near-black background as a seventeen-stop local range and
    # permits a two-stop excursion.
    assert float(np.max(result)) <= float(np.max(image)) * 2.0 ** 0.25 + 1e-4
    # The bound must not turn sharpening off at the edge it is protecting.
    assert _mean_change(image, result) > 1e-4


def test_sharpen_amount_keeps_responding_under_the_halo_bound() -> None:
    """The halo cap trims excursions without behaving like a strict fence.

    Amount must keep changing the picture while the bound holds the peak, so the
    final-output limiter sees a stable anchor at every Amount.
    """
    image = _detail_fixture()
    changes = []
    peaks = []
    for amount in (20.0, 83.0, 150.0):
        result = apply_detail(
            image,
            DetailAdjustments(sharpen_amount=amount, sharpen_radius_px=0.8, sharpen_threshold=10.0),
            PreviewKind.HDR,
        )
        changes.append(_mean_change(image, result))
        peaks.append(float(np.max(result)))

    assert changes[0] < changes[1] < changes[2]
    assert max(peaks) <= float(np.max(image)) * 2.0 ** 0.25 + 1e-4
    assert abs(peaks[-1] - peaks[0]) < 1e-5
