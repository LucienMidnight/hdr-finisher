from __future__ import annotations

import argparse
import ctypes
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
from typing import Any


GIB = 1024**3
LINEAR_RAW = 34892
UNIMPLEMENTED_RENDER_TAGS = (
    "OpcodeList1",
    "OpcodeList2",
    "OpcodeList3",
    "ProfileGainTableMap",
    "ProfileGainTableMap2",
)


@dataclass(frozen=True)
class ResourceSnapshot:
    total_ram_bytes: int | None
    available_ram_bytes: int | None
    source: str


@dataclass(frozen=True)
class MemoryEstimate:
    encoded_pixel_bytes: int
    acescg_source_bytes: int
    strip_scratch_bytes: int
    fixed_overhead_bytes: int
    existing_session_bytes: int
    optimistic_import_peak_bytes: int
    conservative_import_peak_bytes: int
    conservative_export_peak_bytes: int
    safety_reserve_bytes: int | None
    safely_available_bytes: int | None
    import_preflight: str
    export_preflight: str


def _tag(page: Any, name: str, metadata_page: Any | None = None) -> Any:
    tag = page.tags.get(name)
    if tag is None and metadata_page is not None and metadata_page is not page:
        tag = metadata_page.tags.get(name)
    return tag


def _tag_value(page: Any, name: str, default: Any = None, metadata_page: Any | None = None) -> Any:
    tag = _tag(page, name, metadata_page)
    return default if tag is None else tag.value


def _enum_int(value: Any) -> int:
    return int(getattr(value, "value", value))


def _json_value(value: Any) -> Any:
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return value.item()
    except ImportError:
        pass
    if isinstance(value, bytes):
        return list(value) if len(value) <= 32 else {"byte_count": len(value)}
    if hasattr(value, "value") and isinstance(value.value, int):
        return {"name": getattr(value, "name", str(value)), "value": int(value.value)}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _rational_array(value: Any, count: int) -> Any:
    import numpy as np

    flat = np.asarray(value, dtype=np.float64).reshape(-1)
    if flat.size == count * 2:
        numerators = flat[0::2]
        denominators = flat[1::2]
        if np.any(denominators == 0):
            raise ValueError("DNG rational metadata contains a zero denominator.")
        return numerators / denominators
    if flat.size == count:
        return flat
    raise ValueError(f"Expected {count} values or rational pairs; found {flat.size} elements.")


def _select_primary_page(tif: Any) -> Any:
    pages = [series.pages[0] for series in tif.series if len(series.pages)]
    primary = [
        page
        for page in pages
        if int(getattr(page, "subfiletype", 0) or 0) == 0
    ]
    candidates = primary or pages
    if not candidates:
        raise RuntimeError("TIFF/DNG contains no image pages.")
    return max(candidates, key=lambda page: int(page.imagewidth) * int(page.imagelength))


def _series_index(tif: Any, page: Any) -> int:
    for index, series in enumerate(tif.series):
        if len(series.pages) and int(series.pages[0].offset) == int(page.offset):
            return index
    raise RuntimeError(f"Could not resolve TIFF series for page at offset {page.offset}.")


