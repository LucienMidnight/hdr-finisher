from __future__ import annotations

import numpy as np

from .adjustments import apply_adjustments
from .color_context import RenderColorContext, scene_linear_to_nits
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
    ScopeGuide(value=4000.0, label="4000"),
    ScopeGuide(value=10000.0, label="10000 PQ peak"),
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
    max_nits: int = 4000,
    color_context: RenderColorContext | None = None,
) -> ScopeResponse:
    context = color_context or RenderColorContext()
    processed = apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image, color_context=context)
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns, max_nits=max_nits, color_context=context)
    if mode == ScopeMode.VECTORSCOPE:
        return _build_vectorscope(processed, kind, bins=bins or 128, color_context=context)
    return _build_histogram(processed, kind, bins=bins or 256, max_nits=max_nits, color_context=context)


def build_scope_from_processed(
    processed: np.ndarray,
    kind: PreviewKind,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = None,
    waveform_columns: int = 512,
    max_nits: int = 4000,
    color_context: RenderColorContext | None = None,
) -> ScopeResponse:
    context = color_context or RenderColorContext()
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns, max_nits=max_nits, color_context=context)
    if mode == ScopeMode.VECTORSCOPE:
        return _build_vectorscope(processed, kind, bins=bins or 128, color_context=context)
    return _build_histogram(processed, kind, bins=bins or 256, max_nits=max_nits, color_context=context)


def _build_histogram(processed: np.ndarray, kind: PreviewKind, bins: int, max_nits: int, color_context: RenderColorContext) -> ScopeResponse:
    if kind == PreviewKind.HDR:
        return _build_hdr_histogram(processed, bins=bins, max_nits=max_nits, color_context=color_context)
    return _build_sdr_histogram(processed, bins=bins)


def _build_hdr_histogram(processed: np.ndarray, bins: int, max_nits: int, color_context: RenderColorContext) -> ScopeResponse:
    ceiling = _hdr_scope_ceiling(max_nits)
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, None)
    luminance_nits = _rgb_to_reference_nits(clipped, color_context)
    edges = _hdr_edges(bins, ceiling)

    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        channel_nits = _channel_to_reference_nits(clipped[..., idx], color_context)
        hist, _ = np.histogram(np.clip(channel_nits, 1.0, ceiling), bins=edges)
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))
    luma_hist, _ = np.histogram(np.clip(luminance_nits, 1.0, ceiling), bins=edges)
    channels.append(HistogramChannel(name="Y", bins=luma_hist.astype(int).tolist()))

    return ScopeResponse(
        preview_kind=PreviewKind.HDR,
        scope_type="reference_nits_histogram",
        x_axis="reference_nits_log10",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=_hdr_guides(ceiling, color_context),
        stats=_hdr_stats(luminance_nits),
        channels=channels,
        normalization_peak=_normalization_peak(channels),
        peak_value=float(np.max(luminance_nits)),
        clipped=bool(np.any(luminance_nits >= 10000.0)),
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
        normalization_peak=_normalization_peak(channels),
        peak_value=float(np.max(luma)),
        clipped=bool(np.any(luma >= 1.0)),
    )


def _build_waveform(processed: np.ndarray, kind: PreviewKind, bins: int, columns: int, max_nits: int, color_context: RenderColorContext) -> ScopeResponse:
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, None if kind == PreviewKind.HDR else 1.0)
    if kind == PreviewKind.HDR:
        ceiling = _hdr_scope_ceiling(max_nits)
        edges = _hdr_edges(bins, ceiling)
        channels = []
        luminance_nits = _rgb_to_reference_nits(clipped, color_context)
        for idx, name in enumerate(("R", "G", "B")):
            channel_nits = _channel_to_reference_nits(clipped[..., idx], color_context)
            grid = _waveform_grid(np.clip(channel_nits, 1.0, ceiling), edges, columns)
            channels.append(HistogramChannel(name=name, bins=[], grid=grid))
        channels.append(HistogramChannel(name="Y", bins=[], grid=_waveform_grid(np.clip(luminance_nits, 1.0, ceiling), edges, columns)))
        return ScopeResponse(
            preview_kind=PreviewKind.HDR,
            scope_type="reference_nits_waveform",
            x_axis="reference_nits_log10",
            bin_edges=[float(edge) for edge in edges.tolist()],
            guides=_hdr_guides(ceiling, color_context),
            stats=_hdr_stats(luminance_nits),
            channels=channels,
            normalization_peak=_normalization_peak(channels),
            peak_value=float(np.max(luminance_nits)),
            clipped=bool(np.any(luminance_nits >= 10000.0)),
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
        normalization_peak=_normalization_peak(channels),
        peak_value=float(np.max(luma)),
        clipped=bool(np.any(luma >= 1.0)),
    )


