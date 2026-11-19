from __future__ import annotations

import pytest

from pathlib import Path

import numpy as np
from PIL import Image

from hdr_finisher.models import DenoiseDocumentSettings, DenoiseLiveControls, EditCommand
from hdr_finisher.projects import open_project, save_project
from hdr_finisher.sessions import SessionStore


@pytest.mark.parametrize("amount,color,detail", [(0.73, 0.61, 0.63), (0.5, 0.5, 0.0)])
def test_denoise_settings_are_versioned_undoable_and_project_persistent(
    tmp_path: Path, amount: float, color: float, detail: float,
) -> None:
    source = tmp_path / "denoise-source.png"
    Image.fromarray(np.full((16, 24, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    settings = DenoiseDocumentSettings()
    settings.hdr.enabled = True
    settings.hdr.controls.amount = amount
    settings.hdr.controls.color_noise = color
    settings.hdr.controls.detail_recovery = detail
    settings.hdr.controls.method = "fine_grain" if amount > .5 else "clean_grain"
    settings.hdr.controls.grain_evenness = .77
    settings.hdr.controls.color_splotches = .39
    settings.hdr.controls.splotch_size = "small"
    settings.hdr.controls.dark_specks = .66

    changed = store.apply_edit_commands(
        payload.session_id,
        [EditCommand(
            expected_revision=0,
            command_type="set_denoise_settings",
            payload={"denoise": settings.model_dump(mode="json")},
        )],
    )
    assert changed.document.denoise.schema_version == 1
    assert changed.document.denoise.hdr.enabled is True
    assert changed.document.denoise.hdr.controls.amount == amount
    assert changed.document.denoise.hdr.controls.color_noise == color
    assert changed.document.denoise.hdr.controls.detail_recovery == detail

    undone = store.apply_edit_commands(
        payload.session_id,
        [EditCommand(expected_revision=1, command_type="undo")],
    )
    assert undone.document.denoise.hdr.enabled is False

    redone = store.apply_edit_commands(
        payload.session_id,
        [EditCommand(expected_revision=2, command_type="redo")],
    )
    assert redone.document.denoise.hdr.enabled is True

    project_path = tmp_path / "denoise.hdrfinisher"
    save_project(store.get(payload.session_id), project_path)
    reopened = open_project(store, project_path)
    assert reopened.denoise.schema_version == 1
    assert reopened.denoise.hdr.enabled is True
    assert reopened.denoise.hdr.controls.amount == amount
    assert reopened.denoise.hdr.controls.color_noise == color
    assert reopened.denoise.hdr.controls.detail_recovery == detail
    assert reopened.denoise.hdr.controls == settings.hdr.controls


def test_new_denoise_settings_use_approved_d1_defaults() -> None:
    from dataclasses import asdict
    from hdr_finisher.denoise_adaptive import AdaptiveControls
    from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault

    expected = dict(amount=0.75, luminance=0.5, color_noise=0.75,
                    detail_recovery=0.5, finest_noise=0.5, fine_noise=0.5,
                    medium_noise=0.5, coarse_noise=0.5, method="standard",
                    grain_evenness=1, color_splotches=1, splotch_size="large",
                    dark_specks=1)
    assert DenoiseLiveControls().model_dump() == expected
    assert asdict(AdaptiveControls()) == expected
    assert asdict(AppDefault().controls) == expected
    settings = DenoiseDocumentSettings()
    for lane in (settings.hdr, settings.sdr):
        assert not lane.enabled
        assert lane.controls.model_dump() == expected


def test_a_live_edit_refuses_the_removed_wavelet_fields() -> None:
    # Strict in a running session; a saved project drops them on open instead
    # (tests/test_project_open_tolerance.py).
    with pytest.raises(ValueError):
        DenoiseDocumentSettings.model_validate({"hdr": {"analysis": {"preset": "photo_fine", "levels": 2}}})

