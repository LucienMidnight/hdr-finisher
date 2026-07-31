from __future__ import annotations

import numpy as np

from .adjustments import apply_adjustments
from .models import (
    AdjustmentState,
    HistogramChannel,
    PreviewKind,
    ScopeGuide,
    ScopeMode,
    ScopeResponse,
    ScopeStat,
)

HDR_GUIDES = [
    ScopeGuide(value=1.0, label="1 nit"),
    ScopeGuide(value=10.0, label="10"),
    ScopeGuide(value=25.0, label="25"),
    ScopeGuide(value=50.0, label="50"),
    ScopeGuide(value=100.0, label="100 white"),
    ScopeGuide(value=203.0, label="203 BT.2408"),
    ScopeGuide(value=400.0, label="400"),
    ScopeGuide(value=600.0, label="600"),
    ScopeGuide(value=1000.0, label="1000 peak"),
    ScopeGuide(value=2000.0, label="2000"),
    ScopeGuide(value=4000.0, label="4000 peak"),
]

SDR_GUIDES = [
    ScopeGuide(value=0.18, label="18%"),
    ScopeGuide(value=0.5, label="50%"),
    ScopeGuide(value=1.0, label="100%"),
]


def build_scope(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = None,
    waveform_columns: int = 512,
    sdr_reference_image: np.ndarray | None = None,
) -> ScopeResponse:
    processed = apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image)
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns)
    return _build_histogram(processed, kind, bins=bins or 256)


def build_scope_from_processed(
    processed: np.ndarray,
    kind: PreviewKind,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = None,
    waveform_columns: int = 512,
) -> ScopeResponse:
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns)
    return _build_histogram(processed, kind, bins=bins or 256)


def _build_histogram(processed: np.ndarray, kind: PreviewKind, bins: int) -> ScopeResponse:
    if kind == PreviewKind.HDR:
        return _build_hdr_histogram(processed, bins=bins)
    return _build_sdr_histogram(processed, bins=bins)


def _build_hdr_histogram(processed: np.ndarray, bins: int) -> ScopeResponse:
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, None)
    luminance_nits = _rgb_to_reference_nits(clipped)
    edges = _hdr_edges(bins)

    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        channel_nits = _channel_to_reference_nits(clipped[..., idx])
        hist, _ = np.histogram(np.clip(channel_nits, 1.0, 4000.0), bins=edges)
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))
    luma_hist, _ = np.histogram(np.clip(luminance_nits, 1.0, 4000.0), bins=edges)
    channels.append(HistogramChannel(name="Y", bins=luma_hist.astype(int).tolist()))

    return ScopeResponse(
        preview_kind=PreviewKind.HDR,
        scope_type="reference_nits_histogram",
        x_axis="reference_nits_log10",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=HDR_GUIDES,
        stats=_hdr_stats(luminance_nits),
        channels=channels,
    )


def _build_sdr_histogram(processed: np.ndarray, bins: int) -> ScopeResponse:
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, 1.0)
    edges = np.linspace(0.0, 1.0, bins + 1, dtype=np.float32)
    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        hist, _ = np.histogram(clipped[..., idx], bins=edges)
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))

    luma = 0.2126 * clipped[..., 0] + 0.7152 * clipped[..., 1] + 0.0722 * clipped[..., 2]
    luma_hist, _ = np.histogram(luma, bins=edges)
    channels.append(HistogramChannel(name="Y", bins=luma_hist.astype(int).tolist()))
    return ScopeResponse(
        preview_kind=PreviewKind.SDR,
        scope_type="normalized_histogram",
        x_axis="normalized",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=SDR_GUIDES,
        stats=_sdr_stats(luma),
        channels=channels,
    )


