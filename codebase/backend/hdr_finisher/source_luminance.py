from __future__ import annotations

from typing import Any

from .models import SourceImageDescriptor, SourceLuminanceDescriptor


def describe_source_luminance(
    source: SourceImageDescriptor,
    metadata: dict[str, Any],
    *,
    has_authored_sdr: bool,
) -> SourceLuminanceDescriptor:
    transfer = str(metadata.get("transfer_function") or source.transfer_function or "").upper()
    assumptions: list[str] = [str(item) for item in metadata.get("luminance_assumptions", [])]
    source_reference = _optional_float(
        metadata.get("source_reference_white_nits", metadata.get("reference_white_nits"))
    )
    source_peak = _optional_float(metadata.get("source_peak_nits", metadata.get("nominal_peak_nits")))

    if transfer == "PQ":
        semantics, canonical_transfer = "absolute", "PQ"
        assumptions.append("ST 2084 decoded to absolute nits before project normalization.")
    elif transfer == "HLG":
        semantics, canonical_transfer = "display_relative", "HLG"
        assumptions.append("HLG nominal peak/system transform is explicit import state, not project reference white.")
    elif metadata.get("jpeg_ultrahdr"):
        semantics, canonical_transfer = "reference_relative", "linear"
        source_reference = source_reference or 203.0
        assumptions.append("libultrahdr linear interface convention: 1.0 equals 203 nits.")
    elif metadata.get("avif_gain_map"):
        semantics, canonical_transfer = "display_relative", "linear"
        assumptions.append("ISO gain-map reconstruction follows base/alternate headroom metadata.")
    elif transfer in {"SRGB", "BT.709", "BT709"} or source.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}:
        semantics, canonical_transfer = "reference_relative", "SDR"
        assumptions.append("Ordinary SDR white is placed by the selected project workflow without a second scale.")
    elif transfer in {"LINEAR", "ACESCG"}:
        semantics, canonical_transfer = "scene_relative", "linear"
        assumptions.append("Untagged scene-linear pixels carry no inferable absolute luminance.")
    else:
        semantics, canonical_transfer = "scene_relative", "unknown"
        assumptions.append("No absolute source luminance could be inferred.")

    hlg_reference = str(metadata.get("hlg_reference") or "unknown").lower()
    if hlg_reference not in {"display_referred", "scene_referred"}:
        hlg_reference = "unknown"
    hlg_peak = _optional_float(metadata.get("hlg_nominal_peak_nits"))
    if canonical_transfer == "HLG" and hlg_peak is None:
        hlg_peak = 1000.0
        assumptions.append("Missing HLG nominal peak: explicit 1000-nit fallback used by the current import path.")

    return SourceLuminanceDescriptor(
        luminance_semantics=semantics,
        transfer_function=canonical_transfer,
        source_reference_white_nits=source_reference,
        source_peak_nits=source_peak,
        hlg_reference=hlg_reference,
        hlg_nominal_peak_nits=hlg_peak,
        sdr_rendition="authored" if has_authored_sdr else "none",
        assumptions=list(dict.fromkeys(assumptions)),
    )


def _optional_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
