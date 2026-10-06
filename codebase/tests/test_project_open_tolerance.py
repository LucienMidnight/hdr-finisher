"""A saved project outlives the settings it was saved with.

Opening one drops a field the app no longer has, and a field holding a choice
the app no longer offers. A running session stays strict: there an unknown
field or choice is a bug.
"""
from __future__ import annotations

import logging

import pytest
from pydantic import ValidationError

from hdr_finisher.models import EditDocument
from hdr_finisher.projects import _validate_ignoring_unknown_fields


def _state() -> dict[str, object]:
    return {
        "schema_version": 4,
        "hdr_reference_white_nits": 203,
        "source": {
            "filename": "saved.cr2",
            "luminance": {"luminance_semantics": "scene_relative", "transfer_function": "linear"},
        },
    }


def test_a_removed_field_is_dropped_wherever_it_sits(caplog: pytest.LogCaptureFixture) -> None:
    payload = _state()
    payload["a_removed_top_level_setting"] = 1
    payload["denoise"] = {"hdr": {"enabled": True, "analysis": {"preset": "photo_fine", "levels": 2}}}
    payload["global_adjustments"] = {"hdr": {"exposure": 0.5, "a_removed_grade_setting": True}}

    with pytest.raises(ValidationError):
        EditDocument.model_validate(payload)
    with caplog.at_level(logging.INFO, logger="hdr_finisher.projects"):
        document = _validate_ignoring_unknown_fields(payload)

    assert document.denoise.hdr.enabled is True
    assert document.global_adjustments.hdr.exposure == 0.5
    saved = document.model_dump_json()
    for name in ("a_removed_top_level_setting", "a_removed_grade_setting", "photo_fine", "levels"):
        assert name not in saved
    assert "4 outdated field(s) ignored" in caplog.text


def test_a_removed_choice_falls_back_to_the_default() -> None:
    payload = _state()
    payload["denoise"] = {"hdr": {"enabled": True, "analysis": {"algorithm_version": "compact-haar-residual-v1"}}}

    document = _validate_ignoring_unknown_fields(payload)

    assert document.denoise.hdr.enabled is True
    assert document.denoise.hdr.analysis.algorithm_version == "adaptive-atrous-v1"


def test_a_wrong_value_still_refuses_the_project() -> None:
    payload = _state()
    payload["global_adjustments"] = {"hdr": {"exposure": 99.0}}

    with pytest.raises(ValidationError):
        _validate_ignoring_unknown_fields(payload)


def test_a_current_project_is_untouched() -> None:
    payload = _state()
    assert _validate_ignoring_unknown_fields(payload) == EditDocument.model_validate(_state())
