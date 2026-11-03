"""Camera RAW Library thumbnails developed on the GPU.

The backend only unpacks the sensor mosaic (no demosaic) and hands it, with
everything Grade's development needs, to the Library window. The window runs
the same development on the GPU (frontend/library-gpu-raw.js) and returns the
reduced scene picture and its full-source peaks. The picture is then stored in
the Library cache exactly where Grade's CPU development would have put it.

Only ordinary Bayer camera RAWs take this route. X-Trans and anything the camera-linear
bridge cannot describe report NotEligible; GPU presence does not select CPU.
"""
from __future__ import annotations

import json
import struct
import time
import os
from io import BytesIO
from pathlib import Path

import numpy as np

from . import raw_import
from .color import _ACESCG_TO_LINEAR_BT2020, _LINEAR_BT2020_TO_ACESCG
from .import_defaults import RAW_CALIBRATION_EV, fuji_dynamic_range, starting_adjustments
from .models import EditDocument, HDRAnalysis, HDRClassification, RawImportSettings, SourceImageDescriptor, SourceReference
from .source_luminance import describe_source_luminance

ROUTE = "gpu-raw-thumbnail"
# LibRaw 0.22.1 colorconst.cpp constants for AHD CIELab (not legacy dcraw).
XYZ_RGB = np.array([[0.4124564, 0.3575761, 0.1804375],
                    [0.2126729, 0.7151522, 0.0721750],
                    [0.0193339, 0.1191920, 0.9503041]])
D65_WHITE = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
LENS_FIELDS = ("camera_maker", "camera_model", "lens_maker", "lens_model", "lens_name",
               "focal_length_mm", "aperture", "focus_distance_m")


class MemoryPending(Exception):
    """GPU capacity waits for admission; it never selects CPU development."""


class NotEligible(Exception):
    """The current GPU source adapter cannot describe this photo."""


def frame(header: dict, *payload) -> bytes:
    """Length, JSON header padded to 4 bytes, then the payload parts, in one copy."""
    text = json.dumps(header).encode("utf-8")
    text += b" " * ((-(4 + len(text))) % 4)
    return b"".join([struct.pack("<I", len(text)), text, *payload])


def frame_chunks(header: dict, *payload):
    """Same wire frame, without joining large source planes into another copy."""
    yield frame(header)
    for part in payload:
        view = memoryview(part).cast("B")
        for offset in range(0, view.nbytes, 1024 * 1024):
            yield view[offset:offset + 1024 * 1024]


async def receive_frame(request):
    """Fill one body, rather than retaining chunks plus Starlette's joined copy."""
    length = int(request.headers.get("content-length", 0))
    if not length:
        return unframe(await request.body())
    body = bytearray(length)
    offset = 0
    async for chunk in request.stream():
        end = offset + len(chunk)
        if end > length:
            raise ValueError("The developed picture was incomplete.")
        body[offset:end] = chunk
        offset = end
    if offset != length:
        raise ValueError("The developed picture was incomplete.")
    return unframe(body)


def unframe(body: bytes) -> tuple[dict, memoryview]:
    if len(body) < 4:
        raise ValueError("The developed picture was incomplete.")
    length = struct.unpack_from("<I", body, 0)[0]
    if 4 + length > len(body):
        raise ValueError("The developed picture was incomplete.")
    return json.loads(body[4:4 + length].decode("utf-8")), memoryview(body)[4 + length:]


def _identity(path: Path) -> list[str]:
    # The renderer echoes this opaque token through JSON. Decimal strings
    # preserve nanosecond timestamps beyond JavaScript's exact integer range.
    stat = path.stat()
    return [str(stat.st_size), str(stat.st_mtime_ns)]


