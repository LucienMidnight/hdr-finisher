from __future__ import annotations

import numpy as np
import pytest

from hdr_finisher.dng_color import (
    D50_XYZ,
    XYZ_D50_TO_ACESCG,
    DngColorError,
    DngColorMetadata,
    build_color_transform,
    convert_to_acescg,
    reciprocal_temperature_weight,
)
from hdr_finisher.dng_opcodes import DngImportCancelled


def _forward_metadata(**updates: object) -> DngColorMetadata:
    values: dict[str, object] = {
        "color_matrix1": np.eye(3),
        "calibration_illuminant1": 23,
        "as_shot_neutral": np.ones(3),
        "forward_matrix1": np.eye(3),
    }
    values.update(updates)
    return DngColorMetadata(**values)


def test_forward_matrix_path_matches_documented_equation() -> None:
    metadata = _forward_metadata(
        analog_balance=np.asarray([2.0, 1.0, 0.5]),
        camera_calibration1=np.diag([0.5, 1.0, 2.0]),
        as_shot_neutral=np.asarray([0.5, 1.0, 2.0]),
    )
    transform = build_color_transform(metadata)
    assert transform.color_path == "forward_matrix"
    assert np.allclose(transform.camera_to_xyz_d50, np.diag([2.0, 1.0, 0.5]))


def test_xyz_d50_to_acescg_reference_vector() -> None:
    # Independent Bradford-adapted reference produced by colour-science 0.4.6.
    vector = np.asarray([0.2, 0.3, 0.4]) @ XYZ_D50_TO_ACESCG.T
    assert np.allclose(vector, [0.12384674, 0.36263920, 0.48355482], atol=1e-7)


def test_color_matrix_only_path_maps_its_camera_neutral_to_d50() -> None:
    metadata = DngColorMetadata(
        color_matrix1=np.eye(3),
        calibration_illuminant1=23,
        as_shot_neutral=D50_XYZ,
    )
    transform = build_color_transform(metadata)
    assert transform.color_path == "color_matrix_only"
    assert np.allclose(transform.camera_to_xyz_d50 @ D50_XYZ, D50_XYZ, atol=2e-6)


def test_integer_normalization_exposure_and_no_clipping() -> None:
    source = np.asarray([[[0, 100, 200], [300, 400, 500]]], dtype=np.int16)
    metadata = _forward_metadata(
        black_level=np.asarray([100.0]),
        white_level=np.asarray([300.0]),
        baseline_exposure=1.0,
    )
    result, _ = convert_to_acescg(source, metadata)
    expected_camera = (source.astype(np.float32) - 100.0) / 200.0
    expected = (expected_camera @ XYZ_D50_TO_ACESCG.T.astype(np.float32)) * 2.0
    assert np.allclose(result, expected)
    assert np.min(result) < 0.0
    assert np.max(result) > 1.0


def test_float_values_remain_unclipped_and_float32() -> None:
    source = np.asarray([[[-0.25, 0.18, 4.0]]], dtype=np.float16)
    result, _ = convert_to_acescg(source, _forward_metadata())
    assert result.dtype == np.float32
    assert np.min(result) < 0.0
    assert np.max(result) > 1.0


def test_dual_illuminant_uses_reciprocal_temperature_interpolation() -> None:
    assert reciprocal_temperature_weight(6504, 6504, 2856) == pytest.approx(1.0)
    assert reciprocal_temperature_weight(2856, 6504, 2856) == pytest.approx(0.0)
    metadata = _forward_metadata(
        color_matrix2=np.eye(3),
        calibration_illuminant2=17,
        forward_matrix2=np.eye(3) * 2.0,
        as_shot_neutral=D50_XYZ,
    )
    transform = build_color_transform(metadata)
    assert 0.0 <= transform.profile_weight1 <= 1.0
    assert 2856.0 <= transform.estimated_temperature <= 6504.0


def test_singular_and_malformed_metadata_rejects() -> None:
    with pytest.raises(DngColorError, match="singular"):
        build_color_transform(_forward_metadata(camera_calibration1=np.zeros((3, 3))))
    with pytest.raises(DngColorError, match="WhiteLevel"):
        convert_to_acescg(
            np.ones((1, 1, 3), dtype=np.uint16),
            _forward_metadata(black_level=np.ones(3), white_level=np.ones(3)),
        )


def test_color_conversion_cancellation_is_bounded_by_rows() -> None:
    calls = 0

    def cancelled() -> bool:
        nonlocal calls
        calls += 1
        return calls > 1

    with pytest.raises(DngImportCancelled):
        convert_to_acescg(np.ones((3, 1, 3), dtype=np.float32), _forward_metadata(), rows=1, cancelled=cancelled)
