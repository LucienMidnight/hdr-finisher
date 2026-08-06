from __future__ import annotations

import hashlib
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.request import Request, urlopen

from .avif_info import AVIFInfoError, inspect_avif
from .exporters import _inspect_ultrahdr_markers


def inspect_delivery_file(path: Path, format_name: str = "auto") -> dict[str, Any]:
    payload = path.read_bytes()
    detected = _detect_format(path, payload, format_name)
    result: dict[str, Any] = {
        "path": str(path),
        "format": detected,
        "byte_size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "gain_map_present": False,
        "metadata": {},
    }
    if detected == "jpeg_ultrahdr":
        markers = _inspect_ultrahdr_markers(path)
        result["gain_map_present"] = markers.jpeg_images >= 2
        result["metadata"] = {
            "embedded_jpeg_images": markers.jpeg_images,
            "ultra_hdr_v1_xmp": markers.ultra_hdr_v1,
            "iso_21496_1": markers.iso_21496_1,
        }
    elif detected == "avif_gain_map":
        try:
            info = inspect_avif(path)
            result["gain_map_present"] = bool(info.get("gain_map_present"))
            result["metadata"] = {
                "gain_map": info.get("gain_map"),
                "alternate_image": info.get("alternate_image"),
            }
        except AVIFInfoError as exc:
            result["metadata"] = {"inspection_error": str(exc)}
    return result


def probe_hosted_url(
    url: str,
    *,
    original: Path | None = None,
    format_name: str = "auto",
    timeout: float = 30.0,
) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "HDR-Finisher-Delivery-Probe/1.0"})
    with urlopen(request, timeout=timeout) as response:
        payload = response.read()
        headers = {key.lower(): value for key, value in response.headers.items()}
        final_url = response.geturl()
        status = getattr(response, "status", None) or response.getcode()

    suffix = _suffix_for_payload(payload)
    with NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
        temporary.write(payload)
        downloaded_path = Path(temporary.name)
    try:
        delivered = inspect_delivery_file(downloaded_path, "auto")
    finally:
        downloaded_path.unlink(missing_ok=True)
    delivered.pop("path", None)

    result: dict[str, Any] = {
        "requested_url": url,
        "final_url": final_url,
        "http_status": status,
        "content_type": headers.get("content-type"),
        "content_length_header": headers.get("content-length"),
        "content_encoding": headers.get("content-encoding"),
        "cache_control": headers.get("cache-control"),
        "etag": headers.get("etag"),
        "delivered": delivered,
    }
    if original is not None:
        local = inspect_delivery_file(original, format_name)
        result["original"] = local
        result["bytes_identical"] = local["sha256"] == delivered["sha256"]
        result["gain_map_preserved"] = bool(delivered["gain_map_present"])
        result["metadata_preserved"] = _metadata_preserved(local, delivered)
    return result


def _metadata_preserved(original: dict[str, Any], delivered: dict[str, Any]) -> bool:
    if original["format"] != delivered["format"]:
        return False
    if original["format"] == "jpeg_ultrahdr":
        keys = ("ultra_hdr_v1_xmp", "iso_21496_1")
        return all(
            not original["metadata"].get(key) or delivered["metadata"].get(key)
            for key in keys
        )
    return bool(delivered["gain_map_present"]) if original["gain_map_present"] else True


def _detect_format(path: Path, payload: bytes, requested: str) -> str:
    if requested != "auto":
        return requested
    if payload.startswith(b"\xff\xd8"):
        return "jpeg_ultrahdr"
    if b"ftypavif" in payload[:64] or b"ftypavis" in payload[:64]:
        return "avif_gain_map"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return "webp"
    if path.suffix.lower() in {".avif", ".heif", ".heic"}:
        return "avif_gain_map"
    return "unknown"


def _suffix_for_payload(payload: bytes) -> str:
    if payload.startswith(b"\xff\xd8"):
        return ".jpg"
    if b"ftypavif" in payload[:64] or b"ftypavis" in payload[:64]:
        return ".avif"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return ".webp"
    return ".bin"