def _build_waveform(processed: np.ndarray, kind: PreviewKind, bins: int, columns: int) -> ScopeResponse:
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, None if kind == PreviewKind.HDR else 1.0)
    if kind == PreviewKind.HDR:
        edges = _hdr_edges(bins)
        channels = []
        luminance_nits = _rgb_to_reference_nits(clipped)
        for idx, name in enumerate(("R", "G", "B")):
            channel_nits = _channel_to_reference_nits(clipped[..., idx])
            grid = _waveform_grid(np.clip(channel_nits, 1.0, 4000.0), edges, columns)
            channels.append(HistogramChannel(name=name, bins=[], grid=grid))
        channels.append(HistogramChannel(name="Y", bins=[], grid=_waveform_grid(np.clip(luminance_nits, 1.0, 4000.0), edges, columns)))
        return ScopeResponse(
            preview_kind=PreviewKind.HDR,
            scope_type="reference_nits_waveform",
            x_axis="reference_nits_log10",
            bin_edges=[float(edge) for edge in edges.tolist()],
            guides=HDR_GUIDES,
            stats=_hdr_stats(luminance_nits),
            channels=channels,
        )

    edges = np.linspace(0.0, 1.0, bins + 1, dtype=np.float32)
    channels = []
    luma = 0.2126 * clipped[..., 0] + 0.7152 * clipped[..., 1] + 0.0722 * clipped[..., 2]
    for idx, name in enumerate(("R", "G", "B")):
        grid = _waveform_grid(clipped[..., idx], edges, columns)
        channels.append(HistogramChannel(name=name, bins=[], grid=grid))
    channels.append(HistogramChannel(name="Y", bins=[], grid=_waveform_grid(luma, edges, columns)))
    return ScopeResponse(
        preview_kind=PreviewKind.SDR,
        scope_type="normalized_waveform",
        x_axis="normalized",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=SDR_GUIDES,
        stats=_sdr_stats(luma),
        channels=channels,
    )


def _waveform_grid(values: np.ndarray, edges: np.ndarray, columns: int) -> list[list[int]]:
    height, width = values.shape[:2]
    output_columns = max(1, min(columns, width))
    column_edges = np.linspace(0, width, output_columns + 1, dtype=np.int32)
    grid = np.zeros((len(edges) - 1, output_columns), dtype=np.int32)

    for target_x in range(output_columns):
        start = int(column_edges[target_x])
        stop = max(start + 1, int(column_edges[target_x + 1]))
        column_values = values[:, start:stop].reshape(-1)
        hist, _ = np.histogram(column_values, bins=edges)
        grid[:, target_x] = hist.astype(np.int32)
    return grid.tolist()


def _hdr_edges(bins: int) -> np.ndarray:
    log_edges = np.linspace(np.log10(1.0), np.log10(4000.0), bins + 1, dtype=np.float32)
    return np.power(10.0, log_edges, dtype=np.float32)


def _hdr_stats(luminance_nits: np.ndarray) -> list[ScopeStat]:
    return [
        ScopeStat(label="Peak", value=_format_nits(np.max(luminance_nits))),
        ScopeStat(label="P99", value=_format_nits(np.percentile(luminance_nits, 99))),
        ScopeStat(label="P95", value=_format_nits(np.percentile(luminance_nits, 95))),
        ScopeStat(label="Median", value=_format_nits(np.percentile(luminance_nits, 50))),
        ScopeStat(label="% > 100", value=_format_percent(np.mean(luminance_nits > 100.0) * 100.0)),
        ScopeStat(label="% > 203", value=_format_percent(np.mean(luminance_nits > 203.0) * 100.0)),
        ScopeStat(label="% > 1000", value=_format_percent(np.mean(luminance_nits > 1000.0) * 100.0)),
    ]


def _sdr_stats(luma: np.ndarray) -> list[ScopeStat]:
    return [
        ScopeStat(label="Peak", value=f"{float(np.max(luma)):.3f}"),
        ScopeStat(label="P95", value=f"{float(np.percentile(luma, 95)):.3f}"),
        ScopeStat(label="Median", value=f"{float(np.percentile(luma, 50)):.3f}"),
    ]


def _rgb_to_reference_nits(image: np.ndarray) -> np.ndarray:
    luminance = 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]
    return np.clip((luminance / 0.18) * 100.0, 0.0, None)


def _channel_to_reference_nits(channel: np.ndarray) -> np.ndarray:
    return np.clip((channel.astype(np.float32, copy=False) / 0.18) * 100.0, 0.0, None)


def _format_nits(value: float) -> str:
    if value >= 1000.0:
        return f"{value:.0f} nit"
    if value >= 99.995:
        return f"{value:.1f} nit"
    return f"{value:.2f} nit"


def _format_percent(value: float) -> str:
    return f"{value:.2f}%"
