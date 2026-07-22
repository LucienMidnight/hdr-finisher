from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess

from .binaries import resolve_binary
from .models import CapabilityInfo, CapabilityStatus


def _module_status(name: str, import_name: str) -> CapabilityInfo:
    if importlib.util.find_spec(import_name):
        return CapabilityInfo(name=name, status=CapabilityStatus.AVAILABLE, detail=f"Python module '{import_name}' is installed.")
    return CapabilityInfo(name=name, status=CapabilityStatus.MISSING, detail=f"Python module '{import_name}' is not installed.")


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
            [str(resolved)], capture_output=True, text=True, check=False, timeout=5
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


def probe_capabilities() -> dict[str, CapabilityInfo]:
    return {
        "numpy": _module_status("numpy", "numpy"),
        "pillow": _module_status("pillow", "PIL"),
        "tifffile": _module_status("tifffile", "tifffile"),
        "imageio": _module_status("imageio", "imageio"),
        "colour_science": _module_status("colour-science", "colour"),
        "openexr": _module_status("openexr", "OpenEXR"),
        "pillow_heif": _module_status("pillow-heif", "pillow_heif"),
        "exifread": _module_status("exifread", "exifread"),
        "avif_gain_map_encoder": _composite_status("avif gain map export", ["avifgainmaputil", "avifenc"]),
        "avif_encoder": _binary_status("avifenc", "avifenc"),
        "avif_decoder": _binary_status("avifdec", "avifdec"),
        "avif_gain_map_tool": _binary_status("avifgainmaputil", "avifgainmaputil"),
        "ultrahdr_encoder": _ultrahdr_status(),
        "jpegxl_encoder": _binary_status("cjxl", "cjxl"),
    }
