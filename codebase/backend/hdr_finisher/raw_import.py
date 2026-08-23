from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

import numpy as np

from .color import aces2065_to_acescg, transform_float32_bounded
from .models import LensCorrectionSettings, RawImportSettings

if TYPE_CHECKING:
    from .linear_dng import LinearDngInspection


RAW_EXTENSIONS = {
    ".dng", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf",
    ".rw2", ".orf", ".ori", ".pef", ".srw",
}

# Parameter-neutralization audits on both supplied DJI sources proved that
# this decoder build ignores OpcodeList3 in both the raw buffer and developed
# output. New LibRaw versions must be audited before mandatory operations run.
VERIFIED_LIBRAW_IGNORES_OPCODE_LIST3 = {(0, 22, 1)}


class RawImportError(RuntimeError):
    """Raised when deterministic RAW development cannot be completed."""


@dataclass(frozen=True)
class LensProfileRecord:
    id: str
    camera_maker: str
    camera_model: str
    lens_maker: str
    lens_model: str
    mount: str | None
    crop_factor: float
    distortion: bool
    chromatic_aberration: bool
    vignetting: bool

    def as_dict(self) -> dict[str, object]:
        return self.__dict__.copy()


def decode_raw(
    path: Path,
    settings: RawImportSettings,
    *,
    progress: Callable[[str, str], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    dng_inspection: LinearDngInspection | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    _raise_if_cancelled(cancelled)
    if progress:
        progress("raw_metadata", "Reading camera and lens metadata")
    exif = _read_raw_exif(path)
    _raise_if_cancelled(cancelled)
    opcode_plan = bool(dng_inspection and dng_inspection.required_opcodes)
    if opcode_plan and settings.lens.mode == "manual" and (
        settings.lens.distortion or settings.lens.chromatic_aberration or settings.lens.vignetting
    ):
        raise RawImportError(
            "Manual Lensfun correction cannot be combined with mandatory DNG GainMap/WarpRectilinear; "
            "disable Lensfun to avoid applying equivalent corrections twice."
        )
    try:
        import rawpy
    except ImportError as exc:
        raise RawImportError("RAW/DNG input requires the bundled rawpy/LibRaw decoder.") from exc

    try:
        if progress:
            progress("developing_raw", "Developing RAW with as-shot white balance and AHD demosaic")
        with rawpy.imread(str(path)) as raw:
            exif = _merge_missing_metadata(exif, _read_libraw_metadata(raw))
            raw_pattern = getattr(raw, "raw_pattern", None)
            is_mosaiced = raw_pattern is not None
            camera_white_balance = _float_list(getattr(raw, "camera_whitebalance", None))
            daylight_white_balance = _float_list(getattr(raw, "daylight_whitebalance", None))
            sizes = getattr(raw, "sizes", None)
            if opcode_plan:
                version = tuple(int(item) for item in rawpy.libraw_version)
                if version not in VERIFIED_LIBRAW_IGNORES_OPCODE_LIST3:
                    raise RawImportError(
                        "This mosaiced Experimental DNG requires mandatory OpcodeList3 corrections, "
                        f"but bundled LibRaw {'.'.join(map(str, version))} has not been audited for exactly-once behavior."
                    )
                developed = raw.postprocess(
                    demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
                    use_camera_wb=False,
                    user_wb=[1.0, 1.0, 1.0, 1.0],
                    user_flip=0,
                    no_auto_bright=True,
                    output_color=rawpy.ColorSpace.raw,
                    gamma=(1.0, 1.0),
                    output_bps=16,
                    highlight_mode=rawpy.HighlightMode.Clip,
                )
            else:
                developed = raw.postprocess(
                    demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
                    use_camera_wb=True,
                    no_auto_bright=True,
                    output_color=rawpy.ColorSpace.ACES,
                    gamma=(1.0, 1.0),
                    output_bps=16,
                    highlight_mode=rawpy.HighlightMode.Clip,
                )
    except RawImportError:
        raise
    except Exception as exc:
        raise RawImportError(f"LibRaw could not develop {path.suffix.upper()} input: {exc}") from exc

    _raise_if_cancelled(cancelled)
    opcode_audit: dict[str, Any] | None = None
    if opcode_plan:
        from .dng_color import build_color_transform, transform_normalized_to_acescg_in_place
        from .dng_opcodes import apply_opcode_list3
        from .linear_dng import color_metadata_from_mapping, crop_and_orient

        camera_linear = np.asarray(developed).astype(np.float32)
        camera_linear *= np.float32(1.0 / 65535.0)
        del developed
        if progress:
            progress("dng_opcodes", "Experimental DNG Import: applying mandatory DNG operations")
        camera_linear, opcode_diagnostics = apply_opcode_list3(
            camera_linear,
            sorted(
                (*dng_inspection.required_opcodes, *dng_inspection.optional_opcodes),
                key=lambda opcode: opcode.index,
            ),
            cancelled=cancelled,
        )
        color_metadata = color_metadata_from_mapping(dng_inspection.metadata)
        transform = build_color_transform(color_metadata)
        transform_normalized_to_acescg_in_place(
            camera_linear, transform, color_metadata.baseline_exposure, cancelled=cancelled
        )
        image = np.ascontiguousarray(
            crop_and_orient(camera_linear, dng_inspection.metadata), dtype=np.float32
        )
        opcode_audit = {
            "rawpy_version": str(getattr(rawpy, "__version__", "unknown")),
            "libraw_version": ".".join(map(str, rawpy.libraw_version)),
            "decoder_behavior": "verified_ignores_opcode_list3",
            "application_stage": "camera_linear_after_demosaic_before_dng_color_transform",
            "operations": list(opcode_diagnostics),
        }
    else:
        aces2065 = np.asarray(developed).astype(np.float32)
        aces2065 *= np.float32(1.0 / 65535.0)
        del developed
    lens_metadata: dict[str, Any] = {}
    lens_settings = settings.lens
    if opcode_plan and lens_settings.mode == "auto":
        lens_settings = lens_settings.model_copy(update={"mode": "off"})
        lens_metadata = {
            "mode": "off",
            "requested_mode": "auto",
            "applied": False,
            "reason": "Automatic Lensfun correction was disabled because mandatory DNG corrections were applied.",
        }
    elif path.suffix.lower() == ".dng" and not is_mosaiced and lens_settings.mode == "auto":
        lens_settings = lens_settings.model_copy(update={"mode": "off"})
    lens_settings = lens_settings.model_copy(
        update={
            "focal_length_mm": lens_settings.focal_length_mm or exif.get("focal_length_mm"),
            "aperture": lens_settings.aperture or exif.get("aperture"),
            "focus_distance_m": lens_settings.focus_distance_m or exif.get("focus_distance_m"),
        }
    )
    if lens_settings.mode != "off":
        if progress:
            progress("lens_correction", "Applying selected Lensfun corrections")
        aces2065, lens_metadata = apply_lens_correction(
            aces2065,
            lens_settings,
            camera_maker=exif.get("camera_maker"),
            camera_model=exif.get("camera_model"),
            lens_maker=exif.get("lens_maker"),
            lens_name=exif.get("lens_model") or exif.get("lens_name"),
            cancelled=cancelled,
        )
    _raise_if_cancelled(cancelled)
    if not opcode_plan:
        if progress:
            progress("color_conversion", "Converting linear ACES2065-1 to ACEScg")
        image = transform_float32_bounded(
            aces2065, aces2065_to_acescg, cancelled=cancelled
        )
    metadata: dict[str, Any] = {
        "bit_depth": "16-bit LibRaw linear development",
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "raw_input": True,
        "dng_input": path.suffix.lower() == ".dng",
        "raw_convenience_beta": True,
        "raw_mosaiced": is_mosaiced,
        "raw_development": {
            "white_balance": settings.white_balance,
            "demosaic": settings.demosaic,
            "auto_bright": False,
            "highlight_mode": "clip",
            "output_space": "ACES2065-1",
        },
        "camera_white_balance": camera_white_balance,
        "daylight_white_balance": daylight_white_balance,
        "raw_sizes": _sizes_payload(sizes),
        "raw_exif": exif,
        "lens_correction": lens_metadata or {"mode": lens_settings.mode, "applied": False},
        "decoder_normalized_to_acescg": True,
    }
    metadata.update(
        {
            key: value
            for key, value in {
                "camera_maker": exif.get("camera_maker"),
                "camera_model": exif.get("camera_model"),
                "lens_maker": exif.get("lens_maker"),
                "lens": exif.get("lens_model") or exif.get("lens_name"),
                "iso": exif.get("iso"),
                "shutter_speed": exif.get("shutter_speed"),
                "focal_length_mm": exif.get("focal_length_mm"),
                "aperture": exif.get("aperture"),
            }.items()
            if value not in (None, "")
        }
    )
    if opcode_audit is not None:
        metadata.update(
            {
                "experimental_dng_import": True,
                "experimental_dng_label": "Experimental DNG Import",
                "dng_route": "mosaiced_raw_dng",
                "dng_color_path": "camera_linear_after_libraw_demosaic",
                "dng_operations": " → ".join(item["name"] for item in opcode_audit["operations"]),
                "dng_warnings": "Automatic Lensfun disabled to prevent duplicate correction.",
                "dng_opcode_audit": opcode_audit,
            }
        )
    return image, metadata


def list_lens_profiles(query: str | None = None, limit: int = 250) -> list[LensProfileRecord]:
    records = _lens_profile_catalog()
    needle = (query or "").strip().casefold()
    if needle:
        records = tuple(
            record for record in records
            if needle in " ".join(
                (record.camera_maker, record.camera_model, record.lens_maker, record.lens_model, record.mount or "")
            ).casefold()
        )
    return list(records[: max(1, min(limit, 1000))])


@lru_cache(maxsize=1)
def _lens_profile_catalog() -> tuple[LensProfileRecord, ...]:
    database = _lens_database()
    if database is None:
        return ()
    cameras = list(getattr(database, "cameras", []) or [])
    lenses = list(getattr(database, "lenses", []) or [])
    camera_by_mount: dict[str, list[Any]] = {}
    for camera in cameras:
        mount = str(getattr(camera, "mount", "") or "")
        camera_by_mount.setdefault(mount, []).append(camera)
    records: dict[str, LensProfileRecord] = {}
    for lens in lenses:
        mounts = list(getattr(lens, "mounts", []) or []) or [str(getattr(lens, "mount", "") or "")]
        compatible = [camera for mount in mounts for camera in camera_by_mount.get(str(mount), [])]
        for camera in compatible:
            mount = str(getattr(camera, "mount", "") or "")
            record = _lens_record(camera, lens, mount)
            records.setdefault(record.id, record)
    ordered = sorted(
        records.values(),
        key=lambda item: (
            item.camera_maker.casefold(), item.camera_model.casefold(), (item.mount or "").casefold(),
            item.lens_maker.casefold(), item.lens_model.casefold(),
        ),
    )
    return tuple(ordered)


def apply_lens_correction(
    image: np.ndarray,
    settings: LensCorrectionSettings,
    *,
    camera_maker: str | None = None,
    camera_model: str | None = None,
    lens_maker: str | None = None,
    lens_name: str | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    _raise_if_cancelled(cancelled)
    try:
        import lensfunpy
    except ImportError as exc:
        if settings.mode == "auto":
            return image, {
                "mode": "auto",
                "applied": False,
                "reason": "Lensfun is unavailable; RAW development continued without lens correction.",
            }
        raise RawImportError("Lens correction was requested, but lensfunpy is not installed.") from exc

    database = _lens_database()
    if database is None:
        if settings.mode == "auto":
            return image, {
                "mode": "auto",
                "applied": False,
                "reason": "Lensfun's database is unavailable; RAW development continued without lens correction.",
            }
        raise RawImportError("Lensfun's correction database is unavailable.")
    database_identity = _lens_database_identity()
    if (
        settings.mode == "manual"
        and settings.database_version
        and settings.database_version != database_identity
    ):
        return image, {
            "mode": "off",
            "requested_mode": "manual",
            "applied": False,
            "warning": "The saved Lensfun database identity does not match; correction fell back to Off without substitution.",
            "database_version": database_identity,
        }
    profile = _resolve_lens_profile(
        database,
        settings,
        camera_maker=camera_maker,
        camera_model=camera_model,
        lens_maker=lens_maker,
        lens_name=lens_name,
    )
    if profile is None:
        if settings.mode == "auto":
            return image, {"mode": "auto", "applied": False, "reason": "No unique Lensfun profile match."}
        return image, {
            "mode": "off",
            "requested_mode": "manual",
            "applied": False,
            "warning": "The saved Lensfun profile is unavailable; correction fell back to Off without substitution.",
        }

    camera, lens, record = profile
    focal = settings.focal_length_mm
    if focal is None:
        focal = _first_calibration_focal(lens)
    if focal is None:
        raise RawImportError("Lens correction needs a focal length from metadata or manual input.")
    aperture = settings.aperture or 0.0
    distance = settings.focus_distance_m or 1000.0
    crop = float(getattr(camera, "crop_factor", 1.0) or 1.0)
    height, width = image.shape[:2]
    try:
        modifier = lensfunpy.Modifier(lens, crop, width, height)
        flags = lensfunpy.ModifyFlags.SCALE
        if settings.distortion:
            flags |= lensfunpy.ModifyFlags.DISTORTION
        if settings.chromatic_aberration:
            flags |= lensfunpy.ModifyFlags.TCA
        if settings.vignetting:
            flags |= lensfunpy.ModifyFlags.VIGNETTING
        modifier.initialize(
            float(focal), float(aperture), float(distance), scale=0.0, pixel_format=np.float32, flags=flags
        )
        corrected = np.ascontiguousarray(image, dtype=np.float32).copy()
        if settings.vignetting and aperture > 0:
            modifier.apply_color_modification(corrected)
        _raise_if_cancelled(cancelled)
        coordinates = None
        if settings.chromatic_aberration:
            coordinates = modifier.apply_subpixel_geometry_distortion()
        elif settings.distortion:
            coordinates = modifier.apply_geometry_distortion()
        if coordinates is not None:
            corrected = _remap_bilinear_strips(
                corrected,
                np.asarray(coordinates),
                chromatic=settings.chromatic_aberration,
                cancelled=cancelled,
            )
    except RawImportError:
        raise
    except Exception as exc:
        raise RawImportError(f"Lensfun could not apply the selected profile: {exc}") from exc
    return corrected, {
        "mode": settings.mode,
        "applied": True,
        "profile": record.as_dict(),
        "distortion": settings.distortion,
        "chromatic_aberration": settings.chromatic_aberration,
        "vignetting": settings.vignetting and aperture > 0,
        "focal_length_mm": float(focal),
        "aperture": float(aperture) if aperture > 0 else None,
        "focus_distance_m": float(distance),
        "database_version": database_identity,
    }


def _resolve_lens_profile(
    database: Any,
    settings: LensCorrectionSettings,
    *,
    camera_maker: str | None,
    camera_model: str | None,
    lens_maker: str | None,
    lens_name: str | None,
) -> tuple[Any, Any, LensProfileRecord] | None:
    if settings.mode == "manual" and settings.profile_id:
        parts = settings.profile_id.split("|")
        if len(parts) == 5:
            camera_maker_value, camera_model_value, mount_value, lens_maker_value, lens_model_value = parts
        elif len(parts) == 4:
            camera_maker_value, camera_model_value, lens_maker_value, lens_model_value = parts
            mount_value = None
        else:
            return None
        cameras = [
            camera for camera in database.find_cameras(camera_maker_value, camera_model_value)
            if str(getattr(camera, "maker", "") or "") == camera_maker_value
            and str(getattr(camera, "model", "") or "") == camera_model_value
            and (mount_value is None or str(getattr(camera, "mount", "") or "") == mount_value)
        ]
        if len(cameras) != 1:
            return None
        camera = cameras[0]
        candidates = [
            candidate for candidate in database.find_lenses(camera, lens_maker_value, lens_model_value)
            if str(getattr(candidate, "maker", "") or "") == lens_maker_value
            and str(getattr(candidate, "model", "") or "") == lens_model_value
        ]
        if len(candidates) != 1:
            return None
        lens = candidates[0]
        mount = str(getattr(camera, "mount", "") or "")
        record = _lens_record(camera, lens, mount)
        if mount_value is not None and record.id != settings.profile_id:
            return None
        return camera, lens, record
    elif settings.mode == "auto" and camera_model and lens_name:
        cameras = database.find_cameras(camera_maker, camera_model)
        if len(cameras) != 1:
            return None
        camera = cameras[0]
        lenses = database.find_lenses(camera, maker=lens_maker, lens=lens_name)
        if len(lenses) != 1:
            return None
        lens = lenses[0]
        mount = (list(getattr(lens, "mounts", []) or []) or [getattr(camera, "mount", None)])[0]
        return camera, lens, _lens_record(camera, lens, mount)
    else:
        return None


def _remap_bilinear_strips(
    image: np.ndarray,
    coordinates: np.ndarray,
    *,
    chromatic: bool,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    height, width, channels = image.shape
    output = np.empty_like(image)
    for start in range(0, height, rows):
        _raise_if_cancelled(cancelled)
        end = min(height, start + rows)
        for channel in range(channels):
            if chromatic and coordinates.ndim == 4:
                xy = coordinates[start:end, :, min(channel, coordinates.shape[2] - 1), :]
            else:
                xy = coordinates[start:end, :, :]
            x = np.clip(xy[..., 0], 0.0, width - 1.0)
            y = np.clip(xy[..., 1], 0.0, height - 1.0)
            x0 = np.floor(x).astype(np.int32)
            y0 = np.floor(y).astype(np.int32)
            x1 = np.minimum(x0 + 1, width - 1)
            y1 = np.minimum(y0 + 1, height - 1)
            wx = x - x0
            wy = y - y0
            top = image[y0, x0, channel] * (1.0 - wx) + image[y0, x1, channel] * wx
            bottom = image[y1, x0, channel] * (1.0 - wx) + image[y1, x1, channel] * wx
            output[start:end, :, channel] = top * (1.0 - wy) + bottom * wy
    return output


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise RawImportError("Import cancelled")


def _lens_record(camera: Any, lens: Any, mount: str | None) -> LensProfileRecord:
    maker = str(getattr(camera, "maker", "") or "")
    model = str(getattr(camera, "model", "") or "")
    return LensProfileRecord(
        id=_profile_id(camera, lens, mount),
        camera_maker=maker,
        camera_model=model,
        lens_maker=str(getattr(lens, "maker", "") or ""),
        lens_model=str(getattr(lens, "model", "") or ""),
        mount=str(mount) if mount else None,
        crop_factor=float(getattr(camera, "crop_factor", 1.0) or 1.0),
        distortion=bool(getattr(lens, "calib_distortion", None)),
        chromatic_aberration=bool(getattr(lens, "calib_tca", None)),
        vignetting=bool(getattr(lens, "calib_vignetting", None)),
    )


def _profile_id(camera: Any, lens: Any, mount: str | None = None) -> str:
    parts = (
        getattr(camera, "maker", ""), getattr(camera, "model", ""),
        mount if mount is not None else getattr(camera, "mount", ""),
        getattr(lens, "maker", ""), getattr(lens, "model", ""),
    )
    return "|".join(str(part or "").strip().replace("|", "/") for part in parts)


def _first_calibration_focal(lens: Any) -> float | None:
    for attribute in ("calib_distortion", "calib_tca", "calib_vignetting"):
        for calibration in list(getattr(lens, attribute, []) or []):
            value = getattr(calibration, "focal", None)
            if value:
                return float(value)
    return None


def _float_list(value: Any) -> list[float] | None:
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _sizes_payload(sizes: Any) -> dict[str, int]:
    if sizes is None:
        return {}
    names = ("raw_width", "raw_height", "width", "height", "top_margin", "left_margin")
    return {name: int(getattr(sizes, name)) for name in names if getattr(sizes, name, None) is not None}


def _read_raw_exif(path: Path) -> dict[str, Any]:
    try:
        import exifread

        with path.open("rb") as handle:
            tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
    except Exception:
        return {}

    def text(*names: str) -> str | None:
        for name in names:
            value = tags.get(name)
            if value is not None and str(value).strip():
                return str(value).strip()
        return None

    def number(*names: str) -> float | None:
        for name in names:
            value = tags.get(name)
            values = getattr(value, "values", None)
            candidate = values[0] if isinstance(values, list) and values else value
            try:
                numerator = getattr(candidate, "num", None)
                denominator = getattr(candidate, "den", None)
                return float(numerator) / float(denominator) if denominator else float(candidate)
            except (TypeError, ValueError, ZeroDivisionError):
                continue
        return None

    return {
        key: value
        for key, value in {
            "camera_maker": text("Image Make"),
            "camera_model": text("Image Model"),
            "lens_maker": text("EXIF LensMake", "Image LensMake", "MakerNote LensMake"),
            "lens_model": text("EXIF LensModel", "Image LensModel", "MakerNote LensModel", "MakerNote LensType"),
            "iso": text(
                "EXIF PhotographicSensitivity",
                "EXIF ISOSpeedRatings",
                "EXIF RecommendedExposureIndex",
            ),
            "shutter_speed": text("EXIF ExposureTime", "Image ExposureTime"),
            "focal_length_mm": number("EXIF FocalLength"),
            "aperture": number("EXIF FNumber"),
            "focus_distance_m": number("EXIF SubjectDistance"),
        }.items()
        if value is not None
    }


def _read_libraw_metadata(raw: Any) -> dict[str, Any]:
    """Return vendor-aware LibRaw metadata without replacing exact EXIF identity."""
    lens = getattr(raw, "lens", None)
    other = getattr(raw, "other", None)
    return {
        key: value
        for key, value in {
            "lens_maker": _clean_metadata_text(getattr(lens, "make", None)),
            "lens_model": _clean_metadata_text(getattr(lens, "model", None)),
            "focal_length_mm": _positive_float(getattr(other, "focal_length", None)),
            "aperture": _positive_float(getattr(other, "aperture", None)),
            "iso": _positive_float(getattr(other, "iso_speed", None)),
            "shutter_speed": _positive_float(getattr(other, "shutter_speed", None)),
        }.items()
        if value is not None
    }


def _merge_missing_metadata(primary: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    merged = dict(primary)
    for key, value in fallback.items():
        if merged.get(key) in (None, ""):
            merged[key] = value
    return merged


def _clean_metadata_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip().strip("\x00")
    return text or None


def _positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


@lru_cache(maxsize=1)
def _lens_database() -> Any | None:
    try:
        import lensfunpy

        return lensfunpy.Database()
    except (ImportError, OSError, RuntimeError):
        return None


@lru_cache(maxsize=1)
def _lens_database_identity() -> str | None:
    try:
        import lensfunpy

        database_directory = Path(lensfunpy.__file__).resolve().parent / "db_files"
        files = sorted(database_directory.glob("*.xml"))
        if not files:
            return None
        digest = hashlib.sha256()
        for path in files:
            digest.update(path.name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(path.read_bytes())
        return f"sha256:{digest.hexdigest()}"
    except (ImportError, OSError):
        return None
