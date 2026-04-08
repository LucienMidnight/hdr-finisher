from __future__ import annotations

from typing import Any

import numpy as np
from colour import RGB_COLOURSPACES
from colour.models import RGB_to_RGB, eotf_BT2100_HLG, eotf_ST2084


ACESCG_COLOURSPACE = "ACEScg"
SRGB_COLOURSPACE = "sRGB"
BT2020_COLOURSPACE = "ITU-R BT.2020"
DISPLAY_P3_COLOURSPACE = "Display P3"


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
    if suffix == ".exr":
        return None
    return "sRGB"


def normalize_to_acescg(image: np.ndarray, source_color_space: str | None = None, transfer_function: str | None = None) -> np.ndarray:
    sanitized = sanitize_array(image)
    transfer = _canonical_transfer_function(transfer_function)
    colourspace = _canonical_colourspace(source_color_space, transfer)

    if transfer == "PQ":
        return _pq_bt2020_to_acescg(sanitized)
    if transfer == "HLG":
        return _hlg_bt2020_to_acescg(sanitized)
    if colourspace == ACESCG_COLOURSPACE:
        return sanitized
    if colourspace in RGB_COLOURSPACES:
        apply_cctf_decoding = colourspace == SRGB_COLOURSPACE and transfer is None
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
