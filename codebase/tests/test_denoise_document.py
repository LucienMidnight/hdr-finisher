from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from hdr_finisher.models import DenoiseDocumentSettings, EditCommand
from hdr_finisher.projects import open_project, save_project
from hdr_finisher.sessions import SessionStore


def test_denoise_settings_are_versioned_undoable_and_project_persistent(tmp_path: Path) -> None:
    source = tmp_path / "denoise-source.png"
    Image.fromarray(np.full((16, 24, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    settings = DenoiseDocumentSettings()
    settings.hdr.enabled = True
    settings.hdr.controls.amount = 0.73

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
    assert changed.document.denoise.hdr.controls.amount == 0.73

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
    assert reopened.denoise.hdr.controls.amount == 0.73
