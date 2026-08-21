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
    transform_normalized_to_acescg_in_place,
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


def test_clipped_highlight_recovery_feathers_local_fringe_and_protects_distant_color() -> None:
    transform = build_color_transform(_forward_metadata())
    source = np.zeros((40, 40, 3), dtype=np.float32)
    source[20, 20] = [1.0, 0.55, 0.2]
    source[20, 21:25] = [0.9, 0.55, 0.2]
    source[0, 0] = [0.9, 0.55, 0.2]
    baseline = source.copy()
    transform_normalized_to_acescg_in_place(baseline, transform)

    recovered = source.copy()
    transform_normalized_to_acescg_in_place(
        recovered,
        transform,
        highlight_recovery_limit=1.0,
    )

    neutral_scale = np.max(source[20, 20] / transform.camera_neutral)
    expected_core = (transform.camera_neutral * neutral_scale) @ transform.camera_to_acescg.T
    assert np.allclose(recovered[20, 20], expected_core, atol=1e-6)
    assert np.allclose(recovered[20, 20], recovered[20, 20, 0], atol=1e-6)
    baseline_fringe_chroma = np.ptp(baseline[20, 22])
    recovered_fringe_chroma = np.ptp(recovered[20, 22])
    assert recovered_fringe_chroma < baseline_fringe_chroma * 0.25
    assert np.mean(recovered[20, 22]) > np.mean(baseline[20, 22])
    assert np.allclose(recovered[0, 0], baseline[0, 0])


def test_clipped_highlight_recovery_has_continuous_spatial_falloff_and_exposure_scaling() -> None:
    transform = build_color_transform(_forward_metadata())
    source = np.zeros((64, 64, 3), dtype=np.float32)
    source[32, 32] = [1.0, 0.55, 0.2]
    source[32, 33:43] = [0.8, 0.45, 0.2]

    recovered = source.copy()
    transform_normalized_to_acescg_in_place(recovered, transform, highlight_recovery_limit=1.0)
    darker = source.copy()
    transform_normalized_to_acescg_in_place(
        darker,
        transform,
        baseline_exposure=-1.0,
        highlight_recovery_limit=1.0,
    )

    chroma = np.ptp(recovered[32, 33:43], axis=-1)
    assert np.all(np.diff(chroma) >= -1e-6)
    assert len(np.unique(np.round(chroma, 5))) >= 8
    assert float(np.max(np.diff(chroma))) < float(np.ptp(recovered[32, 42])) * 0.25
    np.testing.assert_allclose(darker, recovered * 0.5, rtol=2e-6, atol=2e-7)


def test_invalid_linear_response_limit_rejects() -> None:
    transform = build_color_transform(_forward_metadata())
    with pytest.raises(DngColorError, match="LinearResponseLimit"):
        transform_normalized_to_acescg_in_place(
            np.ones((1, 1, 3), dtype=np.float32),
            transform,
            highlight_recovery_limit=1.01,
        )


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
