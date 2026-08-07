from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


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
    FILMIC = "filmic"
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


class ToneEqualizerNode(BaseModel):
    input_ev: float = Field(ge=-6.0, le=6.0)
    adjustment_ev: float = Field(default=0.0, ge=-2.0, le=2.0)


def _default_tone_equalizer_nodes() -> list[ToneEqualizerNode]:
    return [ToneEqualizerNode(input_ev=value) for value in (-6.0, -3.0, 0.0, 3.0, 6.0)]


class HDRAdjustments(BaseModel):
    tone_section_enabled: bool = True
    tone_equalizer_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    exposure: float = 0.0
    highlight_rolloff: float = 0.0
    highlight_rolloff_start_nits: float = Field(default=400.0, ge=100.0, le=4000.0)
    shadow_lift: float = 0.0
    tone_equalizer_enabled: bool = False
    tone_equalizer_nodes: list[ToneEqualizerNode] = Field(
        default_factory=_default_tone_equalizer_nodes,
        min_length=2,
        max_length=16,
    )
    tone_equalizer_influence_radius: float = Field(default=1.5, ge=0.25, le=12.0)
    tone_equalizer_smoothing: float = Field(default=0.5, ge=0.0, le=1.0)
    lift: float = 0.0
    gamma: float = 0.0
    gain: float = 0.0
    lift_pivot: float = Field(default=-2.0, ge=-8.0, le=8.0)
    lift_range: float = Field(default=4.0, ge=0.5, le=12.0)
    gamma_pivot: float = Field(default=0.0, ge=-8.0, le=8.0)
    gamma_range: float = Field(default=4.25, ge=0.5, le=12.0)
    gain_pivot: float = Field(default=2.0, ge=-8.0, le=8.0)
    gain_range: float = Field(default=4.0, ge=0.5, le=12.0)
    contrast: float = 0.0
    contrast_pivot: float = 0.1845
    white_balance_kelvin: int = 6500
    tint: float = 0.0
    saturation: float = Field(default=0.0, ge=-1.0, le=1.0)
    vibrance: float = Field(default=0.0, ge=-1.0, le=1.0)
    red_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    red_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    green_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    green_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    blue_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    blue_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    tint_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    tint_purity: float = Field(default=0.0, ge=0.0, le=99.0)
    curves_enabled: bool = False
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

    @model_validator(mode="before")
    @classmethod
    def migrate_tone_equalizer_bands(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "tone_equalizer_nodes" in value:
            return value
        bands = value.get("tone_equalizer_bands")
        if not isinstance(bands, list) or len(bands) != 13:
            return value
        migrated = dict(value)
        migrated["tone_equalizer_nodes"] = [
            {"input_ev": float(index - 6), "adjustment_ev": float(adjustment)}
            for index, adjustment in enumerate(bands)
        ]
        migrated.pop("tone_equalizer_bands", None)
        return migrated

    @model_validator(mode="after")
    def normalize_tone_equalizer_nodes(self) -> "HDRAdjustments":
        nodes = sorted(self.tone_equalizer_nodes, key=lambda node: node.input_ev)
        normalized: list[ToneEqualizerNode] = []
        for index, node in enumerate(nodes):
            input_ev = node.input_ev
            if index == 0:
                input_ev = -6.0
            elif index == len(nodes) - 1:
                input_ev = 6.0
            else:
                minimum = normalized[-1].input_ev + 0.1
                maximum = 6.0 - 0.1 * (len(nodes) - index - 1)
                input_ev = min(max(input_ev, minimum), maximum)
            normalized.append(ToneEqualizerNode(input_ev=input_ev, adjustment_ev=node.adjustment_ev))
        self.tone_equalizer_nodes = normalized
        return self


class SDRAdjustments(BaseModel):
    base_section_enabled: bool = True
    tone_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    match_hdr_color: bool = True
    exposure: float = 0.0
    highlight_recovery: float = 0.6
    tone_contrast: float = Field(default=1.0, ge=0.5, le=1.5)
    tone_skew: float = Field(default=0.0, ge=-1.0, le=1.0)
    shadow: float = 0.0
    lift: float = 0.0
    gamma: float = 0.0
    gain: float = 0.0
    lift_pivot: float = Field(default=-2.0, ge=-8.0, le=8.0)
    lift_range: float = Field(default=4.0, ge=0.5, le=12.0)
    gamma_pivot: float = Field(default=0.0, ge=-8.0, le=8.0)
    gamma_range: float = Field(default=4.25, ge=0.5, le=12.0)
    gain_pivot: float = Field(default=2.0, ge=-8.0, le=8.0)
    gain_range: float = Field(default=4.0, ge=0.5, le=12.0)
    contrast: float = 0.0
    contrast_pivot: float = 0.5
    white_balance_kelvin: int = 6500
    tint: float = 0.0
    saturation: float = Field(default=0.0, ge=-1.0, le=1.0)
    vibrance: float = Field(default=0.0, ge=-1.0, le=1.0)
    red_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    red_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    green_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    green_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    blue_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    blue_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    tint_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    tint_purity: float = Field(default=0.0, ge=0.0, le=99.0)
    tone_mapper: ToneMapper = ToneMapper.FILMIC
    curves_enabled: bool = False
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
    long_edge: int | None = Field(default=None, ge=256, le=2000)
    hdr_display: bool = True


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
    format: str = "jpeg_ultrahdr"
    quality: int = Field(default=85, ge=1, le=100)
    jpeg_gain_map_quality: int = Field(default=100, ge=1, le=100)
    jpeg_gain_map_scale: Literal["full", "half"] = "full"
    output_path: str | None = None
    overwrite: bool = False


class ExportResponse(BaseModel):
    accepted: bool
    backend: str
    message: str
    output_path: str | None = None


class DirectoryPickRequest(BaseModel):
    initial_directory: str | None = None


class DirectoryPickResponse(BaseModel):
    directory: str | None = None


class ProofArtifactRequest(BaseModel):
    adjustments: AdjustmentState
    format: str = "jpeg_ultrahdr"
    quality: int = Field(default=90, ge=1, le=100)
    jpeg_gain_map_quality: int = Field(default=100, ge=1, le=100)
    jpeg_gain_map_scale: Literal["full", "half"] = "full"
    long_edge: int = Field(default=1200, ge=256, le=1600)


class JPEGGainMapProofMetadata(BaseModel):
    use_base_color_space: bool
    base_gamut: str
    alternate_gamut: str
    reconstruction_gamut: str
    min_content_boost: float
    max_content_boost: float
    gamma: float
    hdr_capacity_min: float
    hdr_capacity_max: float
    offset_sdr: float
    offset_hdr: float


class ProofArtifactResponse(BaseModel):
    artifact_id: str
    format: str
    media_type: str
    byte_size: int
    sha256: str
    url: str
    wrong_mime_url: str
    width: int
    height: int
    quality: int
    metadata_summary: str
    encoded_headroom: float
    jpeg_gain_map: JPEGGainMapProofMetadata | None = None


class ProofMatrixRequest(BaseModel):
    artifact_id: str
    display_headroom: float | None = Field(default=None, ge=0.0, le=16.0)


class ProofReconstructionTarget(BaseModel):
    mode: Literal["auto", "fixed", "full"] = "auto"
    peak_nits: float | None = Field(default=None, ge=100.0, le=10000.0)
    display_id: str | None = None

    @model_validator(mode="after")
    def validate_fixed_target(self) -> "ProofReconstructionTarget":
        if self.mode == "fixed" and self.peak_nits is None:
            raise ValueError("peak_nits is required for a fixed proof target")
        return self


class ProofReconstructionRequest(BaseModel):
    artifact_id: str
    target: ProofReconstructionTarget


class ProofMatrixTile(BaseModel):
    id: str
    label: str
    target_headroom: float
    url: str
    peak_nits: float
    clipped_percent: float
    above_display_headroom: bool | None = None


class ProofMatrixResponse(BaseModel):
    artifact_id: str
    encoded_headroom: float
    reconstruction: str
    tiles: list[ProofMatrixTile]


class ProofReconstructionResponse(BaseModel):
    artifact_id: str
    format: str
    target_mode: Literal["auto", "fixed", "full"]
    target_label: str
    requested_headroom: float
    resolved_headroom: float
    requested_peak_nits: float | None = None
    resolved_reference_peak_nits: float
    encoded_headroom: float
    capped_by_encoded_headroom: bool
    display_id: str | None = None
    display_label: str | None = None
    display_headroom: float | None = None
    display_max_luminance_nits: float | None = None
    display_can_represent: bool | None = None
    reconstruction: str
    cache_id: str
    tile: ProofMatrixTile


class BrowserEvidenceRecord(BaseModel):
    artifact_id: str
    format: str
    browser_name: str = "Unknown"
    browser_version: str = "Unknown"
    operating_system: str = "Unknown"
    display_label: str = "Unknown display"
    hdr_state: str = "unknown"
    sdr_white_nits: float | None = None
    max_luminance_nits: float | None = None
    nominal_headroom: float | None = None
    dynamic_range_limit: str = "no-limit"
    mime_mode: str = "correct"
    presentation_variant: str = "native"
    highlight_observation: str
    midtone_observation: str
    color_observation: str
    overall_observation: str
    notes: str = ""
    observed_at: datetime = Field(default_factory=datetime.utcnow)


class BrowserEvidenceResponse(BaseModel):
    records: list[BrowserEvidenceRecord]
    stale_after_days: int = 180
