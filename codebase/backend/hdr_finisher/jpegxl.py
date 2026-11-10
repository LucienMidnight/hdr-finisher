from __future__ import annotations

import subprocess
import json
import math
from pathlib import Path
import struct
from typing import Any, Callable

import numpy as np

from .color import acescg_to_linear_bt2020, normalize_to_acescg_bounded
from .binaries import resolve_binary
from .color_context import scene_linear_to_nits, validate_reference_white


class JPEGXLError(RuntimeError):
    """Raised when JPEG XL pixels or their HDR interpretation are unsafe."""


_APP_BOX_TYPE = b"hfmd"
_APP_METADATA_VERSION = 3
_JPEGXL_PRECISIONS: dict[str, tuple[int, str, Any]] = {
    "uint10": (10, "integer", np.uint16),
    "uint12": (12, "integer", np.uint16),
    "uint16": (16, "integer", np.uint16),
    "float16": (16, "float", np.float16),
    "float32": (32, "float", np.float32),
}


def jpegxl_available() -> bool:
    try:
        import imagecodecs

        return bool(imagecodecs.JPEGXL.available)
    except (ImportError, AttributeError):
        return False


def inspect_jpegxl(path: Path) -> dict[str, Any]:
    """Inspect structured libjxl DATA/ORIGINAL profiles and our optional marker."""

    return _inspect_jpegxl_payload(path.read_bytes())