def _waveform_grid(values: np.ndarray, edges: np.ndarray, columns: int) -> list[list[int]]:
    """Build a waveform with one vectorized bincount instead of a Python loop per column."""
    _height, width = values.shape[:2]
    output_columns = max(1, min(columns, width))
    bin_count = len(edges) - 1
    bin_indices = np.searchsorted(edges, values, side="right") - 1
    np.clip(bin_indices, 0, bin_count - 1, out=bin_indices)
    column_edges = np.linspace(0, width, output_columns + 1, dtype=np.int32)
    target_columns = np.repeat(np.arange(output_columns, dtype=np.int64), np.diff(column_edges))
    combined = bin_indices.astype(np.int64, copy=False) * output_columns + target_columns[None, :]
    grid = np.bincount(combined.reshape(-1), minlength=bin_count * output_columns)
    return grid.reshape(bin_count, output_columns).astype(np.int32, copy=False).tolist()


def _build_vectorscope(processed: np.ndarray, kind: PreviewKind, bins: int, color_context: RenderColorContext) -> ScopeResponse:
    rgb = np.clip(processed[..., :3].astype(np.float32, copy=False), 0.0, None if kind == PreviewKind.HDR else 1.0)
    kr, kg, kb = (0.2722287, 0.6740818, 0.0536895) if kind == PreviewKind.HDR else (0.2126, 0.7152, 0.0722)
    luma = kr * rgb[..., 0] + kg * rgb[..., 1] + kb * rgb[..., 2]
    u = np.clip(0.5 + 0.5 * (rgb[..., 2] - luma) / max(2.0 * (1.0 - kb), 1e-6), 0.0, 1.0)
    v = np.clip(0.5 + 0.5 * (rgb[..., 0] - luma) / max(2.0 * (1.0 - kr), 1e-6), 0.0, 1.0)
    x = np.minimum((u * bins).astype(np.int32), bins - 1)
    y = np.minimum((v * bins).astype(np.int32), bins - 1)
    grid = np.bincount((y * bins + x).reshape(-1), minlength=bins * bins).reshape(bins, bins)
    display_luma = scene_linear_to_nits(luma, color_context.hdr_reference_white_nits) if kind == PreviewKind.HDR else np.clip(luma, 0.0, 1.0)
    return ScopeResponse(
        preview_kind=kind,
        scope_type="vectorscope",
        x_axis="chroma_uv",
        bin_edges=np.linspace(0.0, 1.0, bins + 1, dtype=np.float32).tolist(),
        guides=[],
        stats=_hdr_stats(display_luma) if kind == PreviewKind.HDR else _sdr_stats(display_luma),
        channels=[HistogramChannel(name="Y", bins=[], grid=grid.astype(np.int32, copy=False).tolist())],
        normalization_peak=_normalization_peak([HistogramChannel(name="Y", bins=[], grid=grid.tolist())]),
        peak_value=float(np.max(display_luma)),
        clipped=bool(np.any(display_luma >= (10000.0 if kind == PreviewKind.HDR else 1.0))),
    )


def _normalization_peak(channels: list[HistogramChannel]) -> int:
    populations: list[np.ndarray] = []
    for channel in channels:
        values = channel.bins if channel.bins else [value for row in channel.grid for value in row]
        if values:
            positive = np.asarray(values, dtype=np.int64)
            positive = positive[positive > 0]
            if positive.size:
                populations.append(positive)
    if not populations:
        return 1
    combined = np.concatenate(populations)
    percentile = 99.5 if any(channel.grid for channel in channels) else 98.5
    return max(1, int(np.percentile(combined, percentile)))


def _hdr_scope_ceiling(max_nits: int) -> int:
    requested = int(max_nits)
    if requested == 1000:
        return 1000
    return 10000 if requested == 10000 else 4000


def _hdr_edges(bins: int, max_nits: int = 4000) -> np.ndarray:
    log_edges = np.linspace(np.log10(1.0), np.log10(_hdr_scope_ceiling(max_nits)), bins + 1, dtype=np.float32)
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


def _rgb_to_reference_nits(
    image: np.ndarray, color_context: RenderColorContext | None = None
) -> np.ndarray:
    color_context = color_context or RenderColorContext()
    luminance = 0.2722287 * image[..., 0] + 0.6740818 * image[..., 1] + 0.0536895 * image[..., 2]
    return np.clip(scene_linear_to_nits(luminance, color_context.hdr_reference_white_nits), 0.0, None)


def _channel_to_reference_nits(channel: np.ndarray, color_context: RenderColorContext) -> np.ndarray:
    return np.clip(scene_linear_to_nits(channel.astype(np.float32, copy=False), color_context.hdr_reference_white_nits), 0.0, None)


def _hdr_guides(ceiling: int, color_context: RenderColorContext) -> list[ScopeGuide]:
    active = color_context.hdr_reference_white_nits
    guides: list[ScopeGuide] = []
    for guide in HDR_GUIDES:
        if guide.value <= ceiling:
            label = f"{int(guide.value)} · active reference" if guide.value == active else guide.label
            guides.append(ScopeGuide(value=guide.value, label=label))
    return guides


def _format_nits(value: float) -> str:
    if value >= 1000.0:
        return f"{value:.0f} nit"
    if value >= 99.995:
        return f"{value:.1f} nit"
    return f"{value:.2f} nit"


def _format_percent(value: float) -> str:
    return f"{value:.2f}%"
