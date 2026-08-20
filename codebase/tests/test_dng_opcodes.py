from __future__ import annotations

import struct

import numpy as np
import pytest

from hdr_finisher.dng_opcodes import (
    DngImportCancelled,
    DngOpcodeError,
    GainMapParameters,
    AreaSpec,
    WarpRectilinearParameters,
    apply_gain_map,
    apply_opcode_list3,
    apply_warp_rectilinear,
    parse_gain_map,
    parse_opcode_list,
    parse_warp_rectilinear,
)


def _opcode(opcode_id: int, parameters: bytes, *, flags: int = 0) -> bytes:
    return struct.pack(">IIIII", 1, opcode_id, 0x01030000, flags, len(parameters)) + parameters


def _gain_parameters(gains: np.ndarray, *, planes: int = 3) -> bytes:
    points_v, points_h, map_planes = gains.shape
    header = struct.pack(
        ">8I2I4dI",
        0, 0, 4, 4, 0, planes, 1, 1,
        points_v, points_h,
        1.0 / max(points_v - 1, 1), 1.0 / max(points_h - 1, 1),
        0.0, 0.0, map_planes,
    )
    return header + gains.astype(">f4").tobytes()


def test_gain_map_parser_and_bilinear_plane_application() -> None:
    gains = np.ones((2, 2, 3), dtype=np.float64)
    gains[..., 0] = [[1.0, 2.0], [3.0, 4.0]]
    parsed = parse_gain_map(_gain_parameters(gains))
    image = np.ones((4, 4, 3), dtype=np.float32)
    result = apply_gain_map(image, parsed)
    # Pixel centers are at 0.125 and 0.875 in a four-pixel image.
    assert result[0, 0, 0] == pytest.approx(1.375)
    assert result[-1, -1, 0] == pytest.approx(3.625)
    assert np.all(result[..., 1:] == 1.0)


def test_gain_map_preserves_negative_and_hdr_values() -> None:
    gains = np.full((1, 1, 1), 2.0)
    parsed = parse_gain_map(_gain_parameters(gains, planes=3))
    image = np.asarray([[[-0.5, 1.5, 3.0]]], dtype=np.float32)
    parsed = GainMapParameters(
        AreaSpec(0, 0, 1, 1, 0, 3, 1, 1), 1, 1, 1.0, 1.0, 0.0, 0.0, 1, parsed.gains
    )
    assert np.allclose(apply_gain_map(image, parsed), image * 2.0)


def test_warp_identity_and_clipped_border() -> None:
    image = np.arange(5 * 7 * 3, dtype=np.float32).reshape(5, 7, 3)
    identity = WarpRectilinearParameters(np.asarray([[1, 0, 0, 0, 0, 0]], dtype=np.float64), 0.5, 0.5)
    assert np.allclose(apply_warp_rectilinear(image, identity), image)

    shifted = WarpRectilinearParameters(np.asarray([[1, 0, 0, 0, 0, 1]], dtype=np.float64), 0.5, 0.5)
    result = apply_warp_rectilinear(image, shifted)
    assert np.all(np.isfinite(result))
    assert result.shape == image.shape
    assert not np.allclose(result, image)


def test_warp_parser_accepts_real_target_shape_and_rejects_unknown_planes() -> None:
    parameters = struct.pack(">I", 3) + struct.pack(">18d", *([1, 0, 0, 0, 0, 0] * 3)) + struct.pack(">2d", 0.5, 0.5)
    assert parse_warp_rectilinear(parameters).coefficients.shape == (3, 6)
    with pytest.raises(DngOpcodeError, match="1 or 3"):
        parse_warp_rectilinear(struct.pack(">I", 2) + bytes(112))


def test_opcode_order_optional_skip_and_cancellation() -> None:
    gains = np.full((1, 1, 1), 2.0)
    gain = _gain_parameters(gains, planes=3)
    warp = struct.pack(">I", 1) + struct.pack(">6d", 1, 0, 0, 0, 0, 0) + struct.pack(">2d", 0.5, 0.5)
    encoded = struct.pack(">I", 3)
    for opcode_id, flags, params in ((9, 0, gain), (1234, 1, b""), (1, 0, warp)):
        encoded += struct.pack(">IIII", opcode_id, 0x01030000, flags, len(params)) + params
    opcodes = parse_opcode_list(encoded, "OpcodeList3")
    result, diagnostics = apply_opcode_list3(np.ones((4, 4, 3), np.float32), opcodes)
    assert np.allclose(result, 2.0)
    assert [item["status"] for item in diagnostics] == ["applied", "skipped_optional", "applied"]
    with pytest.raises(DngImportCancelled):
        apply_opcode_list3(np.ones((4, 4, 3), np.float32), opcodes, cancelled=lambda: True)


def test_opcode_parser_rejects_truncated_oversized_and_trailing_payloads() -> None:
    with pytest.raises(DngOpcodeError, match="shorter"):
        parse_opcode_list(b"bad", "OpcodeList3")
    with pytest.raises(DngOpcodeError, match="parameters exceed"):
        parse_opcode_list(struct.pack(">IIIII", 1, 9, 0x01030000, 0, 99), "OpcodeList3")
    with pytest.raises(DngOpcodeError, match="trailing"):
        parse_opcode_list(struct.pack(">I", 0) + b"x", "OpcodeList3")
