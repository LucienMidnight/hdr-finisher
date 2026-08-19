from __future__ import annotations

import importlib.util
from functools import lru_cache
from pathlib import Path
import subprocess

from .binaries import resolve_binary
from .models import CapabilityInfo, CapabilityStatus
from .subprocess_utils import hidden_window_options


def _module_status(name: str, import_name: str) -> CapabilityInfo:
    if importlib.util.find_spec(import_name):
        return CapabilityInfo(name=name, status=CapabilityStatus.AVAILABLE, detail=f"Python module '{import_name}' is installed.")
    return CapabilityInfo(name=name, status=CapabilityStatus.MISSING, detail=f"Python module '{import_name}' is not installed.")


def _jpegxl_status(name: str) -> CapabilityInfo:
    try:
        import imagecodecs

        available = bool(imagecodecs.JPEGXL.available)
        version = imagecodecs.jpegxl_version() if available else "unavailable"
    except (ImportError, AttributeError, RuntimeError) as exc:
        return CapabilityInfo(name=name, status=CapabilityStatus.MISSING, detail=f"imagecodecs JPEG XL support is unavailable: {exc}")
    return CapabilityInfo(
        name=name,
        status=CapabilityStatus.AVAILABLE if available else CapabilityStatus.MISSING,
        detail=f"Bundled imagecodecs codec: {version}." if available else "The bundled imagecodecs build has no libjxl codec.",
    )


def _binary_status(name: str, command: str) -> CapabilityInfo:
    resolved = resolve_binary(command)
    if resolved:
        return CapabilityInfo(name=name, status=CapabilityStatus.AVAILABLE, detail=f"Binary found at {resolved}.")
    return CapabilityInfo(name=name, status=CapabilityStatus.MISSING, detail=f"Binary '{command}' was not found on PATH.")


def _composite_status(name: str, commands: list[str]) -> CapabilityInfo:
    resolved = {command: resolve_binary(command) for command in commands}
    missing = [command for command, path in resolved.items() if path is None]
    if missing:
        missing_text = ", ".join(missing)
        return CapabilityInfo(name=name, status=CapabilityStatus.MISSING, detail=f"Missing required binaries: {missing_text}.")

    detail = ", ".join(f"{command}={path}" for command, path in resolved.items() if path is not None)
    return CapabilityInfo(name=name, status=CapabilityStatus.AVAILABLE, detail=f"Required binaries found: {detail}.")


def _ultrahdr_status() -> CapabilityInfo:
    resolved = resolve_binary("ultrahdr_app")
    if resolved is None:
        return CapabilityInfo(
            name="JPEG Ultra HDR (JPG + Gain Map)",
            status=CapabilityStatus.MISSING,
            detail="Binary 'ultrahdr_app' was not found in the bundled bin/ directory or on PATH.",
        )
    try:
        result = subprocess.run(
            [str(resolved)],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
            **hidden_window_options(),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return CapabilityInfo(
            name="JPEG Ultra HDR (JPG + Gain Map)",
            status=CapabilityStatus.UNVERIFIED,
            detail=f"Found {Path(resolved).name}, but it could not be executed: {exc}",
        )
    help_text = f"{result.stdout}\n{result.stderr}".lower()
    if "ultra hdr demo application" not in help_text or "probe mode" not in help_text:
        return CapabilityInfo(
            name="JPEG Ultra HDR (JPG + Gain Map)",
            status=CapabilityStatus.UNVERIFIED,
            detail=f"Binary at {resolved} does not expose the expected current ultrahdr_app CLI.",
        )
    return CapabilityInfo(
        name="JPEG Ultra HDR (JPG + Gain Map)",
        status=CapabilityStatus.AVAILABLE,
        detail=(
            f"Compatible ultrahdr_app found at {resolved}. Each export is validated for both "
            "Ultra HDR v1 XMP and ISO 21496-1 metadata."
        ),
    )


@lru_cache(maxsize=1)
def _probe_capabilities_cached() -> dict[str, CapabilityInfo]:
    ultrahdr = _ultrahdr_status()
    return {
        "numpy": _module_status("numpy", "numpy"),
        "pillow": _module_status("pillow", "PIL"),
        "tifffile": _module_status("tifffile", "tifffile"),
        "imagecodecs": _module_status("imagecodecs", "imagecodecs"),
        "imageio": _module_status("imageio", "imageio"),
        "colour_science": _module_status("colour-science", "colour"),
        "openexr": _module_status("openexr", "OpenEXR"),
        "pillow_heif": _module_status("pillow-heif", "pillow_heif"),
        "exifread": _module_status("exifread", "exifread"),
        "rawpy": _module_status("rawpy / LibRaw", "rawpy"),
        "lensfunpy": _module_status("Lensfun corrections", "lensfunpy"),
        "avif_gain_map_encoder": _composite_status("avif gain map export", ["avifgainmaputil", "avifenc"]),
        "avif_encoder": _binary_status("avifenc", "avifenc"),
        "avif_decoder": _binary_status("avifdec", "avifdec"),
        "avif_gain_map_tool": _binary_status("avifgainmaputil", "avifgainmaputil"),
        "avif_gain_map_decoder": _composite_status(
            "AVIF gain-map input", ["avifgainmaputil", "avifdec"]
        ),
        "ultrahdr_encoder": ultrahdr,
        "ultrahdr_decoder": ultrahdr.model_copy(
            update={"name": "JPEG Ultra HDR input"}
        ),
        "jpegxl_import": _jpegxl_status("JPEG XL import"),
        "jpegxl_export": _jpegxl_status("JPEG XL HDR export"),
        "jpegxl_encoder": _jpegxl_status("JPEG XL HDR export"),
        "dng_import": _module_status("DNG import", "rawpy"),
        "raw_import": _module_status("RAW import", "rawpy"),
        "lens_correction": _module_status("Lensfun corrections", "lensfunpy"),
    }


def probe_capabilities() -> dict[str, CapabilityInfo]:
    """Return process-cached capability results without exposing the cached mapping."""
    return dict(_probe_capabilities_cached())


def invalidate_capability_cache() -> None:
    """Invalidate after executable search-path or bundled-binary configuration changes."""
    _probe_capabilities_cached.cache_clear()
