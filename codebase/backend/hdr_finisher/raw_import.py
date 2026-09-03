from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

import numpy as np

from .color import aces2065_to_acescg, transform_float32_bounded
from .dng_color import D60_XYZ, XYZ_D60_TO_ACESCG, chromatic_adaptation_matrix
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

# LibRaw 0.22.1's cam_xyz_coeff() multiplies cam_xyz (XYZ -> camera rows)
# by its sRGB -> XYZ matrix, normalizes those rows so D65 maps to camera
# unity, and then pseudoinverts the result. Keep this value local and explicit
# so the bridge's interpretation is reviewable without depending on a display
# RGB colourspace helper.
LIBRAW_MATRIX_REFERENCE_WHITE_D65 = np.asarray(
    [0.95047, 1.0, 1.08883], dtype=np.float64
)
CAMERA_LINEAR_PIPELINE = "camera_linear_float_bridge_opposed_v2"
LEGACY_RAW_PIPELINE = "legacy_libraw_aces_fallback_v1"
OPPOSED_COLOR_METHOD = "opposed_color_v1"
OPPOSED_COLOR_ALGORITHM_VERSION = "hdr-finisher-opposed-color-v1"
OPPOSED_COLOR_THRESHOLD_SAFETY = 0.987


class RawImportError(RuntimeError):
    """Raised when deterministic RAW development cannot be completed."""


class _CameraLinearUnsupported(ValueError):
    """Internal capability-gate result for the inspectable legacy fallback."""


