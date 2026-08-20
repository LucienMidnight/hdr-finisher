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


def test_gain_map_honors_area_plane_and_pixel_pitch() -> None:
    image = np.ones((5, 6, 3), dtype=np.float32)
    gain_map = GainMapParameters(
        AreaSpec(1, 1, 5, 6, 1, 1, 2, 2),
        1,
        1,
        1.0,
        1.0,
        0.0,
        0.0,
        1,
        np.full((1, 1, 1), 2.0, dtype=np.float64),
    )
    result = apply_gain_map(image, gain_map)
    expected = np.ones_like(image)
    expected[1:5:2, 1:6:2, 1] = 2.0
    assert np.array_equal(result, expected)


def test_gain_map_parser_rejects_non_positive_spacing() -> None:
    parameters = bytearray(_gain_parameters(np.ones((1, 1, 1)), planes=3))
    struct.pack_into(">d", parameters, 40, 0.0)
    with pytest.raises(DngOpcodeError, match="spacing must be positive"):
        parse_gain_map(bytes(parameters))


def test_warp_identity_and_clipped_border() -> None:
    image = np.arange(5 * 7 * 3, dtype=np.float32).reshape(5, 7, 3)
    identity = WarpRectilinearParameters(np.asarray([[1, 0, 0, 0, 0, 0]], dtype=np.float64), 0.5, 0.5)
    assert np.allclose(apply_warp_rectilinear(image, identity), image)

    shifted = WarpRectilinearParameters(np.asarray([[1, 0, 0, 0, 0, 1]], dtype=np.float64), 0.5, 0.5)
    result = apply_warp_rectilinear(image, shifted)
    assert np.all(np.isfinite(result))
    assert result.shape == image.shape
    assert not np.allclose(result, image)


def test_warp_uses_independent_coefficient_planes() -> None:
    yy, xx = np.mgrid[:11, :13]
    base = (xx + yy * 7).astype(np.float32)
    image = np.stack((base, base, base), axis=-1)
    coefficients = np.asarray(
        [
            [1, 0, 0, 0, 0, 0],
            [1, 0.12, 0, 0, 0, 0],
            [1, 0, 0, 0, 0.015, -0.01],
        ],
        dtype=np.float64,
    )
    result = apply_warp_rectilinear(
        image, WarpRectilinearParameters(coefficients, 0.5, 0.5)
    )
    assert np.allclose(result[..., 0], image[..., 0])
    assert not np.allclose(result[..., 1], result[..., 0])
    assert not np.allclose(result[..., 2], result[..., 1])


def test_warp_cancellation_is_checked_between_bounded_row_chunks() -> None:
    calls = 0

    def cancelled() -> bool:
        nonlocal calls
        calls += 1
        return calls > 1

    image = np.ones((130, 12, 3), dtype=np.float32)
    identity = WarpRectilinearParameters(
        np.asarray([[1, 0, 0, 0, 0, 0]], dtype=np.float64), 0.5, 0.5
    )
    with pytest.raises(DngImportCancelled):
        apply_warp_rectilinear(image, identity, rows=64, cancelled=cancelled)
    assert calls == 2


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


def test_unsupported_mandatory_opcode_rejects_instead_of_being_ignored() -> None:
    encoded = struct.pack(">I", 1) + struct.pack(">IIII", 1234, 0x01030000, 0, 0)
    opcodes = parse_opcode_list(encoded, "OpcodeList3")
    with pytest.raises(DngOpcodeError, match="Unsupported mandatory opcode"):
        apply_opcode_list3(np.ones((2, 2, 3), np.float32), opcodes)
