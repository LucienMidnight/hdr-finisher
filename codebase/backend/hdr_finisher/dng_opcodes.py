from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, wait
from dataclasses import dataclass
import struct
from typing import Callable, Iterable

import numpy as np

from .cpu_budget import CpuExecutor, logical_cpus


# Limit each correction to one wave of about 400k scratch pixels. The pool is
# shared with other CPU work and each task writes disjoint output rows.
_SCRATCH_PIXELS = 400_000


OPCODE_NAMES = {
    1: "WarpRectilinear",
    2: "WarpFisheye",
    3: "FixVignetteRadial",
    4: "FixBadPixelsConstant",
    5: "FixBadPixelsList",
    6: "TrimBounds",
    7: "MapTable",
    8: "MapPolynomial",
    9: "GainMap",
    10: "DeltaPerRow",
    11: "DeltaPerColumn",
    12: "ScalePerRow",
    13: "ScalePerColumn",
    14: "WarpRectilinear2",
}


class DngOpcodeError(ValueError):
    pass


class DngImportCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class AreaSpec:
    top: int
    left: int
    bottom: int
    right: int
    plane: int
    planes: int
    row_pitch: int
    col_pitch: int


@dataclass(frozen=True)
class GainMapParameters:
    area: AreaSpec
    map_points_v: int
    map_points_h: int
    map_spacing_v: float
    map_spacing_h: float
    map_origin_v: float
    map_origin_h: float
    map_planes: int
    gains: np.ndarray


@dataclass(frozen=True)
class WarpRectilinearParameters:
    coefficients: np.ndarray
    center_x: float
    center_y: float


@dataclass(frozen=True)
class DngOpcode:
    list_name: str
    index: int
    opcode_id: int
    name: str
    minimum_version: tuple[int, int, int, int]
    flags: int
    parameters: bytes

    @property
    def optional(self) -> bool:
        return bool(self.flags & 1)

    @property
    def skip_preview_allowed(self) -> bool:
        return bool(self.flags & 2)


def parse_opcode_list(value: object, list_name: str, *, max_payload_bytes: int = 64 * 1024**2) -> tuple[DngOpcode, ...]:
    raw = bytes(value)
    if len(raw) < 4:
        raise DngOpcodeError("opcode list is shorter than its count field")
    if len(raw) > max_payload_bytes:
        raise DngOpcodeError(f"opcode list exceeds the {max_payload_bytes}-byte safety limit")
    count = struct.unpack_from(">I", raw, 0)[0]
    if count > 4096:
        raise DngOpcodeError("opcode count exceeds the 4096-operation safety limit")
    position = 4
    result: list[DngOpcode] = []
    for index in range(count):
        if position + 16 > len(raw):
            raise DngOpcodeError(f"opcode {index} header exceeds the tag payload")
        opcode_id, version, flags, parameter_bytes = struct.unpack_from(">IIII", raw, position)
        position += 16
        if parameter_bytes > max_payload_bytes or position + parameter_bytes > len(raw):
            raise DngOpcodeError(f"opcode {index} parameters exceed the tag payload")
        version_bytes = tuple(version.to_bytes(4, "big"))
        parameters = raw[position : position + parameter_bytes]
        position += parameter_bytes
        result.append(
            DngOpcode(
                list_name=list_name,
                index=index,
                opcode_id=opcode_id,
                name=OPCODE_NAMES.get(opcode_id, f"UnknownOpcode{opcode_id}"),
                minimum_version=version_bytes,
                flags=flags,
                parameters=parameters,
            )
        )
    if position != len(raw):
        raise DngOpcodeError(f"opcode list has {len(raw) - position} trailing bytes")
    return tuple(result)


