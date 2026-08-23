from __future__ import annotations

from typing import Any, Callable
import warnings

import numpy as np

# HDR Finisher does not exercise colour-science's optional plotting or SciPy
# APIs. Suppress only those two import-time capability notices; all other
# colour warnings remain visible because they can signal real color errors.
with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        message=r'"SciPy" related API features are not available:.*',
        module=r"colour\.utilities\.verbose",
    )
    warnings.filterwarnings(
        "ignore",
        message=r'"Matplotlib" related API features are not available:.*',
        module=r"colour\.utilities\.verbose",
    )
    from colour import RGB_COLOURSPACES
    from colour.models import (
        RGB_to_RGB,
        eotf_BT2100_HLG,
        eotf_ST2084,
        matrix_RGB_to_RGB,
        oetf_inverse_BT709,
    )


ACESCG_COLOURSPACE = "ACEScg"
SRGB_COLOURSPACE = "sRGB"
BT2020_COLOURSPACE = "ITU-R BT.2020"
DISPLAY_P3_COLOURSPACE = "Display P3"
ACES2065_COLOURSPACE = "ACES2065-1"


def _fixed_linear_rgb_matrix(
    source_name: str,
    target_name: str,
    chromatic_adaptation_transform: str | None,
) -> np.ndarray:
    """Build the same row-vector matrix used by colour-science's RGB_to_RGB.

    The four transforms below are fixed linear conversions. Caching their
    matrices avoids the generic domain/range and axis-normalization work on
    every full-resolution preview and export while retaining the exact
    colour-science transform coefficients.
    """
    column_matrix = matrix_RGB_to_RGB(
        RGB_COLOURSPACES[source_name],
        RGB_COLOURSPACES[target_name],
        chromatic_adaptation_transform,
    )
    return np.asarray(column_matrix.T, dtype=np.float64)


_ACESCG_TO_LINEAR_SRGB = _fixed_linear_rgb_matrix(ACESCG_COLOURSPACE, SRGB_COLOURSPACE, "CAT02")
_ACESCG_TO_LINEAR_BT2020 = _fixed_linear_rgb_matrix(ACESCG_COLOURSPACE, BT2020_COLOURSPACE, "CAT02")
_LINEAR_SRGB_TO_ACESCG = _fixed_linear_rgb_matrix(SRGB_COLOURSPACE, ACESCG_COLOURSPACE, "CAT02")
_LINEAR_BT2020_TO_ACESCG = _fixed_linear_rgb_matrix(BT2020_COLOURSPACE, ACESCG_COLOURSPACE, "CAT02")
_ACES2065_TO_ACESCG = _fixed_linear_rgb_matrix(ACES2065_COLOURSPACE, ACESCG_COLOURSPACE, None)


