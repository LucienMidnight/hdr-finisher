from __future__ import annotations

from datetime import datetime
from enum import Enum
import math
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .color_context import validate_reference_white


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
    VECTORSCOPE = "vectorscope"


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
    linear_reference: Literal["scene_0_18", "diffuse_white_1_0"] = "scene_0_18"
    interpretation_mode: str = "auto"
    color_space_confident: bool = True


class SourceLuminanceDescriptor(BaseModel):
    """Persistent source facts and explicitly recorded import assumptions."""

    model_config = ConfigDict(extra="forbid")

    luminance_semantics: Literal["absolute", "reference_relative", "display_relative", "scene_relative"]
    transfer_function: Literal["PQ", "HLG", "linear", "SDR", "unknown"]
    source_reference_white_nits: float | None = Field(default=None, gt=0.0, le=10000.0, allow_inf_nan=False)
    source_peak_nits: float | None = Field(default=None, gt=0.0, le=10000.0, allow_inf_nan=False)
    hlg_reference: Literal["display_referred", "scene_referred", "unknown"] = "unknown"
    hlg_nominal_peak_nits: float | None = Field(default=None, gt=0.0, le=10000.0, allow_inf_nan=False)
    sdr_rendition: Literal["authored", "generated", "none"] = "none"
    assumptions: list[str] = Field(default_factory=list)


class MetadataPayload(BaseModel):
    camera_maker: str | None = None
    camera_model: str | None = None
    lens_maker: str | None = None
    lens: str | None = None
    iso: str | None = None
    shutter_speed: str | None = None
    focal_length_mm: str | None = None
    aperture: str | None = None
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
    robust_peak_linear: float | None = None
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
    red_response: float = Field(default=0.0, ge=-100.0, le=100.0)
    green_response: float = Field(default=0.0, ge=-100.0, le=100.0)
    blue_response: float = Field(default=0.0, ge=-100.0, le=100.0)
    highlight_desaturation: float = Field(default=0.0, ge=0.0, le=100.0)
    shadow_desaturation: float = Field(default=0.0, ge=0.0, le=100.0)

    grain_enabled: bool = True
    grain_amount: float = Field(default=0.0, ge=0.0, le=100.0)
    grain_size: float = Field(default=50.0, ge=0.0, le=100.0)
    grain_softness: float = Field(default=25.0, ge=0.0, le=100.0)
    grain_chroma: float = Field(default=0.0, ge=0.0, le=100.0)
    grain_film_format: Literal[
        "65mm", "35mm", "super35", "super16", "16mm", "super8", "custom"
    ] = "35mm"
    grain_capture_geometry: Literal["frame", "horizontal_strip", "vertical_strip"] = "frame"
    grain_custom_width_mm: float = Field(default=36.0, ge=1.0, le=500.0)
    grain_custom_height_mm: float = Field(default=24.0, ge=1.0, le=500.0)
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
    perspective_horizontal: float = Field(default=0.0, ge=-100.0, le=100.0)
    perspective_vertical: float = Field(default=0.0, ge=-100.0, le=100.0)
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


class DetailAdjustments(BaseModel):
    """Neutral-by-default detail controls for global and local grades."""

    model_config = ConfigDict(extra="forbid")

    texture_amount: float = Field(default=0.0, ge=-100.0, le=100.0)
    clarity_amount: float = Field(default=0.0, ge=-100.0, le=100.0)
    clarity_radius_percent: float = Field(default=0.75, ge=0.2, le=3.0)
    sharpen_amount: float = Field(default=0.0, ge=0.0, le=200.0)
    sharpen_radius_px: float = Field(default=0.8, ge=0.3, le=3.0)
    sharpen_threshold: float = Field(default=10.0, ge=0.0, le=100.0)


class HDRAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone_section_enabled: bool = True
    highlight_section_enabled: bool = True
    tone_equalizer_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    detail_section_enabled: bool = True
    film_look_section_enabled: bool = True
    color_grading_section_enabled: bool = True
    vignette_section_enabled: bool = True
    film_look: FilmLookAdjustments = Field(default_factory=FilmLookAdjustments)
    color_grading: ColorGradingAdjustments = Field(default_factory=ColorGradingAdjustments)
    vignette: VignetteAdjustments = Field(default_factory=VignetteAdjustments)
    detail: DetailAdjustments = Field(default_factory=DetailAdjustments)
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
    use_authored_base: bool = True
    tone_section_enabled: bool = True
    tone_equalizer_section_enabled: bool = True
    color_section_enabled: bool = True
    primaries_section_enabled: bool = True
    curves_section_enabled: bool = True
    detail_section_enabled: bool = True
    film_look_section_enabled: bool = True
    color_grading_section_enabled: bool = True
    vignette_section_enabled: bool = True
    film_look: FilmLookAdjustments = Field(default_factory=FilmLookAdjustments)
    color_grading: ColorGradingAdjustments = Field(default_factory=ColorGradingAdjustments)
    vignette: VignetteAdjustments = Field(default_factory=VignetteAdjustments)
    detail: DetailAdjustments = Field(default_factory=DetailAdjustments)
    exposure: float = Field(default=0.0, ge=-8.0, le=8.0)
    highlight_recovery: float = Field(default=0.6, ge=0.0, le=4.0)
    tone_contrast: float = Field(default=1.0, ge=0.5, le=1.5)
    tone_skew: float = Field(default=0.0, ge=-1.0, le=1.0)
    shadow: float = Field(default=0.0, ge=-2.0, le=2.0)
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

    @model_validator(mode="after")
    def normalize_tone_equalizer_nodes(self) -> "SDRAdjustments":
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


class SharedAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overlay_mode: OverlayMode = OverlayMode.OFF
    false_color_band_anchor: Literal["project", "100_nits", "203_nits"] = "project"
    false_color_ceiling_nits: Literal[100, 1000, 4000] = 1000
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
    # Handles may leave the image even though the anchor itself must remain on
    # the source. This is required for smooth edge nodes and large tangents.
    in_x: float | None = Field(default=None, ge=-1.0, le=2.0)
    in_y: float | None = Field(default=None, ge=-1.0, le=2.0)
    out_x: float | None = Field(default=None, ge=-1.0, le=2.0)
    out_y: float | None = Field(default=None, ge=-1.0, le=2.0)
    node_type: Literal["sharp", "smooth"] = "smooth"
    feather: float | None = Field(default=None, ge=0.0, le=0.5)


class FeatherPathNode(BaseModel):
    """Editable feather-boundary node.

    Feather anchors may sit outside the image so a falloff can finish beyond a
    source edge. The finite bounds still reject accidental runaway payloads.
    """

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-1.0, le=2.0)
    y: float = Field(ge=-1.0, le=2.0)
    in_x: float | None = Field(default=None, ge=-1.0, le=2.0)
    in_y: float | None = Field(default=None, ge=-1.0, le=2.0)
    out_x: float | None = Field(default=None, ge=-1.0, le=2.0)
    out_y: float | None = Field(default=None, ge=-1.0, le=2.0)
    node_type: Literal["sharp", "smooth"] = "smooth"


def _flatten_validation_path(nodes: list[PathNode | FeatherPathNode], steps: int = 12) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for first, second in zip(nodes, nodes[1:] + nodes[:1]):
        p0 = (first.x, first.y)
        p1 = (first.out_x if first.out_x is not None else first.x, first.out_y if first.out_y is not None else first.y)
        p2 = (second.in_x if second.in_x is not None else second.x, second.in_y if second.in_y is not None else second.y)
        p3 = (second.x, second.y)
        curved = p0 != p1 or p2 != p3
        count = steps if curved else 1
        for index in range(count):
            t = index / count
            inverse = 1.0 - t
            points.append((
                inverse**3 * p0[0] + 3 * inverse**2 * t * p1[0] + 3 * inverse * t**2 * p2[0] + t**3 * p3[0],
                inverse**3 * p0[1] + 3 * inverse**2 * t * p1[1] + 3 * inverse * t**2 * p2[1] + t**3 * p3[1],
            ))
    return points