def parse_gain_map(parameters: bytes) -> GainMapParameters:
    if len(parameters) < 76:
        raise DngOpcodeError("GainMap parameters are shorter than the fixed header")
    values = struct.unpack_from(">8I2I4dI", parameters, 0)
    area = AreaSpec(*values[:8])
    points_v, points_h = values[8:10]
    spacing_v, spacing_h, origin_v, origin_h = values[10:14]
    map_planes = values[14]
    if area.bottom <= area.top or area.right <= area.left:
        raise DngOpcodeError("GainMap area is empty or inverted")
    if area.planes <= 0 or area.row_pitch <= 0 or area.col_pitch <= 0:
        raise DngOpcodeError("GainMap AreaSpec has invalid planes or pitch")
    if points_v < 1 or points_h < 1 or map_planes < 1:
        raise DngOpcodeError("GainMap dimensions and plane count must be positive")
    if spacing_v <= 0.0 or spacing_h <= 0.0:
        raise DngOpcodeError("GainMap spacing must be positive")
    count = points_v * points_h * map_planes
    if count > 16_777_216:
        raise DngOpcodeError("GainMap grid exceeds the supported safety limit")
    # The grid samples are IEEE float32; spacing and origin above are float64.
    expected = 76 + count * 4
    if len(parameters) != expected:
        raise DngOpcodeError(f"GainMap expected {expected} parameter bytes; found {len(parameters)}")
    gains = np.frombuffer(parameters, dtype=">f4", count=count, offset=76).astype(np.float64)
    if not np.all(np.isfinite(gains)) or np.any(gains < 0):
        raise DngOpcodeError("GainMap gains must be finite and non-negative")
    return GainMapParameters(
        area=area,
        map_points_v=points_v,
        map_points_h=points_h,
        map_spacing_v=spacing_v,
        map_spacing_h=spacing_h,
        map_origin_v=origin_v,
        map_origin_h=origin_h,
        map_planes=map_planes,
        gains=gains.reshape(points_v, points_h, map_planes),
    )


def parse_warp_rectilinear(parameters: bytes) -> WarpRectilinearParameters:
    if len(parameters) < 4:
        raise DngOpcodeError("WarpRectilinear parameters are shorter than the plane count")
    planes = struct.unpack_from(">I", parameters, 0)[0]
    if planes not in {1, 3}:
        raise DngOpcodeError(f"WarpRectilinear supports 1 or 3 coefficient planes; found {planes}")
    expected = 4 + planes * 6 * 8 + 2 * 8
    if len(parameters) != expected:
        raise DngOpcodeError(
            f"WarpRectilinear expected {expected} parameter bytes for {planes} planes; found {len(parameters)}"
        )
    coefficients = np.frombuffer(parameters, dtype=">f8", count=planes * 6, offset=4).astype(np.float64)
    center_x, center_y = struct.unpack_from(">2d", parameters, 4 + planes * 48)
    if not np.all(np.isfinite(coefficients)) or not np.isfinite([center_x, center_y]).all():
        raise DngOpcodeError("WarpRectilinear coefficients and center must be finite")
    return WarpRectilinearParameters(coefficients.reshape(planes, 6), center_x, center_y)


def apply_gain_map(
    image: np.ndarray,
    gain_map: GainMapParameters,
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
    consume_input: bool = False,
) -> np.ndarray:
    """Apply a gain map, optionally overwriting an owned writable image."""
    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3:
        raise DngOpcodeError("GainMap input must be an H×W×C image")
    height, width, channels = source.shape
    area = gain_map.area
    if area.bottom > height or area.right > width or area.plane + area.planes > channels:
        raise DngOpcodeError("GainMap AreaSpec exceeds the decoded image")
    if gain_map.map_planes > channels:
        raise DngOpcodeError("GainMap has more map planes than the decoded image")
    output = source if consume_input and source.flags.writeable else np.array(source, copy=True, order="C")
    # DNG SDK reference semantics use pixel centers normalized over the
    # complete image bounds, not endpoint-normalized pixel indices.
    xx = np.arange(area.left, area.right, area.col_pitch, dtype=np.float64)[None, :]
    gh = (((xx + 0.5) / width) - gain_map.map_origin_h) / gain_map.map_spacing_h
    gh = np.clip(gh, 0.0, gain_map.map_points_h - 1.0)
    h0 = np.floor(gh).astype(np.intp)
    h1 = np.minimum(h0 + 1, gain_map.map_points_h - 1)
    wh = gh - h0
    left_weight = 1.0 - wh

    def band(start: int, end: int) -> None:
        first = start + (area.top - start) % area.row_pitch
        if first >= end:
            return
        yy = np.arange(first, end, area.row_pitch, dtype=np.float64)[:, None]
        gv = (((yy + 0.5) / height) - gain_map.map_origin_v) / gain_map.map_spacing_v
        gv = np.clip(gv, 0.0, gain_map.map_points_v - 1.0)
        v0 = np.floor(gv).astype(np.intp)
        v1 = np.minimum(v0 + 1, gain_map.map_points_v - 1)
        wv = gv - v0
        top_weight = 1.0 - wv
        # Interpolate each contributing grid row horizontally just once per
        # band. A dense or sparse grid still uses at most two rows per sample.
        grid_rows, inverse = np.unique(np.concatenate((v0[:, 0], v1[:, 0])), return_inverse=True)
        top_rows, bottom_rows = np.split(inverse, 2)
        target = output[first:end:area.row_pitch, area.left:area.right:area.col_pitch]
        for relative_plane in range(area.planes):
            plane = area.plane + relative_plane
            map_plane = min(plane, gain_map.map_planes - 1)
            horizontal = gain_map.gains[grid_rows[:, None], h0, map_plane] * left_weight
            horizontal += gain_map.gains[grid_rows[:, None], h1, map_plane] * wh
            gains = horizontal[top_rows]
            gains *= top_weight
            gains += horizontal[bottom_rows] * wv
            target[..., plane] *= gains.astype(np.float32)

    _run_opcode_bands(band, area.top, area.bottom, xx.size, rows, cancelled)
    return output


