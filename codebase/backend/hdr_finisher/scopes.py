from __future__ import annotations

import numpy as np

from .adjustments import apply_adjustments
from .models import AdjustmentState, HistogramChannel, PreviewKind, ScopeResponse


def build_histogram(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    bins: int = 64,
    sdr_reference_image: np.ndarray | None = None,
) -> ScopeResponse:
    processed = np.clip(apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image), 0.0, 1.0)
    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        hist, _ = np.histogram(processed[..., idx], bins=bins, range=(0.0, 1.0))
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))
    return ScopeResponse(preview_kind=kind, channels=channels)
