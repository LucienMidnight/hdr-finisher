from __future__ import annotations

import ctypes
import importlib
import json
import math
from pathlib import Path
import struct
from typing import Any, Callable

import numpy as np

from .color import acescg_to_linear_bt2020, normalize_to_acescg_bounded


class JPEGXLError(RuntimeError):
    """Raised when JPEG XL pixels or their HDR interpretation are unsafe."""


_APP_BOX_TYPE = b"hfmd"
_APP_METADATA_VERSION = 1


def jpegxl_available() -> bool:
    try:
        import imagecodecs

        return bool(imagecodecs.JPEGXL.available)
    except (ImportError, AttributeError):
        return False


def inspect_jpegxl(path: Path) -> dict[str, Any]:
    """Return stable basic info plus HDR Finisher's optional container marker.

    imagecodecs intentionally focuses on pixel I/O, so its libjxl is queried for
    basic dimensions/bit depth when the dynamic library is available. Color is
    only accepted automatically when our explicit container marker is present;
    third-party files remain editable through the existing manual source gate.
    """

    return _inspect_jpegxl_payload(path.read_bytes())


def _inspect_jpegxl_payload(payload: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {"app_metadata": _validate_app_metadata(_read_app_metadata_box(payload))}
    result.update(_probe_basic_info(payload))
    return result


def decode_jpegxl(
    path: Path, *, cancelled: Callable[[], bool] | None = None
) -> tuple[np.ndarray, dict[str, Any]]:
    _raise_if_cancelled(cancelled)
    try:
        import imagecodecs
    except ImportError as exc:
        raise JPEGXLError("JPEG XL input requires the bundled imagecodecs/libjxl decoder.") from exc
    try:
        payload = path.read_bytes()
        info = _inspect_jpegxl_payload(payload)
        _raise_if_cancelled(cancelled)
        decoded = np.asarray(imagecodecs.jpegxl_decode(payload))
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
    color_space = app_metadata.get("color_space")
    transfer = app_metadata.get("transfer_function")
    confident = bool(color_space and transfer)
    if confident:
        image = normalize_to_acescg_bounded(
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
        "color_space": metadata_color,
        "transfer_function": metadata_transfer,
        "jpegxl_input": True,
        "jpegxl_direct_hdr": transfer in {"PQ", "HLG"},
        "jpegxl_info": {key: value for key, value in info.items() if key != "app_metadata"},
        "needs_color_override": not confident,
    }
    if app_metadata:
        metadata["jpegxl_app_metadata"] = app_metadata
    if confident:
        metadata["decoder_normalized_to_acescg"] = True
    return np.asarray(image, dtype=np.float32), metadata


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise JPEGXLError("Import cancelled")


def encode_hdr_jpegxl(image: np.ndarray, quality: int) -> bytes:
    try:
        import imagecodecs
    except ImportError as exc:
        raise JPEGXLError("JPEG XL export requires the bundled imagecodecs/libjxl encoder.") from exc
    if not 1 <= int(quality) <= 100:
        raise JPEGXLError("JPEG XL quality must be between 1 and 100.")

    linear_bt2020 = np.clip(acescg_to_linear_bt2020(image[..., :3]), 0.0, None)
    luminance_nits = np.clip(linear_bt2020 * np.float32(100.0 / 0.18), 0.0, 10000.0)
    pq = _pq_oetf(luminance_nits)
    encoded = np.clip(np.round(pq * np.float32(4095.0)), 0.0, 4095.0).astype(np.uint16)
    distance = max(0.0, (100.0 - float(quality)) / 25.0)
    try:
        payload = imagecodecs.jpegxl_encode(
            encoded,
            effort=7,
            distance=distance,
            lossless=quality == 100,
            bitspersample=12,
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
        "bit_depth": 12,
        "reference_white_nits": 100.0,
    }
    return bytes(payload) + _box(_APP_BOX_TYPE, json.dumps(marker, separators=(",", ":")).encode("utf-8"))


def validate_jpegxl(payload: bytes, expected_shape: tuple[int, int]) -> str:
    try:
        import imagecodecs

        decoded = np.asarray(imagecodecs.jpegxl_decode(payload))
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
    if metadata.get("bit_depth") != 12:
        raise JPEGXLError("JPEG XL output marker does not declare 12-bit samples.")
    if not np.issubdtype(decoded.dtype, np.integer) or int(np.max(decoded, initial=0)) > 4095:
        raise JPEGXLError("JPEG XL output did not decode to valid 12-bit integer samples.")
    basic_info = _probe_basic_info(payload)
    if basic_info.get("bits_per_sample") not in {None, 12}:
        raise JPEGXLError("JPEG XL codestream precision does not match its 12-bit marker.")
    return "Validated by decoding the 12-bit Rec.2020 PQ result."


def _pq_oetf(luminance_nits: np.ndarray) -> np.ndarray:
    m1 = np.float32(2610.0 / 16384.0)
    m2 = np.float32(2523.0 / 32.0)
    c1 = np.float32(3424.0 / 4096.0)
    c2 = np.float32(2413.0 / 128.0)
    c3 = np.float32(2392.0 / 128.0)
    normalized = np.clip(luminance_nits.astype(np.float32, copy=False) / np.float32(10000.0), 0.0, 1.0)
    powered = np.power(normalized, m1)
    return np.power((c1 + c2 * powered) / (np.float32(1.0) + c3 * powered), m2).astype(np.float32)


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


def _validate_app_metadata(value: dict[str, Any]) -> dict[str, Any]:
    if not value:
        return {}
    expected = {
        "schema_version",
        "color_space",
        "transfer_function",
        "bit_depth",
        "reference_white_nits",
    }
    if set(value) != expected:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid schema.")
    if value.get("schema_version") != _APP_METADATA_VERSION:
        raise JPEGXLError("JPEG XL HDR Finisher marker uses an unsupported schema version.")
    if value.get("color_space") != "BT.2020" or value.get("transfer_function") not in {"PQ", "HLG"}:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an unsupported color interpretation.")
    if type(value.get("bit_depth")) is not int or value["bit_depth"] not in {8, 10, 12, 16}:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid bit depth.")
    reference_white = value.get("reference_white_nits")
    if not isinstance(reference_white, (int, float)) or isinstance(reference_white, bool):
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid reference white.")
    if not math.isfinite(float(reference_white)) or not 0 < float(reference_white) <= 10000:
        raise JPEGXLError("JPEG XL HDR Finisher marker has an invalid reference white.")
    return value


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


class _BasicInfoPrefix(ctypes.Structure):
    _fields_ = [
        ("have_container", ctypes.c_int),
        ("xsize", ctypes.c_uint32),
        ("ysize", ctypes.c_uint32),
        ("bits_per_sample", ctypes.c_uint32),
        ("exponent_bits_per_sample", ctypes.c_uint32),
        ("intensity_target", ctypes.c_float),
        ("min_nits", ctypes.c_float),
        ("relative_to_max_display", ctypes.c_int),
        ("linear_below", ctypes.c_float),
        ("uses_original_profile", ctypes.c_int),
    ]


def _probe_basic_info(payload: bytes) -> dict[str, Any]:
    library_path = _find_libjxl()
    if library_path is None:
        return {}
    try:
        library = ctypes.CDLL(str(library_path))
        library.JxlDecoderCreate.argtypes = [ctypes.c_void_p]
        library.JxlDecoderCreate.restype = ctypes.c_void_p
        library.JxlDecoderDestroy.argtypes = [ctypes.c_void_p]
        library.JxlDecoderSubscribeEvents.argtypes = [ctypes.c_void_p, ctypes.c_int]
        library.JxlDecoderSubscribeEvents.restype = ctypes.c_int
        library.JxlDecoderSetInput.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t]
        library.JxlDecoderSetInput.restype = ctypes.c_int
        library.JxlDecoderCloseInput.argtypes = [ctypes.c_void_p]
        library.JxlDecoderProcessInput.argtypes = [ctypes.c_void_p]
        library.JxlDecoderProcessInput.restype = ctypes.c_int
        library.JxlDecoderGetBasicInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        library.JxlDecoderGetBasicInfo.restype = ctypes.c_int
        decoder = library.JxlDecoderCreate(None)
        if not decoder:
            return {}
        try:
            if library.JxlDecoderSubscribeEvents(decoder, 0x40) != 0:
                return {}
            data = (ctypes.c_uint8 * len(payload)).from_buffer_copy(payload)
            if library.JxlDecoderSetInput(decoder, data, len(payload)) != 0:
                return {}
            library.JxlDecoderCloseInput(decoder)
            for _ in range(16):
                status = library.JxlDecoderProcessInput(decoder)
                if status == 0x40:
                    buffer = ctypes.create_string_buffer(1024)
                    if library.JxlDecoderGetBasicInfo(decoder, buffer) != 0:
                        return {}
                    info = _BasicInfoPrefix.from_buffer_copy(buffer.raw)
                    return {
                        "width": int(info.xsize),
                        "height": int(info.ysize),
                        "bits_per_sample": int(info.bits_per_sample),
                        "exponent_bits_per_sample": int(info.exponent_bits_per_sample),
                        "intensity_target": float(info.intensity_target),
                        "uses_original_profile": bool(info.uses_original_profile),
                    }
                if status in {0, 1, 2}:
                    break
        finally:
            library.JxlDecoderDestroy(decoder)
    except (AttributeError, OSError, ValueError):
        return {}
    return {}


def _find_libjxl() -> Path | None:
    try:
        module = importlib.import_module("imagecodecs")
    except ImportError:
        return None
    root = Path(module.__file__).resolve().parent
    candidates: list[Path] = []
    for directory in (root / ".dylibs", root / ".libs", root.parent / "imagecodecs.libs", root):
        if not directory.is_dir():
            continue
        for pattern in ("libjxl.[0-9]*.dylib", "libjxl.so*", "jxl.dll", "libjxl.dll"):
            candidates.extend(directory.glob(pattern))
    return next((path for path in candidates if "threads" not in path.name and "cms" not in path.name), None)
