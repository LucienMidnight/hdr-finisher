from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from .dng_opcodes import DngImportCancelled


D50_XYZ = np.asarray([0.96422, 1.0, 0.82521], dtype=np.float64)
D60_XYZ = np.asarray([0.95264607, 1.0, 1.00882518], dtype=np.float64)
BRADFORD = np.asarray(
    [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]],
    dtype=np.float64,
)
XYZ_D60_TO_ACESCG = np.linalg.inv(
    np.asarray(
        [
            [0.6624541811, 0.1340042065, 0.1561876870],
            [0.2722287168, 0.6740817658, 0.0536895174],
            [-0.0055746495, 0.0040607335, 1.0103391003],
        ],
        dtype=np.float64,
    )
)
XYZ_D50_TO_ACESCG = XYZ_D60_TO_ACESCG @ (
    np.linalg.inv(BRADFORD)
    @ np.diag((BRADFORD @ D60_XYZ) / (BRADFORD @ D50_XYZ))
    @ BRADFORD
)


ILLUMINANT_TEMPERATURES = {
    17: 2856.0,  # Standard light A
    18: 4874.0,  # Standard light B
    19: 6774.0,  # Standard light C
    20: 5503.0,  # D55
    21: 6504.0,  # D65
    22: 7504.0,  # D75
    23: 5003.0,  # D50
    24: 3200.0,  # ISO studio tungsten
}


class DngColorError(ValueError):
    pass


@dataclass(frozen=True)
class DngColorMetadata:
    color_matrix1: np.ndarray
    calibration_illuminant1: int
    as_shot_neutral: np.ndarray
    color_matrix2: np.ndarray | None = None
    calibration_illuminant2: int | None = None
    forward_matrix1: np.ndarray | None = None
    forward_matrix2: np.ndarray | None = None
    camera_calibration1: np.ndarray | None = None
    camera_calibration2: np.ndarray | None = None
    analog_balance: np.ndarray | None = None
    black_level: np.ndarray | None = None
    white_level: np.ndarray | None = None
    baseline_exposure: float = 0.0


@dataclass(frozen=True)
class DngColorTransform:
    camera_to_xyz_d50: np.ndarray
    camera_to_acescg: np.ndarray
    color_path: str
    profile_weight1: float
    estimated_temperature: float


def build_color_transform(metadata: DngColorMetadata) -> DngColorTransform:
    cm1 = _matrix(metadata.color_matrix1, "ColorMatrix1")
    neutral = _vector(metadata.as_shot_neutral, "AsShotNeutral")
    analog = _vector(
        np.ones(3) if metadata.analog_balance is None else metadata.analog_balance,
        "AnalogBalance",
    )
    if np.any(analog == 0) or np.any(neutral <= 0):
        raise DngColorError("AnalogBalance and AsShotNeutral must contain positive non-zero values.")

    dual = metadata.color_matrix2 is not None
    temperature = float(ILLUMINANT_TEMPERATURES.get(metadata.calibration_illuminant1, 5000.0))
    weight1 = 1.0
    if dual:
        if metadata.calibration_illuminant2 is None:
            raise DngColorError("ColorMatrix2 requires CalibrationIlluminant2.")
        cm2 = _matrix(metadata.color_matrix2, "ColorMatrix2")
        temperature, weight1 = _solve_profile_temperature(
            cm1,
            cm2,
            metadata.calibration_illuminant1,
            metadata.calibration_illuminant2,
            neutral,
            analog,
            metadata.camera_calibration1,
            metadata.camera_calibration2,
        )
    else:
        cm2 = cm1

    cm = _interpolate(cm1, cm2, weight1)
    cc1 = _matrix_or_identity(metadata.camera_calibration1, "CameraCalibration1")
    cc2 = _matrix_or_identity(metadata.camera_calibration2, "CameraCalibration2")
    cc = _interpolate(cc1, cc2, weight1)
    abcc = np.diag(analog) @ cc
    _validate_invertible(abcc, "AnalogBalance × CameraCalibration")

    if metadata.forward_matrix1 is not None:
        fm1 = _matrix(metadata.forward_matrix1, "ForwardMatrix1")
        if dual and metadata.forward_matrix2 is None:
            raise DngColorError("A dual-illuminant ForwardMatrix path requires ForwardMatrix2.")
        fm2 = fm1 if metadata.forward_matrix2 is None else _matrix(metadata.forward_matrix2, "ForwardMatrix2")
        forward = _interpolate(fm1, fm2, weight1)
        reference_neutral = np.linalg.solve(abcc, neutral)
        if np.any(np.abs(reference_neutral) < 1e-12):
            raise DngColorError("Reference neutral is numerically singular.")
        camera_to_xyz = forward @ np.diag(1.0 / reference_neutral) @ np.linalg.inv(abcc)
        color_path = "forward_matrix"
    else:
        xyz_to_camera = abcc @ cm
        _validate_invertible(xyz_to_camera, "calibrated ColorMatrix")
        camera_to_xyz_unadapted = np.linalg.inv(xyz_to_camera)
        source_white = camera_to_xyz_unadapted @ neutral
        if not np.all(np.isfinite(source_white)) or source_white[1] <= 0:
            raise DngColorError("ColorMatrix path produced an invalid source white.")
        source_white /= source_white[1]
        camera_to_xyz = chromatic_adaptation_matrix(source_white, D50_XYZ) @ camera_to_xyz_unadapted
        color_path = "color_matrix_only"

    if not np.all(np.isfinite(camera_to_xyz)):
        raise DngColorError("DNG camera-to-XYZ transform is non-finite.")
    camera_to_acescg = XYZ_D50_TO_ACESCG @ camera_to_xyz
    return DngColorTransform(
        camera_to_xyz_d50=camera_to_xyz,
        camera_to_acescg=camera_to_acescg,
        color_path=color_path,
        profile_weight1=weight1,
        estimated_temperature=temperature,
    )


