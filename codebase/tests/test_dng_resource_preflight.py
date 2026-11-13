from __future__ import annotations

import ctypes

import pytest

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


def test_full_preview_rejects_measured_host_memory_shortfall() -> None:
    low_memory = estimate_preview_resources(
        width=6_000,
        height=4_000,
        max_dimension=6_000,
        resources=ResourceSnapshot(8 * GIB, 3 * GIB, "test"),
    )
    assert low_memory.allowed is False
    assert "working memory" in low_memory.reason


def test_pixel_count_guideline_advises_but_does_not_disable_full() -> None:
    """PRD 5.1 and the Phase 2 exit gate: no heuristic memory estimate disables Full.

    The 26 MP figure models a monolithic GPU graph, which the backend cannot
    observe. It is reported so the frontend planner can weigh it, and it no
    longer refuses the request.
    """
    oversized = estimate_preview_resources(
        width=8_000,
        height=6_000,
        max_dimension=8_000,
        resources=ResourceSnapshot(64 * GIB, 48 * GIB, "test"),
    )
    assert oversized.allowed is True
    assert oversized.reason == ""
    assert oversized.decides_gpu_viability is False
    assert any("megapixels" in advisory for advisory in oversized.advisories)


def test_unmeasurable_host_memory_advises_but_does_not_disable_full() -> None:
    unknown = estimate_preview_resources(
        width=6_000,
        height=4_000,
        max_dimension=6_000,
        resources=ResourceSnapshot(None, None, "unavailable"),
    )
    assert unknown.allowed is True
    assert any("could not be measured" in advisory for advisory in unknown.advisories)


def test_hard_request_dimension_bound_still_rejects() -> None:
    # Not a resource heuristic: the current request models cap a single
    # dimension at 16,384. Phase 3's bounded tile transport removes the need.
    oversized = estimate_preview_resources(
        width=40_000,
        height=30_000,
        max_dimension=40_000,
        resources=ResourceSnapshot(64 * GIB, 48 * GIB, "test"),
    )
    assert oversized.allowed is False
    assert "request limit" in oversized.reason


@pytest.mark.usefixtures("native_preflight_memory")
def test_running_platform_reports_real_memory_without_optional_psutil(monkeypatch):
    import sys
    from hdr_finisher.resource_preflight import detect_memory_resources
    monkeypatch.setitem(sys.modules, "psutil", None)
    resources = detect_memory_resources()
    assert resources.total_ram_bytes is not None and resources.total_ram_bytes >= 512 * 1024**2
    assert resources.available_ram_bytes is not None
    assert 0 <= resources.available_ram_bytes <= resources.total_ram_bytes
    assert resources.source != "unavailable"


@pytest.mark.usefixtures("native_preflight_memory")
def test_linux_uses_kernel_reclaimable_available_memory(monkeypatch):
    from hdr_finisher import resource_preflight as preflight
    monkeypatch.setattr(preflight.sys, "platform", "linux")
    monkeypatch.setattr(preflight.Path, "read_text", lambda self: "MemTotal: 8388608 kB\nMemFree: 100 kB\nMemAvailable: 3145728 kB\n")
    resources = preflight.detect_memory_resources()
    assert resources.total_ram_bytes == 8 * GIB
    assert resources.available_ram_bytes == 3 * GIB


class MacMemoryReader:
    def __init__(self, level=51, pressure=1, missing=(), invalid_sizes=()):
        self.values = {
            b"hw.memsize": 8 * GIB,
            b"kern.memorystatus_level": level,
            b"kern.memorystatus_vm_pressure_level": pressure,
        }
        self.missing = missing
        self.invalid_sizes = invalid_sizes
        self.vm_reads = 0
        self.released = []

    def sysctlbyname(self, name, value, size, new_value, new_size):
        if name in self.missing:
            return -1
        value._obj.value = self.values[name]
        if name in self.invalid_sizes:
            size._obj.value = 1
        return 0

    def mach_host_self(self):
        return 42

    def host_page_size(self, host, size):
        size._obj.value = 16_384
        return 0

    def host_statistics(self, host, flavor, pages, count):
        self.vm_reads += 1
        pages[0], pages[2], pages[14] = 2_000, 130_072, 1_000
        return 0

    def mach_port_deallocate(self, task, host):
        self.released.append((task, host))
        return 0


@pytest.fixture
def mac_memory_reader(monkeypatch, native_preflight_memory):
    from hdr_finisher import resource_preflight as preflight
    monkeypatch.setattr(preflight.sys, "platform", "darwin")
    monkeypatch.setattr(ctypes.c_uint32, "in_dll", lambda library, name: ctypes.c_uint32(7))

    def read(**kwargs):
        native = MacMemoryReader(**kwargs)
        monkeypatch.setattr(preflight.ctypes, "CDLL", lambda path: native)
        return native, preflight.detect_memory_resources()

    return read


@pytest.mark.parametrize("level", [0, 1, 51, 100])
def test_mac_normal_pressure_uses_kernel_percentage(mac_memory_reader, level):
    native, resources = mac_memory_reader(level=level)
    assert resources == ResourceSnapshot(8 * GIB, 8 * GIB * level // 100, "sysctl/memorystatus")
    assert native.vm_reads == 0
    estimate = estimate_resources(
        width=8_000, height=6_000, samples=3, bytes_per_sample=2, resources=resources
    )
    assert estimate.import_decision is (ResourceDecision.PASS if level >= 51 else ResourceDecision.REJECT)


@pytest.mark.parametrize("kwargs", [
    {"missing": (b"kern.memorystatus_level",)},
    {"missing": (b"kern.memorystatus_vm_pressure_level",)},
    {"invalid_sizes": (b"kern.memorystatus_level",)},
    {"invalid_sizes": (b"kern.memorystatus_vm_pressure_level",)},
    {"level": -1},
    {"level": 101},
    {"pressure": 0},
    {"pressure": 2},
    {"pressure": 4},
    {"pressure": 99},
])
def test_mac_pressure_or_unusable_sysctl_keeps_conservative_fallback(mac_memory_reader, kwargs):
    native, resources = mac_memory_reader(**kwargs)
    assert resources == ResourceSnapshot(8 * GIB, 2 * GIB, "mach/sysctl")
    assert native.vm_reads == 1
    assert native.released == [(7, 42)]
    estimate = estimate_resources(
        width=8_000, height=6_000, samples=3, bytes_per_sample=2, resources=resources
    )
    assert estimate.import_decision is ResourceDecision.REJECT
