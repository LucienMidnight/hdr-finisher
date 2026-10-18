"""Read-only validation of decoded HDR delivery peaks."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .color import acescg_to_linear_bt2020
from .color_context import scene_linear_to_nits

def decoded_hdr_peak_nits(path: Path, format_name: str) -> float:
    """Read maximum BT.2020 channel nits, not the metadata content peak.

    All three import decoders normalize linear ACEScg to 0.18 == 203 nits.
    This deliberately uses the decoder's observed value with zero upward
    allowance: any rounding is absorbed by downward encoder headroom.
    """
    if format_name == "jpeg_ultrahdr":
        from .gainmap_decoders import decode_ultrahdr_jpeg
        image, _, _ = decode_ultrahdr_jpeg(path)
    elif format_name == "avif_gain_map":
        from .gainmap_decoders import decode_avif
        image, _, _ = decode_avif(path)
    elif format_name == "jpegxl_hdr":
        from .jpegxl import decode_jpegxl
        image, _ = decode_jpegxl(path)
    else:
        raise ValueError(f"Unsupported HDR ceiling format: {format_name}")
    if image.size == 0 or not np.all(np.isfinite(image)):
        raise ValueError("HDR validation decoded empty or non-finite pixels.")
    # Bound colour-conversion scratch for full-resolution deliveries.
    peak = 0.0
    for first in range(0, image.shape[0], 256):
        rgb = acescg_to_linear_bt2020(image[first:first + 256, :, :3])
        peak = max(peak, float(np.max(rgb)))
    return float(scene_linear_to_nits(peak, 203))


def check_decoded_hdr_ceiling(path: Path, format_name: str, target_nits: float) -> float:
    """Reject any decoded over-target pixel; upward rounding allowance is zero.

    This read-only check does not correct encoders or alter delivered pixels.
    The per-channel check also bounds BT.2020 luminance.
    """
    if not np.isfinite(target_nits) or target_nits <= 0:
        raise ValueError("HDR delivery target must be finite and positive.")
    peak = decoded_hdr_peak_nits(path, format_name)
    if peak > target_nits:
        raise ValueError(f"Decoded HDR peak {peak:.3f} nits exceeds {target_nits:g} nits.")
    return peak
