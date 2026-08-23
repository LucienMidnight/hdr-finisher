from __future__ import annotations

import numpy as np

from .adjustments import apply_adjustments
from .color import acescg_to_linear_bt2020
from .color_context import RenderColorContext, nits_to_scene_linear, scene_linear_to_nits
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

SDR_SIGNAL_GUIDES = [
    ScopeGuide(value=0.18, label="18% signal"),
    ScopeGuide(value=0.5, label="50% signal"),
    ScopeGuide(value=1.0, label="100% signal"),
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
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    context = color_context or RenderColorContext()
    processed = apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image, color_context=context)
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns, max_nits=max_nits, color_context=context, channel_names=channel_names)
    if mode == ScopeMode.VECTORSCOPE:
        return _build_vectorscope(processed, kind, bins=bins or 128, color_context=context)
    return _build_histogram(processed, kind, bins=bins or 256, max_nits=max_nits, color_context=context, channel_names=channel_names)


def build_scope_from_processed(
    processed: np.ndarray,
    kind: PreviewKind,
    mode: ScopeMode = ScopeMode.HISTOGRAM,
    bins: int | None = None,
    waveform_columns: int = 512,
    max_nits: int = 4000,
    color_context: RenderColorContext | None = None,
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    context = color_context or RenderColorContext()
    if mode == ScopeMode.WAVEFORM:
        return _build_waveform(processed, kind, bins=bins or 256, columns=waveform_columns, max_nits=max_nits, color_context=context, channel_names=channel_names)
    if mode == ScopeMode.VECTORSCOPE:
        return _build_vectorscope(processed, kind, bins=bins or 128, color_context=context)
    return _build_histogram(processed, kind, bins=bins or 256, max_nits=max_nits, color_context=context, channel_names=channel_names)


def _build_histogram(
    processed: np.ndarray,
    kind: PreviewKind,
    bins: int,
    max_nits: int,
    color_context: RenderColorContext,
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    if kind == PreviewKind.HDR:
        return _build_hdr_histogram(processed, bins=bins, max_nits=max_nits, color_context=color_context, channel_names=channel_names)
    return _build_sdr_histogram(processed, bins=bins, channel_names=channel_names)


def _build_hdr_histogram(
    processed: np.ndarray,
    bins: int,
    max_nits: int,
    color_context: RenderColorContext,
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    ceiling = _hdr_scope_ceiling(max_nits)
    selected = set(channel_names or ("R", "G", "B", "Y"))
    # HDR grades are ACEScg scene-linear. RGB traces represent the actual
    # BT.2020 transport primaries, while Y remains linear-light luminance.
    transport = np.clip(acescg_to_linear_bt2020(processed.astype(np.float32, copy=False)), 0.0, None)
    transport_luma = (
        np.float32(0.2627) * transport[..., 0]
        + np.float32(0.6780) * transport[..., 1]
        + np.float32(0.0593) * transport[..., 2]
    )
    luminance_nits = np.clip(
        scene_linear_to_nits(transport_luma, color_context.hdr_reference_white_nits),
        0.0,
        None,
    )
    edges = _hdr_edges(bins, ceiling)

    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        if name not in selected:
            continue
        channel_nits = _channel_to_reference_nits(transport[..., idx], color_context)
        hist, _ = np.histogram(np.clip(channel_nits, 1.0, ceiling), bins=edges)
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))
    if "Y" in selected:
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
        clipped=bool(np.any(transport >= nits_to_scene_linear(10000.0, color_context.hdr_reference_white_nits))),
    )


