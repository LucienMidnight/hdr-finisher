from __future__ import annotations

from pathlib import Path
from typing import Any
from io import BytesIO

import numpy as np

from .analysis import classify_hdr
from .color import detect_color_space, detect_transfer_function, normalize_to_acescg
from .models import SourceImageDescriptor


EXR_COLOR_INTEROP_SPACES = {
    # OpenColorIO color space interoperability IDs emitted by Blender 5.2.
    # Keep this allowlist exact: an unknown ID must continue to require review.
    "lin_rec709_scene": "sRGB",
    "lin_rec2020_scene": "BT.2020",
    "lin_p3d65_scene": "Display P3",
    "lin_ap1_scene": "ACEScg",
}


class LoaderError(RuntimeError):
    """Raised when an image cannot be loaded."""


def load_image(
    path: Path,
    overrides: dict[str, str | None] | None = None,
) -> tuple[np.ndarray, SourceImageDescriptor, dict[str, Any], Any, np.ndarray | None]:
    suffix = path.suffix.lower()
    try:
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
    except LoaderError:
        raise
    except Exception as exc:
        detail = str(exc).strip() or exc.__class__.__name__
        label = "TIFF" if suffix in {".tif", ".tiff"} else suffix.removeprefix(".").upper() or "image"
        raise LoaderError(f"Could not decode {label} input: {detail}") from exc

    if image.ndim == 2:
        image = image[..., None]
    if image.ndim != 3:
        raise LoaderError(f"Decoded image has unsupported dimensions {image.shape}; expected a single 2D image.")
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
        # A transfer-only override cannot resolve unknown or conflicting source
        # primaries. Only an explicit color-space choice is sufficient to clear
        # the manual-review gate.
        if metadata["user_override"].get("color_space"):
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
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise LoaderError("Pillow is required for bitmap input formats.") from exc

    with Image.open(path) as img:
        metadata = dict(img.info)
        oriented = ImageOps.exif_transpose(img)
        icc_profile = metadata.get("icc_profile")
        if icc_profile:
            profile_name = _read_icc_profile_name(icc_profile)
            metadata["icc_profile_name"] = profile_name
            try:
                from PIL import ImageCms

                image = ImageCms.profileToProfile(
                    oriented,
                    ImageCms.ImageCmsProfile(BytesIO(icc_profile)),
                    ImageCms.createProfile("sRGB"),
                    outputMode="RGB",
                )
                metadata["source_icc_profile_name"] = profile_name
                metadata["color_space"] = "sRGB"
                metadata["transfer_function"] = "sRGB"
                metadata["icc_converted_to_srgb"] = True
            except Exception:
                image = oriented.convert("RGB")
                metadata["color_space"] = _classify_icc_profile_name(profile_name)
                metadata["needs_color_override"] = metadata["color_space"] == "unknown"
        else:
            image = oriented.convert("RGB")
            metadata["color_space"] = "sRGB"
        array = np.asarray(image)
        metadata["bit_depth"] = str(array.dtype)
        normalized = array.astype(np.float32) / 255.0
    return normalized, metadata


