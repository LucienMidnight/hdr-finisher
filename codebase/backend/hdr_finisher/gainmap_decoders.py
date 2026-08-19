from __future__ import annotations

import math
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from typing import Any, Callable
from time import perf_counter

import numpy as np

from .avif_info import AVIFInfoError, inspect_avif
from .binaries import resolve_binary
from .subprocess_utils import hidden_window_options
from .color import (
    acescg_to_linear_srgb,
    linear_bt2020_to_acescg,
    linear_srgb_to_acescg,
    normalize_to_acescg,
)
from .models import JPEGGainMapProofMetadata


class GainMapDecodeError(RuntimeError):
    """Raised when a gain-map rendition cannot be reconstructed faithfully."""


def is_ultrahdr_jpeg(path: Path) -> bool:
    """Detect a JPEG gain-map container without accepting it as ordinary SDR."""
    payload = path.read_bytes()
    return (
        b"http://ns.adobe.com/hdr-gain-map/1.0/" in payload
        or b"urn:iso:std:iso:ts:21496:-1" in payload
    )


def inspect_jpeg_gain_map(path: Path, *, strict: bool = True) -> JPEGGainMapProofMetadata:
    ultrahdr = resolve_binary("ultrahdr_app")
    if ultrahdr is None:
        raise GainMapDecodeError(
            "JPEG Ultra HDR input requires the bundled ultrahdr_app decoder; "
            "refusing to silently open only the SDR fallback."
        )
    probe = _run([str(ultrahdr), "-m", "1", "-j", str(path), "-P"])
    text = f"{probe.stdout}\n{probe.stderr}"
    if "Ultra HDR Image: Yes" not in text:
        raise GainMapDecodeError("The JPEG advertises a gain map, but libultrahdr rejected its metadata.")

    return parse_jpeg_gain_map_probe(text, strict=strict)