def _build_sdr_histogram(
    processed: np.ndarray,
    bins: int,
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    selected = set(channel_names or ("R", "G", "B", "Y"))
    linear = processed.astype(np.float32, copy=False)
    # The authored SDR frame is linear sRGB, but its displayed/exported signal
    # is nonlinear. Analyze the same signal users see instead of overweighting
    # linear-light shadows.
    signal = _linear_srgb_to_signal(np.clip(linear, 0.0, 1.0))
    edges = np.linspace(0.0, 1.0, bins + 1, dtype=np.float32)
    channels = []
    for idx, name in enumerate(("R", "G", "B")):
        if name not in selected:
            continue
        hist, _ = np.histogram(signal[..., idx], bins=edges)
        channels.append(HistogramChannel(name=name, bins=hist.astype(int).tolist()))

    luma = 0.2126 * signal[..., 0] + 0.7152 * signal[..., 1] + 0.0722 * signal[..., 2]
    if "Y" in selected:
        luma_hist, _ = np.histogram(luma, bins=edges)
        channels.append(HistogramChannel(name="Y", bins=luma_hist.astype(int).tolist()))
    return ScopeResponse(
        preview_kind=PreviewKind.SDR,
        scope_type="normalized_histogram",
        x_axis="normalized",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=SDR_SIGNAL_GUIDES,
        stats=_sdr_stats(luma),
        channels=channels,
        normalization_peak=_normalization_peak(channels),
        peak_value=float(np.max(luma)),
        clipped=bool(np.any(linear[..., :3] >= 1.0)),
    )


def _linear_srgb_to_signal(image: np.ndarray) -> np.ndarray:
    source = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    return np.where(
        source <= np.float32(0.0031308),
        source * np.float32(12.92),
        np.float32(1.055) * np.power(source, np.float32(1.0 / 2.4)) - np.float32(0.055),
    ).astype(np.float32, copy=False)


def _build_waveform(
    processed: np.ndarray,
    kind: PreviewKind,
    bins: int,
    columns: int,
    max_nits: int,
    color_context: RenderColorContext,
    channel_names: tuple[str, ...] | None = None,
) -> ScopeResponse:
    selected = set(channel_names or ("R", "G", "B", "Y"))
    clipped = np.clip(processed.astype(np.float32, copy=False), 0.0, None if kind == PreviewKind.HDR else 1.0)
    if kind == PreviewKind.HDR:
        ceiling = _hdr_scope_ceiling(max_nits)
        edges = _hdr_edges(bins, ceiling)
        channels = []
        # HDR grading is ACEScg scene-linear, but the delivered HDR transport
        # and monitor primaries are Rec.2020. Luma is invariant across the
        # linear transform; RGB parade channels are not. Plot the transport
        # primaries so saturated EXR colors land on the channels viewers see.
        waveform_rgb = np.clip(acescg_to_linear_bt2020(clipped[..., :3]), 0.0, None)
        transport_luma = (
            np.float32(0.2627) * waveform_rgb[..., 0]
            + np.float32(0.6780) * waveform_rgb[..., 1]
            + np.float32(0.0593) * waveform_rgb[..., 2]
        )
        luminance_nits = np.clip(
            scene_linear_to_nits(transport_luma, color_context.hdr_reference_white_nits), 0.0, None
        )
        channel_clipped = False
        for idx, name in enumerate(("R", "G", "B")):
            channel_nits = _channel_to_reference_nits(waveform_rgb[..., idx], color_context)
            channel_clipped = channel_clipped or bool(np.any(channel_nits >= 10000.0))
            if name not in selected:
                continue
            grid = _waveform_grid(np.clip(channel_nits, 1.0, ceiling), edges, columns)
            channels.append(HistogramChannel(name=name, bins=[], grid=grid))
        if "Y" in selected:
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
            clipped=channel_clipped,
        )

    edges = np.linspace(0.0, 1.0, bins + 1, dtype=np.float32)
    channels = []
    # Conventional SDR waveform monitors operate on the encoded Rec.709/sRGB
    # output signal, not the internal linear-light render buffer. This also
    # keeps waveform/parade positions consistent with the SDR histogram.
    signal = _linear_srgb_to_signal(clipped[..., :3])
    luma = 0.2126 * signal[..., 0] + 0.7152 * signal[..., 1] + 0.0722 * signal[..., 2]
    for idx, name in enumerate(("R", "G", "B")):
        if name not in selected:
            continue
        grid = _waveform_grid(signal[..., idx], edges, columns)
        channels.append(HistogramChannel(name=name, bins=[], grid=grid))
    if "Y" in selected:
        channels.append(HistogramChannel(name="Y", bins=[], grid=_waveform_grid(luma, edges, columns)))
    return ScopeResponse(
        preview_kind=PreviewKind.SDR,
        scope_type="normalized_waveform",
        x_axis="normalized",
        bin_edges=[float(edge) for edge in edges.tolist()],
        guides=SDR_SIGNAL_GUIDES,
        stats=_sdr_stats(luma),
        channels=channels,
        normalization_peak=_normalization_peak(channels),
        peak_value=float(np.max(luma)),
        # A legal luma value can still contain a clipped RGB primary (pure red
        # at 1.0 is the common case), which a parade must flag.
        clipped=bool(np.any(clipped[..., :3] >= 1.0)),
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
    working_rgb = processed[..., :3].astype(np.float32, copy=False)
    if kind == PreviewKind.HDR:
        # The grading buffer is ACEScg scene-linear, while a conventional HDR
        # vectorscope measures nonlinear Rec.2020 video signal. Analyze the
        # same PQ domain an HDR monitor receives; doing this in scene-linear
        # space collapses ordinary EXR chroma around the center.
        linear_bt2020 = np.clip(acescg_to_linear_bt2020(working_rgb), 0.0, None)
        normalized_nits = np.clip(
            scene_linear_to_nits(linear_bt2020, color_context.hdr_reference_white_nits) / np.float32(10000.0),
            0.0,
            1.0,
        )
        signal_rgb = _scope_pq_oetf(normalized_nits)
        kr, kg, kb = (0.2627, 0.6780, 0.0593)
        display_luma = _rgb_to_reference_nits(np.clip(working_rgb, 0.0, None), color_context)
    else:
        linear_srgb = np.clip(working_rgb, 0.0, 1.0)
        signal_rgb = _scope_srgb_oetf(linear_srgb)
        kr, kg, kb = (0.2126, 0.7152, 0.0722)
        display_luma = kr * linear_srgb[..., 0] + kg * linear_srgb[..., 1] + kb * linear_srgb[..., 2]
    signal_luma = kr * signal_rgb[..., 0] + kg * signal_rgb[..., 1] + kb * signal_rgb[..., 2]
    # Standard full-range Y'CbCr coordinates. The previous extra 0.5 factor
    # halved every chroma excursion, including calibrated primary targets.
    u = np.clip(0.5 + (signal_rgb[..., 2] - signal_luma) / max(2.0 * (1.0 - kb), 1e-6), 0.0, 1.0)
    v = np.clip(0.5 + (signal_rgb[..., 0] - signal_luma) / max(2.0 * (1.0 - kr), 1e-6), 0.0, 1.0)
    x = np.minimum((u * bins).astype(np.int32), bins - 1)
    y = np.minimum((v * bins).astype(np.int32), bins - 1)
    grid = np.bincount((y * bins + x).reshape(-1), minlength=bins * bins).reshape(bins, bins)
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


def _scope_pq_oetf(normalized_luminance: np.ndarray) -> np.ndarray:
    m1 = np.float32(2610.0 / 16384.0)
    m2 = np.float32(2523.0 / 32.0)
    c1 = np.float32(3424.0 / 4096.0)
    c2 = np.float32(2413.0 / 128.0)
    c3 = np.float32(2392.0 / 128.0)
    lm1 = np.power(np.clip(normalized_luminance, 0.0, 1.0), m1)
    return np.power((c1 + c2 * lm1) / (np.float32(1.0) + c3 * lm1), m2).astype(np.float32, copy=False)


def _scope_srgb_oetf(linear: np.ndarray) -> np.ndarray:
    clipped = np.clip(linear, 0.0, 1.0)
    return np.where(
        clipped <= np.float32(0.0031308),
        clipped * np.float32(12.92),
        np.float32(1.055) * np.power(clipped, np.float32(1.0 / 2.4)) - np.float32(0.055),
    ).astype(np.float32, copy=False)


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