def _apply_fixed_linear_rgb_matrix(image: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    source = image.astype(np.float32, copy=False)
    return np.asarray(np.matmul(source, matrix), dtype=np.float32)


def rgb_primaries_adjustment_matrix(
    red_hue: float = 0.0,
    red_purity: float = 0.0,
    green_hue: float = 0.0,
    green_purity: float = 0.0,
    blue_hue: float = 0.0,
    blue_purity: float = 0.0,
    tint_hue: float = 0.0,
    tint_purity: float = 0.0,
) -> np.ndarray:
    """Build a darktable-style primary adjustment in the ACEScg xy gamut.

    Hue rotates a primary's white-to-primary ray and purity scales its distance
    to the ACEScg gamut boundary. Tint moves the achromatic point in the same
    geometry. The returned column-vector matrix is identity at all defaults.
    """
    colourspace = RGB_COLOURSPACES[ACESCG_COLOURSPACE]
    primaries = np.asarray(colourspace.primaries, dtype=np.float64)
    white = np.asarray(colourspace.whitepoint, dtype=np.float64)
    hue_values = (red_hue, green_hue, blue_hue)
    purity_values = (red_purity, green_purity, blue_purity)
    custom_primaries = np.stack(
        [
            _rotate_scale_xy_primary(
                white,
                primaries,
                primaries[index],
                float(hue_values[index]),
                max(0.01, 1.0 + float(purity_values[index]) / 100.0),
            )
            for index in range(3)
        ]
    )
    custom_white = _rotate_scale_xy_primary(
        white,
        primaries,
        primaries[0],
        float(tint_hue),
        np.clip(float(tint_purity) / 100.0, 0.0, 0.99),
    )
    base_rgb_to_xyz = np.asarray(colourspace.matrix_RGB_to_XYZ, dtype=np.float64)
    try:
        custom_rgb_to_xyz = _rgb_to_xyz_matrix(custom_primaries, custom_white)
        adjustment = np.linalg.solve(base_rgb_to_xyz, custom_rgb_to_xyz)
    except np.linalg.LinAlgError:
        return np.eye(3, dtype=np.float32)
    if not np.all(np.isfinite(adjustment)) or np.max(np.abs(adjustment)) > 64.0:
        return np.eye(3, dtype=np.float32)
    return adjustment.astype(np.float32)


def _rotate_scale_xy_primary(
    white: np.ndarray,
    gamut: np.ndarray,
    reference_primary: np.ndarray,
    hue_degrees: float,
    purity_scale: float,
) -> np.ndarray:
    base_direction = reference_primary - white
    angle = np.arctan2(base_direction[1], base_direction[0]) + np.deg2rad(hue_degrees)
    direction = np.array([np.cos(angle), np.sin(angle)], dtype=np.float64)
    edge_distance = _ray_triangle_distance(white, direction, gamut)
    return white + direction * edge_distance * purity_scale


def _ray_triangle_distance(origin: np.ndarray, direction: np.ndarray, triangle: np.ndarray) -> float:
    distances: list[float] = []
    for index in range(3):
        start = triangle[index]
        edge = triangle[(index + 1) % 3] - start
        # origin + t * direction = start + u * edge
        system = np.column_stack((direction, -edge))
        determinant = float(np.linalg.det(system))
        if abs(determinant) < 1e-12:
            continue
        distance, edge_position = np.linalg.solve(system, start - origin)
        if distance >= -1e-9 and -1e-9 <= edge_position <= 1.0 + 1e-9:
            distances.append(max(0.0, float(distance)))
    if not distances:
        return float(np.linalg.norm(triangle[0] - origin))
    return min(distances)


def _rgb_to_xyz_matrix(primaries: np.ndarray, white: np.ndarray) -> np.ndarray:
    unscaled = np.stack(
        [
            np.array([xy[0] / xy[1], 1.0, (1.0 - xy[0] - xy[1]) / xy[1]], dtype=np.float64)
            for xy in primaries
        ],
        axis=1,
    )
    white_xyz = np.array([white[0] / white[1], 1.0, (1.0 - white[0] - white[1]) / white[1]])
    scales = np.linalg.solve(unscaled, white_xyz)
    return unscaled @ np.diag(scales)


def acescg_to_linear_srgb(image: np.ndarray) -> np.ndarray:
    return _apply_fixed_linear_rgb_matrix(image, _ACESCG_TO_LINEAR_SRGB)


def acescg_to_linear_bt2020(image: np.ndarray) -> np.ndarray:
    return _apply_fixed_linear_rgb_matrix(image, _ACESCG_TO_LINEAR_BT2020)


def linear_srgb_to_acescg(image: np.ndarray) -> np.ndarray:
    return _apply_fixed_linear_rgb_matrix(image, _LINEAR_SRGB_TO_ACESCG)


def linear_bt2020_to_acescg(image: np.ndarray) -> np.ndarray:
    return _apply_fixed_linear_rgb_matrix(image, _LINEAR_BT2020_TO_ACESCG)


def aces2065_to_acescg(image: np.ndarray) -> np.ndarray:
    return sanitize_array(_apply_fixed_linear_rgb_matrix(image, _ACES2065_TO_ACESCG))


def sanitize_array(image: np.ndarray) -> np.ndarray:
    image = np.nan_to_num(image.astype(np.float32, copy=False), nan=0.0, posinf=65504.0, neginf=0.0)
    return np.clip(image, 0.0, None)


def detect_transfer_function(metadata: dict[str, Any], suffix: str) -> str | None:
    text = " ".join(str(value).lower() for value in metadata.values() if value is not None)
    if "pq" in text or "smpte2084" in text:
        return "PQ"
    if "hlg" in text or "arib-std-b67" in text:
        return "HLG"
    if "linear" in text or suffix in {".exr", ".hdr", ".pfm"}:
        return "LINEAR"
    if "acescg" in text:
        return "ACEScg"
    return None


def detect_color_space(metadata: dict[str, Any], suffix: str) -> str | None:
    explicit = metadata.get("color_space")
    if explicit and str(explicit).strip().lower() not in {"unknown", "none", ""}:
        return str(explicit)

    chromaticities_name = metadata.get("chromaticities_name")
    if chromaticities_name:
        return str(chromaticities_name)

    text = " ".join(str(value).lower() for value in metadata.values() if value is not None)
    if "acescg" in text:
        return "ACEScg"
    if "rec.2020" in text or "bt.2020" in text or "bt2020" in text:
        return "BT.2020"
    if "display p3" in text:
        return "Display P3"
    if "srgb" in text or "rec.709" in text or "bt.709" in text or "scene-linear" in text:
        return "sRGB"
    if suffix == ".exr" or metadata.get("needs_color_override"):
        return None
    return "sRGB"


def normalize_to_acescg(image: np.ndarray, source_color_space: str | None = None, transfer_function: str | None = None, reference_white_nits: int = 203) -> np.ndarray:
    sanitized = sanitize_array(image)
    transfer = _canonical_transfer_function(transfer_function)

    # Do not apply an irreversible gamut or transfer transform when the source
    # primaries are explicitly unknown. PQ and HLG are standardized on BT.2020
    # in the supported import paths, so those remain safe to normalize.
    if source_color_space is None and transfer not in {"PQ", "HLG", "sRGB", "BT.709"}:
        return sanitized

    colourspace = _canonical_colourspace(source_color_space, transfer)

    if transfer == "PQ":
        return _pq_bt2020_to_acescg(sanitized, reference_white_nits)
    if transfer == "HLG":
        return _hlg_bt2020_to_acescg(sanitized, reference_white_nits)
    if transfer == "BT.709":
        sanitized = sanitize_array(oetf_inverse_BT709(np.clip(sanitized, 0.0, 1.0)))
        transfer = "LINEAR"
    if colourspace == ACESCG_COLOURSPACE:
        return sanitized
    if colourspace in RGB_COLOURSPACES:
        apply_cctf_decoding = transfer == "sRGB" or (
            transfer is None and colourspace in {SRGB_COLOURSPACE, DISPLAY_P3_COLOURSPACE}
        )
        converted = RGB_to_RGB(
            sanitized,
            colourspace,
            ACESCG_COLOURSPACE,
            chromatic_adaptation_transform="CAT02",
            apply_cctf_decoding=apply_cctf_decoding,
        )
        return sanitize_array(converted)
    return sanitized


def normalize_to_acescg_bounded(
    image: np.ndarray,
    source_color_space: str | None = None,
    transfer_function: str | None = None,
    reference_white_nits: int = 203,
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    """Normalize into a writable float32 buffer with strip-bounded temporaries."""
    result = image.astype(np.float32, copy=False)
    if not result.flags.writeable:
        result = result.copy()
    strip_rows = max(1, int(rows))
    for start in range(0, result.shape[0], strip_rows):
        if cancelled is not None and cancelled():
            raise RuntimeError("Import cancelled")
        stop = min(start + strip_rows, result.shape[0])
        result[start:stop] = normalize_to_acescg(
            result[start:stop], source_color_space, transfer_function, reference_white_nits
        )
    return result


def transform_float32_bounded(
    image: np.ndarray,
    transform: Callable[[np.ndarray], np.ndarray],
    *,
    rows: int = 128,
    cancelled: Callable[[], bool] | None = None,
) -> np.ndarray:
    """Apply a color transform in-place with memory independent of image height."""
    result = image.astype(np.float32, copy=False)
    if not result.flags.writeable:
        result = result.copy()
    strip_rows = max(1, int(rows))
    for start in range(0, result.shape[0], strip_rows):
        if cancelled is not None and cancelled():
            raise RuntimeError("Import cancelled")
        stop = min(start + strip_rows, result.shape[0])
        result[start:stop] = transform(result[start:stop])
    return result


def compute_peak_stops(image: np.ndarray) -> float | None:
    peak = float(np.max(image)) if image.size else 0.0
    if peak <= 0.18:
        return 0.0
    return float(np.log2(peak / 0.18))


def _canonical_transfer_function(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if "pq" in text or "2084" in text:
        return "PQ"
    if "hlg" in text or "b67" in text:
        return "HLG"
    if "acescg" in text:
        return "ACEScg"
    if "linear" in text:
        return "LINEAR"
    if "srgb" in text:
        return "sRGB"
    if "bt.709" in text or "bt709" in text or "rec.709" in text or "rec709" in text:
        return "BT.709"
    return None


def _canonical_colourspace(value: str | None, transfer: str | None) -> str:
    if value is None:
        if transfer in {"PQ", "HLG"}:
            return BT2020_COLOURSPACE
        return SRGB_COLOURSPACE

    text = str(value).strip().lower()
    if "scene-linear rec.2020" in text or "linear rec.2020" in text:
        return BT2020_COLOURSPACE
    if "scene-linear srgb" in text or "linear srgb" in text or "linear rec.709" in text or "scene-linear rec.709" in text:
        return SRGB_COLOURSPACE
    if "acescg" in text:
        return ACESCG_COLOURSPACE
    if "aces2065" in text or "ap0" in text:
        return "ACES2065-1"
    if "display p3" in text or text == "p3":
        return DISPLAY_P3_COLOURSPACE
    if "2020" in text or "bt.2020" in text or "bt2020" in text or "rec.2020" in text:
        return BT2020_COLOURSPACE
    if "709" in text or "srgb" in text or text in {"rgb", "scene-linear", "unknown", "2"}:
        return SRGB_COLOURSPACE
    return SRGB_COLOURSPACE


def _pq_bt2020_to_acescg(image: np.ndarray, reference_white_nits: int = 203) -> np.ndarray:
    encoded = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    luminance_nits = eotf_ST2084(encoded)
    from .color_context import nits_to_scene_linear
    linear_bt2020 = nits_to_scene_linear(luminance_nits, reference_white_nits)
    converted = RGB_to_RGB(
        linear_bt2020,
        BT2020_COLOURSPACE,
        ACESCG_COLOURSPACE,
        chromatic_adaptation_transform="CAT02",
    )
    return sanitize_array(converted)


def _hlg_bt2020_to_acescg(image: np.ndarray, reference_white_nits: int = 203, nominal_peak_nits: float = 1000.0) -> np.ndarray:
    encoded = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    luminance_nits = eotf_BT2100_HLG(encoded, L_B=0, L_W=nominal_peak_nits)
    from .color_context import nits_to_scene_linear
    linear_bt2020 = nits_to_scene_linear(luminance_nits, reference_white_nits)
    converted = RGB_to_RGB(
        linear_bt2020,
        BT2020_COLOURSPACE,
        ACESCG_COLOURSPACE,
        chromatic_adaptation_transform="CAT02",
    )
    return sanitize_array(converted)
