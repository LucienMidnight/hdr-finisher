from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HDRClassification(str, Enum):
    HDR_TRUE = "HDR_TRUE"
    HDR_ENCODED = "HDR_ENCODED"
    HDR_LINEAR_UNCONFIRMED = "HDR_LINEAR_UNCONFIRMED"
    SDR_ONLY = "SDR_ONLY"


class PreviewKind(str, Enum):
    HDR = "hdr"
    SDR = "sdr"


class ScopeMode(str, Enum):
    HISTOGRAM = "histogram"
    WAVEFORM = "waveform"


class ToneMapper(str, Enum):
    ACES = "aces"
    REINHARD = "reinhard"


class OverlayMode(str, Enum):
    OFF = "off"
    FALSE_COLOR = "false_color"
    ZEBRA = "zebra"


class CapabilityStatus(str, Enum):
    AVAILABLE = "available"
    MISSING = "missing"
    UNVERIFIED = "unverified"


class CapabilityInfo(BaseModel):
    name: str
    status: CapabilityStatus
    detail: str


class SourceImageDescriptor(BaseModel):
    filename: str
    suffix: str
    width: int
    height: int
    channels: int
    dtype: str
    working_space: str = "ACEScg"
    source_color_space: str | None = None
    transfer_function: str | None = None
    interpretation_mode: str = "auto"
    color_space_confident: bool = True


class MetadataPayload(BaseModel):
    camera_model: str | None = None
    lens: str | None = None
    iso: str | None = None
    shutter_speed: str | None = None
    bit_depth: str | None = None
    color_space: str | None = None
    transfer_function: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class SourceLatitude(str, Enum):
    WIDE = "WIDE"
    MEDIUM = "MEDIUM"
    NARROW = "NARROW"


class HDRAnalysis(BaseModel):
    classification: HDRClassification
    peak_linear: float
    peak_stops_above_diffuse_white: float | None = None
    source_latitude: SourceLatitude = SourceLatitude.MEDIUM
    needs_color_override: bool = False
    badge_message: str


class HDRAdjustments(BaseModel):
    exposure: float = 0.0
    highlight_rolloff: float = 0.25
    shadow_lift: float = 0.0
    white_balance_kelvin: int = 6500
    tint: float = 0.0


class SDRAdjustments(BaseModel):
    exposure: float = 0.0
    highlight_recovery: float = 0.25
    shadow: float = 0.0
    contrast: float = 0.0
    tone_mapper: ToneMapper = ToneMapper.ACES


class SharedAdjustments(BaseModel):
    active_focus: PreviewKind = PreviewKind.HDR
    curves_enabled: bool = False
    overlay_mode: OverlayMode = OverlayMode.OFF
    overlay_preset: str = "web_1000_100"
    overlay_opacity: float = 0.72
    overlay_threshold: float = 1.0
    luma_curve: list[list[float]] = Field(
        default_factory=lambda: [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]
    )
    red_curve: list[list[float]] = Field(
        default_factory=lambda: [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]
    )
    green_curve: list[list[float]] = Field(
        default_factory=lambda: [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]
    )
    blue_curve: list[list[float]] = Field(
        default_factory=lambda: [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]
    )


class AdjustmentState(BaseModel):
    hdr: HDRAdjustments = Field(default_factory=HDRAdjustments)
    sdr: SDRAdjustments = Field(default_factory=SDRAdjustments)
    shared: SharedAdjustments = Field(default_factory=SharedAdjustments)


class PreviewSettings(BaseModel):
    long_edge: int = 1600
    format: str = "png"


class SessionPayload(BaseModel):
    session_id: str
    source: SourceImageDescriptor
    metadata: MetadataPayload
    analysis: HDRAnalysis
    adjustments: AdjustmentState
    preview: PreviewSettings
    capabilities: dict[str, CapabilityInfo]


class SessionSummary(BaseModel):
    session: SessionPayload | None


class SourceInterpretationOverride(BaseModel):
    color_space: str | None = None
    transfer_function: str | None = None


class PreviewRequest(BaseModel):
    adjustments: AdjustmentState
    request_id: str | None = None


class HistogramChannel(BaseModel):
    name: str
    bins: list[int]
    grid: list[list[int]] = Field(default_factory=list)


class ScopeGuide(BaseModel):
    value: float
    label: str


class ScopeStat(BaseModel):
    label: str
    value: str


class ScopeResponse(BaseModel):
    preview_kind: PreviewKind
    scope_type: str = "histogram"
    x_axis: str = "normalized"
    bin_edges: list[float] = Field(default_factory=list)
    guides: list[ScopeGuide] = Field(default_factory=list)
    stats: list[ScopeStat] = Field(default_factory=list)
    channels: list[HistogramChannel]


class ExportSettings(BaseModel):
    format: str = "avif_gain_map"
    quality: int = 85
    output_path: str | None = None


class ExportResponse(BaseModel):
    accepted: bool
    backend: str
    message: str
    output_path: str | None = None