def _xtrans_raf(path):
    """Read Fuji's 6x6 CFA header tag without RawPy's implicit pixel unpack."""
    with path.open("rb") as source:
        if not source.read(16).startswith(b"FUJIFILMCCD-RAW "):
            return False
        source.seek(92)
        header = source.read(8)
        if len(header) != 8:
            return False
        offset, length = struct.unpack(">II", header)
        end = offset + length
        if length < 4 or end > path.stat().st_size:
            return False
        source.seek(offset)
        count = struct.unpack(">I", source.read(4))[0]
        for _ in range(count):
            if source.tell() + 4 > end:
                return False
            tag, size = struct.unpack(">HH", source.read(4))
            if source.tell() + size > end:
                return False
            if tag == 0x0131 and size == 36:
                pattern = source.read(size)
                return len(pattern) == 36 and set(pattern) == {0, 1, 2}
            source.seek(size, 1)
    return False


def xtrans_cpu(path):
    """The sole sensor-specific CPU development exception, decided November 1."""
    path = Path(path)
    return path.suffix.lower() == ".raf" and _xtrans_raf(path)


def sensor(path: Path, settings: RawImportSettings | None = None) -> tuple[dict, list]:
    """Unpack the visible mosaic and describe Grade's development of it."""
    path = Path(path).resolve(strict=True)
    if path.suffix.lower() not in raw_import.RAW_EXTENSIONS or path.suffix.lower() == ".dng":
        raise NotEligible("not an ordinary camera RAW")
    settings = settings or RawImportSettings()
    highlights = settings.highlight_reconstruction
    if not highlights.enabled or highlights.method not in (raw_import.OPPOSED_COLOR_METHOD, raw_import.EDGE_COLOUR_METHOD):
        raise NotEligible("highlight reconstruction differs from the GPU route")
    began = time.perf_counter()
    timings = {}
    if _xtrans_raf(path):
        raise NotEligible("Not supported: X-Trans sensor development is not available in the Library. The camera preview is kept when available.")
    identity = _identity(path)
    exif, _warning = raw_import._read_raw_exif(path)
    timings["exif"] = (time.perf_counter()-began)*1000
    import rawpy
    profile = os.environ.get("HDR_FINISHER_LIBRARY_PROFILE") == "1"
    mark = time.perf_counter()
    source = BytesIO(path.read_bytes()) if profile else None
    timings["file_read"] = (time.perf_counter()-mark)*1000 if profile else None
    with rawpy.RawPy() as raw:
        mark = time.perf_counter()
        if source is not None: raw.open_buffer(source)
        else: raw.open_file(str(path))
        timings["libraw_open"] = (time.perf_counter()-mark)*1000
        mark = time.perf_counter()
        raw.unpack()
        timings["libraw_unpack"] = (time.perf_counter()-mark)*1000
        mark = time.perf_counter()
        exif = raw_import._merge_missing_metadata(exif, raw_import._read_libraw_metadata(raw))
        try:
            metadata = raw_import._camera_linear_metadata_from_libraw(raw)
        except raw_import._CameraLinearUnsupported as error:
            raise NotEligible(str(error)) from None
        if metadata.raw_pattern.shape != (2, 2):
            raise NotEligible("X-Trans sensors keep the CPU route")
        # LibRaw frees its own buffer when the file closes.
        mosaic = np.array(raw.raw_image_visible, dtype="<u2", order="C", copy=True)
        colors = np.asarray(raw.raw_colors_visible[:2, :2], dtype=np.int64)
        cam_rgb = np.asarray(raw.rgb_xyz_matrix, dtype=np.float64)[:3] @ XYZ_RGB
        flip = int(raw.sizes.flip)
    timings["mosaic_copy_metadata"] = (time.perf_counter()-mark)*1000
    # LibRaw cam_xyz_coeff: rows normalized to sum 1, then inverted (3 colours).
    cam_rgb /= cam_rgb.sum(axis=1, keepdims=True)
    # LibRaw stores rgb_cam as float before accumulating each Lab matrix term.
    # Keep those rounding points: AHD's integer homogeneity votes depend on them.
    rgb_cam = np.linalg.inv(cam_rgb).astype(np.float32)
    xyz_cam = np.zeros((3, 3), dtype=np.float32)
    for k in range(3):
        xyz_cam += (XYZ_RGB[:, k, None] * rgb_cam[k] / D65_WHITE[:, None]).astype(np.float32)
    height, width = mosaic.shape
    out_h, out_w = (width, height) if flip in (5, 6) else (height, width)
    dr = fuji_dynamic_range(path)
    recorded = {200: 1.0, 400: 2.0}.get(dr, 0.0)
    header = {
        "path": str(path), "identity": identity, "width": width, "height": height, "flip": flip,
        "raw_import_settings": settings.model_dump(mode="json"),
        "cfa_raw": colors.reshape(-1).tolist(),
        "cfa_rgb": [int(metadata.raw_channel_to_rgb[c]) for c in colors.reshape(-1)],
        "raw_black": metadata.raw_black_level.tolist(), "raw_white": metadata.raw_white_level.tolist(),
        "rgb_black": metadata.black_level.tolist(), "rgb_white": metadata.white_level.tolist(),
        "wb": metadata.as_shot_wb.tolist(),
        "camera_to_acescg": metadata.camera_to_acescg.tolist(),
        "xyz_cam": xyz_cam.tolist(),
        # Stored for row vectors in color.py; the shader multiplies columns.
        "acescg_to_bt2020": np.asarray(_ACESCG_TO_LINEAR_BT2020).T.tolist(),
        "bt2020_to_acescg": np.asarray(_LINEAR_BT2020_TO_ACESCG).T.tolist(),
        "threshold": highlights.clipping_threshold * raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY,
        "calibration_gain": 2.0 ** (RAW_CALIBRATION_EV + recorded),
        "raw_start_brightness": {"calibration_ev": RAW_CALIBRATION_EV, "recorded_brightness_ev": recorded,
                                 "fuji_dynamic_range_percent": dr},
        "sample_stride": max(1, int(np.ceil(np.sqrt((out_h * out_w) / 2_000_000)))),
        "lens": {field: exif.get(field) for field in LENS_FIELDS},
    }
    lens = _lens_grid(header["lens"], width, height, flip, settings.lens)
    parts = [memoryview(mosaic).cast("B")]
    header["mosaic_bytes"] = mosaic.nbytes
    padding = (-mosaic.nbytes) % 4
    if padding:
        parts.append(b"\0" * padding)
    header["lens_grid"], header["lens_offset"] = (lens[0], mosaic.nbytes + padding) if lens else (None, None)
    if lens:
        parts.append(memoryview(lens[1]).cast("B"))
    timings["sensor_total"] = (time.perf_counter()-began)*1000
    header["source_timings_ms"] = timings
    return header, parts


