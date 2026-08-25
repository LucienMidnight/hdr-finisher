from __future__ import annotations

from typing import Any, Callable

import numpy as np

from .color import compute_peak_stops, detect_transfer_function
from .models import HDRAnalysis, HDRClassification, SourceLatitude


def classify_hdr(
    image: np.ndarray,
    metadata: dict[str, Any],
    suffix: str,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> HDRAnalysis:
    peak = float(np.max(image)) if image.size else 0.0
    if image.size and image.ndim >= 3 and image.shape[-1] >= 3:
        peak_luma, robust_peak_luma = _luma_peaks(image, cancelled=cancelled)
        robust_peak = _robust_channel_peak(image)
    else:
        peak_luma = peak
        robust_peak_luma = peak
        robust_peak = peak
    transfer = detect_transfer_function(metadata, suffix)
    linear_hint = transfer == "LINEAR"
    encoded_hint = transfer in {"PQ", "HLG"}
    needs_override = bool(metadata.get("needs_color_override"))
    developed_camera_raw = bool(
        metadata.get("raw_input") and metadata.get("decoder_normalized_to_acescg")
    )
    heif_aux_types = metadata.get("heif_aux_types") or []
    gainmap_applied = bool(
        metadata.get("apple_hdr_gainmap_applied") or metadata.get("gain_map_applied")
    )

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
    elif suffix in {".jpg", ".jpeg"} and not encoded_hint:
        # Baseline JPEG samples are display-referred SDR. Converting saturated
        # sRGB colors to ACEScg can create tiny matrix excursions above 1.0;
        # those are gamut math, not HDR headroom. Ultra HDR JPEGs take the
        # explicit gain-map branch above.
        classification = HDRClassification.SDR_ONLY
        badge = "No HDR gain map or transfer metadata detected. Treating this JPEG as SDR."
        latitude = SourceLatitude.MEDIUM
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
    elif linear_hint and developed_camera_raw:
        classification = HDRClassification.HDR_LINEAR_UNCONFIRMED
        badge = (
            "Camera RAW developed to scene-linear ACEScg. "
            f"Current source peak is {peak:.3f}; no color interpretation override is required."
        )
        needs_override = False
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
        robust_peak_linear=robust_peak,
        peak_luma_linear=peak_luma,
        robust_peak_luma_linear=robust_peak_luma,
        peak_stops_above_diffuse_white=compute_peak_stops(image),
        source_latitude=latitude,
        needs_color_override=needs_override,
        badge_message=badge,
    )


def _luma_peaks(
    image: np.ndarray,
    *,
    maximum_quantile_samples: int = 2_000_000,
    rows: int = 256,
    cancelled: Callable[[], bool] | None = None,
) -> tuple[float, float]:
    """Return exact peak luma and a bounded-memory robust percentile."""
    coefficients = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32)
    height, width = image.shape[:2]
    pixels = height * width
    if pixels <= maximum_quantile_samples:
        luma = np.tensordot(image[..., :3], coefficients, axes=([-1], [0]))
        np.maximum(luma, np.float32(0.0), out=luma)
        return float(np.max(luma)), float(np.quantile(luma, 0.9999))

    stride = max(1, int(np.ceil(np.sqrt(pixels / maximum_quantile_samples))))
    sample = image[::stride, ::stride, :3]
    sample_luma = np.tensordot(sample, coefficients, axes=([-1], [0]))
    np.maximum(sample_luma, np.float32(0.0), out=sample_luma)
    robust_peak = float(np.quantile(sample_luma, 0.9999))

    exact_peak = 0.0
    strip_rows = max(1, int(rows))
    for start in range(0, height, strip_rows):
        if cancelled is not None and cancelled():
            raise RuntimeError("Import cancelled")
        stop = min(start + strip_rows, height)
        strip_luma = np.tensordot(
            image[start:stop, :, :3], coefficients, axes=([-1], [0])
        )
        exact_peak = max(exact_peak, float(np.max(strip_luma, initial=0.0)))
    return exact_peak, robust_peak


def _robust_channel_peak(
    image: np.ndarray,
    *,
    maximum_quantile_samples: int = 2_000_000,
) -> float:
    """Return a bounded-memory robust peak of the brightest RGB channel."""
    height, width = image.shape[:2]
    pixels = height * width
    stride = max(1, int(np.ceil(np.sqrt(pixels / maximum_quantile_samples))))
    sample = image[::stride, ::stride, :3]
    channel_peak = np.max(sample, axis=-1)
    np.maximum(channel_peak, np.float32(0.0), out=channel_peak)
    return float(np.quantile(channel_peak, 0.9999))
