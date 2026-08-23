from __future__ import annotations

import ctypes
from dataclasses import dataclass
from enum import Enum
import os


GIB = 1024**3
UNKNOWN_RESOURCE_LARGE_THRESHOLD = 1 * GIB
DEFAULT_GPU_MAX_TEXTURE_DIMENSION = 16_384
DEFAULT_PROXY_LONG_EDGE = 4_096
FULL_PREVIEW_BASELINE_DIMENSION = 4_096
FULL_PREVIEW_MAX_DIMENSION = 16_384
FULL_PREVIEW_MAX_PIXELS = 26_000_000
FULL_PREVIEW_BYTES_PER_PIXEL = 80
FULL_PREVIEW_FIXED_OVERHEAD_BYTES = 256 * 1024**2


class ResourceDecision(str, Enum):
    PASS = "pass"
    REJECT = "reject"
    UNKNOWN = "unknown_resources"


@dataclass(frozen=True)
class ResourceSnapshot:
    total_ram_bytes: int | None
    available_ram_bytes: int | None
    source: str


@dataclass(frozen=True)
class ResourceEstimate:
    decoded_source_bytes: int
    acescg_source_bytes: int
    conversion_scratch_bytes: int
    fixed_overhead_bytes: int
    retained_session_bytes: int
    conservative_import_peak_bytes: int
    conservative_export_peak_bytes: int
    safety_reserve_bytes: int | None
    safely_available_bytes: int | None
    import_decision: ResourceDecision
    export_decision: ResourceDecision
    gpu_max_texture_dimension: int
    full_frame_gpu_compatible: bool
    proxy_width: int
    proxy_height: int

    def import_error(self, width: int, height: int) -> str | None:
        if self.import_decision is ResourceDecision.PASS:
            return None
        if self.import_decision is ResourceDecision.UNKNOWN:
            return (
                "System memory could not be measured. Large-file safety cannot be confirmed for "
                f"this {width:,} × {height:,} Experimental DNG."
            )
        return (
            f"Opening this {width:,} × {height:,} Experimental DNG is estimated to require "
            f"{self.conservative_import_peak_bytes / GIB:.2f} GiB of additional memory; only "
            f"{(self.safely_available_bytes or 0) / GIB:.2f} GiB is safely available."
        )

    def export_error(self, width: int, height: int) -> str | None:
        if self.export_decision is ResourceDecision.PASS:
            return None
        if self.export_decision is ResourceDecision.UNKNOWN:
            return (
                "System memory could not be measured. Full-resolution export safety cannot be "
                f"confirmed for this {width:,} × {height:,} Experimental DNG session."
            )
        return (
            f"Exporting this {width:,} × {height:,} Experimental DNG session is estimated to "
            f"require {self.conservative_export_peak_bytes / GIB:.2f} GiB of additional memory; "
            f"only {(self.safely_available_bytes or 0) / GIB:.2f} GiB is safely available. "
            "The document remains open; choose a smaller export size or free memory."
        )


@dataclass(frozen=True)
class PreviewResourceEstimate:
    requested_max_dimension: int
    width: int
    height: int
    pixel_count: int
    estimated_peak_bytes: int
    safely_available_bytes: int | None
    allowed: bool
    reason: str


def detect_memory_resources() -> ResourceSnapshot:
    try:
        import psutil

        memory = psutil.virtual_memory()
        return ResourceSnapshot(int(memory.total), int(memory.available), "psutil")
    except (ImportError, OSError, RuntimeError):
        pass

    if os.name == "nt":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return ResourceSnapshot(
                    int(status.ullTotalPhys), int(status.ullAvailPhys), "GlobalMemoryStatusEx"
                )
        except (AttributeError, OSError):
            pass

    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        return ResourceSnapshot(
            page_size * int(os.sysconf("SC_PHYS_PAGES")),
            page_size * int(os.sysconf("SC_AVPHYS_PAGES")),
            "sysconf",
        )
    except (AttributeError, OSError, TypeError, ValueError):
        return ResourceSnapshot(None, None, "unavailable")