def _lens_settings(info: dict, lens=None):
    lens = lens or RawImportSettings().lens
    return lens.model_copy(update={
        "focal_length_mm": lens.focal_length_mm or info.get("focal_length_mm"),
        "aperture": lens.aperture or info.get("aperture"),
        "focus_distance_m": lens.focus_distance_m or info.get("focus_distance_m"),
    })


def _lens_grid(info: dict, width: int, height: int, flip: int, settings=None) -> tuple[dict, np.ndarray] | None:
    """Grade's automatic Lensfun correction on a small grid over the turned picture.

    Grade corrects the full source, after colour conversion and before its
    measurements: vignetting gain first, then distortion and colour fringing
    by a bilinear remap. Lensfun evaluates both here on a grid (point k at
    k * (size - 1) / (grid - 1)); the GPU interpolates them per pixel. Both
    vary smoothly, so the remap lands within about a pixel at full size.
    Returns None when no profile applies, as Grade's automatic mode does.
    """
    lens = _lens_settings(info, settings)
    if lens.mode == "off":
        return None
    import lensfunpy
    database = raw_import._lens_database()
    if database is None:
        return None
    profile = raw_import._resolve_lens_profile(
        database, lens, camera_maker=info.get("camera_maker"), camera_model=info.get("camera_model"),
        lens_maker=info.get("lens_maker"), lens_name=info.get("lens_model") or info.get("lens_name"))
    if profile is None:
        return None
    camera, lensfun_lens, _record = profile
    focal = lens.focal_length_mm or raw_import._first_calibration_focal(lensfun_lens)
    if focal is None:
        raise NotEligible("lens correction needs a focal length")
    out_w, out_h = (height, width) if flip in (5, 6) else (width, height)
    crop = float(getattr(camera, "crop_factor", 1.0) or 1.0)
    aperture, distance = float(lens.aperture or 0.0), float(lens.focus_distance_m or 1000.0)
    parts = []
    info_out = {"gain_width": 0, "gain_height": 0, "coordinate_width": 0, "coordinate_height": 0}
    try:
        if lens.vignetting and aperture > 0:
            # The gain varies slowly; Lensfun evaluates it on a small grid.
            scale = 256 / max(out_w, out_h)
            gain_w, gain_h = max(2, round(out_w * scale)), max(2, round(out_h * scale))
            modifier = lensfunpy.Modifier(lensfun_lens, crop, gain_w, gain_h)
            modifier.initialize(float(focal), aperture, distance, scale=0.0, pixel_format=np.float32,
                                flags=lensfunpy.ModifyFlags.VIGNETTING)
            field = np.ones((gain_h, gain_w, 3), dtype=np.float32)
            modifier.apply_color_modification(field)
            parts.append(field[..., 0].reshape(-1))
            info_out.update(gain_width=gain_w, gain_height=gain_h)
        if lens.distortion or lens.chromatic_aberration:
            # Exact full-size coordinates on an even grid about 16 pixels
            # apart: Lensfun at the picture's own size, row by row.
            flags = lensfunpy.ModifyFlags.SCALE
            if lens.distortion:
                flags |= lensfunpy.ModifyFlags.DISTORTION
            if lens.chromatic_aberration:
                flags |= lensfunpy.ModifyFlags.TCA
            modifier = lensfunpy.Modifier(lensfun_lens, crop, out_w, out_h)
            modifier.initialize(float(focal), aperture, distance, scale=0.0, pixel_format=np.float32, flags=flags)
            nodes_w, nodes_h = max(2, -(-(out_w - 1) // 16) + 1), max(2, -(-(out_h - 1) // 16) + 1)
            node_x = np.linspace(0.0, out_w - 1.0, nodes_w)
            columns = np.arange(out_w, dtype=np.float64)
            grid = np.empty((nodes_h, nodes_w, 3, 2), dtype=np.float32)
            for k, row in enumerate(np.linspace(0.0, out_h - 1.0, nodes_h)):
                line = (modifier.apply_subpixel_geometry_distortion(0.0, float(row), out_w, 1) if lens.chromatic_aberration
                        else modifier.apply_geometry_distortion(0.0, float(row), out_w, 1))
                if line is None:
                    grid = None
                    break
                line = np.asarray(line, dtype=np.float64)[0]
                if line.ndim == 2:
                    line = np.repeat(line[:, None, :], 3, axis=1)
                for channel in range(3):
                    for axis in range(2):
                        grid[k, :, channel, axis] = np.interp(node_x, columns, line[:, channel, axis])
            if grid is not None:
                parts.append(grid.reshape(-1))
                info_out.update(coordinate_width=nodes_w, coordinate_height=nodes_h)
    except Exception as error:
        raise NotEligible(f"Lensfun could not prepare the correction: {error}") from None
    if not parts:
        return None
    data = np.ascontiguousarray(np.concatenate(parts), dtype="<f4")
    info_out["floats"] = int(data.size)
    return info_out, data


def _orient(pixels: np.ndarray, flip: int) -> np.ndarray:
    """Turn a sensor-orientation picture the way LibRaw turns its output."""
    if flip == 3:
        return pixels[::-1, ::-1]
    if flip == 6:
        return np.rot90(pixels, k=-1)
    if flip == 5:
        return np.rot90(pixels, k=1)
    return pixels


def developed(cache, path: str, header: dict, payload) -> dict:
    """Store the GPU-developed picture where Grade's CPU development would."""
    source = Path(path).resolve(strict=True)
    if _identity(source) != list(header["identity"]):
        raise ValueError("Photo changed while its Library picture was being developed.")
    height, width, edge = int(header["height"]), int(header["width"]), int(header["edge"])
    planes = np.frombuffer(payload, dtype="<f4", count=3 * height * width).reshape(3, height, width)
    pixels = _orient(planes.transpose(1, 2, 0), int(header["flip"]))
    # Native crops can read planar strides directly. Retain the received planes
    # instead of another full-size interleaved copy; validate in bounded bands.
    if edge != 100000 and not header.get("native_mode"):
        pixels = np.ascontiguousarray(pixels, dtype=np.float32)
    for row in range(0, pixels.shape[0], 128):
        if not np.all(np.isfinite(pixels[row:row + 128])):
            raise ValueError("The GPU development produced invalid pixels.")
    peaks, robust = header["peaks"], header["robust"]
    analysis = HDRAnalysis(
        classification=HDRClassification.HDR_TRUE if peaks["peak"] > 1.0 else HDRClassification.HDR_LINEAR_UNCONFIRMED,
        peak_linear=peaks["peak"], robust_peak_linear=robust["channel"],
        peak_luma_linear=peaks["peak_luma"], robust_peak_luma_linear=robust["luma"],
        peak_bt2020_linear=peaks["peak_bt2020"], robust_peak_bt2020_linear=robust["bt2020"],
        badge_message="")
    from .sessions import _sha256_file
    from .library_source_jobs import shared_fingerprint
    look = starting_adjustments(analysis)
    source_info = SourceImageDescriptor(filename=source.name, suffix=source.suffix,
        width=int(header["source_width"]), height=int(header["source_height"]),
        channels=3, dtype="float32", transfer_function="linear")
    # Every size of one source preparation shares the one read of the RAW.
    fingerprint = shared_fingerprint(header.get("source_job"), source, header["identity"],
        lambda: _sha256_file(source))
    document = EditDocument(hdr_reference_white_nits=203, global_adjustments=look,
        source=SourceReference(filename=source.name, durable_path=str(source),
            byte_size=source.stat().st_size, fingerprint_sha256=fingerprint,
            raw_import_settings=RawImportSettings.model_validate(header.get("raw_import_settings", {})),
            luminance=describe_source_luminance(source_info, {}, has_authored_sdr=False)))
    if _identity(source) != list(header["identity"]):
        raise ValueError("Photo changed while its Library picture was being developed.")
    metadata = {
        "route": ROUTE, "raw_input": True, "renderer": "gpu",
        "starting_look": look.model_dump(mode="json"),
        "default_document": document.model_dump(mode="json"),
        "raw_start_brightness": header.get("raw_start_brightness"),
        "lens_correction_applied": bool(header.get("lens_corrected")),
        "source_width": int(header["source_width"]), "source_height": int(header["source_height"]),
        "gpu_development_ms": header.get("gpu_ms"),
        "gpu_memory_peak_bytes": header.get("memory_peak_bytes"),
        "edge_colour": header.get("edge_diagnostics"),
    }
    if header.get("native_mode"):
        if (pixels.shape[1], pixels.shape[0]) != (int(header["source_width"]), int(header["source_height"])):
            raise ValueError("The native GPU development is not full size.")
        cache.keep_default_document(source, metadata.pop("default_document"))
        metadata.pop("starting_look")
        cache.retain_gpu_native(source, pixels, metadata, look.model_dump(mode="json"))
        return {"native_ready": True, "renderer": "gpu"}
    return cache.build(source, edge, "grade-thumbnail", decoded=(pixels, None, metadata))
