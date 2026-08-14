from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class ScopeMaxNits(str, Enum):
    NITS_1000 = "1000"
    NITS_4000 = "4000"
    NITS_10000 = "10000"


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
    peak_luma_linear: float | None = None
    robust_peak_luma_linear: float | None = None
    peak_stops_above_diffuse_white: float | None = None
    source_latitude: SourceLatitude = SourceLatitude.MEDIUM
    needs_color_override: bool = False
    badge_message: str


class ToneEqualizerNode(BaseModel):
    input_ev: float = Field(ge=-6.0, le=6.0)
    adjustment_ev: float = Field(default=0.0, ge=-2.0, le=2.0)


def _default_tone_equalizer_nodes() -> list[ToneEqualizerNode]:
    return [ToneEqualizerNode(input_ev=value) for value in (-6.0, -3.0, 0.0, 3.0, 6.0)]


def _default_curve_points() -> list[list[float]]:
    """Return a neutral curve with three editable points between fixed endpoints."""
    return [[0.0, 0.0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1.0, 1.0]]


class FilmLookAdjustments(BaseModel):
    """Scene-aware finishing controls shared by the HDR and SDR branches."""

    model_config = ConfigDict(extra="forbid")

    reference_model: Literal[
        "custom",
        "large_format_fine",
        "35mm_fine",
        "35mm_balanced",
        "35mm_fast",
        "16mm_fine",
    ] = "custom"
    look_strength: float = Field(default=100.0, ge=0.0, le=100.0)
    print_strength: float = Field(default=0.0, ge=0.0, le=100.0)
    print_contrast: float = Field(default=0.0, ge=-100.0, le=100.0)
    print_toe: float = Field(default=0.0, ge=-100.0, le=100.0)
    print_shoulder: float = Field(default=0.0, ge=-100.0, le=100.0)
    color_density: float = Field(default=0.0, ge=-100.0, le=100.0)

    grain_enabled: bool = True
    grain_amount: float = Field(default=0.0, ge=0.0, le=100.0)
    grain_size: float = Field(default=50.0, ge=0.0, le=100.0)
    grain_softness: float = Field(default=25.0, ge=0.0, le=100.0)
    grain_chroma: float = Field(default=0.0, ge=0.0, le=100.0)
    grain_shadow_response: float = Field(default=100.0, ge=0.0, le=150.0)
    grain_midtone_response: float = Field(default=100.0, ge=0.0, le=150.0)
    grain_highlight_response: float = Field(default=100.0, ge=0.0, le=150.0)
    film_resolution: float = Field(default=100.0, ge=0.0, le=100.0)

    halation_enabled: bool = True
    halation_amount: float = Field(default=0.0, ge=0.0, le=100.0)
    halation_sensitivity: float = Field(default=75.0, ge=0.0, le=100.0)
    halation_radius: float = Field(default=0.2, ge=0.0, le=5.0)
    halation_hue_offset: float = Field(default=0.0, ge=-100.0, le=100.0)
    halation_saturation: float = Field(default=75.0, ge=0.0, le=100.0)
    halation_view_map: bool = False

    bloom_enabled: bool = True
    bloom_amount: float = Field(default=0.0, ge=0.0, le=100.0)
    bloom_sensitivity: float = Field(default=80.0, ge=0.0, le=100.0)
    bloom_radius: float = Field(default=0.5, ge=0.0, le=10.0)
    bloom_highlight_detail: float = Field(default=75.0, ge=0.0, le=100.0)

    image_structure_enabled: bool = True
    image_softness: float = Field(default=0.0, ge=0.0, le=100.0)
    microcontrast: float = Field(default=0.0, ge=-100.0, le=100.0)


class ColorWheelAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hue: float = Field(default=0.0, ge=0.0, le=360.0)
    saturation: float = Field(default=0.0, ge=0.0, le=100.0)
    luminance_ev: float = Field(default=0.0, ge=-1.0, le=1.0)


class ColorGradingAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shadows: ColorWheelAdjustments = Field(default_factory=ColorWheelAdjustments)
    midtones: ColorWheelAdjustments = Field(default_factory=ColorWheelAdjustments)
    highlights: ColorWheelAdjustments = Field(default_factory=ColorWheelAdjustments)
    blending: float = Field(default=50.0, ge=0.0, le=100.0)
    balance: float = Field(default=0.0, ge=-100.0, le=100.0)


class VignetteAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: float = Field(default=0.0, ge=-100.0, le=100.0)
    midpoint: float = Field(default=50.0, ge=0.0, le=100.0)
    roundness: float = Field(default=0.0, ge=-100.0, le=100.0)
    feather: float = Field(default=75.0, ge=0.0, le=100.0)
    highlight_protection: float = Field(default=0.0, ge=0.0, le=100.0)
    center_x: float = Field(default=0.5, ge=0.0, le=1.0)
    center_y: float = Field(default=0.5, ge=0.0, le=1.0)


class CropRectangle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(default=0.0, ge=0.0, lt=1.0)
    y: float = Field(default=0.0, ge=0.0, lt=1.0)
    width: float = Field(default=1.0, gt=0.0, le=1.0)
    height: float = Field(default=1.0, gt=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_bounds(self) -> "CropRectangle":
        if self.x + self.width > 1.0 + 1e-7 or self.y + self.height > 1.0 + 1e-7:
            raise ValueError("crop rectangle must stay within normalized image bounds")
        return self


class CustomAspectRatio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    width: float = Field(default=1.0, gt=0.0, le=10000.0)
    height: float = Field(default=1.0, gt=0.0, le=10000.0)


class GeometryAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rotation: Literal[0, 90, 180, 270] = 0
    flip_horizontal: bool = False
    flip_vertical: bool = False
    straighten_angle: float = Field(default=0.0, ge=-45.0, le=45.0)
    crop: CropRectangle = Field(default_factory=CropRectangle)
    ratio_mode: Literal[
        "free", "original", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "custom"
    ] = "free"
    custom_ratio: CustomAspectRatio = Field(default_factory=CustomAspectRatio)


class OutputFinishingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resize_mode: Literal["original", "long_edge", "fit"] = "original"
    long_edge: int | None = Field(default=None, ge=1, le=100000)
    width: int | None = Field(default=None, ge=1, le=100000)
    height: int | None = Field(default=None, ge=1, le=100000)
    prevent_enlargement: bool = True
    sharpening: Literal["off", "subtle", "standard", "strong"] = "off"
    method: Literal["edge_aware_multiscale"] = "edge_aware_multiscale"

    @model_validator(mode="after")
    def validate_resize_dimensions(self) -> "OutputFinishingSettings":
        if self.resize_mode == "long_edge" and self.long_edge is None:
            raise ValueError("long_edge is required when resize_mode is long_edge")
        if self.resize_mode == "fit" and (self.width is None or self.height is None):
            raise ValueError("width and height are required when resize_mode is fit")
        return self


class HDRAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone_section_enabled: bool = True
    highlight_section_enabled: bool = True
    tone_equalizer_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    film_look_section_enabled: bool = True
    color_grading_section_enabled: bool = True
    vignette_section_enabled: bool = True
    film_look: FilmLookAdjustments = Field(default_factory=FilmLookAdjustments)
    color_grading: ColorGradingAdjustments = Field(default_factory=ColorGradingAdjustments)
    vignette: VignetteAdjustments = Field(default_factory=VignetteAdjustments)
    exposure: float = Field(default=0.0, ge=-8.0, le=8.0)
    highlight_compression_start_nits: float = Field(default=400.0, ge=1.0, le=9999.0)
    highlight_compression_target_nits: float = Field(default=1000.0, ge=2.0, le=10000.0)
    highlight_compression_softness: float = Field(default=0.0, ge=0.0, le=100.0)
    highlight_compression_mode: Literal["off", "peak_fit", "soft_ceiling"] = "off"
    highlight_compression_peak_measurement: Literal["maximum", "robust", "manual"] = "maximum"
    highlight_compression_source_peak_nits: float = Field(default=1000.0, ge=1.0, le=1_000_000.0)
    highlight_compression_manual_peak_nits: float = Field(default=1000.0, ge=1.0, le=1_000_000.0)
    highlight_compression_peak_detail: float = Field(default=35.0, ge=0.0, le=100.0)
    highlight_compression_bias: float = Field(default=0.0, ge=-100.0, le=100.0)
    highlight_compression_color_handling: Literal["preserve_color", "path_to_white"] = "preserve_color"
    shadow_lift: float = Field(default=0.0, ge=-1.0, le=1.0)
    tone_equalizer_nodes: list[ToneEqualizerNode] = Field(
        default_factory=_default_tone_equalizer_nodes,
        min_length=2,
        max_length=16,
    )
    tone_equalizer_influence_radius: float = Field(default=1.5, ge=0.25, le=12.0)
    tone_equalizer_smoothing: float = Field(default=0.5, ge=0.0, le=1.0)
    lift: float = Field(default=0.0, ge=-1.0, le=1.0)
    gamma: float = Field(default=0.0, ge=-2.0, le=2.0)
    gain: float = Field(default=0.0, ge=-1.0, le=1.0)
    lift_pivot: float = Field(default=-2.0, ge=-12.0, le=12.0)
    lift_range: float = Field(default=4.0, ge=0.5, le=24.0)
    gamma_pivot: float = Field(default=0.0, ge=-12.0, le=12.0)
    gamma_range: float = Field(default=4.25, ge=0.5, le=24.0)
    gain_pivot: float = Field(default=2.0, ge=-12.0, le=12.0)
    gain_range: float = Field(default=4.0, ge=0.5, le=24.0)
    contrast: float = Field(default=0.0, ge=-2.0, le=2.0)
    contrast_pivot: float = Field(default=0.1845, ge=0.0001, le=18.0)
    white_balance_kelvin: int = Field(default=6500, ge=1000, le=25000)
    tint: float = Field(default=0.0, ge=-2.0, le=2.0)
    saturation: float = Field(default=0.0, ge=-1.0, le=3.0)
    vibrance: float = Field(default=0.0, ge=-1.0, le=3.0)
    red_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    red_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    green_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    green_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    blue_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    blue_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    tint_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    tint_purity: float = Field(default=0.0, ge=0.0, le=99.0)
    luma_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    red_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    green_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    blue_curve: list[list[float]] = Field(default_factory=_default_curve_points)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_hdr_controls(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        if "highlight_compression_mode" not in migrated:
            migrated["highlight_compression_mode"] = (
                "soft_ceiling" if float(migrated.get("highlight_compression_softness", 0.0) or 0.0) > 0.0 else "off"
            )
        if "highlight_compression_softness" not in migrated and "highlight_rolloff" in migrated:
            # The replacement control must be opt-in. Reusing a saved rolloff
            # strength here would alter an imported preview before the user has
            # touched Highlight Compression in the current UI.
            migrated["highlight_compression_softness"] = 0.0
        if "highlight_compression_start_nits" not in migrated and "highlight_rolloff_start_nits" in migrated:
            migrated["highlight_compression_start_nits"] = migrated["highlight_rolloff_start_nits"]
        migrated.pop("highlight_rolloff", None)
        migrated.pop("highlight_rolloff_start_nits", None)
        if "tone_equalizer_nodes" not in migrated:
            bands = migrated.get("tone_equalizer_bands")
            if isinstance(bands, list) and len(bands) == 13:
                migrated["tone_equalizer_nodes"] = [
                    {"input_ev": float(index - 6), "adjustment_ev": float(adjustment)}
                    for index, adjustment in enumerate(bands)
                ]
                migrated.pop("tone_equalizer_bands", None)
        return migrated

    @model_validator(mode="after")
    def normalize_tone_equalizer_nodes(self) -> "HDRAdjustments":
        if self.highlight_compression_target_nits <= self.highlight_compression_start_nits:
            raise ValueError("highlight compression target must be brighter than its start")
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
    model_config = ConfigDict(extra="forbid")

    base_section_enabled: bool = True
    tone_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    film_look_section_enabled: bool = True
    color_grading_section_enabled: bool = True
    vignette_section_enabled: bool = True
    film_look: FilmLookAdjustments = Field(default_factory=FilmLookAdjustments)
    color_grading: ColorGradingAdjustments = Field(default_factory=ColorGradingAdjustments)
    vignette: VignetteAdjustments = Field(default_factory=VignetteAdjustments)
    exposure: float = Field(default=0.0, ge=-8.0, le=8.0)
    highlight_recovery: float = Field(default=0.6, ge=0.0, le=4.0)
    tone_contrast: float = Field(default=1.0, ge=0.5, le=1.5)
    tone_skew: float = Field(default=0.0, ge=-1.0, le=1.0)
    shadow: float = Field(default=0.0, ge=-2.0, le=2.0)
    lift: float = Field(default=0.0, ge=-1.0, le=1.0)
    gamma: float = Field(default=0.0, ge=-2.0, le=2.0)
    gain: float = Field(default=0.0, ge=-1.0, le=1.0)
    lift_pivot: float = Field(default=-2.0, ge=-12.0, le=12.0)
    lift_range: float = Field(default=4.0, ge=0.5, le=24.0)
    gamma_pivot: float = Field(default=0.0, ge=-12.0, le=12.0)
    gamma_range: float = Field(default=4.25, ge=0.5, le=24.0)
    gain_pivot: float = Field(default=2.0, ge=-12.0, le=12.0)
    gain_range: float = Field(default=4.0, ge=0.5, le=24.0)
    contrast: float = Field(default=0.0, ge=-2.0, le=2.0)
    contrast_pivot: float = Field(default=0.5, ge=0.001, le=0.999)
    white_balance_kelvin: int = Field(default=6500, ge=1000, le=25000)
    tint: float = Field(default=0.0, ge=-2.0, le=2.0)
    saturation: float = Field(default=0.0, ge=-1.0, le=3.0)
    vibrance: float = Field(default=0.0, ge=-1.0, le=3.0)
    red_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    red_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    green_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    green_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    blue_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    blue_purity: float = Field(default=0.0, ge=-99.0, le=400.0)
    tint_hue: float = Field(default=0.0, ge=-180.0, le=180.0)
    tint_purity: float = Field(default=0.0, ge=0.0, le=99.0)
    tone_mapper: ToneMapper = ToneMapper.FILMIC
    luma_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    red_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    green_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    blue_curve: list[list[float]] = Field(default_factory=_default_curve_points)


class SharedAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overlay_mode: OverlayMode = OverlayMode.OFF
    overlay_preset: str = "web_1000_100"
    overlay_opacity: float = 0.72
    overlay_threshold: float = Field(default=100.0, ge=1.0, le=10000.0)
    film_grain_seed: int = Field(default=271828, ge=0, le=2_147_483_647)
    geometry: GeometryAdjustments = Field(default_factory=GeometryAdjustments)


class AdjustmentState(BaseModel):
    hdr: HDRAdjustments = Field(default_factory=HDRAdjustments)
    sdr: SDRAdjustments = Field(default_factory=SDRAdjustments)
    shared: SharedAdjustments = Field(default_factory=SharedAdjustments)


class MaskPoint(BaseModel):
    """A point in normalized, uncropped source coordinates."""

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    pressure: float = Field(default=1.0, ge=0.0, le=1.0)


class BrushStroke(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[MaskPoint] = Field(min_length=1, max_length=16384)
    radius: float = Field(default=0.025, gt=0.0, le=1.0)
    hardness: float = Field(default=0.75, ge=0.0, le=1.0)
    flow: float = Field(default=1.0, ge=0.0, le=1.0)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    smoothing: float = Field(default=0.35, ge=0.0, le=1.0)
    erase: bool = False


class PathNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    in_x: float | None = Field(default=None, ge=0.0, le=1.0)
    in_y: float | None = Field(default=None, ge=0.0, le=1.0)
    out_x: float | None = Field(default=None, ge=0.0, le=1.0)
    out_y: float | None = Field(default=None, ge=0.0, le=1.0)
    node_type: Literal["sharp", "smooth"] = "smooth"
    feather: float | None = Field(default=None, ge=0.0, le=0.5)


class MaskLeaf(BaseModel):
    """Typed mask payload.

    One public model keeps recursive command payloads stable while leaf-specific
    validation below rejects fields that do not make sense for the selected type.
    Sampled leaves are serializable but remain renderer feature-gated.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "brush",
        "linear_gradient",
        "luminance_range",
        "path",
        "sampled_point",
        "sampled_gradient",
    ]
    strokes: list[BrushStroke] = Field(default_factory=list, max_length=4096)
    brush_radius: float = Field(default=0.025, gt=0.0, le=1.0)
    brush_hardness: float = Field(default=0.75, ge=0.0, le=1.0)
    brush_flow: float = Field(default=1.0, ge=0.0, le=1.0)
    brush_opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    brush_smoothing: float = Field(default=0.35, ge=0.0, le=1.0)
    mask_shift_edge: float = Field(default=0.0, ge=-0.05, le=0.05)
    mask_feather: float = Field(default=0.0, ge=0.0, le=0.05)
    mask_opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    start: MaskPoint | None = None
    end: MaskPoint | None = None
    gradient_midpoint_1: float = Field(default=1.0 / 3.0, gt=0.0, lt=1.0)
    gradient_midpoint_2: float = Field(default=2.0 / 3.0, gt=0.0, lt=1.0)
    gradient_fan: float = Field(default=0.0, ge=-1.0, le=1.0)
    gradient_luma_enabled: bool = False
    fade_in_start_ev: float = Field(default=-12.0, ge=-24.0, le=24.0)
    reference_start_ev: float | None = Field(default=None, ge=-24.0, le=24.0)
    full_start_ev: float = Field(default=-8.0, ge=-24.0, le=24.0)
    full_end_ev: float = Field(default=6.0, ge=-24.0, le=24.0)
    reference_end_ev: float | None = Field(default=None, ge=-24.0, le=24.0)
    fade_out_end_ev: float = Field(default=10.0, ge=-24.0, le=24.0)
    nodes: list[PathNode] = Field(default_factory=list, max_length=16384)
    feather: float = Field(default=0.0, ge=0.0, le=0.5)
    sample: MaskPoint | None = None
    radius: float = Field(default=0.2, gt=0.0, le=2.0)
    luma_tolerance_ev: float = Field(default=1.0, gt=0.0, le=12.0)
    chroma_tolerance: float = Field(default=0.08, gt=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_leaf_payload(self) -> "MaskLeaf":
        if self.type in {"linear_gradient", "sampled_gradient"} and (self.start is None or self.end is None):
            raise ValueError(f"{self.type} masks require start and end points")
        if self.gradient_midpoint_1 >= self.gradient_midpoint_2:
            raise ValueError("gradient midpoint controls must be ordered")
        if self.type == "path" and len(self.nodes) < 3:
            raise ValueError("path masks require at least three nodes")
        if self.type == "sampled_point" and self.sample is None:
            raise ValueError("sampled_point masks require a sample point")
        if not (
            self.fade_in_start_ev
            <= self.full_start_ev
            <= self.full_end_ev
            <= self.fade_out_end_ev
        ):
            raise ValueError("luminance range handles must be ordered")
        if (self.reference_start_ev is None) != (self.reference_end_ev is None):
            raise ValueError("luminance reference bounds must both be set or both be omitted")
        if self.type == "luminance_range" and self.reference_start_ev is not None and not (
            self.reference_start_ev
            <= self.full_start_ev
            <= self.full_end_ev
            <= self.reference_end_ev
        ):
            raise ValueError("refined luminance range must remain inside its reference bounds")
        return self


class MaskExpression(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operator: Literal["leaf", "union", "intersect", "subtract"] = "leaf"
    leaf: MaskLeaf | None = None
    children: list["MaskExpression"] = Field(default_factory=list, max_length=64)
    inverted: bool = False

    @model_validator(mode="after")
    def validate_expression(self) -> "MaskExpression":
        if self.operator == "leaf":
            if self.leaf is None or self.children:
                raise ValueError("leaf expressions require exactly one leaf payload")
        elif self.leaf is not None or len(self.children) < 2:
            raise ValueError("mask operators require at least two child expressions")
        return self


def _default_local_mask() -> MaskExpression:
    return MaskExpression(
        leaf=MaskLeaf(
            type="linear_gradient",
            start=MaskPoint(x=0.25, y=0.5),
            end=MaskPoint(x=0.75, y=0.5),
        )
    )


class LocalGrade(BaseModel):
    """Pixel-local controls supported by the first local-rendering phase."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    exposure: float = Field(default=0.0, ge=-8.0, le=8.0)
    highlights: float = Field(default=0.0, ge=-2.0, le=2.0)
    midtones: float = Field(default=0.0, ge=-2.0, le=2.0)
    shadows: float = Field(default=0.0, ge=-2.0, le=2.0)
    blacks: float = Field(default=0.0, ge=-2.0, le=2.0)
    contrast: float = Field(default=0.0, ge=-2.0, le=2.0)
    contrast_pivot: float = Field(default=0.18, ge=0.001, le=4.0)
    white_balance_kelvin: int = Field(default=6500, ge=1000, le=25000)
    tint: float = Field(default=0.0, ge=-2.0, le=2.0)
    saturation: float = Field(default=0.0, ge=-1.0, le=3.0)
    vibrance: float = Field(default=0.0, ge=-1.0, le=3.0)
    luma_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    red_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    green_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    blue_curve: list[list[float]] = Field(default_factory=_default_curve_points)
    color_grading: ColorGradingAdjustments = Field(default_factory=ColorGradingAdjustments)


class LocalAdjustment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=128)
    name: str = Field(default="Local Adjustment", min_length=1, max_length=120)
    enabled: bool = True
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    mask: MaskExpression = Field(default_factory=_default_local_mask)
    hdr_grade: LocalGrade = Field(default_factory=LocalGrade)
    sdr_grade: LocalGrade = Field(default_factory=LocalGrade)


class SourceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    fingerprint_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    durable_path: str | None = None
    byte_size: int | None = Field(default=None, ge=0)


class EditDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    source: SourceReference
    interpretation_override: "SourceInterpretationOverride" = Field(default_factory=lambda: SourceInterpretationOverride())
    global_adjustments: AdjustmentState = Field(default_factory=AdjustmentState)
    local_adjustments: list[LocalAdjustment] = Field(default_factory=list, max_length=256)


class EditCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    command_type: Literal[
        "replace_document",
        "set_global_adjustments",
        "create_local",
        "update_local",
        "delete_local",
        "reorder_locals",
        "undo",
        "redo",
    ]
    target_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class EditCommandBatch(BaseModel):
    commands: list[EditCommand] = Field(min_length=1, max_length=100)


class EditStateResponse(BaseModel):
    revision: int = Field(ge=0)
    document: EditDocument
    dirty: bool = False
    can_undo: bool = False
    can_redo: bool = False


class PreviewSettings(BaseModel):
    long_edge: int = 1600
    format: str = "png"


class SessionPayload(BaseModel):
    session_id: str
    source: SourceImageDescriptor
    metadata: MetadataPayload
    analysis: HDRAnalysis
    adjustments: AdjustmentState
    edit_document: EditDocument | None = None
    edit_revision: int = Field(default=0, ge=0)
    dirty: bool = False
    can_undo: bool = False
    can_redo: bool = False
    preview: PreviewSettings
    capabilities: dict[str, CapabilityInfo]


class SessionSummary(BaseModel):
    session: SessionPayload | None


class SourceInterpretationOverride(BaseModel):
    color_space: str | None = None
    transfer_function: str | None = None


class PreviewRequest(BaseModel):
    adjustments: AdjustmentState | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    request_id: str | None = None
    generation: int | None = Field(default=None, ge=0)
    tier: Literal["interactive", "settled", "refinement"] = "settled"
    long_edge: int | None = Field(default=None, ge=256, le=2000)
    hdr_display: bool = True
    include_locals: bool = True
    local_adjustments: list[LocalAdjustment] | None = None


class LocalMaskPreviewRequest(BaseModel):
    """A non-persistent mask draft compiled against the current session source."""

    model_config = ConfigDict(extra="forbid")

    mask: MaskExpression
    edit_revision: int | None = Field(default=None, ge=0)
    long_edge: int = Field(default=1600, ge=256, le=2000)


class LocalLuminanceSampleRequest(BaseModel):
    """Viewport points sampled against the fixed scene-linear mask source."""

    model_config = ConfigDict(extra="forbid")

    points: list[MaskPoint] = Field(min_length=1, max_length=512)
    edit_revision: int | None = Field(default=None, ge=0)
    long_edge: int = Field(default=1600, ge=256, le=2000)


class LocalLuminanceSampleResponse(BaseModel):
    low_ev: float
    high_ev: float
    center_ev: float
    sample_count: int = Field(ge=1)


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
    tier: Literal["interactive", "settled", "refinement"] = "settled"
    generation: int | None = None
    normalization_peak: int = 1
    peak_value: float = 0.0
    clipped: bool = False
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
    edit_revision: int | None = Field(default=None, ge=0)
    output_finishing: OutputFinishingSettings = Field(default_factory=OutputFinishingSettings)


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
    adjustments: AdjustmentState | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    format: str = "jpeg_ultrahdr"
    quality: int = Field(default=90, ge=1, le=100)
    jpeg_gain_map_quality: int = Field(default=100, ge=1, le=100)
    jpeg_gain_map_scale: Literal["full", "half"] = "full"
    long_edge: int = Field(default=1200, ge=256, le=1600)
    output_finishing: OutputFinishingSettings = Field(default_factory=OutputFinishingSettings)


class ProjectSaveRequest(BaseModel):
    path: str
    source_path: str | None = None


class ProjectOpenRequest(BaseModel):
    path: str
    source_path: str | None = None


class ProjectResponse(BaseModel):
    path: str
    revision: int = Field(ge=0)
    document: EditDocument


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
