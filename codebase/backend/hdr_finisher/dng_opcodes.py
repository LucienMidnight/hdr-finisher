from __future__ import annotations

from dataclasses import dataclass
import struct
from typing import Callable, Iterable

import numpy as np


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
) -> np.ndarray:
    source = np.asarray(image, dtype=np.float32)
    if source.ndim != 3:
        raise DngOpcodeError("GainMap input must be an H×W×C image")
    height, width, channels = source.shape
    area = gain_map.area
    if area.bottom > height or area.right > width or area.plane + area.planes > channels:
        raise DngOpcodeError("GainMap AreaSpec exceeds the decoded image")
    if gain_map.map_planes > channels:
        raise DngOpcodeError("GainMap has more map planes than the decoded image")
    output = np.array(source, dtype=np.float32, copy=True, order="C")
    for start in range(area.top, area.bottom, rows):
        _raise_if_cancelled(cancelled)
        end = min(area.bottom, start + rows)
        yy = np.arange(start, end, dtype=np.float64)[:, None]
        xx = np.arange(area.left, area.right, dtype=np.float64)[None, :]
        # DNG SDK reference semantics use pixel centers normalized over the
        # complete image bounds, not endpoint-normalized pixel indices.
        gv = (((yy + 0.5) / height) - gain_map.map_origin_v) / gain_map.map_spacing_v
        gh = (((xx + 0.5) / width) - gain_map.map_origin_h) / gain_map.map_spacing_h
        gv = np.clip(gv, 0.0, gain_map.map_points_v - 1.0)
        gh = np.clip(gh, 0.0, gain_map.map_points_h - 1.0)
        v0 = np.floor(gv).astype(np.int32)
        h0 = np.floor(gh).astype(np.int32)
        v1 = np.minimum(v0 + 1, gain_map.map_points_v - 1)
        h1 = np.minimum(h0 + 1, gain_map.map_points_h - 1)
        wv = gv - v0
        wh = gh - h0
        for relative_plane in range(area.planes):
            plane = area.plane + relative_plane
            map_plane = min(plane, gain_map.map_planes - 1)
            top = gain_map.gains[v0, h0, map_plane] * (1.0 - wh) + gain_map.gains[v0, h1, map_plane] * wh
            bottom = gain_map.gains[v1, h0, map_plane] * (1.0 - wh) + gain_map.gains[v1, h1, map_plane] * wh
            gains = top * (1.0 - wv) + bottom * wv
            target = output[start:end, area.left:area.right, plane]
            row_mask = ((np.arange(start, end) - area.top) % area.row_pitch) == 0
            col_mask = ((np.arange(area.left, area.right) - area.left) % area.col_pitch) == 0
            target[np.ix_(row_mask, col_mask)] *= gains[np.ix_(row_mask, col_mask)].astype(np.float32)
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
    for start in range(0, height, rows):
        _raise_if_cancelled(cancelled)
        end = min(height, start + rows)
        y_pixels = np.arange(start, end, dtype=np.float64)[:, None]
        y = (y_pixels - center_y) / scale
        r2 = np.minimum(x * x + y * y, 1.0)
        for channel in range(channels):
            k0, k1, k2, k3, k4, k5 = warp.coefficients[
                0 if warp.coefficients.shape[0] == 1 else channel
            ]
            radial = k0 + k1 * r2 + k2 * r2**2 + k3 * r2**3
            source_x = center_x + scale * (x * radial + 2.0 * k4 * x * y + k5 * (r2 + 2.0 * x * x))
            source_y = center_y + scale * (y * radial + k4 * (r2 + 2.0 * y * y) + 2.0 * k5 * x * y)
            output[start:end, :, channel] = _sample_bicubic_clipped(
                source[..., channel], source_x, source_y
            )
    return output


def apply_opcode_list3(
    image: np.ndarray,
    opcodes: Iterable[DngOpcode],
    *,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, tuple[dict[str, object], ...]]:
    result = np.asarray(image, dtype=np.float32)
    diagnostics: list[dict[str, object]] = []
    for opcode in opcodes:
        _raise_if_cancelled(cancelled)
        if opcode.list_name != "OpcodeList3":
            if opcode.optional:
                diagnostics.append(_diagnostic(opcode, "skipped_optional_wrong_stage"))
                continue
            raise DngOpcodeError(f"{opcode.name} is not supported in {opcode.list_name}")
        if opcode.opcode_id == 9:
            result = apply_gain_map(result, parse_gain_map(opcode.parameters), cancelled=cancelled)
            diagnostics.append(_diagnostic(opcode, "applied"))
        elif opcode.opcode_id == 1:
            result = apply_warp_rectilinear(
                result, parse_warp_rectilinear(opcode.parameters), cancelled=cancelled
            )
            diagnostics.append(_diagnostic(opcode, "applied"))
        elif opcode.optional:
            diagnostics.append(_diagnostic(opcode, "skipped_optional"))
        else:
            raise DngOpcodeError(
                f"Unsupported mandatory opcode: {opcode.name} ({opcode.list_name}, opcode {opcode.opcode_id})"
            )
    return result, tuple(diagnostics)


def _sample_bicubic_clipped(
    plane: np.ndarray, x: np.ndarray, y: np.ndarray
) -> np.ndarray:
    height, width = plane.shape
    safe_x = np.clip(x, 0.0, width - 1.0)
    safe_y = np.clip(y, 0.0, height - 1.0)
    x0 = np.floor(safe_x).astype(np.int32)
    y0 = np.floor(safe_y).astype(np.int32)
    fx = safe_x - x0
    fy = safe_y - y0
    result = np.zeros_like(safe_x, dtype=np.float64)
    total_weight = np.zeros_like(safe_x, dtype=np.float64)
    for row_offset in (-1, 0, 1, 2):
        source_y = np.clip(y0 + row_offset, 0, height - 1)
        wy = _bicubic_weight(row_offset - fy)
        for col_offset in (-1, 0, 1, 2):
            source_x = np.clip(x0 + col_offset, 0, width - 1)
            weight = wy * _bicubic_weight(col_offset - fx)
            result += plane[source_y, source_x] * weight
            total_weight += weight
    return np.asarray(result / total_weight, dtype=np.float32)


def _bicubic_weight(distance: np.ndarray) -> np.ndarray:
    x = np.abs(distance)
    a = -0.75
    return np.where(
        x >= 2.0,
        0.0,
        np.where(
            x >= 1.0,
            ((a * x - 5.0 * a) * x + 8.0 * a) * x - 4.0 * a,
            ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0,
        ),
    )


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