@dataclass(frozen=True)
class CameraLinearMetadata:
    """Validated metadata needed after LibRaw's camera-RGB transport.

    The black values are retained as provenance. LibRaw has already subtracted
    them before the no_auto_scale gate, so normalization divides by the usable
    white-minus-black range and deliberately does not subtract them again.
    """

    black_level: np.ndarray
    white_level: np.ndarray
    raw_black_level: np.ndarray
    raw_white_level: np.ndarray
    raw_pattern: np.ndarray
    raw_channel_to_rgb: np.ndarray
    as_shot_wb: np.ndarray
    camera_to_xyz_d65: np.ndarray
    camera_to_acescg: np.ndarray
    color_description: str
    normalization_basis: str
    matrix_source: str
    matrix_reference_white: str
    white_level_source: str
    wb_channel_sources: tuple[str, str, str]


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

    bridge_metadata: CameraLinearMetadata | None = None
    legacy_fallback_reason: str | None = None
    bridge_transport_diagnostics: dict[str, list[int]] | None = None
    highlight_reconstruction_diagnostics: dict[str, Any] | None = None
    try:
        if progress:
            progress("developing_raw", "Developing RAW with AHD demosaic")
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
                try:
                    bridge_metadata = _camera_linear_metadata_from_libraw(raw)
                except _CameraLinearUnsupported as exc:
                    legacy_fallback_reason = str(exc)
                if bridge_metadata is not None:
                    highlight_reconstruction_diagnostics = _apply_raw_highlight_reconstruction(
                        raw,
                        bridge_metadata,
                        settings,
                        cancelled=cancelled,
                    )
                    developed = _develop_libraw_camera_rgb(raw, rawpy)
                    bridge_transport_diagnostics = _transport_diagnostics(
                        developed, cancelled=cancelled
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
    elif bridge_metadata is not None:
        camera_linear = _normalize_camera_rgb_float32(
            developed, bridge_metadata, cancelled=cancelled
        )
        del developed
        if progress:
            progress("color_conversion", "Applying RAW white balance and converting camera RGB to ACEScg")
        image = _camera_rgb_to_acescg_float32(
            camera_linear, bridge_metadata, cancelled=cancelled
        )
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
        lens_input = aces2065 if not opcode_plan and bridge_metadata is None else image
        lens_output, lens_metadata = apply_lens_correction(
            lens_input,
            lens_settings,
            camera_maker=exif.get("camera_maker"),
            camera_model=exif.get("camera_model"),
            lens_maker=exif.get("lens_maker"),
            lens_name=exif.get("lens_model") or exif.get("lens_name"),
            cancelled=cancelled,
        )
        if not opcode_plan and bridge_metadata is None:
            aces2065 = lens_output
        else:
            image = lens_output
    _raise_if_cancelled(cancelled)
    if not opcode_plan and bridge_metadata is None:
        if progress:
            progress("color_conversion", "Converting linear ACES2065-1 to ACEScg")
        image = transform_float32_bounded(
            aces2065, aces2065_to_acescg, cancelled=cancelled
        )
    rawpy_version = str(getattr(rawpy, "__version__", "unknown"))
    libraw_version_value = getattr(rawpy, "libraw_version", ())
    libraw_version = ".".join(map(str, libraw_version_value)) if libraw_version_value else "unknown"
    if opcode_plan:
        bit_depth = "16-bit LibRaw linear development"
        raw_development: dict[str, Any] = {
            "white_balance": settings.white_balance,
            "demosaic": settings.demosaic,
            "auto_bright": False,
            "highlight_mode": "clip",
            "output_space": "ACES2065-1",
        }
    elif bridge_metadata is not None:
        bit_depth = "16-bit LibRaw camera-RGB transport; float32 color development"
        raw_development = _bridge_provenance(
            bridge_metadata,
            rawpy_version=rawpy_version,
            libraw_version=libraw_version,
            transport_diagnostics=bridge_transport_diagnostics or {},
            highlight_reconstruction=highlight_reconstruction_diagnostics or {},
        )
    else:
        bit_depth = "16-bit LibRaw linear development; float32 ACEScg conversion"
        raw_development = {
            "pipeline": LEGACY_RAW_PIPELINE,
            "fallback_reason": legacy_fallback_reason or "camera-linear bridge qualification unavailable",
            "decoder": "LibRaw",
            "rawpy_version": rawpy_version,
            "libraw_version": libraw_version,
            "white_balance": settings.white_balance,
            "demosaic": settings.demosaic,
            "auto_bright": False,
            "highlight_mode": "clip",
            "output_space": "ACES2065-1",
        }
    metadata: dict[str, Any] = {
        "bit_depth": bit_depth,
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "raw_input": True,
        "dng_input": path.suffix.lower() == ".dng",
        "raw_convenience_beta": True,
        "raw_mosaiced": is_mosaiced,
        "raw_development": raw_development,
        "camera_white_balance": camera_white_balance,
        "daylight_white_balance": daylight_white_balance,
        "raw_sizes": _sizes_payload(sizes),
        "raw_exif": exif,
        "lens_correction": lens_metadata or {"mode": lens_settings.mode, "applied": False},
        "decoder_normalized_to_acescg": True,
    }
    if not opcode_plan:
        metadata["raw_pipeline"] = str(raw_development["pipeline"])
        if legacy_fallback_reason is not None:
            metadata["raw_fallback_reason"] = legacy_fallback_reason
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


def _develop_libraw_camera_rgb(raw: Any, rawpy: Any) -> np.ndarray:
    """Use uint16 only to carry black-subtracted, unity-WB camera RGB."""
    return raw.postprocess(
        demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
        use_camera_wb=False,
        use_auto_wb=False,
        user_wb=[1.0, 1.0, 1.0, 1.0],
        no_auto_bright=True,
        no_auto_scale=True,
        output_color=rawpy.ColorSpace.raw,
        gamma=(1.0, 1.0),
        output_bps=16,
        highlight_mode=rawpy.HighlightMode.Clip,
    )


def _camera_linear_metadata_from_libraw(raw: Any) -> CameraLinearMetadata:
    """Capability-gate an ordinary Bayer/X-Trans RAW using metadata only.

    rawpy exposes ``rgb_xyz_matrix`` as LibRaw's ``cam_xyz[4][3]``. Despite
    the wrapper's historical "Camera RGB - XYZ" label, LibRaw 0.22.1 source
    uses each row as XYZ -> camera: cam_xyz_coeff() multiplies it by the
    linear-sRGB -> XYZ(D65) matrix, normalizes each row against D65, then
    pseudoinverts it to obtain camera -> output RGB. Repeating those exact
    orientation/reference-white steps here produces a camera -> XYZ(D65)
    matrix suitable for our own float32 development.
    """
    pattern_value = getattr(raw, "raw_pattern", None)
    if pattern_value is None:
        raise _CameraLinearUnsupported("unsupported non-mosaiced or layered sensor data")
    try:
        pattern = np.asarray(pattern_value)
    except (TypeError, ValueError):
        raise _CameraLinearUnsupported("missing or invalid CFA topology") from None
    if pattern.shape not in {(2, 2), (6, 6)}:
        raise _CameraLinearUnsupported(
            f"unsupported CFA topology {tuple(int(item) for item in pattern.shape)}"
        )
    if not np.issubdtype(pattern.dtype, np.integer):
        raise _CameraLinearUnsupported("CFA channel indices are not integral")

    try:
        color_description = bytes(getattr(raw, "color_desc", None)).decode("ascii").rstrip("\x00")
    except (TypeError, ValueError, UnicodeDecodeError):
        raise _CameraLinearUnsupported("missing or invalid LibRaw color description") from None
    if len(color_description) < 3:
        raise _CameraLinearUnsupported("LibRaw color description has fewer than three channels")
    used_indices = tuple(sorted(int(item) for item in np.unique(pattern)))
    if any(index < 0 or index >= len(color_description) for index in used_indices):
        raise _CameraLinearUnsupported("CFA references a channel outside LibRaw color_desc")
    used_colors = {color_description[index] for index in used_indices}
    if used_colors != {"R", "G", "B"}:
        raise _CameraLinearUnsupported(
            f"unsupported non-RGB CFA color model {color_description!r}"
        )
    try:
        num_colors = int(getattr(raw, "num_colors", 3))
    except (TypeError, ValueError, OverflowError):
        raise _CameraLinearUnsupported("missing or invalid LibRaw color count") from None
    if num_colors != 3:
        raise _CameraLinearUnsupported("unsupported materially distinct four-color sensor model")

    black_raw = _finite_vector(getattr(raw, "black_level_per_channel", None), 4, "black levels")
    if np.any(black_raw < 0.0):
        raise _CameraLinearUnsupported("black levels must be non-negative")
    black = _map_libraw_channels(
        black_raw, color_description, used_indices, "black levels", require_positive=False
    )

    per_channel_white_value = getattr(raw, "camera_white_level_per_channel", None)
    white_level_source = "camera_white_level_per_channel"
    try:
        white_raw = _finite_vector(per_channel_white_value, 4, "camera white levels")
        white = _map_libraw_channels(
            white_raw, color_description, used_indices, "camera white levels", require_positive=True
        )
        if np.any(white <= black):
            raise _CameraLinearUnsupported("camera white levels must exceed black levels")
    except _CameraLinearUnsupported:
        global_white = _positive_finite_scalar(getattr(raw, "white_level", None), "global white level")
        white_raw = np.full(4, global_white, dtype=np.float64)
        white = np.full(3, global_white, dtype=np.float64)
        white_level_source = "libraw_global_white_fallback"
        if np.any(white <= black):
            raise _CameraLinearUnsupported("global white level must exceed black levels") from None

    wb_raw = _finite_vector(getattr(raw, "camera_whitebalance", None), 4, "as-shot white balance")
    wb, wb_sources = _map_white_balance(wb_raw, color_description, used_indices)
    green = float(wb[1])
    if not np.isfinite(green) or green <= 0.0:
        raise _CameraLinearUnsupported("as-shot white balance has no positive green reference")
    wb = wb / green

    try:
        raw_matrix = np.asarray(getattr(raw, "rgb_xyz_matrix", None), dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        raise _CameraLinearUnsupported("missing or invalid LibRaw camera matrix") from None
    if raw_matrix.shape != (4, 3) or not np.all(np.isfinite(raw_matrix)):
        raise _CameraLinearUnsupported("LibRaw camera matrix must be finite with shape 4x3")
    xyz_to_camera = np.empty((3, 3), dtype=np.float64)
    for output_index, color in enumerate("RGB"):
        rows = [
            raw_matrix[index]
            for index, item in enumerate(color_description[:4])
            if item == color and np.linalg.norm(raw_matrix[index]) > 1e-12
        ]
        if not rows:
            raise _CameraLinearUnsupported(f"LibRaw camera matrix has no {color} row")
        if len(rows) > 1 and any(
            not np.allclose(rows[0], row, rtol=1e-3, atol=1e-6) for row in rows[1:]
        ):
            raise _CameraLinearUnsupported(
                f"LibRaw camera matrix has materially different {color} channel rows"
            )
        xyz_to_camera[output_index] = np.mean(rows, axis=0)
    _validate_camera_matrix(xyz_to_camera, "LibRaw XYZ-to-camera matrix")
    d65_response = xyz_to_camera @ LIBRAW_MATRIX_REFERENCE_WHITE_D65
    if not np.all(np.isfinite(d65_response)) or np.any(d65_response <= 1e-12):
        raise _CameraLinearUnsupported("LibRaw camera matrix has an invalid D65 response")
    normalized_xyz_to_camera = xyz_to_camera / d65_response[:, None]
    _validate_camera_matrix(normalized_xyz_to_camera, "D65-normalized XYZ-to-camera matrix")
    try:
        camera_to_xyz_d65 = np.linalg.inv(normalized_xyz_to_camera)
    except np.linalg.LinAlgError:
        raise _CameraLinearUnsupported("D65-normalized XYZ-to-camera matrix is singular") from None
    d65_to_d60 = chromatic_adaptation_matrix(LIBRAW_MATRIX_REFERENCE_WHITE_D65, D60_XYZ)
    camera_to_acescg = XYZ_D60_TO_ACESCG @ d65_to_d60 @ camera_to_xyz_d65
    _validate_camera_matrix(camera_to_acescg, "camera-to-ACEScg matrix")

    raw_channel_to_rgb = np.full(4, -1, dtype=np.int8)
    for index in used_indices:
        raw_channel_to_rgb[index] = "RGB".index(color_description[index])

    return CameraLinearMetadata(
        black_level=black,
        white_level=white,
        raw_black_level=black_raw,
        raw_white_level=white_raw,
        raw_pattern=pattern.astype(np.uint8, copy=True),
        raw_channel_to_rgb=raw_channel_to_rgb,
        as_shot_wb=wb,
        camera_to_xyz_d65=camera_to_xyz_d65,
        camera_to_acescg=camera_to_acescg,
        color_description=color_description,
        normalization_basis="camera_white_minus_black",
        matrix_source="rawpy.rgb_xyz_matrix / LibRaw cam_xyz[4][3]",
        matrix_reference_white="D65 (LibRaw cam_xyz_coeff row-normalization convention)",
        white_level_source=white_level_source,
        wb_channel_sources=wb_sources,
    )


def _apply_raw_highlight_reconstruction(
    raw: Any,
    metadata: CameraLinearMetadata,
    settings: RawImportSettings,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Repair clipped CFA photosites with a local opposed-color estimate.

    The method follows darktable's GPLv3+ opposed highlight reconstruction:
    local channel averages are measured in cube-root space, a clipped channel
    is estimated from the two opposing channels, and a global chrominance
    residual is learned from nearby unclipped samples. This NumPy version runs
    before AHD because CFA channel identity is unavailable after demosaic.
    """
    configuration = settings.highlight_reconstruction
    threshold = float(configuration.clipping_threshold)
    effective_threshold = threshold * OPPOSED_COLOR_THRESHOLD_SAFETY
    diagnostics: dict[str, Any] = {
        "enabled": bool(configuration.enabled),
        "method": str(configuration.method),
        "algorithm_version": OPPOSED_COLOR_ALGORITHM_VERSION,
        "clipping_threshold": threshold,
        "effective_threshold": effective_threshold,
        "effective_threshold_per_rgb_after_white_balance": [],
        "stage": "float32_normalized_raw_mosaic_before_ahd",
        "applied": False,
        "clipped_photosites_per_rgb": [0, 0, 0],
        "reconstructed_photosites_per_rgb": [0, 0, 0],
        "chrominance_correction_per_rgb": [0.0, 0.0, 0.0],
        "chrominance_sample_count_per_rgb": [0, 0, 0],
        "uint16_transport_overflow_count": 0,
    }
    if not configuration.enabled:
        diagnostics["reason"] = "bypassed_in_raw_recipe"
        return diagnostics
    if configuration.method != OPPOSED_COLOR_METHOD:
        raise RawImportError(
            f"Unsupported RAW highlight reconstruction method {configuration.method!r}."
        )

    mosaic_value = getattr(raw, "raw_image_visible", None)
    if mosaic_value is None:
        raise RawImportError(
            "Opposed-color highlight reconstruction requires LibRaw's visible RAW mosaic."
        )
    mosaic = np.asarray(mosaic_value)
    if mosaic.dtype != np.uint16 or mosaic.ndim != 2 or not mosaic.flags.writeable:
        raise RawImportError(
            "LibRaw's visible RAW mosaic must be a writable uint16 two-dimensional array."
        )

    normalized = _normalize_raw_mosaic_float32(
        mosaic,
        metadata,
        cancelled=cancelled,
    )
    rgb_pattern = metadata.raw_channel_to_rgb[metadata.raw_pattern]
    pattern_height, pattern_width = rgb_pattern.shape
    height, width = normalized.shape
    wb = metadata.as_shot_wb.astype(np.float32)
    channel_thresholds = wb * np.float32(effective_threshold)
    diagnostics["effective_threshold_per_rgb_after_white_balance"] = (
        channel_thresholds.astype(float).tolist()
    )
    # darktable's RAW opposed method receives the white-balanced mosaic and
    # scales each clipping threshold by the same coefficient. Do that in this
    # temporary float domain, then divide repaired values by WB when returning
    # them to LibRaw's unity-WB mosaic.
    for row_offset in range(pattern_height):
        for column_offset in range(pattern_width):
            rgb_channel = int(rgb_pattern[row_offset, column_offset])
            normalized[row_offset::pattern_height, column_offset::pattern_width] *= wb[
                rgb_channel
            ]
    clipped = np.zeros(normalized.shape, dtype=bool)
    clipped_counts = np.zeros(3, dtype=np.int64)
    for row_offset in range(pattern_height):
        for column_offset in range(pattern_width):
            rgb_channel = int(rgb_pattern[row_offset, column_offset])
            selected = normalized[
                row_offset::pattern_height, column_offset::pattern_width
            ] >= channel_thresholds[rgb_channel]
            clipped[row_offset::pattern_height, column_offset::pattern_width] = selected
            clipped_counts[rgb_channel] += np.count_nonzero(selected)
    diagnostics["clipped_photosites_per_rgb"] = clipped_counts.astype(int).tolist()
    if not np.any(clipped):
        diagnostics["applied"] = True
        diagnostics["reason"] = "no_photosites_at_or_above_threshold"
        return diagnostics

    _raise_if_cancelled(cancelled)
    chrominance, chrominance_counts = _estimate_opposed_chrominance(
        normalized,
        clipped,
        rgb_pattern,
        channel_thresholds,
        cancelled=cancelled,
    )
    diagnostics["chrominance_correction_per_rgb"] = chrominance.astype(float).tolist()
    diagnostics["chrominance_sample_count_per_rgb"] = chrominance_counts.astype(int).tolist()

    rows_all, columns_all = np.nonzero(clipped)
    reconstructed_counts = np.zeros(3, dtype=np.int64)
    overflow_count = 0
    chunk_size = 250_000
    for start in range(0, rows_all.size, chunk_size):
        _raise_if_cancelled(cancelled)
        rows = rows_all[start : start + chunk_size]
        columns = columns_all[start : start + chunk_size]
        target_rgb = rgb_pattern[rows % pattern_height, columns % pattern_width]
        reference = _opposed_reference(normalized, rows, columns, target_rgb, rgb_pattern)
        original = normalized[rows, columns]
        repaired_wb = np.maximum(original, reference + chrominance[target_rgb])
        repaired = repaired_wb / wb[target_rgb]
        raw_channels = metadata.raw_pattern[rows % pattern_height, columns % pattern_width]
        raw_black = metadata.raw_black_level[raw_channels]
        raw_range = metadata.raw_white_level[raw_channels] - raw_black
        encoded_float = repaired.astype(np.float64) * raw_range + raw_black
        overflow_count += int(np.count_nonzero(encoded_float > 65535.0))
        encoded = np.clip(np.rint(encoded_float), 0.0, 65535.0).astype(np.uint16)
        changed = encoded != mosaic[rows, columns]
        mosaic[rows, columns] = encoded
        for rgb_channel in range(3):
            reconstructed_counts[rgb_channel] += np.count_nonzero(
                changed & (target_rgb == rgb_channel)
            )

    diagnostics["applied"] = True
    diagnostics["reconstructed_photosites_per_rgb"] = reconstructed_counts.astype(int).tolist()
    diagnostics["uint16_transport_overflow_count"] = overflow_count
    return diagnostics


def _normalize_raw_mosaic_float32(
    mosaic: np.ndarray,
    metadata: CameraLinearMetadata,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    """Black-subtract and white-normalize each CFA photosite exactly once."""
    output = np.empty(mosaic.shape, dtype=np.float32)
    pattern_height, pattern_width = metadata.raw_pattern.shape
    for row_offset in range(pattern_height):
        _raise_if_cancelled(cancelled)
        for column_offset in range(pattern_width):
            raw_channel = int(metadata.raw_pattern[row_offset, column_offset])
            black = np.float32(metadata.raw_black_level[raw_channel])
            usable_range = np.float32(
                metadata.raw_white_level[raw_channel] - metadata.raw_black_level[raw_channel]
            )
            source = mosaic[row_offset::pattern_height, column_offset::pattern_width]
            destination = output[row_offset::pattern_height, column_offset::pattern_width]
            np.subtract(source, black, out=destination, casting="unsafe")
            np.maximum(destination, np.float32(0.0), out=destination)
            destination *= np.float32(1.0) / usable_range
    return output


def _estimate_opposed_chrominance(
    normalized: np.ndarray,
    clipped: np.ndarray,
    rgb_pattern: np.ndarray,
    channel_thresholds: np.ndarray,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Estimate per-channel color residuals close to clipped image regions."""
    height, width = normalized.shape
    pattern_height, pattern_width = rgb_pattern.shape
    coarse_height = (height + 2) // 3
    coarse_width = (width + 2) // 3
    near_clipping = np.zeros((3, coarse_height, coarse_width), dtype=bool)
    clipped_rows, clipped_columns = np.nonzero(clipped)
    clipped_rgb = rgb_pattern[
        clipped_rows % pattern_height,
        clipped_columns % pattern_width,
    ]
    for rgb_channel in range(3):
        selected = clipped_rgb == rgb_channel
        if np.any(selected):
            near_clipping[rgb_channel, clipped_rows[selected] // 3, clipped_columns[selected] // 3] = True
            near_clipping[rgb_channel] = _dilate_boolean_mask(
                near_clipping[rgb_channel], radius=3
            )

    residual_sum = np.zeros(3, dtype=np.float64)
    residual_count = np.zeros(3, dtype=np.int64)
    chunk_size = 250_000
    for row_offset in range(pattern_height):
        _raise_if_cancelled(cancelled)
        global_rows = np.arange(row_offset, height, pattern_height, dtype=np.int64)
        coarse_rows = global_rows // 3
        for column_offset in range(pattern_width):
            rgb_channel = int(rgb_pattern[row_offset, column_offset])
            global_columns = np.arange(column_offset, width, pattern_width, dtype=np.int64)
            coarse_columns = global_columns // 3
            values = normalized[row_offset::pattern_height, column_offset::pattern_width]
            candidate = near_clipping[rgb_channel][
                coarse_rows[:, None], coarse_columns[None, :]
            ]
            candidate &= values >= np.float32(0.2) * channel_thresholds[rgb_channel]
            candidate &= values < channel_thresholds[rgb_channel]
            local_rows, local_columns = np.nonzero(candidate)
            for start in range(0, local_rows.size, chunk_size):
                _raise_if_cancelled(cancelled)
                rows = global_rows[local_rows[start : start + chunk_size]]
                columns = global_columns[local_columns[start : start + chunk_size]]
                targets = np.full(rows.shape, rgb_channel, dtype=np.int8)
                reference = _opposed_reference(
                    normalized, rows, columns, targets, rgb_pattern
                )
                residual = normalized[rows, columns] - reference
                finite = np.isfinite(residual)
                residual_sum[rgb_channel] += float(np.sum(residual[finite], dtype=np.float64))
                residual_count[rgb_channel] += int(np.count_nonzero(finite))

    correction = np.zeros(3, dtype=np.float32)
    reliable = residual_count > 100
    correction[reliable] = (
        residual_sum[reliable] / residual_count[reliable]
    ).astype(np.float32)
    return correction, residual_count


def _dilate_boolean_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    padded = np.pad(mask, radius, mode="constant", constant_values=False)
    output = np.zeros_like(mask)
    height, width = mask.shape
    for row_shift in range(2 * radius + 1):
        for column_shift in range(2 * radius + 1):
            row_delta = row_shift - radius
            column_delta = column_shift - radius
            if row_delta * row_delta + column_delta * column_delta > radius * radius + 4:
                continue
            output |= padded[
                row_shift : row_shift + height,
                column_shift : column_shift + width,
            ]
    return output


def _opposed_reference(
    normalized: np.ndarray,
    rows: np.ndarray,
    columns: np.ndarray,
    target_rgb: np.ndarray,
    rgb_pattern: np.ndarray,
) -> np.ndarray:
    """Return the cube-root-domain mean of the two opposing CFA channels."""
    count = rows.size
    if count == 0:
        return np.empty(0, dtype=np.float32)
    height, width = normalized.shape
    pattern_height, pattern_width = rgb_pattern.shape
    channel_sum = np.zeros((count, 3), dtype=np.float32)
    channel_count = np.zeros((count, 3), dtype=np.uint8)
    for row_delta in (-1, 0, 1):
        neighbor_rows = rows + row_delta
        valid_rows = (neighbor_rows >= 0) & (neighbor_rows < height)
        for column_delta in (-1, 0, 1):
            neighbor_columns = columns + column_delta
            valid = valid_rows & (neighbor_columns >= 0) & (neighbor_columns < width)
            indices = np.flatnonzero(valid)
            if indices.size == 0:
                continue
            neighbor_channels = rgb_pattern[
                neighbor_rows[indices] % pattern_height,
                neighbor_columns[indices] % pattern_width,
            ]
            neighbor_values = np.maximum(
                normalized[neighbor_rows[indices], neighbor_columns[indices]],
                np.float32(0.0),
            )
            for rgb_channel in range(3):
                selected = neighbor_channels == rgb_channel
                selected_indices = indices[selected]
                channel_sum[selected_indices, rgb_channel] += neighbor_values[selected]
                channel_count[selected_indices, rgb_channel] += 1

    channel_average = np.divide(
        channel_sum,
        channel_count,
        out=np.zeros_like(channel_sum),
        where=channel_count > 0,
    )
    np.cbrt(channel_average, out=channel_average)
    opposing_average = np.empty(count, dtype=np.float32)
    opposing_average[target_rgb == 0] = np.mean(
        channel_average[target_rgb == 0, 1:3], axis=1
    )
    opposing_average[target_rgb == 1] = np.mean(
        channel_average[target_rgb == 1][:, (0, 2)], axis=1
    )
    opposing_average[target_rgb == 2] = np.mean(
        channel_average[target_rgb == 2, 0:2], axis=1
    )
    return opposing_average * opposing_average * opposing_average


def _normalize_camera_rgb_float32(
    transport: np.ndarray,
    metadata: CameraLinearMetadata,
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    source = np.asarray(transport)
    if source.dtype != np.uint16 or source.ndim != 3 or source.shape[2] != 3:
        raise RawImportError("LibRaw camera-RGB transport must be a uint16 H×W×3 image.")
    output = source.astype(np.float32)
    inverse_range = (1.0 / (metadata.white_level - metadata.black_level)).astype(np.float32)
    for start in range(0, output.shape[0], rows):
        _raise_if_cancelled(cancelled)
        output[start : start + rows] *= inverse_range
    return output


def _camera_rgb_to_acescg_float32(
    camera_rgb: np.ndarray,
    metadata: CameraLinearMetadata,
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    if camera_rgb.dtype != np.float32 or camera_rgb.ndim != 3 or camera_rgb.shape[2] != 3:
        raise RawImportError("Camera color conversion requires an H×W×3 float32 image.")
    wb = metadata.as_shot_wb.astype(np.float32)
    matrix = metadata.camera_to_acescg.astype(np.float32)
    for start in range(0, camera_rgb.shape[0], rows):
        _raise_if_cancelled(cancelled)
        end = min(camera_rgb.shape[0], start + rows)
        strip = camera_rgb[start:end]
        strip *= wb
        strip[:] = strip @ matrix.T
    return np.ascontiguousarray(camera_rgb, dtype=np.float32)


def _map_white_balance(
    values: np.ndarray,
    color_description: str,
    used_indices: tuple[int, ...],
) -> tuple[np.ndarray, tuple[str, str, str]]:
    mapped = np.empty(3, dtype=np.float64)
    sources: list[str] = []
    for output_index, color in enumerate("RGB"):
        direct_indices = [index for index in used_indices if color_description[index] == color]
        direct = [float(values[index]) for index in direct_indices if values[index] > 0.0]
        source = "+".join(f"color_desc[{index}]" for index in direct_indices)
        if len(direct) != len(direct_indices):
            fallback = [
                float(values[index])
                for index, item in enumerate(color_description[:4])
                if item == color and values[index] > 0.0
            ]
            if not fallback:
                raise _CameraLinearUnsupported(
                    f"as-shot white balance has no positive {color} coefficient"
                )
            direct = fallback
            source += "_same-color-fallback"
        if any(not np.isclose(direct[0], item, rtol=1e-3, atol=1e-6) for item in direct[1:]):
            raise _CameraLinearUnsupported(
                f"as-shot white balance has materially different dual-{color} coefficients"
            )
        mapped[output_index] = float(np.mean(direct))
        sources.append(source)
    if not np.all(np.isfinite(mapped)) or np.any(mapped <= 0.0):
        raise _CameraLinearUnsupported("as-shot white balance must be finite and positive")
    return mapped, (sources[0], sources[1], sources[2])


def _map_libraw_channels(
    values: np.ndarray,
    color_description: str,
    used_indices: tuple[int, ...],
    name: str,
    *,
    require_positive: bool,
) -> np.ndarray:
    result = np.empty(3, dtype=np.float64)
    for output_index, color in enumerate("RGB"):
        selected = [float(values[index]) for index in used_indices if color_description[index] == color]
        if not selected:
            raise _CameraLinearUnsupported(f"{name} have no {color} channel")
        if require_positive and any(item <= 0.0 for item in selected):
            raise _CameraLinearUnsupported(f"{name} contain a non-positive {color} value")
        result[output_index] = float(np.mean(selected))
    return result


def _finite_vector(value: Any, size: int, name: str) -> np.ndarray:
    try:
        result = np.asarray(value, dtype=np.float64).reshape(-1)
    except (TypeError, ValueError):
        raise _CameraLinearUnsupported(f"missing or invalid {name}") from None
    if result.size != size or not np.all(np.isfinite(result)):
        raise _CameraLinearUnsupported(f"{name} must contain {size} finite values")
    return result


def _positive_finite_scalar(value: Any, name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise _CameraLinearUnsupported(f"missing or invalid {name}") from None
    if not np.isfinite(result) or result <= 0.0:
        raise _CameraLinearUnsupported(f"{name} must be finite and positive")
    return result


def _validate_camera_matrix(matrix: np.ndarray, name: str) -> None:
    if matrix.shape != (3, 3) or not np.all(np.isfinite(matrix)):
        raise _CameraLinearUnsupported(f"{name} must be a finite 3x3 matrix")
    try:
        condition = float(np.linalg.cond(matrix))
    except np.linalg.LinAlgError:
        raise _CameraLinearUnsupported(f"{name} is singular or ill-conditioned") from None
    if not np.isfinite(condition) or condition > 1e10:
        raise _CameraLinearUnsupported(f"{name} is singular or ill-conditioned")


def _transport_diagnostics(
    transport: np.ndarray,
    *,
    rows: int = 256,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, list[int]]:
    source = np.asarray(transport)
    if source.ndim != 3 or source.shape[2] != 3:
        return {}
    maximum = np.zeros(3, dtype=np.uint16)
    ceiling_count = np.zeros(3, dtype=np.int64)
    for start in range(0, source.shape[0], rows):
        _raise_if_cancelled(cancelled)
        strip = source[start : start + rows]
        maximum = np.maximum(maximum, np.max(strip, axis=(0, 1)))
        ceiling_count += np.count_nonzero(strip == 65535, axis=(0, 1))
    return {
        "channel_maximum": maximum.astype(int).tolist(),
        "exact_65535_count": ceiling_count.astype(int).tolist(),
    }


def _bridge_provenance(
    metadata: CameraLinearMetadata,
    *,
    rawpy_version: str,
    libraw_version: str,
    transport_diagnostics: dict[str, list[int]],
    highlight_reconstruction: dict[str, Any],
) -> dict[str, Any]:
    return {
        "pipeline": CAMERA_LINEAR_PIPELINE,
        "decoder": "LibRaw",
        "rawpy_version": rawpy_version,
        "libraw_version": libraw_version,
        "demosaic": "AHD",
        "libraw_output_space": "camera RGB",
        "libraw_output_bps": 16,
        "libraw_auto_scale": False,
        "white_balance_stage": "float32_after_libraw",
        "color_transform_stage": "float32_after_libraw",
        "libraw_highlight_mode_requested": "clip",
        "libraw_highlight_processing": "bypassed_by_no_auto_scale",
        "highlight_reconstruction": highlight_reconstruction,
        "normalization_basis": metadata.normalization_basis,
        "black_subtraction_stage": "LibRaw_before_no_auto_scale",
        "black_subtracted_exactly_once": True,
        "black_level_per_output_channel": metadata.black_level.tolist(),
        "camera_white_level_per_output_channel": metadata.white_level.tolist(),
        "camera_white_level_source": metadata.white_level_source,
        "as_shot_wb_green_normalized": metadata.as_shot_wb.tolist(),
        "white_balance_channel_sources": list(metadata.wb_channel_sources),
        "color_description": metadata.color_description,
        "matrix_qualification": "qualified",
        "matrix_source": metadata.matrix_source,
        "matrix_orientation": "raw rows are XYZ-to-camera; inverted after D65 row normalization",
        "matrix_reference_white": metadata.matrix_reference_white,
        "camera_to_xyz_d65": metadata.camera_to_xyz_d65.tolist(),
        "camera_to_acescg": metadata.camera_to_acescg.tolist(),
        "transport_channel_maximum": transport_diagnostics.get("channel_maximum", []),
        "transport_exact_65535_count": transport_diagnostics.get("exact_65535_count", []),
        "libraw_transport_ceiling": 65535,
    }


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
