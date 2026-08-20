from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .dng_color import (
    DngColorError,
    DngColorMetadata,
    build_color_transform,
    normalize_camera_samples,
    transform_normalized_to_acescg_in_place,
)
from .dng_opcodes import (
    DngImportCancelled,
    DngOpcode,
    DngOpcodeError,
    apply_opcode_list3,
    parse_gain_map,
    parse_opcode_list,
    parse_warp_rectilinear,
)
from .resource_preflight import (
    ResourceDecision,
    ResourceEstimate,
    ResourceSnapshot,
    detect_memory_resources,
    estimate_resources,
)


LINEAR_RAW = 34892
CFA = 32803
OPCODE_LIST_TAGS = ("OpcodeList1", "OpcodeList2", "OpcodeList3")
UNSUPPORTED_PIXEL_TAGS = (
    "LinearizationTable",
    "BlackLevelDeltaH",
    "BlackLevelDeltaV",
    "ProfileGainTableMap",
    "ProfileGainTableMap2",
)


class DngRoute(str, Enum):
    LINEAR_DNG = "linear_dng"
    MOSAICED_RAW_DNG = "mosaiced_raw_dng"
    UNSUPPORTED_DNG = "unsupported_dng"
    INVALID_DNG = "invalid_dng"


@dataclass(frozen=True)
class DngRejection:
    code: str
    message: str


@dataclass(frozen=True)
class DngFingerprint:
    file_size: int
    modified_ns: int
    primary_offset: int
    width: int
    height: int
    compression: int


@dataclass(frozen=True)
class LinearDngInspection:
    route: DngRoute
    width: int
    height: int
    samples_per_pixel: int
    dtype: str
    compression: int
    primary_series_index: int
    primary_page_index: int | None
    metadata_page_index: int
    color_path: str | None
    required_opcodes: tuple[DngOpcode, ...]
    optional_opcodes: tuple[DngOpcode, ...]
    warnings: tuple[str, ...]
    rejection: DngRejection | None
    resource_estimate: ResourceEstimate | None
    fingerprint: DngFingerprint
    metadata: dict[str, Any]


class LinearDngError(RuntimeError):
    pass


def inspect_dng(
    path: Path,
    *,
    resource_snapshot: ResourceSnapshot | None = None,
    retained_session_bytes: int = 0,
    gpu_max_texture_dimension: int = 16_384,
) -> LinearDngInspection:
    try:
        import tifffile
    except ImportError as exc:
        raise LinearDngError("Experimental DNG Import requires tifffile.") from exc

    stat = path.stat()
    try:
        with tifffile.TiffFile(path) as tif:
            if not tif.pages:
                raise LinearDngError("TIFF/DNG contains no root IFD.")
            root = tif.pages[0]
            if root.tags.get("DNGVersion") is None:
                return _invalid_inspection(path, stat, "missing_dng_version", "The file has no DNGVersion tag.")
            series_index, page = _select_primary(tif)
            page_index = _root_page_index(tif, page)
            width, height = int(page.imagewidth), int(page.imagelength)
            samples = int(page.samplesperpixel)
            compression = int(page.compression)
            photometric = int(page.photometric)
            dtype = np.dtype(page.dtype)
            fingerprint = DngFingerprint(
                stat.st_size, stat.st_mtime_ns, int(page.offset), width, height, compression
            )
            opcodes = _read_opcodes(page, root)
            required = tuple(opcode for opcode in opcodes if not opcode.optional)
            optional = tuple(opcode for opcode in opcodes if opcode.optional)
            warnings = [
                f"Skipped optional {opcode.name} ({opcode.list_name}, opcode {opcode.opcode_id})."
                for opcode in optional
                if not _supported_opcode(opcode)
            ]
            rejection = _opcode_rejection(required)
            metadata = _resolve_metadata(page, root, dtype, samples, width, height)
            metadata.update(
                {
                    "photometric": photometric,
                    "producer": _text_tag(page, root, "Software"),
                    "make": _text_tag(page, root, "Make"),
                    "model": _text_tag(page, root, "Model"),
                    "dng_version": _version_tag(page, root, "DNGVersion"),
                    "dng_backward_version": _version_tag(page, root, "DNGBackwardVersion"),
                }
            )

            if rejection is None:
                rejection = _metadata_rejection(page, root, metadata)
            is_mosaic = samples == 1 and (photometric == CFA or _tag(page, root, "CFAPattern") is not None)
            is_linear = photometric == LINEAR_RAW and samples == 3
            if is_mosaic:
                route = DngRoute.MOSAICED_RAW_DNG if rejection is None else DngRoute.UNSUPPORTED_DNG
                color_path = None
                estimate = None
            elif is_linear:
                rejection = rejection or _linear_layout_rejection(page, dtype, metadata)
                color_path = "forward_matrix" if metadata.get("forward_matrix1") is not None else "color_matrix_only"
                full_intermediates = 2 if required or int(metadata["orientation"]) != 1 else 1
                estimate = estimate_resources(
                    width=width,
                    height=height,
                    samples=samples,
                    bytes_per_sample=dtype.itemsize,
                    resources=resource_snapshot or detect_memory_resources(),
                    retained_session_bytes=retained_session_bytes,
                    gpu_max_texture_dimension=gpu_max_texture_dimension,
                    full_float_intermediates=full_intermediates,
                )
                if rejection is None and estimate.import_decision is not ResourceDecision.PASS:
                    rejection = DngRejection(
                        "unsafe_resources", estimate.import_error(width, height) or "DNG resource preflight failed."
                    )
                route = DngRoute.LINEAR_DNG if rejection is None else DngRoute.UNSUPPORTED_DNG
                if not estimate.full_frame_gpu_compatible:
                    warnings.append(
                        "The full image exceeds the GPU texture limit; a bounded preview proxy is required."
                    )
            else:
                route = DngRoute.UNSUPPORTED_DNG
                color_path = None
                estimate = None
                rejection = rejection or DngRejection(
                    "unsupported_primary",
                    f"The full-resolution DNG primary has unsupported photometric {photometric} and {samples} samples per pixel.",
                )

            return LinearDngInspection(
                route=route,
                width=width,
                height=height,
                samples_per_pixel=samples,
                dtype=str(dtype),
                compression=compression,
                primary_series_index=series_index,
                primary_page_index=page_index,
                metadata_page_index=0,
                color_path=color_path,
                required_opcodes=required,
                optional_opcodes=optional,
                warnings=tuple(warnings),
                rejection=rejection,
                resource_estimate=estimate,
                fingerprint=fingerprint,
                metadata=metadata,
            )
    except LinearDngError:
        raise
    except (OSError, ValueError, DngOpcodeError) as exc:
        raise LinearDngError(f"Invalid Experimental DNG metadata: {exc}") from exc


