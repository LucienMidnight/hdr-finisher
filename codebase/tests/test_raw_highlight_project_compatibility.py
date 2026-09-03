from __future__ import annotations

from hdr_finisher.models import EditDocument, RawImportSettings
from hdr_finisher.projects import (
    _migrate_legacy_highlight_off_mode,
    _preserve_legacy_raw_highlight_behavior,
    _preserve_legacy_sdr_rendering,
)


def _legacy_v4_state() -> dict[str, object]:
    return {
        "schema_version": 4,
        "hdr_reference_white_nits": 203,
        "source": {
            "filename": "legacy.cr2",
            "raw_import_settings": {
                "white_balance": "as_shot",
                "demosaic": "ahd",
                "lens": {"mode": "off"},
            },
            "luminance": {
                "luminance_semantics": "scene_relative",
                "transfer_function": "linear",
            },
        },
    }


def test_new_raw_recipes_default_opposed_color_reconstruction_on() -> None:
    settings = RawImportSettings()

    assert settings.highlight_reconstruction.enabled is True
    assert settings.highlight_reconstruction.method == "opposed_color_v1"
    assert settings.highlight_reconstruction.clipping_threshold == 1.0


def test_pre_module_v4_project_is_migrated_to_explicit_bypass() -> None:
    payload = _legacy_v4_state()

    _preserve_legacy_raw_highlight_behavior(payload)
    document = EditDocument.model_validate(payload)

    highlights = document.source.raw_import_settings.highlight_reconstruction
    assert highlights.enabled is False
    assert highlights.method == "opposed_color_v1"
    assert highlights.clipping_threshold == 1.0


def test_legacy_highlight_off_mode_moves_to_the_section_bypass() -> None:
    payload = _legacy_v4_state()
    payload["global_adjustments"] = {
        "hdr": {
            "highlight_section_enabled": True,
            "highlight_compression_mode": "off",
        }
    }

    _migrate_legacy_highlight_off_mode(payload)

    hdr = payload["global_adjustments"]["hdr"]
    assert hdr["highlight_section_enabled"] is False
    assert hdr["highlight_compression_mode"] == "peak_fit"


def test_pre_sdr_highlight_project_keeps_legacy_base_rendition_renderer() -> None:
    payload = _legacy_v4_state()
    payload["global_adjustments"] = {"sdr": {"tone_mapper": "aces", "highlight_recovery": 1.25}}

    _preserve_legacy_sdr_rendering(payload)
    document = EditDocument.model_validate(payload)

    assert document.global_adjustments.sdr.rendering_version == "legacy_base_v1"
    assert document.global_adjustments.sdr.tone_mapper.value == "aces"
    assert document.global_adjustments.sdr.highlight_recovery == 1.25


def test_explicit_sdr_highlight_renderer_is_not_downgraded_by_project_migration() -> None:
    payload = _legacy_v4_state()
    payload["global_adjustments"] = {"sdr": {"rendering_version": "highlight_v2"}}

    _preserve_legacy_sdr_rendering(payload)

    assert payload["global_adjustments"]["sdr"]["rendering_version"] == "highlight_v2"