def estimate_preview_resources(
    *,
    width: int,
    height: int,
    max_dimension: int,
    resources: ResourceSnapshot,
) -> PreviewResourceEstimate:
    if min(width, height, max_dimension) <= 0:
        raise ValueError("Preview dimensions must be positive.")
    requested = int(max_dimension)
    scale = min(1.0, requested / max(width, height))
    preview_width = max(1, int(round(width * scale)))
    preview_height = max(1, int(round(height * scale)))
    pixels = preview_width * preview_height
    estimated = FULL_PREVIEW_FIXED_OVERHEAD_BYTES + pixels * FULL_PREVIEW_BYTES_PER_PIXEL

    reserve = None
    safely_available = None
    if resources.total_ram_bytes is not None and resources.available_ram_bytes is not None:
        reserve = max(2 * GIB, int(resources.total_ram_bytes * 0.15))
        safely_available = max(0, resources.available_ram_bytes - reserve)

    reason = ""
    allowed = True
    if max(preview_width, preview_height) > FULL_PREVIEW_MAX_DIMENSION:
        allowed = False
        reason = (
            f"Full preview would be {preview_width:,} × {preview_height:,}, above the "
            f"{FULL_PREVIEW_MAX_DIMENSION:,}-pixel safety limit in either dimension."
        )
    elif pixels > FULL_PREVIEW_MAX_PIXELS:
        allowed = False
        reason = (
            f"Full preview would contain {pixels / 1_000_000:.1f} megapixels, above the "
            f"{FULL_PREVIEW_MAX_PIXELS / 1_000_000:.0f}-megapixel working-memory limit."
        )
    elif max(preview_width, preview_height) > FULL_PREVIEW_BASELINE_DIMENSION and safely_available is None:
        allowed = False
        reason = "System memory could not be measured, so Full preview safety cannot be confirmed."
    elif max(preview_width, preview_height) > FULL_PREVIEW_BASELINE_DIMENSION and estimated > (safely_available or 0):
        allowed = False
        reason = (
            f"Full preview is estimated to need {estimated / GIB:.2f} GiB of working memory; "
            f"only {(safely_available or 0) / GIB:.2f} GiB is safely available."
        )

    return PreviewResourceEstimate(
        requested_max_dimension=requested,
        width=preview_width,
        height=preview_height,
        pixel_count=pixels,
        estimated_peak_bytes=estimated,
        safely_available_bytes=safely_available,
        allowed=allowed,
        reason=reason,
    )


def estimate_resources(
    *,
    width: int,
    height: int,
    samples: int,
    bytes_per_sample: int,
    resources: ResourceSnapshot,
    retained_session_bytes: int = 0,
    strip_rows: int = 128,
    gpu_max_texture_dimension: int = DEFAULT_GPU_MAX_TEXTURE_DIMENSION,
    proxy_long_edge: int = DEFAULT_PROXY_LONG_EDGE,
    full_float_intermediates: int = 1,
) -> ResourceEstimate:
    if min(width, height, samples, bytes_per_sample) <= 0:
        raise ValueError("Resource dimensions and sample sizes must be positive.")
    pixels = width * height
    decoded = pixels * samples * bytes_per_sample
    acescg = pixels * 3 * 4
    scratch = min(width * max(samples, 3) * 4 * strip_rows * 3, 768 * 1024**2)
    fixed = 256 * 1024**2
    if full_float_intermediates < 1:
        raise ValueError("At least one full float32 working image is required.")
    import_peak = retained_session_bytes + decoded + acescg * full_float_intermediates + scratch + fixed
    export_codec_staging = max(decoded, acescg // 2)
    export_peak = retained_session_bytes + decoded + acescg * 2 + export_codec_staging + scratch + fixed

    reserve = None
    safely_available = None
    import_decision = ResourceDecision.UNKNOWN
    export_decision = ResourceDecision.UNKNOWN
    if resources.total_ram_bytes is not None and resources.available_ram_bytes is not None:
        reserve = max(2 * GIB, int(resources.total_ram_bytes * 0.15))
        safely_available = max(0, resources.available_ram_bytes - reserve)
        import_decision = (
            ResourceDecision.PASS if import_peak <= safely_available else ResourceDecision.REJECT
        )
        export_decision = (
            ResourceDecision.PASS if export_peak <= safely_available else ResourceDecision.REJECT
        )
    elif import_peak <= UNKNOWN_RESOURCE_LARGE_THRESHOLD:
        # Unknown resources are tolerated only inside the existing ordinary-size envelope.
        import_decision = ResourceDecision.PASS

    longest = max(width, height)
    scale = min(1.0, proxy_long_edge / longest)
    proxy_width = max(1, int(round(width * scale)))
    proxy_height = max(1, int(round(height * scale)))
    return ResourceEstimate(
        decoded_source_bytes=decoded,
        acescg_source_bytes=acescg,
        conversion_scratch_bytes=scratch,
        fixed_overhead_bytes=fixed,
        retained_session_bytes=max(0, retained_session_bytes),
        conservative_import_peak_bytes=import_peak,
        conservative_export_peak_bytes=export_peak,
        safety_reserve_bytes=reserve,
        safely_available_bytes=safely_available,
        import_decision=import_decision,
        export_decision=export_decision,
        gpu_max_texture_dimension=gpu_max_texture_dimension,
        full_frame_gpu_compatible=(
            width <= gpu_max_texture_dimension and height <= gpu_max_texture_dimension
        ),
        proxy_width=proxy_width,
        proxy_height=proxy_height,
    )
