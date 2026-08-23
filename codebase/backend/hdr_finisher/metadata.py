from __future__ import annotations

from pathlib import Path
from typing import Any

from .color import detect_transfer_function
from .models import MetadataPayload


def extract_metadata(path: Path, raw_metadata: dict[str, Any] | None = None) -> MetadataPayload:
    raw_metadata = raw_metadata or {}
    raw_exif_value = raw_metadata.get("raw_exif")
    raw_exif = raw_exif_value if isinstance(raw_exif_value, dict) else {}
    transfer_function = detect_transfer_function(raw_metadata, path.suffix.lower())
    bit_depth = str(raw_metadata.get("bit_depth") or raw_metadata.get("BitsPerSample") or "unknown")
    color_space = str(raw_metadata.get("color_space") or raw_metadata.get("ColorSpace") or raw_metadata.get("icc_profile_name") or "unknown")

    return MetadataPayload(
        camera_maker=(
            _value(raw_metadata, "camera_maker", "Make", "Image Make")
            or _value(raw_exif, "camera_maker", "Make", "Image Make")
        ),
        camera_model=(
            _value(raw_metadata, "camera_model", "Model", "Image Model")
            or _value(raw_exif, "camera_model", "Model", "Image Model")
        ),
        lens=(
            _value(raw_metadata, "lens", "lens_model", "lens_name", "LensModel", "EXIF LensModel")
            or _value(raw_exif, "lens", "lens_model", "lens_name", "LensModel", "EXIF LensModel", "Image LensModel")
        ),
        lens_maker=(
            _value(raw_metadata, "lens_maker", "LensMake", "EXIF LensMake")
            or _value(raw_exif, "lens_maker", "LensMake", "EXIF LensMake", "Image LensMake")
        ),
        iso=(
            _value(raw_metadata, "iso", "ISOSpeedRatings", "EXIF ISOSpeedRatings", "EXIF PhotographicSensitivity")
            or _value(raw_exif, "iso", "ISOSpeedRatings", "EXIF ISOSpeedRatings", "EXIF PhotographicSensitivity")
        ),
        shutter_speed=(
            _value(raw_metadata, "shutter_speed", "ExposureTime", "EXIF ExposureTime")
            or _value(raw_exif, "shutter_speed", "ExposureTime", "EXIF ExposureTime")
        ),
        focal_length_mm=(
            _value(raw_metadata, "focal_length_mm", "FocalLength", "EXIF FocalLength")
            or _value(raw_exif, "focal_length_mm", "FocalLength", "EXIF FocalLength")
        ),
        aperture=(
            _value(raw_metadata, "aperture", "FNumber", "EXIF FNumber")
            or _value(raw_exif, "aperture", "FNumber", "EXIF FNumber")
        ),
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
