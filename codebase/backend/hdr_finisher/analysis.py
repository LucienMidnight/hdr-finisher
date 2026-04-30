from __future__ import annotations

from typing import Any

import numpy as np

from .color import compute_peak_stops, detect_transfer_function
from .models import HDRAnalysis, HDRClassification, SourceLatitude


def classify_hdr(image: np.ndarray, metadata: dict[str, Any], suffix: str) -> HDRAnalysis:
    peak = float(np.max(image)) if image.size else 0.0
    transfer = detect_transfer_function(metadata, suffix)
    linear_hint = transfer == "LINEAR"
    encoded_hint = transfer in {"PQ", "HLG"}
    needs_override = bool(metadata.get("needs_color_override"))
    heif_aux_types = metadata.get("heif_aux_types") or []
    gainmap_applied = bool(metadata.get("apple_hdr_gainmap_applied"))

    if gainmap_applied and peak > 1.0:
        classification = HDRClassification.HDR_TRUE
        badge = f"Apple HDR gain map applied, peak {compute_peak_stops(image):.2f} stops above diffuse white."
        latitude = SourceLatitude.MEDIUM
    elif suffix in {".heic", ".heif"} and heif_aux_types:
        classification = HDRClassification.HDR_ENCODED
        badge = (
            "HEIC auxiliary image data detected. HDR content is likely present, "
            "but auxiliary gain-map application is not implemented yet."
        )
        needs_override = True
        latitude = SourceLatitude.NARROW
    elif peak > 1.0:
        classification = HDRClassification.HDR_TRUE
        badge = f"True HDR detected, peak {compute_peak_stops(image):.2f} stops above diffuse white."
        latitude = SourceLatitude.WIDE
        if needs_override:
            badge += " Source color space is ambiguous; review source settings."
    elif encoded_hint:
        classification = HDRClassification.HDR_ENCODED
        badge = f"HDR encoded input detected via {transfer} metadata, peak linear value {peak:.3f}."
        latitude = SourceLatitude.WIDE
    elif linear_hint:
        classification = HDRClassification.HDR_LINEAR_UNCONFIRMED
        badge = "Scene-linear file detected with no values above 1.0. Confirm whether this should be treated as HDR."
        needs_override = True
        latitude = SourceLatitude.WIDE
    else:
        classification = HDRClassification.SDR_ONLY
        badge = "No HDR headroom or transfer metadata detected. Treating this file as SDR."
        latitude = SourceLatitude.NARROW if suffix in {".tif", ".tiff", ".heic", ".heif"} else SourceLatitude.MEDIUM
        if suffix in {".tif", ".tiff", ".heic", ".heif"}:
            needs_override = True

    return HDRAnalysis(
        classification=classification,
        peak_linear=peak,
        peak_stops_above_diffuse_white=compute_peak_stops(image),
        source_latitude=latitude,
        needs_color_override=needs_override,
        badge_message=badge,
    )
