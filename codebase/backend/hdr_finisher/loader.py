from __future__ import annotations

from pathlib import Path
from typing import Any
from io import BytesIO

import numpy as np

from .analysis import classify_hdr
from .color import detect_color_space, detect_transfer_function, normalize_to_acescg
from .models import SourceImageDescriptor


class LoaderError(RuntimeError):
    """Raised when an image cannot be loaded."""


def load_image(
    path: Path,
    overrides: dict[str, str | None] | None = None,
) -> tuple[np.ndarray, SourceImageDescriptor, dict[str, Any], Any, np.ndarray | None]:
    suffix = path.suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".bmp"}:
        image, metadata = _load_with_pillow(path)
    elif suffix in {".tif", ".tiff"}:
        image, metadata = _load_tiff(path)
    elif suffix == ".exr":
        image, metadata = _load_exr(path)
    elif suffix in {".hdr", ".pfm"}:
        image, metadata = _load_hdr_like(path)
    elif suffix in {".heic", ".heif"}:
        image, metadata = _load_heif(path)
    else:
        raise LoaderError(f"Unsupported input format: {suffix}")

    if image.ndim == 2:
        image = image[..., None]
    if image.shape[2] == 1:
        image = np.repeat(image, 3, axis=2)
    if image.shape[2] > 3:
        image = image[..., :3]

    overrides = overrides or {}
    for key in ("color_space", "transfer_function"):
        if overrides.get(key):
            metadata[key] = overrides[key]
    if overrides:
        metadata["user_override"] = {key: value for key, value in overrides.items() if value is not None}
        if metadata["user_override"]:
            metadata["needs_color_override"] = False

    metadata["color_space"] = detect_color_space(metadata, suffix)
    metadata["transfer_function"] = metadata.get("transfer_function") or detect_transfer_function(metadata, suffix)
    sdr_reference_image = metadata.pop("sdr_reference_image", None)
    normalized = normalize_to_acescg(image, metadata.get("color_space"), metadata.get("transfer_function"))
    descriptor = SourceImageDescriptor(
        filename=path.name,
        suffix=suffix,
        width=int(normalized.shape[1]),
        height=int(normalized.shape[0]),
        channels=int(normalized.shape[2]),
        dtype=str(normalized.dtype),
        source_color_space=metadata.get("color_space"),
        transfer_function=metadata.get("transfer_function"),
        interpretation_mode="manual" if metadata.get("user_override") else "auto",
        color_space_confident=not bool(metadata.get("needs_color_override")),
    )
    analysis = classify_hdr(normalized, metadata, suffix)
    return normalized, descriptor, metadata, analysis, sdr_reference_image