def build_bounded_preview(path: Path, output: Path, *, max_long_edge: int = 2400) -> dict[str, Any]:
    import numpy as np
    from PIL import Image
    import tifffile

    try:
        from colour import CCS_ILLUMINANTS, RGB_to_RGB, RGB_COLOURSPACES, XYZ_to_RGB
    except ImportError as exc:
        raise RuntimeError("The color preview requires colour-science.") from exc

    with tifffile.TiffFile(path) as tif:
        metadata_page = tif.pages[0]
        page = _select_primary_page(tif)
        reasons, _notes, _metadata = qualify_page(
            page, int(page.compression) in tifffile.TIFF.DECOMPRESSORS, metadata_page=metadata_page
        )
        non_color_reasons = [reason for reason in reasons if "ForwardMatrix1" not in reason]
        if non_color_reasons:
            raise RuntimeError("DNG does not qualify: " + " ".join(reasons))

        source = (
            tifffile.memmap(path, series=_series_index(tif, page), mode="r")
            if page.is_memmappable
            else page.asarray()
        )
        factor = max(1, int(np.ceil(max(source.shape[:2]) / max(1, max_long_edge))))
        output_height = max(1, source.shape[0] // factor)
        output_width = max(1, source.shape[1] // factor)
        cropped_height = output_height * factor
        cropped_width = output_width * factor
        camera_rgb = np.empty((output_height, output_width, 3), dtype=np.float32)
        for output_row in range(output_height):
            start = output_row * factor
            block = np.asarray(source[start : start + factor, :cropped_width, :3], dtype=np.float32)
            camera_rgb[output_row] = block.reshape(factor, output_width, factor, 3).mean(axis=(0, 2))

        bits = int(page.bitspersample[0] if isinstance(page.bitspersample, tuple) else page.bitspersample)
        black = _rational_array(_tag_value(page, "BlackLevel", (0,) * 3, metadata_page), 3).astype(np.float32)
        white = _rational_array(
            _tag_value(page, "WhiteLevel", ((1 << bits) - 1,) * 3, metadata_page), 3
        ).astype(np.float32)
        camera_rgb = (camera_rgb - black) / np.maximum(white - black, np.float32(1e-12))

        analog_balance = _rational_array(_tag_value(page, "AnalogBalance", (1,) * 3, metadata_page), 3)
        camera_calibration = _rational_array(
            _tag_value(page, "CameraCalibration1", tuple(np.eye(3).reshape(-1)), metadata_page), 9
        ).reshape(3, 3)
        camera_neutral = _rational_array(_tag_value(page, "AsShotNeutral", metadata_page=metadata_page), 3)
        forward_tag = _tag(page, "ForwardMatrix1", metadata_page)
        if forward_tag is not None:
            forward_matrix = _rational_array(forward_tag.value, 9).reshape(3, 3)
            reference_neutral = np.linalg.solve(np.diag(analog_balance) @ camera_calibration, camera_neutral)
            camera_to_xyz_d50 = forward_matrix @ np.diag(1.0 / reference_neutral) @ np.linalg.inv(
                np.diag(analog_balance) @ camera_calibration
            )
            xyz_d50 = camera_rgb @ camera_to_xyz_d50.T
            color_method = "ForwardMatrix1"
        else:
            color_matrix = _rational_array(_tag_value(page, "ColorMatrix1", metadata_page=metadata_page), 9).reshape(3, 3)
            xyz_to_camera = np.diag(analog_balance) @ camera_calibration @ color_matrix
            camera_to_xyz = np.linalg.inv(xyz_to_camera)
            xyz_unadapted = camera_rgb @ camera_to_xyz.T
            source_white = camera_to_xyz @ camera_neutral
            source_white /= source_white[1]
            from colour.adaptation import matrix_chromatic_adaptation_VonKries

            d50_xyz = np.asarray([0.96422, 1.0, 0.82521], dtype=np.float64)
            adaptation = matrix_chromatic_adaptation_VonKries(source_white, d50_xyz, transform="CAT02")
            xyz_d50 = xyz_unadapted @ adaptation.T
            color_method = "ColorMatrix1 fallback (ForwardMatrix1 absent)"

        illuminants = CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]
        acescg = XYZ_to_RGB(
            xyz_d50,
            "ACEScg",
            illuminant=illuminants["D50"],
            chromatic_adaptation_transform="CAT02",
        ).astype(np.float32)
        linear_srgb = RGB_to_RGB(
            acescg,
            RGB_COLOURSPACES["ACEScg"],
            RGB_COLOURSPACES["sRGB"],
            chromatic_adaptation_transform="CAT02",
        )
        display = np.clip(linear_srgb, 0.0, 1.0)
        encoded = np.where(
            display <= 0.0031308,
            display * 12.92,
            1.055 * np.power(display, 1.0 / 2.4) - 0.055,
        )
        image = (np.clip(encoded, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(image).save(output)
        return {
            "path": str(output),
            "shape": list(image.shape),
            "block_factor": factor,
            "source_crop": [0, 0, cropped_height, cropped_width],
            "source_page_offset": int(page.offset),
            "source_memmappable": bool(page.is_memmappable),
            "color_method": color_method,
            "acescg_min": [float(item) for item in np.min(acescg, axis=(0, 1))],
            "acescg_max": [float(item) for item in np.max(acescg, axis=(0, 1))],
            "note": "Diagnostic SDR preview only; visual correctness requires a producer reference render.",
        }


def detect_memory_resources() -> ResourceSnapshot:
    try:
        import psutil

        memory = psutil.virtual_memory()
        return ResourceSnapshot(int(memory.total), int(memory.available), "psutil")
    except (ImportError, OSError, RuntimeError):
        pass

    if os.name == "nt":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return ResourceSnapshot(int(status.ullTotalPhys), int(status.ullAvailPhys), "GlobalMemoryStatusEx")

    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        total = page_size * int(os.sysconf("SC_PHYS_PAGES"))
        available = page_size * int(os.sysconf("SC_AVPHYS_PAGES"))
        return ResourceSnapshot(total, available, "sysconf")
    except (AttributeError, OSError, TypeError, ValueError):
        return ResourceSnapshot(None, None, "unavailable")


def estimate_memory(
    *,
    width: int,
    height: int,
    samples: int,
    bytes_per_sample: int,
    resources: ResourceSnapshot,
    memmappable: bool,
    existing_session_bytes: int = 0,
    strip_rows: int = 128,
) -> MemoryEstimate:
    pixel_count = width * height
    encoded = pixel_count * samples * bytes_per_sample
    acescg = pixel_count * 3 * 4
    scratch = min(width * max(samples, 3) * 4 * strip_rows, 512 * 1024**2)
    fixed_overhead = 256 * 1024**2
    base_import = existing_session_bytes + acescg + scratch + fixed_overhead
    optimistic = base_import + (0 if memmappable else encoded)
    # Count the complete decoded payload even for a file-backed mapping. Those
    # pages are reclaimable, but this prevents the resource gate from assuming
    # that a very large mapped source has zero physical-memory cost.
    conservative = base_import + encoded
    # Export commonly needs the retained source, a processed float frame, and
    # at least one integer/codec staging buffer. This is intentionally a
    # conservative preflight estimate, not a promise of exact peak RSS.
    export_peak = existing_session_bytes + (acescg * 2) + encoded + scratch + fixed_overhead

    reserve = None
    safe_available = None
    import_status = "unknown_resources"
    export_status = "unknown_resources"
    if resources.total_ram_bytes is not None and resources.available_ram_bytes is not None:
        reserve = max(2 * GIB, int(resources.total_ram_bytes * 0.15))
        safe_available = max(0, resources.available_ram_bytes - reserve)
        import_status = "pass" if conservative <= safe_available else "reject"
        export_status = "pass" if export_peak <= safe_available else "reject"

    return MemoryEstimate(
        encoded_pixel_bytes=encoded,
        acescg_source_bytes=acescg,
        strip_scratch_bytes=scratch,
        fixed_overhead_bytes=fixed_overhead,
        existing_session_bytes=existing_session_bytes,
        optimistic_import_peak_bytes=optimistic,
        conservative_import_peak_bytes=conservative,
        conservative_export_peak_bytes=export_peak,
        safety_reserve_bytes=reserve,
        safely_available_bytes=safe_available,
        import_preflight=import_status,
        export_preflight=export_status,
    )


def qualify_page(
    page: Any, decoder_available: bool, *, metadata_page: Any | None = None
) -> tuple[list[str], list[str], dict[str, Any]]:
    reasons: list[str] = []
    notes: list[str] = []
    photometric = _enum_int(page.photometric)
    samples = int(page.samplesperpixel)
    dtype = page.dtype
    bits = tuple(int(item) for item in page.bitspersample) if isinstance(page.bitspersample, tuple) else (
        int(page.bitspersample),
    )

    if photometric != LINEAR_RAW:
        reasons.append("PhotometricInterpretation is not LinearRaw.")
    if samples != 3:
        reasons.append(f"Linear DNG path requires exactly 3 samples per pixel; found {samples}.")
    if not (dtype.kind == "u" and dtype.itemsize == 2 or dtype.kind == "f" and dtype.itemsize in {2, 4}):
        reasons.append(f"Unsupported sample type {dtype}; expected uint16, float16, or float32.")
    if len(set(bits)) != 1 or bits[0] not in {16, 32}:
        reasons.append(f"Unsupported BitsPerSample {bits}.")
    if not decoder_available:
        reasons.append(f"No installed imagecodecs decoder for TIFF compression {int(page.compression)}.")

    required_tags = ("ColorMatrix1", "ForwardMatrix1", "CalibrationIlluminant1", "AsShotNeutral")
    for name in required_tags:
        if _tag(page, name, metadata_page) is None:
            reasons.append(f"Required color metadata {name} is absent.")

    present_render_tags = [name for name in UNIMPLEMENTED_RENDER_TAGS if _tag(page, name, metadata_page) is not None]
    if present_render_tags:
        reasons.append("Unimplemented rendering metadata is present: " + ", ".join(present_render_tags) + ".")

    defaults = {
        "BlackLevel": _tag_value(page, "BlackLevel", [0.0] * samples, metadata_page),
        "WhiteLevel": _tag_value(
            page,
            "WhiteLevel",
            [1.0] * samples if dtype.kind == "f" else [float((1 << bits[0]) - 1)] * samples,
            metadata_page,
        ),
        "AnalogBalance": _tag_value(page, "AnalogBalance", [1.0] * samples, metadata_page),
        "BaselineExposure": _tag_value(page, "BaselineExposure", 0.0, metadata_page),
        "ActiveArea": _tag_value(
            page, "ActiveArea", [0, 0, int(page.imagelength), int(page.imagewidth)], metadata_page
        ),
        "DefaultCropOrigin": _tag_value(page, "DefaultCropOrigin", [0.0, 0.0], metadata_page),
        "DefaultCropSize": _tag_value(
            page, "DefaultCropSize", [float(page.imagewidth), float(page.imagelength)], metadata_page
        ),
        "Orientation": _tag_value(page, "Orientation", 1, metadata_page),
    }
    for name in defaults:
        if _tag(page, name, metadata_page) is None:
            notes.append(f"{name} resolved from its DNG/TIFF default.")

    metadata_names = (
        "DNGVersion",
        "DNGBackwardVersion",
        "Make",
        "Model",
        "Software",
        "ColorMatrix1",
        "ForwardMatrix1",
        "CalibrationIlluminant1",
        "AsShotNeutral",
    )
    metadata = {name: _json_value(_tag_value(page, name, metadata_page=metadata_page)) for name in metadata_names}
    metadata["resolved_defaults"] = {name: _json_value(value) for name, value in defaults.items()}
    return reasons, notes, metadata


def probe(
    path: Path,
    *,
    existing_session_bytes: int = 0,
    sparse_decode: bool = True,
    full_decode: bool = False,
) -> dict[str, Any]:
    try:
        import tifffile
    except ImportError as exc:
        raise RuntimeError("The probe requires tifffile.") from exc

    resources = detect_memory_resources()
    with tifffile.TiffFile(path) as tif:
        metadata_page = tif.pages[0]
        page = _select_primary_page(tif)
        compression = int(page.compression)
        decoder_available = compression in tifffile.TIFF.DECOMPRESSORS
        reasons, notes, metadata = qualify_page(page, decoder_available, metadata_page=metadata_page)
        memmappable = bool(page.is_memmappable)
        estimate = estimate_memory(
            width=int(page.imagewidth),
            height=int(page.imagelength),
            samples=int(page.samplesperpixel),
            bytes_per_sample=int(page.dtype.itemsize),
            resources=resources,
            memmappable=memmappable,
            existing_session_bytes=existing_session_bytes,
        )
        if estimate.import_preflight == "reject":
            reasons.append(
                "Estimated import peak exceeds safely available system RAM "
                f"({estimate.conservative_import_peak_bytes / GIB:.2f} GiB required; "
                f"{(estimate.safely_available_bytes or 0) / GIB:.2f} GiB safely available)."
            )

        decode: dict[str, Any] = {"attempted": False}
        if sparse_decode and (memmappable or full_decode):
            decoded = (
                tifffile.memmap(path, series=_series_index(tif, page), mode="r")
                if memmappable
                else page.asarray()
            )
            row_step = max(1, decoded.shape[0] // 8)
            column_step = max(1, decoded.shape[1] // 16)
            sample = decoded[::row_step, ::column_step]
            axes = tuple(range(sample.ndim - 1)) if sample.ndim > 2 else tuple(range(sample.ndim))
            decode = {
                "attempted": True,
                "method": (
                    "read-only memory map with sparse sample"
                    if memmappable
                    else "full imagecodecs decode with sparse sample"
                ),
                "shape": list(decoded.shape),
                "dtype": str(decoded.dtype),
                "sample_shape": list(sample.shape),
                "sample_min": [_json_value(item) for item in sample.min(axis=axes)],
                "sample_max": [_json_value(item) for item in sample.max(axis=axes)],
            }

        return {
            "path": str(path),
            "file_size_bytes": path.stat().st_size,
            "qualifies": not reasons,
            "rejection_reasons": reasons,
            "notes": notes,
            "image": {
                "width": int(page.imagewidth),
                "height": int(page.imagelength),
                "samples_per_pixel": int(page.samplesperpixel),
                "dtype": str(page.dtype),
                "bits_per_sample": _json_value(page.bitspersample),
                "photometric": _json_value(page.photometric),
                "compression": _json_value(page.compression),
                "memmappable": memmappable,
                "page_count": len(tif.pages),
                "series_count": len(tif.series),
                "subifds": _json_value(page.subifds),
                "page_offset": int(page.offset),
                "root_page_offset": int(metadata_page.offset),
            },
            "metadata": metadata,
            "decoder_available": decoder_available,
            "decode": decode,
            "resources": asdict(resources),
            "memory_estimate": asdict(estimate),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe a real linear DNG without wiring it into HDR Finisher.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--existing-session-gib", type=float, default=0.0)
    parser.add_argument("--no-sparse-decode", action="store_true")
    parser.add_argument("--full-decode", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--preview-output", type=Path)
    parser.add_argument("--preview-long-edge", type=int, default=2400)
    args = parser.parse_args()
    result = probe(
        args.path,
        existing_session_bytes=max(0, int(args.existing_session_gib * GIB)),
        sparse_decode=not args.no_sparse_decode,
        full_decode=args.full_decode,
    )
    preview_reasons = [
        reason for reason in result["rejection_reasons"] if "ForwardMatrix1" not in reason
    ]
    if args.preview_output is not None and not preview_reasons:
        result["bounded_preview"] = build_bounded_preview(
            args.path, args.preview_output, max_long_edge=args.preview_long_edge
        )
    rendered = json.dumps(result, indent=2)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if result["qualifies"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
