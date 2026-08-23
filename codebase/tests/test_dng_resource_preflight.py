from __future__ import annotations

from hdr_finisher.resource_preflight import (
    GIB,
    ResourceDecision,
    ResourceSnapshot,
    estimate_preview_resources,
    estimate_resources,
)


def test_large_import_rejects_when_reserve_leaves_too_little_ram() -> None:
    estimate = estimate_resources(
        width=72_480,
        height=4_096,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(16 * GIB, 7 * GIB, "test"),
    )
    assert estimate.import_decision is ResourceDecision.REJECT
    assert "72,480 × 4,096" in (estimate.import_error(72_480, 4_096) or "")


def test_retained_session_and_export_are_accounted_separately() -> None:
    resources = ResourceSnapshot(16 * GIB, 8 * GIB, "test")
    without_session = estimate_resources(
        width=8_000, height=6_000, samples=3, bytes_per_sample=2, resources=resources
    )
    with_session = estimate_resources(
        width=8_000,
        height=6_000,
        samples=3,
        bytes_per_sample=2,
        resources=resources,
        retained_session_bytes=2 * GIB,
    )
    assert with_session.conservative_import_peak_bytes - without_session.conservative_import_peak_bytes == 2 * GIB
    assert with_session.conservative_export_peak_bytes > with_session.conservative_import_peak_bytes


def test_export_only_failure_has_distinct_actionable_error() -> None:
    estimate = estimate_resources(
        width=8_000,
        height=6_000,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(16 * GIB, 4 * GIB, "test"),
    )
    assert estimate.import_decision is ResourceDecision.PASS
    assert estimate.export_decision is ResourceDecision.REJECT
    assert "choose a smaller export size" in (estimate.export_error(8_000, 6_000) or "")


def test_unknown_resources_only_allow_ordinary_sized_inputs() -> None:
    unknown = ResourceSnapshot(None, None, "unavailable")
    small = estimate_resources(
        width=1_024, height=768, samples=3, bytes_per_sample=2, resources=unknown
    )
    giant = estimate_resources(
        width=72_480, height=4_096, samples=3, bytes_per_sample=2, resources=unknown
    )
    assert small.import_decision is ResourceDecision.PASS
    assert giant.import_decision is ResourceDecision.UNKNOWN


def test_gpu_dimension_gate_builds_bounded_proxy_without_rejecting_cpu() -> None:
    estimate = estimate_resources(
        width=72_480,
        height=4_096,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(128 * GIB, 96 * GIB, "test"),
        gpu_max_texture_dimension=16_384,
    )
    assert estimate.import_decision is ResourceDecision.PASS
    assert estimate.full_frame_gpu_compatible is False
    assert max(estimate.proxy_width, estimate.proxy_height) == 4_096


def test_4k_preview_is_hard_capped_in_both_dimensions_without_memory_probe() -> None:
    estimate = estimate_preview_resources(
        width=6_000,
        height=8_000,
        max_dimension=4_096,
        resources=ResourceSnapshot(None, None, "unavailable"),
    )
    assert estimate.allowed is True
    assert (estimate.width, estimate.height) == (3_072, 4_096)
    assert estimate.width <= 4_096 and estimate.height <= 4_096


def test_full_preview_allows_common_24mp_source_with_safe_memory() -> None:
    estimate = estimate_preview_resources(
        width=6_000,
        height=4_000,
        max_dimension=6_000,
        resources=ResourceSnapshot(32 * GIB, 20 * GIB, "test"),
    )
    assert estimate.allowed is True
    assert (estimate.width, estimate.height) == (6_000, 4_000)


def test_full_preview_rejects_unsafe_memory_or_excessive_pixel_count() -> None:
    low_memory = estimate_preview_resources(
        width=6_000,
        height=4_000,
        max_dimension=6_000,
        resources=ResourceSnapshot(8 * GIB, 3 * GIB, "test"),
    )
    oversized = estimate_preview_resources(
        width=8_000,
        height=6_000,
        max_dimension=8_000,
        resources=ResourceSnapshot(64 * GIB, 48 * GIB, "test"),
    )
    assert low_memory.allowed is False
    assert "working memory" in low_memory.reason
    assert oversized.allowed is False
    assert "megapixels" in oversized.reason
