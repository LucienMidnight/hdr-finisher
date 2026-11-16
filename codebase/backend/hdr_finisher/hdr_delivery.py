"""Read-only validation of decoded HDR delivery peaks."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .hdr_ceiling import ENCODING_ALLOWANCE, decoded_channel_nits

def decoded_hdr_peak_nits(path: Path, format_name: str) -> float:
    """Read maximum BT.2020 channel nits, not the metadata content peak.

    All three import decoders normalize linear ACEScg to 0.18 == 203 nits.
    Return the observed value without subtracting the encoding allowance.
    """
    # Use the identical float32 nits boundary as mandatory encoder validation.
    # Reducing first and converting a Python float instead introduces a second,
    # float64 rounding rule at exactly the target.
    return float(np.max(decoded_channel_nits(path, format_name)))


def check_decoded_hdr_ceiling(path: Path, format_name: str, target_nits: float) -> float:
    """Reject any decoded pixel above the target.

    This read-only check does not correct encoders or alter delivered pixels.
    The per-channel check also bounds BT.2020 luminance.
    """
    if not np.isfinite(target_nits) or target_nits <= 0:
        raise ValueError("HDR delivery target must be finite and positive.")
    peak = decoded_hdr_peak_nits(path, format_name)
    if peak > target_nits * (1 + ENCODING_ALLOWANCE):
        raise ValueError(f"Decoded HDR peak {peak:.3f} nits exceeds {target_nits:g} nits.")
    return peak
