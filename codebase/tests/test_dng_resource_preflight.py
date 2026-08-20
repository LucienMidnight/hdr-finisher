from __future__ import annotations

from hdr_finisher.resource_preflight import (
    GIB,
    ResourceDecision,
    ResourceSnapshot,
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