def _validation_segments_intersect(
    first: tuple[float, float],
    second: tuple[float, float],
    third: tuple[float, float],
    fourth: tuple[float, float],
) -> bool:
    def orientation(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    ab_c = orientation(first, second, third)
    ab_d = orientation(first, second, fourth)
    cd_a = orientation(third, fourth, first)
    cd_b = orientation(third, fourth, second)
    return ((ab_c > 1e-8 > ab_d) or (ab_c < -1e-8 < ab_d)) and (
        (cd_a > 1e-8 > cd_b) or (cd_a < -1e-8 < cd_b)
    )


def _validation_path_is_simple(points: list[tuple[float, float]]) -> bool:
    for first in range(len(points)):
        first_next = (first + 1) % len(points)
        for second in range(first + 1, len(points)):
            second_next = (second + 1) % len(points)
            if first_next == second or second_next == first or (first == 0 and second_next == 0):
                continue
            if _validation_segments_intersect(points[first], points[first_next], points[second], points[second_next]):
                return False
    return True


def _validation_polygon_contains(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    inside = False
    previous = len(polygon) - 1
    for index, current in enumerate(polygon):
        prior = polygon[previous]
        cross = (current[1] > point[1]) != (prior[1] > point[1])
        if cross and point[0] < (prior[0] - current[0]) * (point[1] - current[1]) / (prior[1] - current[1] + 1e-12) + current[0]:
            inside = not inside
        previous = index
    return inside


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
    feather_softness: float = Field(default=0.0, ge=0.0, le=1.0)
    feather_mode: Literal["symmetric", "outer_boundary"] = "symmetric"
    feather_nodes: list[FeatherPathNode] = Field(default_factory=list, max_length=16384)
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
        if self.type == "path" and self.feather_nodes and len(self.feather_nodes) < 3:
            raise ValueError("editable feather boundaries require at least three nodes")
        if self.type == "path" and self.feather_mode == "symmetric" and self.feather_nodes:
            raise ValueError("legacy symmetric path feathering cannot carry editable feather nodes")
        if self.type == "path":
            inner = _flatten_validation_path(self.nodes)
            if not _validation_path_is_simple(inner):
                raise ValueError("path masks cannot self-intersect")
            if self.feather_nodes:
                outer = _flatten_validation_path(self.feather_nodes)
                # A folded outer guide is valid for additive feathering: each
                # local band contributes coverage and overlaps merge by max.
                # Preserve the containment guard for ordinary simple guides.
                if (
                    self.feather > 1e-8
                    and _validation_path_is_simple(outer)
                    and not all(_validation_polygon_contains(point, outer) for point in inner)
                ):
                    raise ValueError("editable feather boundaries must contain the complete path")
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
    detail: DetailAdjustments = Field(default_factory=DetailAdjustments)


class LocalAdjustment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=128)
    name: str = Field(default="Local Adjustment", min_length=1, max_length=120)
    enabled: bool = True
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    mask: MaskExpression = Field(default_factory=_default_local_mask)
    hdr_grade: LocalGrade = Field(default_factory=LocalGrade)
    sdr_grade: LocalGrade = Field(default_factory=LocalGrade)


class CapturedHDRLocalAdjustment(BaseModel):
    """The ordered HDR side of a local adjustment captured by SDR Match."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    enabled: bool
    opacity: float = Field(ge=0.0, le=1.0)
    mask: MaskExpression
    hdr_grade: LocalGrade


class SDRLocalGradeSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    sdr_grade: LocalGrade


class DenoiseLiveControls(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: float = Field(default=0.5, ge=0.0, le=1.0)
    luminance: float = Field(default=0.5, ge=0.0, le=1.0)
    color_noise: float = Field(default=0.5, ge=0.0, le=1.0)
    detail_recovery: float = Field(default=0.5, ge=0.0, le=1.0)


class DenoiseAnalysisSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    algorithm_version: Literal["compact-haar-residual-v1"] = "compact-haar-residual-v1"
    preset: Literal["photo_fine", "photo_mixed", "render_fine", "render_coarse", "custom"] = "photo_fine"
    levels: int = Field(default=2, ge=1, le=4)
    noise_threshold: float = Field(default=3.0, gt=0.0, le=16.0)
    luma_sigma: float = Field(default=0.035, gt=0.0, le=2.0)
    chroma_sigma: float = Field(default=0.035, gt=0.0, le=2.0)


class DenoiseLaneSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    controls: DenoiseLiveControls = Field(default_factory=DenoiseLiveControls)
    analysis: DenoiseAnalysisSettings = Field(default_factory=DenoiseAnalysisSettings)


class DenoiseDocumentSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    hdr: DenoiseLaneSettings = Field(default_factory=DenoiseLaneSettings)
    sdr: DenoiseLaneSettings = Field(default_factory=DenoiseLaneSettings)


class SDRMatchRevertState(BaseModel):
    """Independent SDR state retained by the first successful Match."""

    model_config = ConfigDict(extra="forbid")

    sdr_adjustments: SDRAdjustments
    sdr_denoise: DenoiseLaneSettings = Field(default_factory=DenoiseLaneSettings)
    local_grades: list[SDRLocalGradeSnapshot] = Field(default_factory=list, max_length=256)
    authored_sdr_base_active: bool = False


class SDRMatchQualityMetrics(BaseModel):
    """Diagnostics for a materialized match; never participates in rendering."""

    model_config = ConfigDict(extra="forbid")

    median_luma_error: float = Field(ge=0.0, allow_inf_nan=False)
    p95_luma_error: float = Field(ge=0.0, allow_inf_nan=False)
    median_oklab_error: float = Field(ge=0.0, allow_inf_nan=False)
    p95_oklab_error: float = Field(ge=0.0, allow_inf_nan=False)


class SdrMatchState(BaseModel):
    """Legacy snapshot state plus non-rendering diagnostics for materialized matches."""

    model_config = ConfigDict(extra="forbid")

    active: bool = False
    stale: bool = False
    grain_source: Literal["captured_hdr", "sdr_override"] | None = None
    algorithm_version: Literal["hdr-to-sdr-match-v1", "hdr-to-sdr-materialized-v2"] = "hdr-to-sdr-match-v1"
    captured_hdr_adjustments: HDRAdjustments | None = None
    captured_shared_adjustments: SharedAdjustments | None = None
    captured_locals: list[CapturedHDRLocalAdjustment] = Field(default_factory=list, max_length=256)
    captured_reference_white_nits: Literal[100, 203] | None = None
    captured_source_fingerprint_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    automatic_highlight_boundary_ratio: float | None = Field(default=None, ge=0.60, le=0.90)
    manual_highlight_boundary_ratio: float | None = Field(default=None, ge=0.50, le=0.95)
    signature: str | None = Field(default=None, min_length=1, max_length=256)
    revert_state: SDRMatchRevertState | None = None
    materialized_status: Literal["matched", "needs_review"] | None = None
    materialized_metrics: SDRMatchQualityMetrics | None = None

    @model_validator(mode="after")
    def validate_active_state(self) -> "SdrMatchState":
        if not self.active:
            if self.grain_source is not None:
                raise ValueError("inactive SDR Match state cannot select a grain source")
            dormant_values = (
                self.captured_hdr_adjustments,
                self.captured_shared_adjustments,
                self.captured_reference_white_nits,
                self.captured_source_fingerprint_sha256,
                self.automatic_highlight_boundary_ratio,
                self.manual_highlight_boundary_ratio,
                self.signature,
                self.revert_state,
            )
            if self.captured_locals or any(value is not None for value in dormant_values):
                raise ValueError("inactive SDR Match state cannot retain a captured recipe or Revert state")
            if (self.materialized_status is None) != (self.materialized_metrics is None):
                raise ValueError("materialized SDR Match status and metrics must be stored together")
            if self.materialized_status is not None and self.algorithm_version != "hdr-to-sdr-materialized-v2":
                raise ValueError("materialized SDR Match diagnostics require the v2 algorithm")
            return self
        if self.algorithm_version != "hdr-to-sdr-match-v1":
            raise ValueError("only legacy v1 SDR Match state may activate the hidden renderer")
        if self.materialized_status is not None or self.materialized_metrics is not None:
            raise ValueError("an active legacy SDR Match cannot contain materialization diagnostics")
        if self.grain_source is None:
            raise ValueError("active SDR Match state requires a grain source")
        required = {
            "captured_hdr_adjustments": self.captured_hdr_adjustments,
            "captured_shared_adjustments": self.captured_shared_adjustments,
            "captured_reference_white_nits": self.captured_reference_white_nits,
            "captured_source_fingerprint_sha256": self.captured_source_fingerprint_sha256,
            "automatic_highlight_boundary_ratio": self.automatic_highlight_boundary_ratio,
            "signature": self.signature,
            "revert_state": self.revert_state,
        }
        missing = [name for name, value in required.items() if value is None]
        if missing:
            raise ValueError(f"active SDR Match state is missing: {', '.join(missing)}")
        return self


class LensCorrectionSettings(BaseModel):
    """Reproducible Lensfun selection without silently substituting profiles."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["off", "auto", "manual"] = "auto"
    profile_id: str | None = Field(default=None, max_length=512)
    database_version: str | None = Field(default=None, max_length=128)
    distortion: bool = True
    chromatic_aberration: bool = True
    vignetting: bool = True
    focal_length_mm: float | None = Field(default=None, gt=0.0, le=2000.0)
    aperture: float | None = Field(default=None, gt=0.0, le=128.0)
    focus_distance_m: float | None = Field(default=None, gt=0.0, le=1_000_000.0)


class RawImportSettings(BaseModel):
    """Small, deterministic RAW-development surface stored with the project."""

    model_config = ConfigDict(extra="forbid")

    white_balance: Literal["as_shot"] = "as_shot"
    demosaic: Literal["ahd"] = "ahd"
    lens: LensCorrectionSettings = Field(default_factory=LensCorrectionSettings)


class SourceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    fingerprint_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    durable_path: str | None = None
    byte_size: int | None = Field(default=None, ge=0)
    raw_import_settings: RawImportSettings = Field(default_factory=RawImportSettings)
    luminance: SourceLuminanceDescriptor


class EditDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[4] = 4
    hdr_reference_white_nits: Literal[100, 203]
    source: SourceReference
    interpretation_override: "SourceInterpretationOverride" = Field(default_factory=lambda: SourceInterpretationOverride())
    global_adjustments: AdjustmentState = Field(default_factory=AdjustmentState)
    local_adjustments: list[LocalAdjustment] = Field(default_factory=list, max_length=256)
    denoise: DenoiseDocumentSettings = Field(default_factory=DenoiseDocumentSettings)
    sdr_match: SdrMatchState = Field(default_factory=SdrMatchState)

    @model_validator(mode="before")
    @classmethod
    def reject_legacy_documents(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("schema_version") in {1, 2, 3}:
            raise ValueError(
                "Unsupported project schema v1/v2/v3. HDR Finisher v4 projects must be created again; migration is not supported."
            )
        return value

    @field_validator("hdr_reference_white_nits", mode="before")
    @classmethod
    def validate_hdr_reference_white(cls, value: object) -> int:
        return validate_reference_white(value)


class EditCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    command_type: Literal[
        "replace_document",
        "set_hdr_reference_white",
        "set_global_adjustments",
        "set_denoise_settings",
        "create_local",
        "update_local",
        "delete_local",
        "reorder_locals",
        "set_sdr_match",
        "undo",
        "redo",
    ]
    target_id: str | None = None
    history_group: str | None = Field(default=None, min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)


class EditCommandBatch(BaseModel):
    commands: list[EditCommand] = Field(min_length=1, max_length=100)


class SdrMatchActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    action: Literal["match", "convert", "revert"]
    authored_sdr_override_consent: bool = False


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
    linear_reference: Literal["scene_0_18", "diffuse_white_1_0"] | None = None


class ScopeRegion(BaseModel):
    """Normalized post-geometry rectangle used only for scope analysis."""

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    y: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    width: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    height: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_extents(self) -> "ScopeRegion":
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("Scope region must stay within the post-geometry frame.")
        return self


class PreviewRequest(BaseModel):
    adjustments: AdjustmentState | None = None
    transient_adjustments: bool = False
    edit_revision: int | None = Field(default=None, ge=0)
    request_id: str | None = None
    generation: int | None = Field(default=None, ge=0)
    tier: Literal["interactive", "settled", "refinement"] = "settled"
    long_edge: int | None = Field(default=None, ge=256, le=16384)
    hdr_display: bool = True
    include_locals: bool = True
    local_adjustments: list[LocalAdjustment] | None = None
    scope_region: ScopeRegion | None = None


class LocalMaskPreviewRequest(BaseModel):
    """A non-persistent mask draft compiled against the current session source."""

    model_config = ConfigDict(extra="forbid")

    mask: MaskExpression
    adjustments: AdjustmentState | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    long_edge: int = Field(default=1600, ge=256, le=16384)


class GeometryMapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adjustments: AdjustmentState | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    long_edge: int = Field(default=1600, ge=256, le=16384)


class GeometryMapResponse(BaseModel):
    geometry_signature: str
    output_to_source: list[float] = Field(min_length=9, max_length=9)
    source_to_output: list[float] = Field(min_length=9, max_length=9)
    output_width: int = Field(gt=0)
    output_height: int = Field(gt=0)


class PerspectiveGuideLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: MaskPoint
    end: MaskPoint

    @model_validator(mode="after")
    def validate_length(self) -> "PerspectiveGuideLine":
        if math.hypot(self.end.x - self.start.x, self.end.y - self.start.y) < 0.05:
            raise ValueError("perspective guide lines must span at least five percent of the image")
        return self


class PerspectiveSolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adjustments: AdjustmentState
    vertical_guides: list[PerspectiveGuideLine] = Field(default_factory=list, max_length=2)
    horizontal_guides: list[PerspectiveGuideLine] = Field(default_factory=list, max_length=2)
    edit_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_guide_pairs(self) -> "PerspectiveSolveRequest":
        if len(self.vertical_guides) not in {0, 2} or len(self.horizontal_guides) not in {0, 2}:
            raise ValueError("perspective solving requires exactly two guides for each selected orientation")
        if not self.vertical_guides and not self.horizontal_guides:
            raise ValueError("at least one perspective guide pair is required")
        return self


class PerspectiveSolveResponse(BaseModel):
    perspective_horizontal: float = Field(ge=-100.0, le=100.0)
    perspective_vertical: float = Field(ge=-100.0, le=100.0)
    straighten_angle: float = Field(ge=-45.0, le=45.0)
    residual_degrees: float = Field(ge=0.0)


class LocalLuminanceSampleRequest(BaseModel):
    """Viewport points sampled against the fixed scene-linear mask source."""

    model_config = ConfigDict(extra="forbid")

    points: list[MaskPoint] = Field(min_length=1, max_length=512)
    edit_revision: int | None = Field(default=None, ge=0)
    long_edge: int = Field(default=1600, ge=256, le=16384)


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


class ExportTargetIdentity(BaseModel):
    device: str
    inode: str
    size: str
    modifiedNs: str


class ExportSettings(BaseModel):
    format: str = "jpeg_ultrahdr"
    quality: int = Field(default=85, ge=1, le=100)
    jpeg_gain_map_quality: int = Field(default=100, ge=1, le=100)
    jpeg_gain_map_scale: Literal["full", "half"] = "full"
    jpeg_chroma_subsampling: Literal["420", "422", "444"] = "420"
    avif_bit_depth: Literal[8, 10, 12] = 10
    avif_chroma_subsampling: Literal["420", "422", "444"] = "420"
    avif_gain_map_chroma_subsampling: Literal["400", "420", "422", "444"] = "444"
    avif_gain_map_quality: int | None = Field(default=None, ge=1, le=100)
    avif_gain_map_scale: Literal["full", "half"] = "half"
    sdr_png_bit_depth: Literal[8, 16] = 8
    jpegxl_precision: Literal["uint10", "uint12", "uint16", "float16", "float32"] = "uint12"
    dithering: Literal["auto", "off", "subtle"] = "auto"
    metadata_policy: Literal["none", "copyright", "all_except_location", "all_including_location"] = "none"
    output_path: str | None = None
    path_grant: str | None = None
    overwrite: bool = False
    overwrite_target: ExportTargetIdentity | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    output_finishing: OutputFinishingSettings = Field(default_factory=OutputFinishingSettings)


class ExportResponse(BaseModel):
    accepted: bool
    backend: str
    message: str
    output_path: str | None = None
    timings_ms: dict[str, float] = Field(default_factory=dict)


class DirectoryPickRequest(BaseModel):
    initial_directory: str | None = None


class DirectoryPickResponse(BaseModel):
    directory: str | None = None


class FavoritePathRequest(BaseModel):
    path: str


class DesktopPathGrantRequest(BaseModel):
    path: str
    intent: Literal["source-open", "source-relink", "project-open", "project-save", "export-file"]


class DesktopPathGrantResponse(BaseModel):
    grant: str
    path: str


class DesktopSessionOpenRequest(BaseModel):
    grant: str
    raw_import_settings: RawImportSettings = Field(default_factory=RawImportSettings)


class ImportJobRequest(BaseModel):
    grant: str
    raw_import_settings: RawImportSettings = Field(default_factory=RawImportSettings)
    replace_session_id: str | None = None


class DesktopProjectOpenRequest(BaseModel):
    project_grant: str
    source_grant: str | None = None


class DesktopProjectSaveRequest(BaseModel):
    project_grant: str


class ProofArtifactRequest(BaseModel):
    adjustments: AdjustmentState | None = None
    edit_revision: int | None = Field(default=None, ge=0)
    format: str = "jpeg_ultrahdr"
    quality: int = Field(default=90, ge=1, le=100)
    jpeg_gain_map_quality: int = Field(default=100, ge=1, le=100)
    jpeg_gain_map_scale: Literal["full", "half"] = "full"
    jpeg_chroma_subsampling: Literal["420", "422", "444"] = "420"
    avif_bit_depth: Literal[8, 10, 12] = 10
    avif_chroma_subsampling: Literal["420", "422", "444"] = "420"
    avif_gain_map_chroma_subsampling: Literal["400", "420", "422", "444"] = "444"
    avif_gain_map_quality: int | None = Field(default=None, ge=1, le=100)
    avif_gain_map_scale: Literal["full", "half"] = "half"
    jpegxl_precision: Literal["uint10", "uint12", "uint16", "float16", "float32"] = "uint12"
    dithering: Literal["auto", "off", "subtle"] = "auto"
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
