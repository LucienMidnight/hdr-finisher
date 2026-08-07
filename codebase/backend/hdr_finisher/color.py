from __future__ import annotations

from typing import Any

import numpy as np
from colour import RGB_COLOURSPACES
from colour.models import RGB_to_RGB, eotf_BT2100_HLG, eotf_ST2084


ACESCG_COLOURSPACE = "ACEScg"
SRGB_COLOURSPACE = "sRGB"
BT2020_COLOURSPACE = "ITU-R BT.2020"
DISPLAY_P3_COLOURSPACE = "Display P3"


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
    converted = RGB_to_RGB(
        image.astype(np.float32, copy=False),
        RGB_COLOURSPACES[ACESCG_COLOURSPACE],
        RGB_COLOURSPACES[SRGB_COLOURSPACE],
        chromatic_adaptation_transform="CAT02",
    )
    return np.asarray(converted, dtype=np.float32)


def acescg_to_linear_bt2020(image: np.ndarray) -> np.ndarray:
    converted = RGB_to_RGB(
        image.astype(np.float32, copy=False),
        RGB_COLOURSPACES[ACESCG_COLOURSPACE],
        RGB_COLOURSPACES[BT2020_COLOURSPACE],
        chromatic_adaptation_transform="CAT02",
    )
    return np.asarray(converted, dtype=np.float32)


def linear_srgb_to_acescg(image: np.ndarray) -> np.ndarray:
    converted = RGB_to_RGB(
        image.astype(np.float32, copy=False),
        RGB_COLOURSPACES[SRGB_COLOURSPACE],
        RGB_COLOURSPACES[ACESCG_COLOURSPACE],
        chromatic_adaptation_transform="CAT02",
    )
    return np.asarray(converted, dtype=np.float32)


def linear_bt2020_to_acescg(image: np.ndarray) -> np.ndarray:
    converted = RGB_to_RGB(
        image.astype(np.float32, copy=False),
        RGB_COLOURSPACES[BT2020_COLOURSPACE],
        RGB_COLOURSPACES[ACESCG_COLOURSPACE],
        chromatic_adaptation_transform="CAT02",
    )
    return np.asarray(converted, dtype=np.float32)


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


def normalize_to_acescg(image: np.ndarray, source_color_space: str | None = None, transfer_function: str | None = None) -> np.ndarray:
    sanitized = sanitize_array(image)
    transfer = _canonical_transfer_function(transfer_function)

    # Do not apply an irreversible gamut or transfer transform when the source
    # primaries are explicitly unknown. PQ and HLG are standardized on BT.2020
    # in the supported import paths, so those remain safe to normalize.
    if source_color_space is None and transfer not in {"PQ", "HLG", "sRGB"}:
        return sanitized

    colourspace = _canonical_colourspace(source_color_space, transfer)

    if transfer == "PQ":
        return _pq_bt2020_to_acescg(sanitized)
    if transfer == "HLG":
        return _hlg_bt2020_to_acescg(sanitized)
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


def _pq_bt2020_to_acescg(image: np.ndarray) -> np.ndarray:
    encoded = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    luminance_nits = eotf_ST2084(encoded)
    linear_bt2020 = (luminance_nits / 100.0) * 0.18
    converted = RGB_to_RGB(
        linear_bt2020,
        BT2020_COLOURSPACE,
        ACESCG_COLOURSPACE,
        chromatic_adaptation_transform="CAT02",
    )
    return sanitize_array(converted)


def _hlg_bt2020_to_acescg(image: np.ndarray) -> np.ndarray:
    encoded = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    luminance_nits = eotf_BT2100_HLG(encoded, L_B=0, L_W=1000)
    linear_bt2020 = (luminance_nits / 100.0) * 0.18
    converted = RGB_to_RGB(
        linear_bt2020,
        BT2020_COLOURSPACE,
        ACESCG_COLOURSPACE,
        chromatic_adaptation_transform="CAT02",
    )
    return sanitize_array(converted)
