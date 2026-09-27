from __future__ import annotations

import hashlib

from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, ExportSettings, ProofArtifactRequest
from hdr_finisher.proofing import ProofArtifactStore
from hdr_finisher.render_cache import adjustment_signature


HDR_FIELD_ORDER = (
    "tone_section_enabled", "highlight_section_enabled", "tone_equalizer_section_enabled",
    "color_section_enabled", "primaries_section_enabled", "curves_section_enabled",
    "detail_section_enabled", "black_and_white_section_enabled", "film_look_section_enabled",
    "color_grading_section_enabled", "vignette_section_enabled", "film_look", "color_grading",
    "vignette", "detail", "black_and_white", "exposure", "highlight_compression_start_nits",
    "highlight_compression_target_nits", "highlight_compression_softness",
    "highlight_compression_mode", "highlight_compression_peak_measurement",
    "highlight_compression_source_peak_nits", "highlight_compression_manual_peak_nits",
    "highlight_compression_peak_detail", "highlight_compression_bias",
    "highlight_compression_color_handling", "shadow_lift", "tone_equalizer_nodes",
    "tone_equalizer_influence_radius", "tone_equalizer_smoothing", "lift", "gamma", "gain",
    "lift_pivot", "lift_range", "gamma_pivot", "gamma_range", "gain_pivot", "gain_range",
    "contrast", "contrast_pivot", "white_balance_kelvin", "tint", "saturation", "vibrance",
    "red_hue", "red_purity", "green_hue", "green_purity", "blue_hue", "blue_purity",
    "tint_hue", "tint_purity", "luma_curve", "red_curve", "green_curve", "blue_curve",
)
SDR_FIELD_ORDER = (
    "rendering_version", "base_section_enabled", "use_authored_base", "tone_section_enabled",
    "highlight_section_enabled", "tone_equalizer_section_enabled", "color_section_enabled",
    "primaries_section_enabled", "curves_section_enabled", "detail_section_enabled",
    "black_and_white_section_enabled", "film_look_section_enabled",
    "color_grading_section_enabled", "vignette_section_enabled", "film_look", "color_grading",
    "vignette", "detail", "black_and_white", "exposure", "highlight_recovery",
    "highlight_compression_start_percent", "highlight_compression_softness",
    "highlight_compression_mode", "highlight_compression_peak_measurement",
    "highlight_compression_source_peak_percent", "highlight_compression_manual_peak_percent",
    "highlight_compression_peak_detail", "highlight_compression_bias",
    "highlight_compression_color_handling", "tone_contrast", "tone_skew", "shadow",
    "tone_equalizer_nodes", "tone_equalizer_influence_radius", "tone_equalizer_smoothing",
    "lift", "gamma", "gain", "lift_pivot", "lift_range", "gamma_pivot", "gamma_range",
    "gain_pivot", "gain_range", "contrast", "contrast_pivot", "white_balance_kelvin", "tint",
    "saturation", "vibrance", "red_hue", "red_purity", "green_hue", "green_purity",
    "blue_hue", "blue_purity", "tint_hue", "tint_purity", "tone_mapper", "luma_curve",
    "red_curve", "green_curve", "blue_curve",
)


def test_branch_serialization_order_and_adjustment_signature_are_stable() -> None:
    adjustments = AdjustmentState()

    assert tuple(adjustments.hdr.model_dump()) == HDR_FIELD_ORDER
    assert tuple(adjustments.sdr.model_dump()) == SDR_FIELD_ORDER
    signature = adjustment_signature(adjustments)
    assert hashlib.sha256(signature.encode()).hexdigest() == (
        "e75b6b7a29dffdfd13925e16f6bb4ed3189afabdabbe9ed22bd5b8aecec8a785"
    )
    assert AdjustmentState.model_validate(adjustments.model_dump(mode="json")) == adjustments


def test_proof_request_order_signature_and_export_conversion_are_stable() -> None:
    request = ProofArtifactRequest()
    assert tuple(request.model_dump()) == (
        "adjustments", "edit_revision", "format", "quality", "jpeg_gain_map_quality",
        "jpeg_gain_map_scale", "jpeg_chroma_subsampling", "avif_bit_depth",
        "avif_chroma_subsampling", "avif_gain_map_chroma_subsampling",
        "avif_gain_map_quality", "avif_gain_map_scale", "jpegxl_precision", "dithering",
        "long_edge", "output_finishing", "force",
    )
    assert ProofArtifactStore._request_signature(
        "session", request, RenderColorContext(203)
    ) == "27295d5e6543edfd11f1b83a"

    converted = request.to_export_settings("proof.jpg")
    for name in (
        "format", "quality", "jpeg_gain_map_quality", "jpeg_gain_map_scale",
        "jpeg_chroma_subsampling", "avif_bit_depth", "avif_chroma_subsampling",
        "avif_gain_map_chroma_subsampling", "avif_gain_map_quality", "avif_gain_map_scale",
        "jpegxl_precision", "dithering", "output_finishing",
    ):
        assert getattr(converted, name) == getattr(request, name)
    assert converted.output_path == "proof.jpg"
    assert converted.overwrite is True
    assert ExportSettings.model_validate(converted.model_dump(mode="json")) == converted