def decode_linear_dng(
    path: Path,
    inspection: LinearDngInspection,
    *,
    progress: Callable[[str, str], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    if inspection.route is not DngRoute.LINEAR_DNG:
        detail = inspection.rejection.message if inspection.rejection else inspection.route.value
        raise LinearDngError(f"Experimental DNG is not accepted: {detail}")
    _raise_if_cancelled(cancelled)
    try:
        import tifffile

        with tifffile.TiffFile(path) as tif:
            page = tif.series[inspection.primary_series_index].pages[0]
            _verify_fingerprint(path, page, inspection.fingerprint)
            if progress:
                progress("dng_decode", "Experimental DNG Import: decoding full-resolution primary")
            if bool(page.is_memmappable):
                decoded = tifffile.memmap(path, series=inspection.primary_series_index, mode="r")
            else:
                decoded = page.asarray()
            decoded = _normalize_layout(decoded, getattr(tif.series[inspection.primary_series_index], "axes", None))
            _raise_if_cancelled(cancelled)

            color_metadata = _color_metadata(inspection.metadata)
            if progress:
                progress("dng_normalize", "Experimental DNG Import: normalizing camera-linear samples")
            working = normalize_camera_samples(decoded, color_metadata, cancelled=cancelled)
            del decoded
            applied: tuple[dict[str, object], ...] = ()
            if inspection.required_opcodes or inspection.optional_opcodes:
                if progress:
                    progress("dng_opcodes", "Experimental DNG Import: applying mandatory DNG operations")
                working, applied = apply_opcode_list3(
                    working,
                    (*inspection.required_opcodes, *inspection.optional_opcodes),
                    cancelled=cancelled,
                )
            transform = build_color_transform(color_metadata)
            if progress:
                progress("dng_color", "Experimental DNG Import: converting scene-linear pixels to ACEScg")
            transform_normalized_to_acescg_in_place(
                working, transform, color_metadata.baseline_exposure, cancelled=cancelled
            )
            working = _crop_and_orient(working, inspection.metadata)
            image = np.ascontiguousarray(working, dtype=np.float32)
    except (MemoryError, OSError) as exc:
        raise LinearDngError(
            "Experimental DNG import ran out of memory or storage while decoding. The open document was not changed."
        ) from exc
    except (DngColorError, DngOpcodeError, DngImportCancelled):
        raise
    except Exception as exc:
        raise LinearDngError(f"Experimental DNG decoder failed: {exc}") from exc

    estimate = inspection.resource_estimate
    metadata: dict[str, Any] = {
        "bit_depth": inspection.dtype,
        "color_space": "ACEScg",
        "transfer_function": "LINEAR",
        "decoder_normalized_to_acescg": True,
        "dng_input": True,
        "raw_input": True,
        "raw_mosaiced": False,
        "experimental_dng_import": True,
        "experimental_dng_label": "Experimental DNG Import",
        "dng_diagnostics": {
            "route": inspection.route.value,
            "producer": inspection.metadata.get("producer"),
            "make": inspection.metadata.get("make"),
            "model": inspection.metadata.get("model"),
            "dng_version": inspection.metadata.get("dng_version"),
            "source_dimensions": [inspection.width, inspection.height],
            "compression": inspection.compression,
            "source_dtype": inspection.dtype,
            "primary_series_index": inspection.primary_series_index,
            "primary_page_offset": inspection.fingerprint.primary_offset,
            "color_path": transform.color_path,
            "estimated_profile_temperature": transform.estimated_temperature,
            "profile_weight1": transform.profile_weight1,
            "opcode_operations": list(applied),
            "warnings": list(inspection.warnings),
            "resource_estimate": _resource_payload(estimate),
        },
    }
    return image, metadata


def _select_primary(tif: Any) -> tuple[int, Any]:
    candidates: list[tuple[int, Any]] = []
    for index, series in enumerate(tif.series):
        if not len(series.pages):
            continue
        page = series.pages[0]
        if int(getattr(page, "subfiletype", 0) or 0) == 0:
            candidates.append((index, page))
    if not candidates:
        raise LinearDngError("DNG contains no full-resolution NewSubfileType=0 primary image.")
    return max(candidates, key=lambda item: int(item[1].imagewidth) * int(item[1].imagelength))


def _read_opcodes(page: Any, root: Any) -> tuple[DngOpcode, ...]:
    result: list[DngOpcode] = []
    for name in OPCODE_LIST_TAGS:
        tag = _tag(page, root, name)
        if tag is not None:
            result.extend(parse_opcode_list(tag.value, name))
    return tuple(result)


def _supported_opcode(opcode: DngOpcode) -> bool:
    return opcode.list_name == "OpcodeList3" and opcode.opcode_id in {1, 9}


def _opcode_rejection(opcodes: tuple[DngOpcode, ...]) -> DngRejection | None:
    for opcode in opcodes:
        if not _supported_opcode(opcode):
            return DngRejection(
                "unsupported_mandatory_opcode",
                f"This Experimental DNG requires an unsupported mandatory opcode: {opcode.name} "
                f"({opcode.list_name}, opcode {opcode.opcode_id}). No correction was skipped.",
            )
        try:
            if opcode.opcode_id == 1:
                parse_warp_rectilinear(opcode.parameters)
            else:
                parse_gain_map(opcode.parameters)
        except DngOpcodeError as exc:
            return DngRejection(
                "unsupported_opcode_variant",
                f"This Experimental DNG uses an unsupported {opcode.name} variant: {exc}.",
            )
    return None


def _metadata_rejection(page: Any, root: Any, metadata: dict[str, Any]) -> DngRejection | None:
    for name in UNSUPPORTED_PIXEL_TAGS:
        if _tag(page, root, name) is not None:
            return DngRejection(
                "unsupported_pixel_metadata",
                f"This Experimental DNG requires unsupported pixel-shaping metadata: {name}.",
            )
    default_scale = metadata.get("default_scale")
    if default_scale is not None and not np.allclose(default_scale, [1.0, 1.0]):
        return DngRejection("unsupported_scale", "This Experimental DNG requires unsupported resampling via DefaultScale.")
    return None


def _linear_layout_rejection(page: Any, dtype: np.dtype, metadata: dict[str, Any]) -> DngRejection | None:
    if dtype.kind not in {"u", "f"} or (dtype.kind == "u" and dtype.itemsize != 2) or (
        dtype.kind == "f" and dtype.itemsize not in {2, 4}
    ):
        return DngRejection("unsupported_sample_type", f"Unsupported Linear DNG sample type {dtype}.")
    if int(getattr(page, "planarconfig", 1)) != 1:
        return DngRejection("unsupported_planar_layout", "Planar Linear DNG samples are not supported.")
    try:
        import tifffile

        if int(page.compression) not in tifffile.TIFF.DECOMPRESSORS:
            return DngRejection(
                "missing_decoder", f"No installed decoder supports Linear DNG compression {int(page.compression)}."
            )
    except ImportError:
        return DngRejection("missing_decoder", "tifffile is unavailable.")
    for name in ("color_matrix1", "calibration_illuminant1", "as_shot_neutral"):
        if metadata.get(name) is None:
            return DngRejection("missing_color_metadata", f"Required DNG color metadata {name} is absent.")
    try:
        build_color_transform(_color_metadata(metadata))
    except DngColorError as exc:
        return DngRejection("invalid_color_metadata", str(exc))
    return None


def _resolve_metadata(page: Any, root: Any, dtype: np.dtype, samples: int, width: int, height: int) -> dict[str, Any]:
    bits = int(np.dtype(dtype).itemsize * 8)
    integer_white = float((1 << bits) - 1)
    return {
        "color_matrix1": _rational_tag(page, root, "ColorMatrix1", 9),
        "color_matrix2": _rational_tag(page, root, "ColorMatrix2", 9),
        "forward_matrix1": _rational_tag(page, root, "ForwardMatrix1", 9),
        "forward_matrix2": _rational_tag(page, root, "ForwardMatrix2", 9),
        "camera_calibration1": _rational_tag(page, root, "CameraCalibration1", 9),
        "camera_calibration2": _rational_tag(page, root, "CameraCalibration2", 9),
        "analog_balance": _rational_tag(page, root, "AnalogBalance", 3, default=np.ones(3)),
        "as_shot_neutral": _rational_tag(page, root, "AsShotNeutral", 3),
        "black_level": _broadcast_tag(page, root, "BlackLevel", samples, default=0.0),
        "white_level": _broadcast_tag(
            page, root, "WhiteLevel", samples, default=integer_white if dtype.kind == "u" else 1.0
        ),
        "baseline_exposure": _scalar_rational_tag(page, root, "BaselineExposure", 0.0),
        "calibration_illuminant1": _int_tag(page, root, "CalibrationIlluminant1"),
        "calibration_illuminant2": _int_tag(page, root, "CalibrationIlluminant2"),
        "active_area": _integer_array_tag(page, root, "ActiveArea", [0, 0, height, width]),
        "default_crop_origin": _rational_tag(page, root, "DefaultCropOrigin", 2, default=np.zeros(2)),
        "default_crop_size": _rational_tag(page, root, "DefaultCropSize", 2, default=np.asarray([width, height])),
        "default_scale": _rational_tag(page, root, "DefaultScale", 2, default=np.ones(2)),
        "orientation": _int_tag(page, root, "Orientation", 1),
    }


def _color_metadata(metadata: dict[str, Any]) -> DngColorMetadata:
    return DngColorMetadata(
        color_matrix1=metadata.get("color_matrix1"),
        color_matrix2=metadata.get("color_matrix2"),
        forward_matrix1=metadata.get("forward_matrix1"),
        forward_matrix2=metadata.get("forward_matrix2"),
        camera_calibration1=metadata.get("camera_calibration1"),
        camera_calibration2=metadata.get("camera_calibration2"),
        analog_balance=metadata.get("analog_balance"),
        as_shot_neutral=metadata.get("as_shot_neutral"),
        black_level=metadata.get("black_level"),
        white_level=metadata.get("white_level"),
        baseline_exposure=float(metadata.get("baseline_exposure", 0.0)),
        calibration_illuminant1=int(metadata.get("calibration_illuminant1") or 0),
        calibration_illuminant2=metadata.get("calibration_illuminant2"),
    )


def _crop_and_orient(image: np.ndarray, metadata: dict[str, Any]) -> np.ndarray:
    active = np.asarray(metadata["active_area"], dtype=int)
    top, left, bottom, right = active
    origin = np.rint(metadata["default_crop_origin"]).astype(int)
    size = np.rint(metadata["default_crop_size"]).astype(int)
    crop_left = left + origin[0]
    crop_top = top + origin[1]
    crop_right = crop_left + size[0]
    crop_bottom = crop_top + size[1]
    if crop_left < left or crop_top < top or crop_right > right or crop_bottom > bottom:
        raise LinearDngError("Default crop exceeds the DNG ActiveArea.")
    result = image[crop_top:crop_bottom, crop_left:crop_right]
    orientation = int(metadata["orientation"])
    operations = {
        1: lambda x: x,
        2: lambda x: np.fliplr(x),
        3: lambda x: np.rot90(x, 2),
        4: lambda x: np.flipud(x),
        5: lambda x: np.transpose(x, (1, 0, 2)),
        6: lambda x: np.rot90(x, 3),
        7: lambda x: np.fliplr(np.transpose(x, (1, 0, 2))),
        8: lambda x: np.rot90(x, 1),
    }
    if orientation not in operations:
        raise LinearDngError(f"Unsupported TIFF Orientation {orientation}.")
    return operations[orientation](result)


def _verify_fingerprint(path: Path, page: Any, expected: DngFingerprint) -> None:
    stat = path.stat()
    actual = DngFingerprint(
        stat.st_size,
        stat.st_mtime_ns,
        int(page.offset),
        int(page.imagewidth),
        int(page.imagelength),
        int(page.compression),
    )
    if actual != expected:
        raise LinearDngError("The DNG changed after inspection; import was cancelled before allocation.")


def _normalize_layout(array: np.ndarray, axes: str | None) -> np.ndarray:
    result = np.asarray(array)
    if str(axes or "").upper() == "SYX":
        result = np.moveaxis(result, 0, -1)
    if result.ndim != 3 or result.shape[2] != 3:
        raise LinearDngError(f"Decoded Linear DNG has unsupported layout {result.shape} ({axes}).")
    return result


def _tag(page: Any, root: Any, name: str) -> Any:
    return page.tags.get(name) or (root.tags.get(name) if root is not page else None)


def _rational_tag(page: Any, root: Any, name: str, count: int, default: Any = None) -> np.ndarray | None:
    tag = _tag(page, root, name)
    if tag is None:
        return None if default is None else np.asarray(default, dtype=np.float64)
    flat = np.asarray(tag.value, dtype=np.float64).reshape(-1)
    if flat.size == count * 2:
        denominator = flat[1::2]
        if np.any(denominator == 0):
            raise DngOpcodeError(f"{name} contains a zero rational denominator")
        return flat[0::2] / denominator
    if flat.size == count:
        return flat
    raise DngOpcodeError(f"{name} expected {count} values; found {flat.size}")


def _scalar_rational_tag(page: Any, root: Any, name: str, default: float) -> float:
    value = _rational_tag(page, root, name, 1, default=np.asarray([default]))
    return float(value[0])


def _broadcast_tag(page: Any, root: Any, name: str, samples: int, default: float) -> np.ndarray:
    tag = _tag(page, root, name)
    if tag is None:
        return np.full(samples, default, dtype=np.float64)
    flat = np.asarray(tag.value, dtype=np.float64).reshape(-1)
    if int(getattr(tag, "dtype", 0)) in {5, 10}:
        if np.any(flat[1::2] == 0):
            raise DngOpcodeError(f"{name} contains a zero rational denominator")
        flat = flat[0::2] / flat[1::2]
    if flat.size == 1:
        flat = np.repeat(flat, samples)
    if samples == 1 and flat.size == 4:
        return flat[:1]
    if flat.size not in {samples, 4}:
        raise DngOpcodeError(f"{name} cannot be broadcast to {samples} samples")
    if flat.size == 4 and samples == 3:
        # A 2×2 CFA black level is not valid for a three-channel LinearRaw primary.
        raise DngOpcodeError(f"{name} uses an unsupported repeated-cell layout")
    return flat[:samples]


def _integer_array_tag(page: Any, root: Any, name: str, default: list[int]) -> np.ndarray:
    tag = _tag(page, root, name)
    return np.asarray(default if tag is None else tag.value, dtype=np.int64).reshape(-1)


def _int_tag(page: Any, root: Any, name: str, default: int | None = None) -> int | None:
    tag = _tag(page, root, name)
    return default if tag is None else int(tag.value)


def _text_tag(page: Any, root: Any, name: str) -> str | None:
    tag = _tag(page, root, name)
    return None if tag is None else str(tag.value).strip("\x00")


def _version_tag(page: Any, root: Any, name: str) -> str | None:
    tag = _tag(page, root, name)
    return None if tag is None else ".".join(str(item) for item in bytes(tag.value))


def _root_page_index(tif: Any, page: Any) -> int | None:
    for index, candidate in enumerate(tif.pages):
        if int(candidate.offset) == int(page.offset):
            return index
    return None


def _resource_payload(estimate: ResourceEstimate | None) -> dict[str, Any] | None:
    if estimate is None:
        return None
    payload = asdict(estimate)
    payload["import_decision"] = estimate.import_decision.value
    payload["export_decision"] = estimate.export_decision.value
    return payload


def _invalid_inspection(path: Path, stat: Any, code: str, message: str) -> LinearDngInspection:
    fingerprint = DngFingerprint(stat.st_size, stat.st_mtime_ns, 0, 0, 0, 0)
    return LinearDngInspection(
        DngRoute.INVALID_DNG, 0, 0, 0, "unknown", 0, -1, None, 0, None, (), (), (),
        DngRejection(code, message), None, fingerprint, {}
    )


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise DngImportCancelled("Experimental DNG import cancelled")