def _inspect_jpegxl_payload(payload: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {"app_metadata": _validate_app_metadata(_read_app_metadata_box(payload))}
    result.update(_probe_basic_info(payload))
    return result


def decode_jpegxl(
    path: Path, *, cancelled: Callable[[], bool] | None = None, encoded_samples: bool = False
) -> tuple[np.ndarray, dict[str, Any]]:
    """Library may request normalized-range samples before colour conversion.

    In that mode sample_* describes the returned buffer, while the remaining
    metadata preserves Grade's post-decoder interpretation and override order.
    """
    _raise_if_cancelled(cancelled)
    try:
        import imagecodecs
    except ImportError as exc:
        raise JPEGXLError("JPEG XL input requires the bundled imagecodecs/libjxl decoder.") from exc
    try:
        payload = path.read_bytes()
        info = _inspect_jpegxl_payload(payload)
        _raise_if_cancelled(cancelled)
        from .cpu_budget import logical_cpus
        decoded = np.asarray(imagecodecs.jpegxl_decode(payload, numthreads=logical_cpus()))
    except Exception as exc:
        raise JPEGXLError(f"Could not decode JPEG XL input: {exc}") from exc

    if decoded.ndim == 2:
        decoded = decoded[..., None]
    if decoded.ndim != 3:
        raise JPEGXLError(f"JPEG XL returned unsupported pixel dimensions {decoded.shape}.")
    if decoded.shape[2] == 1:
        decoded = np.repeat(decoded, 3, axis=2)
    decoded = decoded[..., :3]

    bit_depth = _resolve_bit_depth(decoded, info)
    sample_type = _resolve_sample_type(decoded, info)
    if np.issubdtype(decoded.dtype, np.integer):
        if np.issubdtype(decoded.dtype, np.signedinteger) and np.any(decoded < 0):
            raise JPEGXLError("JPEG XL returned negative integer samples.")
        maximum = float((1 << bit_depth) - 1)
        if int(np.max(decoded, initial=0)) > maximum:
            raise JPEGXLError(f"JPEG XL samples exceed the declared {bit_depth}-bit range.")
        encoded = decoded.astype(np.float32)
        encoded *= np.float32(1.0 / maximum)
    else:
        encoded = decoded.astype(np.float32, copy=False)
    del decoded

    app_metadata = info.get("app_metadata") or {}
    # hfmd describes our authored samples; do not apply DATA interpretation twice.
    interpretation = app_metadata or _standard_data_interpretation(info)
    color_space = interpretation.get("color_space")
    transfer = interpretation.get("transfer_function")
    confident = bool(color_space and transfer)
    if confident:
        image = encoded if encoded_samples else normalize_to_acescg_bounded(
            encoded, str(color_space), str(transfer), cancelled=cancelled
        )
        metadata_color = "ACEScg"
        metadata_transfer = "LINEAR"
    else:
        # Preserve signal values until the user confirms the third-party file's
        # encoded primaries and transfer in the existing interpretation panel.
        image = encoded
        metadata_color = "unknown"
        metadata_transfer = None

    metadata = {
        "bit_depth": str(bit_depth),
        "sample_type": sample_type,
        "color_space": metadata_color,
        "transfer_function": metadata_transfer,
        "jpegxl_input": True,
        "jpegxl_direct_hdr": transfer in {"PQ", "HLG"},
        "jpegxl_info": {key: value for key, value in info.items() if key != "app_metadata"},
        "needs_color_override": not confident,
    }
    if app_metadata:
        metadata["jpegxl_app_metadata"] = app_metadata
        metadata["source_reference_white_nits"] = app_metadata.get("reference_white_nits")
    if confident:
        metadata["source_color_space_label"] = color_space
        metadata["source_transfer_function_label"] = transfer
        if encoded_samples:
            metadata["sample_color_space"] = color_space
            metadata["sample_transfer_function"] = transfer
        metadata["decoder_normalized_to_acescg"] = True
        if transfer in {"PQ", "HLG"}:
            metadata["decoder_reference_white_nits"] = 203.0
    return np.asarray(image, dtype=np.float32), metadata


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise JPEGXLError("Import cancelled")


def encode_hdr_jpegxl(
    image: np.ndarray,
    quality: int,
    precision: str = "uint12",
    *,
    exif_payload: bytes | None = None,
    reference_white_nits: int = 203,
) -> bytes:
    if precision not in _JPEGXL_PRECISIONS:
        raise JPEGXLError(f"Unsupported JPEG XL precision: {precision}")
    try:
        import imagecodecs
    except ImportError as exc:
        raise JPEGXLError("JPEG XL export requires the bundled imagecodecs/libjxl encoder.") from exc
    if not 1 <= int(quality) <= 100:
        raise JPEGXLError("JPEG XL quality must be between 1 and 100.")
    bit_depth, sample_type, storage_type = _JPEGXL_PRECISIONS[precision]

    linear_bt2020 = np.clip(acescg_to_linear_bt2020(image[..., :3]), 0.0, None)
    reference_white_nits = validate_reference_white(reference_white_nits)
    luminance_nits = np.clip(scene_linear_to_nits(linear_bt2020, reference_white_nits), 0.0, 10000.0)
    pq = _pq_oetf(luminance_nits)
    if sample_type == "integer":
        maximum = float((1 << bit_depth) - 1)
        encoded = np.clip(np.round(pq * np.float32(maximum)), 0.0, maximum).astype(storage_type)
    else:
        encoded = pq.astype(storage_type)
    distance = max(0.0, (100.0 - float(quality)) / 25.0)
    try:
        payload = imagecodecs.jpegxl_encode(
            encoded,
            effort=7,
            distance=distance,
            lossless=quality == 100,
            bitspersample=bit_depth,
            primaries=imagecodecs.JPEGXL.PRIMARIES.BT2100,
            transfer=imagecodecs.JPEGXL.TRANSFER_FUNCTION.PQ,
            usecontainer=True,
        )
    except Exception as exc:
        raise JPEGXLError(f"JPEG XL encoding failed: {exc}") from exc
    marker = {
        "schema_version": _APP_METADATA_VERSION,
        "color_space": "BT.2020",
        "transfer_function": "PQ",
        "bit_depth": bit_depth,
        "sample_type": sample_type,
        "reference_white_nits": float(reference_white_nits),
    }
    result = bytes(payload) + _box(_APP_BOX_TYPE, json.dumps(marker, separators=(",", ":")).encode("utf-8"))
    return result + (_jpegxl_exif_box(exif_payload) if exif_payload else b"")


def encode_sdr_jpegxl(
    image: np.ndarray,
    quality: int,
    *,
    dithering: str = "off",
    exif_payload: bytes | None = None,
) -> bytes:
    """Encode the authored display-linear sRGB branch as conventional 8-bit JXL."""

    try:
        import imagecodecs
    except ImportError as exc:
        raise JPEGXLError("JPEG XL export requires the bundled imagecodecs/libjxl encoder.") from exc
    if not 1 <= int(quality) <= 100:
        raise JPEGXLError("JPEG XL quality must be between 1 and 100.")

    srgb = _srgb_oetf(np.clip(image[..., :3], 0.0, 1.0))
    if dithering != "off":
        _dither_srgb_in_place(srgb, amplitude_lsb=0.5 if dithering == "subtle" else 1.0)
    encoded = np.clip(
        np.round(srgb * np.float32(255.0)),
        0.0,
        255.0,
    ).astype(np.uint8)
    distance = max(0.0, (100.0 - float(quality)) / 25.0)
    try:
        payload = imagecodecs.jpegxl_encode(
            encoded,
            effort=7,
            distance=distance,
            lossless=quality == 100,
            bitspersample=8,
            primaries=imagecodecs.JPEGXL.PRIMARIES.SRGB,
            transfer=imagecodecs.JPEGXL.TRANSFER_FUNCTION.SRGB,
            usecontainer=True,
        )
    except Exception as exc:
        raise JPEGXLError(f"JPEG XL encoding failed: {exc}") from exc
    marker = {
        "schema_version": _APP_METADATA_VERSION,
        "color_space": "sRGB",
        "transfer_function": "sRGB",
        "bit_depth": 8,
        "sample_type": "integer",
        "reference_white_nits": 100.0,
    }
    result = bytes(payload) + _box(_APP_BOX_TYPE, json.dumps(marker, separators=(",", ":")).encode("utf-8"))
    return result + (_jpegxl_exif_box(exif_payload) if exif_payload else b"")


def validate_jpegxl(
    payload: bytes, expected_shape: tuple[int, int], precision: str = "uint12"
) -> str:
    try:
        bit_depth, sample_type, _storage_type = _JPEGXL_PRECISIONS[precision]
    except KeyError as exc:
        raise JPEGXLError(f"Unsupported JPEG XL precision: {precision}") from exc
    try:
        import imagecodecs

        from .cpu_budget import logical_cpus
        decoded = np.asarray(imagecodecs.jpegxl_decode(payload, numthreads=logical_cpus()))
    except Exception as exc:
        raise JPEGXLError(f"JPEG XL validation decode failed: {exc}") from exc
    if decoded.shape[:2] != expected_shape:
        raise JPEGXLError(
            f"JPEG XL validation returned {decoded.shape[:2]}; expected {expected_shape}."
        )
    if not np.all(np.isfinite(decoded)):
        raise JPEGXLError("JPEG XL validation returned non-finite samples.")
    metadata = _validate_app_metadata(_read_app_metadata_box(payload))
    if metadata.get("color_space") != "BT.2020" or metadata.get("transfer_function") != "PQ":
        raise JPEGXLError("JPEG XL output is missing its Rec.2020 PQ interpretation marker.")
    if metadata.get("bit_depth") != bit_depth or metadata.get("sample_type") != sample_type:
        raise JPEGXLError("JPEG XL output marker does not match the selected precision.")
    if sample_type == "integer":
        maximum = (1 << bit_depth) - 1
        if not np.issubdtype(decoded.dtype, np.integer):
            raise JPEGXLError(f"JPEG XL output did not decode to {bit_depth}-bit integer samples.")
        if np.issubdtype(decoded.dtype, np.signedinteger) and np.any(decoded < 0):
            raise JPEGXLError("JPEG XL output decoded to negative integer samples.")
        if int(np.max(decoded, initial=0)) > maximum:
            raise JPEGXLError(f"JPEG XL output exceeds its declared {bit_depth}-bit range.")
    elif not np.issubdtype(decoded.dtype, np.floating) or decoded.dtype.itemsize * 8 != bit_depth:
        raise JPEGXLError(f"JPEG XL output did not decode to {bit_depth}-bit floating-point samples.")
    basic_info = _probe_basic_info(payload)
    if basic_info.get("bits_per_sample") not in {None, bit_depth}:
        raise JPEGXLError("JPEG XL codestream precision does not match its marker.")
    exponent_bits = basic_info.get("exponent_bits_per_sample")
    if exponent_bits is not None:
        stream_sample_type = "float" if int(exponent_bits) > 0 else "integer"
        if stream_sample_type != sample_type:
            raise JPEGXLError("JPEG XL codestream sample type does not match its marker.")
    return f"Validated by decoding the {bit_depth}-bit {sample_type} Rec.2020 PQ result."


def validate_sdr_jpegxl(payload: bytes, expected_shape: tuple[int, int]) -> str:
    try:
        import imagecodecs

        from .cpu_budget import logical_cpus
        decoded = np.asarray(imagecodecs.jpegxl_decode(payload, numthreads=logical_cpus()))
    except Exception as exc:
        raise JPEGXLError(f"JPEG XL validation decode failed: {exc}") from exc
    if decoded.shape[:2] != expected_shape:
        raise JPEGXLError(
            f"JPEG XL validation returned {decoded.shape[:2]}; expected {expected_shape}."
        )
    if not np.all(np.isfinite(decoded)):
        raise JPEGXLError("JPEG XL validation returned non-finite samples.")
    metadata = _validate_app_metadata(_read_app_metadata_box(payload))
    expected_marker = {
        "color_space": "sRGB",
        "transfer_function": "sRGB",
        "bit_depth": 8,
        "sample_type": "integer",
    }
    if any(metadata.get(key) != value for key, value in expected_marker.items()):
        raise JPEGXLError("JPEG XL SDR output is missing its 8-bit sRGB interpretation marker.")
    if not np.issubdtype(decoded.dtype, np.integer) or decoded.dtype.itemsize != 1:
        raise JPEGXLError("JPEG XL SDR output did not decode to 8-bit integer samples.")
    if np.issubdtype(decoded.dtype, np.signedinteger) and np.any(decoded < 0):
        raise JPEGXLError("JPEG XL SDR output decoded to negative integer samples.")
    if int(np.max(decoded, initial=0)) > 255:
        raise JPEGXLError("JPEG XL SDR output exceeds its declared 8-bit range.")
    basic_info = _probe_basic_info(payload)
    if basic_info.get("bits_per_sample") not in {None, 8}:
        raise JPEGXLError("JPEG XL SDR codestream precision does not match its marker.")
    exponent_bits = basic_info.get("exponent_bits_per_sample")
    if exponent_bits not in {None, 0}:
        raise JPEGXLError("JPEG XL SDR codestream is not integer encoded.")
    return "Validated by decoding the 8-bit sRGB SDR result."


def _pq_oetf(luminance_nits: np.ndarray) -> np.ndarray:
    m1 = np.float32(2610.0 / 16384.0)
    m2 = np.float32(2523.0 / 32.0)
    c1 = np.float32(3424.0 / 4096.0)
    c2 = np.float32(2413.0 / 128.0)
    c3 = np.float32(2392.0 / 128.0)
    normalized = np.clip(luminance_nits.astype(np.float32, copy=False) / np.float32(10000.0), 0.0, 1.0)
    powered = np.power(normalized, m1)
    return np.power((c1 + c2 * powered) / (np.float32(1.0) + c3 * powered), m2).astype(np.float32)


def _srgb_oetf(linear: np.ndarray) -> np.ndarray:
    linear = linear.astype(np.float32, copy=False)
    return np.where(
        linear <= np.float32(0.0031308),
        linear * np.float32(12.92),
        np.float32(1.055) * np.power(linear, np.float32(1.0 / 2.4)) - np.float32(0.055),
    ).astype(np.float32)


def _dither_srgb_in_place(
    srgb: np.ndarray, *, amplitude_lsb: float, chunk_rows: int = 256
) -> None:
    height, width, channel_count = srgb.shape
    x = np.arange(width, dtype=np.uint32)[None, :]
    for row_start in range(0, height, chunk_rows):
        row_end = min(height, row_start + chunk_rows)
        y = np.arange(row_start, row_end, dtype=np.uint32)[:, None]
        for channel in range(channel_count):
            seed = np.uint32(((channel + 1) * 0x9E3779B9) & 0xFFFFFFFF)
            value = x * np.uint32(0x1F123BB5) ^ y * np.uint32(0x5F356495) ^ seed
            value ^= value >> np.uint32(16)
            value *= np.uint32(0x7FEB352D)
            value ^= value >> np.uint32(15)
            noise = (
                ((value & np.uint32(0xFFFF)).astype(np.float32) / np.float32(65535.0) - 0.5)
                * np.float32((2.0 * amplitude_lsb) / 255.0)
            )
            srgb[row_start:row_end, :, channel] += noise


def _jpegxl_exif_box(exif_payload: bytes) -> bytes:
    tiff_payload = exif_payload[6:] if exif_payload.startswith(b"Exif\x00\x00") else exif_payload
    return _box(b"Exif", b"\x00\x00\x00\x00" + tiff_payload)


def _resolve_bit_depth(image: np.ndarray, info: dict[str, Any]) -> int:
    probed = info.get("bits_per_sample")
    marker = (info.get("app_metadata") or {}).get("bit_depth")
    if probed is not None:
        try:
            probed = int(probed)
        except (TypeError, ValueError) as exc:
            raise JPEGXLError("JPEG XL decoder returned an invalid sample precision.") from exc
        if probed <= 0 or probed > 32:
            raise JPEGXLError("JPEG XL decoder returned an unsupported sample precision.")
    if marker is not None and probed is not None and int(marker) != probed:
        raise JPEGXLError("JPEG XL sample precision conflicts with its HDR Finisher marker.")
    bit_depth = int(probed or marker or 0)
    if np.issubdtype(image.dtype, np.integer):
        if not bit_depth:
            if image.dtype == np.uint8:
                return 8
            raise JPEGXLError(
                "JPEG XL integer precision is unavailable; refusing to infer bit depth from image brightness."
            )
        if bit_depth > np.iinfo(image.dtype).bits:
            raise JPEGXLError("JPEG XL precision exceeds the decoded integer storage type.")
        return bit_depth
    return bit_depth or int(image.dtype.itemsize * 8)


def _resolve_sample_type(image: np.ndarray, info: dict[str, Any]) -> str:
    marker = (info.get("app_metadata") or {}).get("sample_type")
    exponent_bits = info.get("exponent_bits_per_sample")
    probed = None if exponent_bits is None else ("float" if int(exponent_bits) > 0 else "integer")
    decoded = "integer" if np.issubdtype(image.dtype, np.integer) else "float"
    declared = marker or probed or decoded
    if marker is not None and probed is not None and marker != probed:
        raise JPEGXLError("JPEG XL sample type conflicts with its HDR Finisher marker.")
    if declared != decoded:
        raise JPEGXLError("JPEG XL declared sample type conflicts with its decoded pixels.")
    return str(declared)


def _validate_app_metadata(value: dict[str, Any]) -> dict[str, Any]:
    if not value:
        return {}
    common = {
        "schema_version",
        "color_space",
        "transfer_function",
        "bit_depth",
        "reference_white_nits",
    }
    schema_version = value.get("schema_version")
    if schema_version in {1, 2}:
        raise JPEGXLError("JPEG XL HDR Finisher prototype marker v1/v2 is unsupported; re-export with v3.")
    if schema_version == _APP_METADATA_VERSION:
        if set(value) != common | {"sample_type"}:
            raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid schema.")
        interpretation = (value.get("color_space"), value.get("transfer_function"))
        if interpretation == ("sRGB", "sRGB"):
            allowed_precisions = {(8, "integer")}
        elif interpretation[0] == "BT.2020" and interpretation[1] in {"PQ", "HLG"}:
            allowed_precisions = {
                (10, "integer"),
                (12, "integer"),
                (16, "integer"),
                (16, "float"),
                (32, "float"),
            }
        else:
            raise JPEGXLError("JPEG XL HDR Finisher marker has an unsupported color interpretation.")
        if (value.get("bit_depth"), value.get("sample_type")) not in allowed_precisions:
            raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid precision.")
        allowed_bit_depths = {8, 10, 12, 16, 32}
        normalized = value
    else:
        raise JPEGXLError("JPEG XL HDR Finisher marker uses an unsupported schema version.")
    if type(value.get("bit_depth")) is not int or value["bit_depth"] not in allowed_bit_depths:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid bit depth.")
    reference_white = value.get("reference_white_nits")
    if not isinstance(reference_white, (int, float)) or isinstance(reference_white, bool):
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid reference white.")
    if not math.isfinite(float(reference_white)) or not 0 < float(reference_white) <= 10000:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid reference white.")
    return normalized


def _box(kind: bytes, payload: bytes) -> bytes:
    if len(kind) != 4:
        raise ValueError("JPEG XL box types must contain four bytes.")
    size = len(payload) + 8
    if size >= 2**32:
        return struct.pack(">I4sQ", 1, kind, len(payload) + 16) + payload
    return struct.pack(">I4s", size, kind) + payload


def _read_app_metadata_box(payload: bytes) -> dict[str, Any]:
    signature = b"\x00\x00\x00\x0cJXL \r\n\x87\n"
    if not payload.startswith(signature):
        return {}
    offset = len(signature)
    while offset + 8 <= len(payload):
        size, kind = struct.unpack_from(">I4s", payload, offset)
        header = 8
        if size == 1:
            if offset + 16 > len(payload):
                break
            size = int(struct.unpack_from(">Q", payload, offset + 8)[0])
            header = 16
        elif size == 0:
            size = len(payload) - offset
        if size < header or offset + size > len(payload):
            break
        if kind == _APP_BOX_TYPE:
            try:
                value = json.loads(payload[offset + header : offset + size].decode("utf-8"))
                return value if isinstance(value, dict) else {}
            except (UnicodeDecodeError, json.JSONDecodeError):
                return {}
        offset += size
    return {}


def _probe_basic_info(payload: bytes) -> dict[str, Any]:
    helper = resolve_binary("hdrf-jxl-info")
    if helper is None:
        return {}
    try:
        result = subprocess.run(
            [str(helper)], input=payload, capture_output=True, check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        info = json.loads(result.stdout)
        if not isinstance(info, dict) or info.get("schema_version") != 1:
            return {}
        return info
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def _standard_data_interpretation(info: dict[str, Any]) -> dict[str, str]:
    """Accept only structured standard RGB encodings; ICC/custom stays gated."""
    profile = info.get("data_color_encoding")
    if not isinstance(profile, dict):
        return {}
    if profile.get("color_space") != 0 or profile.get("white_point") != 1:
        return {}
    primaries = {1: "sRGB", 9: "BT.2020", 11: "Display P3"}.get(profile.get("primaries"))
    transfer = {1: "BT.709", 8: "LINEAR", 13: "sRGB", 16: "PQ", 18: "HLG"}.get(profile.get("transfer_function"))
    if not primaries or not transfer:
        return {}
    return {"color_space": primaries, "transfer_function": transfer}
