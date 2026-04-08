from __future__ import annotations

from pathlib import Path
from typing import Any

from .color import detect_transfer_function
from .models import MetadataPayload


def extract_metadata(path: Path, raw_metadata: dict[str, Any] | None = None) -> MetadataPayload:
    raw_metadata = raw_metadata or {}
    transfer_function = detect_transfer_function(raw_metadata, path.suffix.lower())
    bit_depth = str(raw_metadata.get("bit_depth") or raw_metadata.get("BitsPerSample") or "unknown")
    color_space = str(raw_metadata.get("color_space") or raw_metadata.get("ColorSpace") or raw_metadata.get("icc_profile_name") or "unknown")

    return MetadataPayload(
        camera_model=_value(raw_metadata, "camera_model", "Model"),
        lens=_value(raw_metadata, "lens", "LensModel", "EXIF LensModel"),
        iso=_value(raw_metadata, "iso", "ISOSpeedRatings", "EXIF ISOSpeedRatings"),
        shutter_speed=_value(raw_metadata, "shutter_speed", "ExposureTime", "EXIF ExposureTime"),
        bit_depth=bit_depth,
        color_space=color_space,
        transfer_function=transfer_function,
        extra={key: str(value) for key, value in raw_metadata.items() if key not in {"icc_profile"}},
    )


def _value(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        if key in data and data[key] is not None:
            return str(data[key])
    return None