def _load_with_pillow(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise LoaderError("Pillow is required for bitmap input formats.") from exc

    with Image.open(path) as img:
        image = img.convert("RGB")
        metadata = dict(img.info)
        array = np.asarray(image)
        metadata["bit_depth"] = str(array.dtype)
        metadata["color_space"] = metadata.get("icc_profile_name", metadata.get("srgb", "sRGB"))
        normalized = array.astype(np.float32) / 255.0
    return normalized, metadata


def _load_tiff(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        import tifffile
    except ImportError as exc:
        raise LoaderError("tifffile is required for TIFF input.") from exc

    with tifffile.TiffFile(path) as tif:
        array = tif.asarray()
        page = tif.pages[0]
        metadata = {
            "bit_depth": str(array.dtype),
            "color_space": getattr(page, "photometric", None) or "unknown",
            "transfer_function": None,
        }
        if getattr(page, "tags", None) is not None:
            color_profile = page.tags.get("ColorMap") or page.tags.get("ICCProfile")
            if color_profile is not None:
                metadata["icc_profile_name"] = str(color_profile.value)[:128]

    if np.issubdtype(array.dtype, np.integer):
        max_value = float(np.iinfo(array.dtype).max)
        normalized = array.astype(np.float32) / max_value
    else:
        normalized = array.astype(np.float32)
    return normalized, metadata


def _load_exr(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        import OpenEXR
        import Imath
    except ImportError as exc:
        raise LoaderError("OpenEXR bindings are required for EXR input.") from exc

    file = OpenEXR.InputFile(str(path))
    header = file.header()
    dw = header["dataWindow"]
    width = dw.max.x - dw.min.x + 1
    height = dw.max.y - dw.min.y + 1
    float_type = Imath.PixelType(Imath.PixelType.FLOAT)
    channels = []
    for name in ("R", "G", "B"):
        channel = np.frombuffer(file.channel(name, float_type), dtype=np.float32)
        channels.append(channel.reshape(height, width))
    image = np.stack(channels, axis=-1)
    chromaticities_name, chromaticities_raw, chromaticities_confident = _infer_exr_chromaticities(header.get("chromaticities"))
    metadata = {
        "bit_depth": "32f",
        "color_space": chromaticities_name,
        "transfer_function": "LINEAR",
        "header_keys": [str(key) for key in header.keys()],
        "chromaticities_name": chromaticities_name,
        "chromaticities_raw": chromaticities_raw,
        "needs_color_override": not chromaticities_confident,
    }
    if not chromaticities_confident:
        metadata["color_space_note"] = "EXR chromaticities missing or ambiguous. Manual source interpretation is recommended."
    return image, metadata


def _load_hdr_like(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        import imageio.v3 as iio
    except ImportError as exc:
        raise LoaderError("imageio is required for HDR/PFM input.") from exc

    image = iio.imread(path).astype(np.float32)
    metadata = {
        "bit_depth": "32f",
        "color_space": "scene-linear",
        "transfer_function": "LINEAR",
    }
    return image, metadata


def _load_heif(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        from pillow_heif import open_heif
        from PIL import Image
        from PIL import ImageCms
    except ImportError as exc:
        raise LoaderError("pillow-heif is required for HEIC/HEIF input.") from exc

    heif_file = open_heif(path, convert_hdr_to_8bit=False)
    primary = heif_file[heif_file.primary_index]
    info = dict(primary.info)
    array = np.asarray(heif_file)
    bit_depth = int(info.get("bit_depth", 8))
    profile_desc = _heif_profile_description(info)
    apple_hdr = _read_apple_hdr_metadata(path)
    metadata = {
        "bit_depth": str(bit_depth),
        "color_space": profile_desc or _heif_color_space_from_info(info),
        "transfer_function": _heif_transfer_from_info(info),
        "heif_primary_mode": primary.mode,
        "heif_aux_types": sorted((info.get("aux") or {}).keys()),
        "heif_aux_count": sum(len(value) for value in (info.get("aux") or {}).values()),
        "heif_has_aux": bool(info.get("aux")),
        "heif_container_mimetype": heif_file.mimetype,
    }
    if apple_hdr:
        metadata.update(apple_hdr)
    if "nclx_profile" in info:
        metadata["nclx_profile"] = info["nclx_profile"]
    if "metadata" in info:
        metadata["heif_metadata_blocks"] = len(info["metadata"])

    if metadata.get("heif_aux_types") and metadata.get("apple_hdr_headroom") is not None:
        aux_type = metadata["heif_aux_types"][0]
        aux_id = info["aux"][aux_type][0]
        aux_image = primary.get_aux_image(aux_id)
        aux_array = np.asarray(aux_image).astype(np.float32) / 255.0
        base_array = _normalize_integer_image(array)
        metadata["sdr_reference_image"] = _display_p3_to_linear_srgb(base_array)
        resized_gainmap = np.asarray(
            Image.fromarray((np.clip(aux_array, 0.0, 1.0) * 255.0).astype(np.uint8), mode="L").resize(
                (base_array.shape[1], base_array.shape[0]),
                resample=Image.Resampling.LANCZOS,
            ),
            dtype=np.float32,
        ) / 255.0
        array = _apply_apple_hdr_gainmap(base_array, resized_gainmap, float(metadata["apple_hdr_headroom"]))
        metadata["color_space"] = profile_desc or "Display P3"
        metadata["transfer_function"] = "LINEAR"
        metadata["bit_depth"] = "32f"
        metadata["apple_hdr_gainmap_applied"] = True
    else:
        array = _normalize_integer_image(array)
    return array, metadata


def _heif_color_space_from_info(info: dict[str, Any]) -> str:
    profile = info.get("nclx_profile")
    primaries = _profile_value(profile, 0, "color_primaries")
    if primaries == 9:
        return "BT.2020"
    if primaries == 1:
        return "sRGB"
    return "BT.2020"


def _heif_transfer_from_info(info: dict[str, Any]) -> str | None:
    profile = info.get("nclx_profile")
    transfer = _profile_value(profile, 1, "transfer_characteristics")
    if transfer == 16:
        return "PQ"
    if transfer == 18:
        return "HLG"
    if transfer == 13:
        return "sRGB"
    return info.get("transfer_function")


def _heif_profile_description(info: dict[str, Any]) -> str | None:
    icc_profile = info.get("icc_profile")
    if not icc_profile:
        return None
    try:
        from PIL import ImageCms

        profile = ImageCms.getOpenProfile(BytesIO(icc_profile))
        return str(ImageCms.getProfileDescription(profile)).strip()
    except Exception:
        return None


def _profile_value(profile: Any, index: int, key: str) -> int | None:
    if profile is None:
        return None
    if isinstance(profile, dict):
        value = profile.get(key)
        return int(value) if value is not None else None
    if isinstance(profile, (list, tuple)) and len(profile) > index:
        return int(profile[index])
    return None


def _normalize_integer_image(array: np.ndarray) -> np.ndarray:
    if np.issubdtype(array.dtype, np.integer):
        max_value = float(np.iinfo(array.dtype).max)
        return array.astype(np.float32) / max_value
    return array.astype(np.float32)


def _apply_apple_hdr_gainmap(dp3_sdr: np.ndarray, hdrgainmap: np.ndarray, headroom: float) -> np.ndarray:
    try:
        import colour
    except ImportError as exc:
        raise LoaderError("colour-science is required to apply Apple HDR gain maps.") from exc

    dp3_sdr_linear = colour.models.eotf_sRGB(np.clip(dp3_sdr.astype(np.float32, copy=False), 0.0, 1.0))
    hdrgainmap_linear = colour.models.eotf_sRGB(np.clip(hdrgainmap.astype(np.float32, copy=False), 0.0, 1.0))
    scale_factor_map = 1.0 + (max(headroom, 1.0) - 1.0) * hdrgainmap_linear
    return dp3_sdr_linear * scale_factor_map[..., None]


def _display_p3_to_linear_srgb(image: np.ndarray) -> np.ndarray:
    try:
        from colour.models import RGB_to_RGB, eotf_sRGB
    except ImportError as exc:
        raise LoaderError("colour-science is required for HEIC SDR base conversion.") from exc

    dp3_linear = eotf_sRGB(np.clip(image.astype(np.float32, copy=False), 0.0, 1.0))
    srgb_linear = RGB_to_RGB(
        dp3_linear,
        "Display P3",
        "sRGB",
        chromatic_adaptation_transform="CAT02",
    )
    return np.clip(srgb_linear, 0.0, 1.0).astype(np.float32)


def _read_apple_hdr_metadata(path: Path) -> dict[str, Any]:
    try:
        import exifread
    except ImportError:
        return {}

    with path.open("rb") as handle:
        tags = exifread.process_file(handle, details=True)

    maker33 = _parse_exifread_ratio(tags.get("MakerNote Tag 0x0021"), fallback=1.0)
    maker48 = _parse_exifread_ratio(tags.get("MakerNote Tag 0x0030"))
    if maker48 is None:
        return {}

    headroom = _compute_apple_headroom(maker33 if maker33 is not None else 1.0, maker48)
    return {
        "apple_hdr_maker_33": maker33,
        "apple_hdr_maker_48": maker48,
        "apple_hdr_headroom": headroom,
    }


def _parse_exifread_ratio(tag: Any, fallback: float | None = None) -> float | None:
    if tag is None:
        return fallback
    values = getattr(tag, "values", None)
    if not values:
        return fallback
    value = values[0]
    numerator = getattr(value, "num", None)
    denominator = getattr(value, "den", None)
    if denominator == 0:
        return fallback
    try:
        return float(value)
    except Exception:
        return fallback


def _compute_apple_headroom(maker33: float, maker48: float) -> float:
    if maker33 < 1.0:
        if maker48 <= 0.01:
            stops = -20.0 * maker48 + 1.8
        else:
            stops = -0.101 * maker48 + 1.601
    else:
        if maker48 <= 0.01:
            stops = -70.0 * maker48 + 3.0
        else:
            stops = -0.303 * maker48 + 2.303
    return float(2.0 ** max(stops, 0.0))


def _infer_exr_chromaticities(value: Any) -> tuple[str | None, dict[str, tuple[float, float]] | None, bool]:
    raw = _read_exr_chromaticities(value)
    if raw is None:
        return None, None, False

    known = {
        "ACEScg": {
            "red": (0.713, 0.293),
            "green": (0.165, 0.830),
            "blue": (0.128, 0.044),
            "white": (0.32168, 0.33767),
        },
        "BT.2020": {
            "red": (0.708, 0.292),
            "green": (0.170, 0.797),
            "blue": (0.131, 0.046),
            "white": (0.3127, 0.3290),
        },
        "sRGB": {
            "red": (0.640, 0.330),
            "green": (0.300, 0.600),
            "blue": (0.150, 0.060),
            "white": (0.3127, 0.3290),
        },
        "Display P3": {
            "red": (0.680, 0.320),
            "green": (0.265, 0.690),
            "blue": (0.150, 0.060),
            "white": (0.3127, 0.3290),
        },
    }

    best_name = None
    best_error = float("inf")
    for name, reference in known.items():
        error = sum(
            abs(raw[key][0] - reference[key][0]) + abs(raw[key][1] - reference[key][1])
            for key in ("red", "green", "blue", "white")
        )
        if error < best_error:
            best_error = error
            best_name = name

    return best_name, raw, best_error < 0.08


def _read_exr_chromaticities(value: Any) -> dict[str, tuple[float, float]] | None:
    if value is None:
        return None
    try:
        red = getattr(value, "red")
        green = getattr(value, "green")
        blue = getattr(value, "blue")
        white = getattr(value, "white")
        return {
            "red": (float(red.x), float(red.y)),
            "green": (float(green.x), float(green.y)),
            "blue": (float(blue.x), float(blue.y)),
            "white": (float(white.x), float(white.y)),
        }
    except Exception:
        return None