def apply_warp_rectilinear(
    image: np.ndarray,
    warp: WarpRectilinearParameters,
    *,
    rows: int = 64,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3:
        raise DngOpcodeError("WarpRectilinear input must be an H×W×C image")
    height, width, channels = source.shape
    if warp.coefficients.shape[0] not in {1, channels}:
        raise DngOpcodeError("WarpRectilinear planes must be one or match the image channels")
    if not (0.0 <= warp.center_x <= 1.0 and 0.0 <= warp.center_y <= 1.0):
        raise DngOpcodeError("WarpRectilinear optical center must be within normalized image bounds")
    output = np.empty_like(source)
    center_x = warp.center_x * width
    center_y = warp.center_y * height
    # For square pixels, the DNG normalization radius is the Euclidean
    # distance from the optical center to the farthest image-bounds corner.
    scale = float(
        np.hypot(max(center_x, width - center_x), max(center_y, height - center_y))
    )
    x_pixels = np.arange(width, dtype=np.float64)[None, :]
    x = (x_pixels - center_x) / scale
    x2 = x * x
    coefficients = [
        warp.coefficients[0 if warp.coefficients.shape[0] == 1 else channel]
        for channel in range(channels)
    ]
    identity = [np.array_equal(c, (1, 0, 0, 0, 0, 0)) for c in coefficients]
    all_identity = all(identity)

    def band(start: int, end: int) -> None:
        if all_identity:
            output[start:end] = source[start:end]
            return
        y_pixels = np.arange(start, end, dtype=np.float64)[:, None]
        y = (y_pixels - center_y) / scale
        y2 = y * y
        r2 = np.minimum(x2 + y2, 1.0)
        r4, r6 = r2**2, r2**3
        for channel, (k0, k1, k2, k3, k4, k5) in enumerate(coefficients):
            if identity[channel]:
                output[start:end, :, channel] = source[start:end, :, channel]
                continue
            radial = k0 + k1 * r2 + k2 * r4 + k3 * r6
            source_x, source_y = x * radial, y * radial
            if k4 or k5:
                source_x += 2.0 * k4 * x * y
                source_x += k5 * (r2 + 2.0 * x * x)
                source_y += k4 * (r2 + 2.0 * y * y)
                source_y += 2.0 * k5 * x * y
            source_x *= scale
            source_y *= scale
            source_x += center_x
            source_y += center_y
            output[start:end, :, channel] = _sample_bicubic_clipped(
                source[..., channel], source_x, source_y
            )

    _run_opcode_bands(band, 0, height, width, rows, cancelled)
    return output


def apply_opcode_list3(
    image: np.ndarray,
    opcodes: Iterable[DngOpcode],
    *,
    cancelled: Callable[[], bool] | None = None,
    progress: Callable[[str, str], None] | None = None,
    consume_input: bool = False,
) -> tuple[np.ndarray, tuple[dict[str, object], ...]]:
    """Apply opcodes in tag order. Only consume input when the caller owns it."""
    result = np.asarray(image, dtype=np.float32)
    diagnostics: list[dict[str, object]] = []
    for opcode in opcodes:
        _raise_if_cancelled(cancelled)
        if opcode.list_name != "OpcodeList3":
            if opcode.optional:
                diagnostics.append(_diagnostic(opcode, "skipped_optional_wrong_stage"))
                continue
            raise DngOpcodeError(f"{opcode.name} is not supported in {opcode.list_name}")
        if progress and opcode.opcode_id in {9, 1}:
            progress("dng_gain_map" if opcode.opcode_id == 9 else "dng_warp", "Applying DNG brightness correction" if opcode.opcode_id == 9 else "Correcting DNG distortion")
        if opcode.opcode_id == 9:
            result = apply_gain_map(
                result, parse_gain_map(opcode.parameters),
                cancelled=cancelled, consume_input=consume_input,
            )
            diagnostics.append(_diagnostic(opcode, "applied"))
            consume_input = True  # Subsequent operations own this buffer.
        elif opcode.opcode_id == 1:
            result = apply_warp_rectilinear(
                result, parse_warp_rectilinear(opcode.parameters), cancelled=cancelled
            )
            diagnostics.append(_diagnostic(opcode, "applied"))
            consume_input = True
        elif opcode.optional:
            diagnostics.append(_diagnostic(opcode, "skipped_optional"))
        else:
            raise DngOpcodeError(
                f"Unsupported mandatory opcode: {opcode.name} ({opcode.list_name}, opcode {opcode.opcode_id})"
            )
    return result, tuple(diagnostics)


def _run_opcode_bands(
    band: Callable[[int, int], None], top: int, bottom: int, width: int,
    rows: int, cancelled: Callable[[], bool] | None,
) -> None:
    # Leave small jobs on the calling thread. Larger corrections keep one
    # bounded wave in flight and join it before changing opcode or releasing
    # the source and destination, even on cancellation.
    if (bottom - top) * width > _SCRATCH_PIXELS:
        workers = min(logical_cpus(), max(1, _SCRATCH_PIXELS // width))
        rows = min(rows, max(1, _SCRATCH_PIXELS // workers // width))
    else:
        workers = 1
    starts = range(top, bottom, rows)

    def process(start: int) -> None:
        _raise_if_cancelled(cancelled)
        band(start, min(bottom, start + rows))

    if workers == 1 or len(starts) < 2:
        for start in starts:
            process(start)
        return
    with CpuExecutor() as pool:
        pending = {pool.submit(process, start) for start in starts[:workers]}
        remaining = iter(starts[workers:])
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for task in done:
                task.result()
            for _, start in zip(done, remaining):
                pending.add(pool.submit(process, start))


def _sample_bicubic_clipped(
    plane: np.ndarray, x: np.ndarray, y: np.ndarray,
) -> np.ndarray:
    height, width = plane.shape
    safe_x = np.clip(x, 0.0, width - 1.0, out=x)
    safe_y = np.clip(y, 0.0, height - 1.0, out=y)
    x0 = np.floor(safe_x).astype(np.intp)
    y0 = np.floor(safe_y).astype(np.intp)
    fx = np.subtract(safe_x, x0, out=safe_x)
    fy = np.subtract(safe_y, y0, out=safe_y)
    result = np.zeros_like(safe_x, dtype=np.float64)
    total_weight = np.zeros_like(safe_x, dtype=np.float64)
    row_sum = np.empty_like(result)
    contribution = np.empty_like(result)
    # Separable cubic: gather the same sixteen clamped taps in float64, but
    # apply the y weight only once per horizontally interpolated source row.
    x_taps = tuple(
        (np.clip(x0 + offset, 0, width - 1), _bicubic_weight(offset, fx))
        for offset in (-1, 0, 1, 2)
    )
    for row_offset in (-1, 0, 1, 2):
        source_y = np.clip(y0 + row_offset, 0, height - 1)
        wy = _bicubic_weight(row_offset, fy)
        source_x, wx = x_taps[0]
        np.multiply(plane[source_y, source_x], wx, out=row_sum)
        for source_x, wx in x_taps[1:]:
            np.multiply(plane[source_y, source_x], wx, out=contribution)
            row_sum += contribution
        row_sum *= wy
        result += row_sum
        total_weight += wy
    _, wx0 = x_taps[0]
    _, wx1 = x_taps[1]
    _, wx2 = x_taps[2]
    _, wx3 = x_taps[3]
    total_weight *= wx0 + wx1 + wx2 + wx3
    np.divide(result, total_weight, out=result)
    return result.astype(np.float32)


def _bicubic_weight(offset: int, fraction: np.ndarray) -> np.ndarray:
    # The fractional part is in [0, 1), so the tap determines the interval
    # of the cubic. Both polynomials give exactly zero at the shared endpoint.
    x = np.abs(offset - fraction)
    a = -0.75
    if offset in {-1, 2}:
        return ((a * x - 5.0 * a) * x + 8.0 * a) * x - 4.0 * a
    return ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0


def _diagnostic(opcode: DngOpcode, status: str) -> dict[str, object]:
    return {
        "list": opcode.list_name,
        "index": opcode.index,
        "id": opcode.opcode_id,
        "name": opcode.name,
        "flags": opcode.flags,
        "status": status,
    }


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise DngImportCancelled("Experimental DNG import cancelled")