def _load_tiff(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        import tifffile
    except ImportError as exc:
        raise LoaderError("tifffile is required for TIFF input.") from exc

    with tifffile.TiffFile(path) as tif:
        series = tif.series[0]
        array = series.asarray()
        array = _normalize_tiff_layout(array, getattr(series, "axes", None))
        page = tif.pages[0]
        metadata = {
            "bit_depth": str(array.dtype),
            "color_space": "unknown",
            "transfer_function": None,
            "photometric": str(getattr(page, "photometric", "unknown")),
            "series_axes": str(getattr(series, "axes", "")),
            "needs_color_override": True,
        }
        if getattr(page, "tags", None) is not None:
            color_profile = page.tags.get("InterColorProfile") or page.tags.get("ICCProfile")
            if color_profile is not None:
                profile_name = _read_icc_profile_name(color_profile.value)
                metadata["icc_profile_name"] = profile_name
                metadata["color_space"] = _classify_icc_profile_name(profile_name)
                metadata["needs_color_override"] = metadata["color_space"] == "unknown"

    if np.issubdtype(array.dtype, np.integer):
        max_value = float(np.iinfo(array.dtype).max)
        normalized = array.astype(np.float32) / max_value
    else:
        normalized = array.astype(np.float32)
    return normalized, metadata


def _normalize_tiff_layout(array: np.ndarray, axes: str | None) -> np.ndarray:
    """Return the first TIFF image as HxWxC regardless of page/sample layout."""
    result = np.asarray(array)
    labels = list(str(axes or "").upper())

    if labels and len(labels) == result.ndim and "Y" in labels and "X" in labels:
        channel_axis = next((index for index, label in enumerate(labels) if label in {"S", "C"}), None)
        keep = {labels.index("Y"), labels.index("X")}
        if channel_axis is not None:
            keep.add(channel_axis)
        for axis in range(result.ndim - 1, -1, -1):
            if axis not in keep:
                result = np.take(result, 0, axis=axis)
                labels.pop(axis)
                keep = {index - (1 if index > axis else 0) for index in keep if index != axis}
        y_axis = labels.index("Y")
        x_axis = labels.index("X")
        channel_axis = next((index for index, label in enumerate(labels) if label in {"S", "C"}), None)
        order = [y_axis, x_axis] + ([channel_axis] if channel_axis is not None else [])
        result = np.transpose(result, order)
    elif result.ndim == 3 and result.shape[0] in {1, 2, 3, 4} and result.shape[-1] not in {1, 2, 3, 4}:
        result = np.moveaxis(result, 0, -1)
    elif result.ndim > 3:
        while result.ndim > 3:
            result = result[0]

    if result.ndim not in {2, 3}:
        raise LoaderError(f"Unsupported TIFF sample layout {array.shape} with axes '{axes or 'unknown'}'.")
    return result


def _read_icc_profile_name(profile_data: bytes) -> str:
    try:
        from PIL import ImageCms

        profile = ImageCms.ImageCmsProfile(BytesIO(profile_data))
        return ImageCms.getProfileName(profile).strip()
    except Exception:
        return "unknown"


def _classify_icc_profile_name(profile_name: str) -> str:
    text = profile_name.strip().lower()
    if "acescg" in text:
        return "ACEScg"
    if "2020" in text:
        return "BT.2020"
    if "display p3" in text:
        return "Display P3"
    if "srgb" in text or "rec.709" in text or "bt.709" in text:
        return "sRGB"
    return "unknown"


def _load_exr(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    try:
        import OpenEXR
        import Imath
    except ImportError as exc:
        raise LoaderError("OpenEXR bindings are required for EXR input.") from exc

    file = OpenEXR.InputFile(str(path))
    try:
        header = file.header()
        dw = header["dataWindow"]
        width = dw.max.x - dw.min.x + 1
        height = dw.max.y - dw.min.y + 1
        float_type = Imath.PixelType(Imath.PixelType.FLOAT)
        channel_names = _select_exr_rgb_channels(header.get("channels", {}).keys())
        channels = []
        for name in channel_names:
            channel = np.frombuffer(file.channel(name, float_type), dtype=np.float32)
            channels.append(channel.reshape(height, width))
        image = np.stack(channels, axis=-1)
    finally:
        close = getattr(file, "close", None)
        if callable(close):
            close()
    chromaticities_name, chromaticities_raw, chromaticities_confident = _infer_exr_chromaticities(header.get("chromaticities"))
    interop_name, interop_id, interop_confident = _infer_exr_color_interop_id(header.get("colorInteropID"))

    color_space, color_space_source, color_space_confident, metadata_conflict = _resolve_exr_color_space(
        chromaticities_name,
        chromaticities_confident,
        interop_name,
        interop_confident,
    )

    metadata = {
        "bit_depth": "32f",
        "color_space": color_space,
        "transfer_function": "LINEAR",
        "header_keys": [str(key) for key in header.keys()],
        "selected_rgb_channels": list(channel_names),
        "chromaticities_name": chromaticities_name,
        "chromaticities_raw": chromaticities_raw,
        "color_interop_id": interop_id,
        "color_interop_name": interop_name,
        "color_space_source": color_space_source,
        "needs_color_override": not color_space_confident,
    }
    if metadata_conflict:
        metadata["color_space_note"] = (
            "EXR chromaticities and colorInteropID disagree. Manual source interpretation is required."
        )
    elif interop_confident and not chromaticities_confident:
        metadata["color_space_note"] = (
            f"EXR color space recognized from colorInteropID '{interop_id}'."
        )
    elif not color_space_confident:
        metadata["color_space_note"] = "EXR chromaticities missing or ambiguous. Manual source interpretation is recommended."
    return image, metadata


def _select_exr_rgb_channels(channel_names: Any) -> tuple[str, str, str]:
    names = [str(name) for name in channel_names]
    by_lower = {name.lower(): name for name in names}
    if all(channel in by_lower for channel in ("r", "g", "b")):
        return by_lower["r"], by_lower["g"], by_lower["b"]

    groups: dict[str, dict[str, str]] = {}
    for name in names:
        if "." not in name:
            continue
        prefix, component = name.rsplit(".", 1)
        component = component.lower()
        if component in {"r", "g", "b"}:
            groups.setdefault(prefix, {})[component] = name
    complete = [(prefix, group) for prefix, group in groups.items() if all(channel in group for channel in ("r", "g", "b"))]
    if complete:
        prefix, group = sorted(complete, key=lambda item: ("combined" not in item[0].lower(), item[0].lower()))[0]
        _ = prefix
        return group["r"], group["g"], group["b"]
    raise LoaderError(f"EXR does not contain an RGB channel set. Available channels: {', '.join(sorted(names))}")


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


def _infer_exr_color_interop_id(value: Any) -> tuple[str | None, str | None, bool]:
    interop_id = _read_exr_text(value)
    if not interop_id:
        return None, None, False
    color_space = EXR_COLOR_INTEROP_SPACES.get(interop_id)
    return color_space, interop_id, color_space is not None


def _resolve_exr_color_space(
    chromaticities_name: str | None,
    chromaticities_confident: bool,
    interop_name: str | None,
    interop_confident: bool,
) -> tuple[str | None, str | None, bool, bool]:
    conflict = bool(
        chromaticities_confident
        and interop_confident
        and chromaticities_name != interop_name
    )
    if conflict:
        return None, "conflict", False, True
    if chromaticities_confident:
        return chromaticities_name, "chromaticities", True, False
    if interop_confident:
        return interop_name, "colorInteropID", True, False
    return None, None, False, False


def _read_exr_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip("\x00") or None
    if isinstance(value, str):
        return value.strip("\x00") or None
    nested = getattr(value, "value", None)
    if nested is not None and nested is not value:
        return _read_exr_text(nested)
    text = str(value).strip("\x00")
    return text or None


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