def convert_to_acescg(
    image: np.ndarray,
    metadata: DngColorMetadata,
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[np.ndarray, DngColorTransform]:
    source = np.asarray(image)
    if source.ndim != 3 or source.shape[2] != 3:
        raise DngColorError("DNG color conversion requires an H×W×3 image.")
    transform = build_color_transform(metadata)
    black = _broadcast_level(metadata.black_level, 0.0, "BlackLevel")
    if metadata.white_level is None:
        if np.issubdtype(source.dtype, np.integer):
            white = np.full(3, np.iinfo(source.dtype).max, dtype=np.float64)
        else:
            white = np.ones(3, dtype=np.float64)
    else:
        white = _broadcast_level(metadata.white_level, 1.0, "WhiteLevel")
    scale = white - black
    if np.any(scale <= 0) or not np.all(np.isfinite(scale)):
        raise DngColorError("WhiteLevel must be finite and greater than BlackLevel.")
    exposure = np.float32(2.0 ** float(metadata.baseline_exposure))
    output = np.empty(source.shape, dtype=np.float32)
    matrix = transform.camera_to_acescg.astype(np.float32)
    black32 = black.astype(np.float32)
    inverse_scale32 = (1.0 / scale).astype(np.float32)
    for start in range(0, source.shape[0], rows):
        if cancelled is not None and cancelled():
            raise DngImportCancelled("Experimental DNG import cancelled")
        end = min(source.shape[0], start + rows)
        camera = np.asarray(source[start:end], dtype=np.float32)
        camera = (camera - black32) * inverse_scale32
        output[start:end] = (camera @ matrix.T) * exposure
    return output, transform


def chromatic_adaptation_matrix(source_white: np.ndarray, destination_white: np.ndarray) -> np.ndarray:
    source = _vector(source_white, "source white")
    destination = _vector(destination_white, "destination white")
    source_cone = BRADFORD @ source
    destination_cone = BRADFORD @ destination
    if np.any(np.abs(source_cone) < 1e-12):
        raise DngColorError("Chromatic adaptation source white is singular.")
    return np.linalg.inv(BRADFORD) @ np.diag(destination_cone / source_cone) @ BRADFORD


def reciprocal_temperature_weight(temperature: float, temperature1: float, temperature2: float) -> float:
    if min(temperature, temperature1, temperature2) <= 0:
        raise DngColorError("Profile temperatures must be positive.")
    denominator = (1.0 / temperature1) - (1.0 / temperature2)
    if abs(denominator) < 1e-12:
        return 1.0
    return float(np.clip(((1.0 / temperature) - (1.0 / temperature2)) / denominator, 0.0, 1.0))


def _solve_profile_temperature(
    cm1: np.ndarray,
    cm2: np.ndarray,
    illuminant1: int,
    illuminant2: int,
    neutral: np.ndarray,
    analog: np.ndarray,
    cc1_value: np.ndarray | None,
    cc2_value: np.ndarray | None,
) -> tuple[float, float]:
    if illuminant1 not in ILLUMINANT_TEMPERATURES or illuminant2 not in ILLUMINANT_TEMPERATURES:
        raise DngColorError("Dual-illuminant interpolation requires supported calibration illuminants.")
    t1 = ILLUMINANT_TEMPERATURES[illuminant1]
    t2 = ILLUMINANT_TEMPERATURES[illuminant2]
    cc1 = _matrix_or_identity(cc1_value, "CameraCalibration1")
    cc2 = _matrix_or_identity(cc2_value, "CameraCalibration2")
    temperature = np.sqrt(t1 * t2)
    for _ in range(30):
        weight = reciprocal_temperature_weight(temperature, t1, t2)
        xyz_to_camera = np.diag(analog) @ _interpolate(cc1, cc2, weight) @ _interpolate(cm1, cm2, weight)
        _validate_invertible(xyz_to_camera, "dual-illuminant ColorMatrix")
        white = np.linalg.solve(xyz_to_camera, neutral)
        xy = _xyz_to_xy(white)
        solved = float(np.clip(_xy_to_cct(xy), min(t1, t2), max(t1, t2)))
        if abs(solved - temperature) < 0.1:
            temperature = solved
            break
        temperature = (temperature + solved) * 0.5
    return temperature, reciprocal_temperature_weight(temperature, t1, t2)


def _xyz_to_xy(xyz: np.ndarray) -> np.ndarray:
    total = float(np.sum(xyz))
    if not np.isfinite(total) or total <= 0:
        raise DngColorError("DNG neutral produced an invalid chromaticity.")
    return np.asarray([xyz[0] / total, xyz[1] / total], dtype=np.float64)


def _xy_to_cct(xy: np.ndarray) -> float:
    # McCamy's cubic is used only to solve the profile interpolation temperature;
    # the final white adaptation is calculated from the matrix-derived XYZ white.
    x, y = xy
    denominator = y - 0.1858
    if abs(denominator) < 1e-9:
        return 6500.0
    n = (x - 0.3320) / denominator
    return float(-449.0 * n**3 + 3525.0 * n**2 - 6823.3 * n + 5520.33)


def _matrix(value: np.ndarray | None, name: str) -> np.ndarray:
    if value is None:
        raise DngColorError(f"{name} is required.")
    result = np.asarray(value, dtype=np.float64)
    if result.size != 9:
        raise DngColorError(f"{name} must contain nine values.")
    result = result.reshape(3, 3)
    if not np.all(np.isfinite(result)):
        raise DngColorError(f"{name} must be finite.")
    return result


def _matrix_or_identity(value: np.ndarray | None, name: str) -> np.ndarray:
    return np.eye(3, dtype=np.float64) if value is None else _matrix(value, name)


def _vector(value: np.ndarray, name: str) -> np.ndarray:
    result = np.asarray(value, dtype=np.float64).reshape(-1)
    if result.size != 3 or not np.all(np.isfinite(result)):
        raise DngColorError(f"{name} must contain three finite values.")
    return result


def _broadcast_level(value: np.ndarray | None, default: float, name: str) -> np.ndarray:
    result = np.asarray(default if value is None else value, dtype=np.float64).reshape(-1)
    if result.size == 1:
        result = np.repeat(result, 3)
    if result.size != 3 or not np.all(np.isfinite(result)):
        raise DngColorError(f"{name} must be a finite scalar or three-channel value.")
    return result


def _interpolate(first: np.ndarray, second: np.ndarray, weight1: float) -> np.ndarray:
    return first * weight1 + second * (1.0 - weight1)


def _validate_invertible(matrix: np.ndarray, name: str) -> None:
    condition = float(np.linalg.cond(matrix))
    if not np.isfinite(condition) or condition > 1e10:
        raise DngColorError(f"{name} is singular or ill-conditioned.")