def parse_jpeg_gain_map_probe(text: str, *, strict: bool = True) -> JPEGGainMapProofMetadata:
    """Parse libultrahdr's probe output without coupling callers to process execution."""

    def scalar(name: str, default: float) -> float:
        match = re.search(
            rf"{re.escape(name)}\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            return float(match.group(1))
        if strict:
            raise GainMapDecodeError(f"libultrahdr did not report required metadata field {name}.")
        return default

    use_base = bool(round(scalar("--useBaseColorSpace", 1.0)))
    return JPEGGainMapProofMetadata(
        use_base_color_space=use_base,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709" if use_base else "BT.2020",
        min_content_boost=max(scalar("--minContentBoost", 1.0), 1e-8),
        max_content_boost=max(scalar("--maxContentBoost", 1.0), 1e-8),
        gamma=max(scalar("--gamma", 1.0), 1e-8),
        hdr_capacity_min=max(scalar("--hdrCapacityMin", 1.0), 1e-8),
        hdr_capacity_max=max(scalar("--hdrCapacityMax", 1.0), 1.0),
        offset_sdr=max(scalar("--offsetSdr", 1.0 / 64.0), 0.0),
        offset_hdr=max(scalar("--offsetHdr", 1.0 / 64.0), 0.0),
    )


def decode_ultrahdr_jpeg(path: Path) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Return canonical HDR ACEScg plus the exact decoded SDR base in linear sRGB."""
    try:
        from PIL import Image, ImageCms, ImageOps
    except ImportError as exc:
        raise GainMapDecodeError("Pillow is required for JPEG Ultra HDR input.") from exc

    gain = inspect_jpeg_gain_map(path)
    ultrahdr = resolve_binary("ultrahdr_app")
    assert ultrahdr is not None  # inspect_jpeg_gain_map already enforced this.

    with Image.open(path) as image:
        raw_width, raw_height = image.size
        orientation = int(image.getexif().get(274, 1))
        icc_profile = image.info.get("icc_profile")
        profile_name = "sRGB"
        base = ImageOps.exif_transpose(image)
        if icc_profile:
            try:
                source_profile = ImageCms.ImageCmsProfile(_bytes_io(icc_profile))
                profile_name = ImageCms.getProfileName(source_profile).strip() or "unknown"
                base = ImageCms.profileToProfile(
                    base,
                    source_profile,
                    ImageCms.createProfile("sRGB"),
                    outputMode="RGB",
                )
            except Exception:
                base = base.convert("RGB")
                profile_name = "unknown"
        else:
            base = base.convert("RGB")
        encoded_sdr = np.asarray(base, dtype=np.float32) / np.float32(255.0)
    linear_sdr = _srgb_eotf(encoded_sdr)

    with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_decode_") as temp_name:
        raw_path = Path(temp_name) / "hdr-linear-rgba-f16.raw"
        _run(
            [
                str(ultrahdr),
                "-m",
                "1",
                "-j",
                str(path),
                "-o",
                "0",
                "-O",
                "4",
                "-z",
                str(raw_path),
            ]
        )
        expected_values = raw_width * raw_height * 4
        decoded = np.fromfile(raw_path, dtype="<f2")
        if decoded.size != expected_values:
            raise GainMapDecodeError(
                f"libultrahdr returned {decoded.size} half-float values; expected {expected_values}."
            )
        decoded = decoded.astype(np.float32).reshape(raw_height, raw_width, 4)[..., :3]

    # libultrahdr's linear output uses 1.0 == 203 nits. Convert to HDR
    # Finisher's invariant 0.18 == 100 nits before the gamut transform.
    decoded *= np.float32(203.0 * 0.18 / 100.0)
    hdr = linear_srgb_to_acescg(decoded) if gain.use_base_color_space else linear_bt2020_to_acescg(decoded)
    hdr = _apply_exif_orientation(hdr, orientation)
    if hdr.shape[:2] != linear_sdr.shape[:2]:
        raise GainMapDecodeError(
            f"Ultra HDR renditions disagree on oriented dimensions: HDR {hdr.shape[:2]}, SDR {linear_sdr.shape[:2]}."
        )

    metadata = {
        "bit_depth": "16f decoded from 8-bit JPEG + gain map",
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "jpeg_ultrahdr": True,
        "gain_map_applied": True,
        "sdr_base_preserved": True,
        "reference_white_nits": 100.0,
        "hdr_capacity_stops": float(math.log2(max(gain.hdr_capacity_max, 1.0))),
        "gain_map_metadata": gain.model_dump(mode="json"),
        "orientation": orientation,
        "icc_profile_name": profile_name,
    }
    return np.clip(hdr, 0.0, None).astype(np.float32), linear_sdr.astype(np.float32), metadata


def decode_avif(
    path: Path, *, progress: Callable[[str, str], None] | None = None
) -> tuple[np.ndarray, np.ndarray | None, dict[str, Any]]:
    """Decode plain, direct-HDR, or ISO 21496-1 gain-map AVIF to ACEScg."""
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        raise GainMapDecodeError("AVIF input requires the bundled avifdec decoder.")
    inspect_started = perf_counter()
    if progress:
        progress("metadata", "Inspecting AVIF gain-map metadata")
    try:
        info = inspect_avif(path)
    except AVIFInfoError as exc:
        raise GainMapDecodeError(f"Could not inspect AVIF input: {exc}") from exc

    inspect_ms = (perf_counter() - inspect_started) * 1000.0
    if info.get("gain_map_present"):
        image, sdr, metadata = _decode_avif_gain_map(path, info, progress=progress)
        metadata.setdefault("decode_timings_ms", {})["inspect"] = round(inspect_ms, 3)
        return image, sdr, metadata

    if progress:
        progress("decoding_avif", "Decoding full-resolution AVIF")
    encoded = _decode_avif_pixels(path, avifdec)
    color_space = _cicp_color_space(info.get("color_primaries"))
    transfer = _cicp_transfer(info.get("transfer_char"))
    if transfer is None:
        raise GainMapDecodeError(
            f"Unsupported or missing AVIF transfer characteristic {info.get('transfer_char')!r}; "
            "manual interpretation after an irreversible decode would be unsafe."
        )
    hdr = normalize_to_acescg(encoded, color_space, transfer)
    metadata = {
        "bit_depth": str(info.get("bit_depth", "unknown")),
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "avif_input": True,
        "avif_direct_hdr": transfer in {"PQ", "HLG"},
        "gain_map_applied": False,
        "source_cicp": _cicp_payload(info),
        "orientation": info.get("transformations", "None"),
        "avif_info": _without_raw(info),
        "decode_timings_ms": {"inspect": round(inspect_ms, 3)},
    }
    return hdr.astype(np.float32), None, metadata


def _decode_avif_gain_map(
    path: Path, info: dict[str, Any], *, progress: Callable[[str, str], None] | None = None
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    utility = resolve_binary("avifgainmaputil")
    avifdec = resolve_binary("avifdec")
    if utility is None or avifdec is None:
        raise GainMapDecodeError(
            "AVIF gain-map input requires both avifgainmaputil and avifdec; "
            "refusing to return only the base rendition."
        )
    gain = info.get("gain_map") or {}
    headrooms = [gain.get("base_headroom"), gain.get("alternate_headroom")]
    if any(value is None for value in headrooms):
        raise GainMapDecodeError("AVIF gain-map metadata is missing base or alternate HDR headroom.")
    hdr_headroom = max(float(value) for value in headrooms)
    sdr_headroom = min(float(value) for value in headrooms)
    if hdr_headroom <= sdr_headroom + 1e-6:
        raise GainMapDecodeError("AVIF gain-map metadata does not define distinct SDR and HDR renditions.")

    timings: dict[str, float] = {}
    with TemporaryDirectory(prefix="hdr_finisher_avif_gainmap_decode_") as temp_name:
        temp_dir = Path(temp_name)
        hdr_png = temp_dir / "hdr.png"
        if progress:
            progress("hdr_reconstruction", "Reconstructing full-resolution HDR gain map")
        phase_started = perf_counter()
        _run(
            [
                str(utility),
                "tonemap",
                str(path),
                str(hdr_png),
                "--headroom",
                _format_float(hdr_headroom),
                "--cicp-output",
                "9/16/9",
                "-d",
                "10",
            ]
        )
        # avifgainmaputil can write the reconstructed 16-bit PNG directly.
        # Avoiding an intermediate AVIF encode and subsequent decode is both
        # lossless and materially faster for full-resolution camera images.
        encoded_hdr = _decode_png_pixels(hdr_png)
        timings["hdr_reconstruction"] = round((perf_counter() - phase_started) * 1000.0, 3)

        if progress:
            progress("sdr_decode", "Decoding the AVIF SDR base rendition")
        phase_started = perf_counter()
        base_is_sdr = float(gain["base_headroom"]) <= float(gain["alternate_headroom"])
        if base_is_sdr and abs(float(gain["base_headroom"]) - sdr_headroom) <= 1e-6:
            encoded_sdr = _decode_avif_pixels(path, avifdec, temp_dir / "sdr-base.png")
            sdr_color = _cicp_color_space(info.get("color_primaries"))
            sdr_transfer = _cicp_transfer(info.get("transfer_char"))
            exact_sdr_base = True
        else:
            sdr_avif = temp_dir / "sdr-rendition.avif"
            _run(
                [
                    str(utility),
                    "tonemap",
                    str(path),
                    str(sdr_avif),
                    "--headroom",
                    _format_float(sdr_headroom),
                    "--cicp-output",
                    "1/13/0",
                    "-y",
                    "444",
                    "-d",
                    "8",
                    "-q",
                    "100",
                ]
            )
            encoded_sdr = _decode_avif_pixels(sdr_avif, avifdec, temp_dir / "sdr.png")
            sdr_color, sdr_transfer, exact_sdr_base = "sRGB", "sRGB", False
        timings["sdr_rendition"] = round((perf_counter() - phase_started) * 1000.0, 3)

        phase_started = perf_counter()
        metadata_text = _run([str(utility), "printmetadata", str(path)]).stdout
        timings["metadata"] = round((perf_counter() - phase_started) * 1000.0, 3)

    if progress:
        progress("color_conversion", "Converting AVIF renditions to the working space")
    phase_started = perf_counter()
    hdr = normalize_to_acescg(encoded_hdr, "BT.2020", "PQ")
    if sdr_transfer is None:
        raise GainMapDecodeError("The AVIF SDR rendition has no supported transfer characteristic.")
    sdr_acescg = normalize_to_acescg(encoded_sdr, sdr_color, sdr_transfer)
    linear_sdr = np.clip(acescg_to_linear_srgb(sdr_acescg), 0.0, 1.0)
    timings["color_conversion"] = round((perf_counter() - phase_started) * 1000.0, 3)
    if hdr.shape[:2] != linear_sdr.shape[:2]:
        raise GainMapDecodeError(
            f"AVIF gain-map renditions disagree on dimensions: HDR {hdr.shape[:2]}, SDR {linear_sdr.shape[:2]}."
        )

    metadata = {
        "bit_depth": str((info.get("alternate_image") or {}).get("bit_depth", "10")),
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "avif_input": True,
        "avif_gain_map": True,
        "gain_map_applied": True,
        "sdr_base_preserved": exact_sdr_base,
        "reference_white_nits": 100.0,
        "hdr_capacity_stops": hdr_headroom,
        "hdr_capacity_ratio": float(2.0**hdr_headroom),
        "source_cicp": _cicp_payload(info),
        "alternate_cicp": _cicp_payload(info.get("alternate_image") or {}),
        "gain_map_metadata": _parse_avif_gain_map_metadata(metadata_text),
        "orientation": info.get("transformations", "None"),
        "avif_info": _without_raw(info),
        "decode_timings_ms": timings,
    }
    return hdr.astype(np.float32), linear_sdr.astype(np.float32), metadata


def _decode_avif_pixels(path: Path, avifdec: Path, output: Path | None = None) -> np.ndarray:
    if output is not None:
        png_path = output
        png_path.parent.mkdir(parents=True, exist_ok=True)
        _run([str(avifdec), "-d", "16", str(path), str(png_path)])
        return _decode_png_pixels(png_path)

    with TemporaryDirectory(prefix="hdr_finisher_avif_decode_") as temp_name:
        png_path = Path(temp_name) / "decoded.png"
        _run([str(avifdec), "-d", "16", str(path), str(png_path)])
        return _decode_png_pixels(png_path)


def _decode_png_pixels(path: Path) -> np.ndarray:
    try:
        import imagecodecs
    except ImportError as exc:
        raise GainMapDecodeError("imagecodecs is required to retain 10/12-bit AVIF decoder output.") from exc

    decoded = imagecodecs.png_decode(path.read_bytes())
    array = np.asarray(decoded)
    if array.ndim == 2:
        array = np.repeat(array[..., None], 3, axis=2)
    if array.ndim != 3 or array.shape[2] < 3:
        raise GainMapDecodeError(f"avifdec returned an unsupported pixel layout {array.shape}.")
    if np.issubdtype(array.dtype, np.integer):
        array = array.astype(np.float32) / np.float32(np.iinfo(array.dtype).max)
    else:
        array = array.astype(np.float32)
    return array[..., :3]


def _parse_avif_gain_map_metadata(output: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for line in output.splitlines():
        match = re.match(r"\s*\*\s*([^:]+):\s*(.*)$", line)
        if not match:
            continue
        key = match.group(1).strip().lower().replace(" ", "_")
        value = match.group(2).strip()
        leading = re.match(r"([-+]?[0-9]*\.?[0-9]+)", value)
        metadata[key] = float(leading.group(1)) if leading else value
    return metadata


def _cicp_payload(info: dict[str, Any]) -> dict[str, Any]:
    return {
        "color_primaries": info.get("color_primaries"),
        "transfer_characteristics": info.get("transfer_char"),
        "matrix_coefficients": info.get("matrix_coeffs"),
    }


def _cicp_color_space(value: Any) -> str | None:
    mapping = {1: "sRGB", 9: "BT.2020", 12: "Display P3"}
    return mapping.get(value)


def _cicp_transfer(value: Any) -> str | None:
    mapping = {1: "BT.709", 8: "LINEAR", 13: "sRGB", 16: "PQ", 18: "HLG"}
    return mapping.get(value)


def _without_raw(info: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in info.items() if key != "raw"}


def _srgb_eotf(image: np.ndarray) -> np.ndarray:
    encoded = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    return np.where(
        encoded <= np.float32(0.04045),
        encoded / np.float32(12.92),
        np.power((encoded + np.float32(0.055)) / np.float32(1.055), np.float32(2.4)),
    ).astype(np.float32)


def _apply_exif_orientation(image: np.ndarray, orientation: int) -> np.ndarray:
    if orientation == 2:
        return np.flip(image, axis=1).copy()
    if orientation == 3:
        return np.flip(image, axis=(0, 1)).copy()
    if orientation == 4:
        return np.flip(image, axis=0).copy()
    if orientation == 5:
        return np.transpose(image, (1, 0, 2)).copy()
    if orientation == 6:
        return np.rot90(image, k=3).copy()
    if orientation == 7:
        return np.flip(np.transpose(image, (1, 0, 2)), axis=(0, 1)).copy()
    if orientation == 8:
        return np.rot90(image, k=1).copy()
    return image


def _bytes_io(payload: bytes):
    from io import BytesIO

    return BytesIO(payload)


def _format_float(value: float) -> str:
    return f"{value:.8f}".rstrip("0").rstrip(".")


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            **hidden_window_options(),
        )
    except OSError as exc:
        raise GainMapDecodeError(f"Could not start {Path(command[0]).name}: {exc}") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"Command failed with exit code {result.returncode}."
        raise GainMapDecodeError(detail)
    return result
