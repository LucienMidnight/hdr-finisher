from __future__ import annotations

from hdr_finisher.models import EditDocument, RawImportSettings
from hdr_finisher.projects import _preserve_legacy_raw_highlight_behavior


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
