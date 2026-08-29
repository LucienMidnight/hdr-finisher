from __future__ import annotations

import json
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image
import pytest
from pydantic import ValidationError

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.models import (
    AdjustmentState,
    DetailAdjustments,
    EditCommand,
    EditDocument,
    PreviewKind,
    SDRMatchRevertState,
    SdrMatchState,
)
from hdr_finisher.projects import ProjectError, open_project, save_project
from hdr_finisher.sessions import EditCommandError, RevisionConflictError, SessionStore


def _store_with_source(tmp_path: Path) -> tuple[SessionStore, str]:
    source = tmp_path / "match-source.png"
    Image.fromarray(np.full((12, 16, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    return store, payload.session_id


def _active_match_state(store: SessionStore, session_id: str, *, grain_source: str = "captured_hdr") -> SdrMatchState:
    session = store.get(session_id)
    return SdrMatchState(
        active=True,
        grain_source=grain_source,
        captured_hdr_adjustments=session.adjustments.hdr.model_copy(deep=True),
        captured_shared_adjustments=session.adjustments.shared.model_copy(deep=True),
        captured_reference_white_nits=session.hdr_reference_white_nits,
        captured_source_fingerprint_sha256=session.source_fingerprint_sha256,
        automatic_highlight_boundary_ratio=0.8,
        signature="test-match-signature",
        revert_state=SDRMatchRevertState(
            sdr_adjustments=session.adjustments.sdr.model_copy(deep=True),
            authored_sdr_base_active=session.sdr_reference_image is not None,
        ),
    )


def _match_command(
    store: SessionStore,
    session_id: str,
    *,
    expected_revision: int,
    state: SdrMatchState,
    adjustments: AdjustmentState | None = None,
    consent: bool = False,
) -> EditCommand:
    session = store.get(session_id)
    return EditCommand(
        expected_revision=expected_revision,
        command_type="set_sdr_match",
        payload={
            "match_state": state.model_dump(mode="json"),
            "global_adjustments": (adjustments or session.adjustments).model_dump(mode="json"),
            "local_adjustments": [item.model_dump(mode="json") for item in session.local_adjustments],
            "authored_sdr_override_consent": consent,
        },
    )


def test_schema_v4_has_neutral_detail_and_inactive_match_defaults(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    document = store.get(session_id).edit_document()

    assert document.schema_version == 4
    assert document.global_adjustments.hdr.detail == DetailAdjustments()
    assert document.global_adjustments.sdr.detail == DetailAdjustments()
    assert document.sdr_match == SdrMatchState()


def test_sdr_match_grain_source_invariant() -> None:
    with pytest.raises(ValidationError, match="inactive SDR Match state cannot select"):
        SdrMatchState(grain_source="captured_hdr")
    with pytest.raises(ValidationError, match="active SDR Match state requires a grain source"):
        SdrMatchState(active=True)


def test_schema_v3_is_rejected_by_model_and_project_gate(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    legacy_document = store.get(session_id).edit_document().model_dump(mode="json")
    legacy_document["schema_version"] = 3

    with pytest.raises(ValidationError, match="migration is not supported"):
        EditDocument.model_validate(legacy_document)

    project = tmp_path / "legacy.hdrfinisher"
    with zipfile.ZipFile(project, "w") as archive:
        archive.writestr("manifest.json", json.dumps({
            "format": "HDR Finisher Project",
            "schema_version": 3,
            "contains_source_pixels": False,
        }))
        archive.writestr("edit-state.json", json.dumps(legacy_document))

    with pytest.raises(ProjectError, match="create a new v4 project"):
        open_project(store, project)


def test_set_sdr_match_is_one_deterministic_undo_step(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    state = _active_match_state(store, session_id)
    target = store.get(session_id).adjustments.model_copy(deep=True)
    target.sdr.exposure = 0.75

    changed = store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=state, adjustments=target)],
    )
    session = store.get(session_id)
    assert changed.revision == 1
    assert changed.document.sdr_match.grain_source == "captured_hdr"
    assert changed.document.global_adjustments.sdr.exposure == 0.75
    assert len(session.undo_history) == 1
    assert session.undo_history[0].forward.command_type == "set_sdr_match"
    assert session.undo_history[0].inverse.command_type == "set_sdr_match"

    undone = store.apply_edit_commands(
        session_id,
        [EditCommand(expected_revision=1, command_type="undo")],
    )
    assert undone.revision == 2
    assert undone.document.sdr_match.active is False
    assert undone.document.global_adjustments.sdr.exposure == 0.0

    redone = store.apply_edit_commands(
        session_id,
        [EditCommand(expected_revision=2, command_type="redo")],
    )
    assert redone.revision == 3
    assert redone.document.sdr_match.model_dump() == state.model_dump()
    assert redone.document.global_adjustments.sdr.exposure == 0.75

    with pytest.raises(RevisionConflictError):
        store.apply_edit_commands(
            session_id,
            [_match_command(store, session_id, expected_revision=0, state=state)],
        )
    assert store.get(session_id).edit_revision == 3


def test_slider_history_group_undoes_one_complete_gesture(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    for revision, exposure in enumerate((0.15, 0.55, 0.9)):
        target = store.get(session_id).adjustments.model_copy(deep=True)
        target.hdr.exposure = exposure
        store.apply_edit_commands(session_id, [EditCommand(
            expected_revision=revision,
            command_type="set_global_adjustments",
            history_group="slider-1",
            payload={"adjustments": target.model_dump(mode="json")},
        )])

    session = store.get(session_id)
    assert session.edit_revision == 3
    assert len(session.undo_history) == 1
    assert session.adjustments.hdr.exposure == 0.9

    undone = store.apply_edit_commands(
        session_id, [EditCommand(expected_revision=3, command_type="undo")]
    )
    assert undone.document.global_adjustments.hdr.exposure == 0.0
    redone = store.apply_edit_commands(
        session_id, [EditCommand(expected_revision=4, command_type="redo")]
    )
    assert redone.document.global_adjustments.hdr.exposure == 0.9


def test_match_scales_hdr_shoulder_into_sdr_display_linear_range() -> None:
    image = np.full((4, 6, 3), 0.18, dtype=np.float32)
    adjustments = AdjustmentState()
    adjustments.sdr.base_section_enabled = False
    match = SdrMatchState(
        active=True,
        grain_source="captured_hdr",
        captured_hdr_adjustments=adjustments.hdr.model_copy(deep=True),
        captured_shared_adjustments=adjustments.shared.model_copy(deep=True),
        captured_reference_white_nits=203,
        captured_source_fingerprint_sha256="0" * 64,
        automatic_highlight_boundary_ratio=0.8,
        signature="reference-white-test",
        revert_state=SDRMatchRevertState(sdr_adjustments=adjustments.sdr.model_copy(deep=True)),
    )

    rendered = apply_adjustments(
        image, adjustments, PreviewKind.SDR, include_grain=False, sdr_match=match
    )
    knee = 0.8
    mapped_reference = 1.0 - (1.0 - knee) * np.exp(-(1.0 - knee) / (1.0 - knee))
    np.testing.assert_allclose(rendered, mapped_reference * 100.0 / 203.0, atol=1e-4)


def test_v4_project_persists_active_match_state(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    state = _active_match_state(store, session_id)
    store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=state)],
    )

    project = tmp_path / "matched.hdrfinisher"
    save_project(store.get(session_id), project)
    with zipfile.ZipFile(project, "r") as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["schema_version"] == 4

    reopened = open_project(store, project)
    assert reopened.sdr_match.model_dump() == state.model_dump()
    assert reopened.edit_document().schema_version == 4


def test_inherited_grain_requires_atomic_override_but_other_film_controls_do_not(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    inherited = _active_match_state(store, session_id)
    store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=inherited)],
    )

    ordinary = store.get(session_id).adjustments.model_copy(deep=True)
    ordinary.sdr.film_look.grain_size = 63.0
    with pytest.raises(EditCommandError, match="switch to an override"):
        store.apply_edit_commands(
            session_id,
            [EditCommand(
                expected_revision=1,
                command_type="set_global_adjustments",
                payload={"adjustments": ordinary.model_dump(mode="json")},
            )],
        )
    assert store.get(session_id).edit_revision == 1

    non_grain = store.get(session_id).adjustments.model_copy(deep=True)
    non_grain.sdr.film_look.look_strength = 72.0
    store.apply_edit_commands(
        session_id,
        [EditCommand(
            expected_revision=1,
            command_type="set_global_adjustments",
            payload={"adjustments": non_grain.model_dump(mode="json")},
        )],
    )
    assert store.get(session_id).sdr_match.grain_source == "captured_hdr"

    override = _active_match_state(store, session_id, grain_source="sdr_override")
    override_target = store.get(session_id).adjustments.model_copy(deep=True)
    override_target.sdr.film_look.grain_size = 63.0
    result = store.apply_edit_commands(
        session_id,
        [_match_command(
            store,
            session_id,
            expected_revision=2,
            state=override,
            adjustments=override_target,
        )],
    )
    assert result.document.sdr_match.grain_source == "sdr_override"
    assert result.document.global_adjustments.sdr.film_look.grain_size == 63.0


@pytest.mark.parametrize(("field_name", "value"), (
    ("grain_enabled", False),
    ("grain_amount", 1.0),
    ("grain_size", 63.0),
    ("grain_softness", 26.0),
    ("grain_chroma", 1.0),
    ("grain_film_format", "16mm"),
    ("grain_capture_geometry", "horizontal_strip"),
    ("grain_custom_width_mm", 37.0),
    ("grain_custom_height_mm", 25.0),
    ("grain_shadow_response", 101.0),
    ("grain_midtone_response", 101.0),
    ("grain_highlight_response", 101.0),
))
def test_every_sdr_grain_field_is_guarded_while_inherited(
    tmp_path: Path,
    field_name: str,
    value: object,
) -> None:
    store, session_id = _store_with_source(tmp_path)
    inherited = _active_match_state(store, session_id)
    store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=inherited)],
    )
    target = store.get(session_id).adjustments.model_copy(deep=True)
    setattr(target.sdr.film_look, field_name, value)

    with pytest.raises(EditCommandError, match="switch to an override"):
        store.apply_edit_commands(
            session_id,
            [EditCommand(
                expected_revision=1,
                command_type="set_global_adjustments",
                payload={"adjustments": target.model_dump(mode="json")},
            )],
        )


def test_explicit_revert_is_one_state_replacement_and_restores_sdr(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    before = store.get(session_id).adjustments.model_copy(deep=True)
    state = _active_match_state(store, session_id)
    matched = before.model_copy(deep=True)
    matched.sdr.exposure = 1.25
    store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=state, adjustments=matched)],
    )

    reverted = store.apply_edit_commands(
        session_id,
        [_match_command(
            store,
            session_id,
            expected_revision=1,
            state=SdrMatchState(),
            adjustments=before,
        )],
    )
    assert reverted.revision == 2
    assert reverted.document.sdr_match.active is False
    assert reverted.document.global_adjustments.sdr == before.sdr
    assert len(store.get(session_id).undo_history) == 2


def test_authored_sdr_requires_consent_before_activation(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.sdr_reference_image = np.zeros_like(session.image)
    state = _active_match_state(store, session_id)

    with pytest.raises(EditCommandError, match="explicit consent"):
        store.apply_edit_commands(
            session_id,
            [_match_command(store, session_id, expected_revision=0, state=state)],
        )
    assert session.edit_revision == 0
    assert session.sdr_match.active is False
    assert session.undo_history == []

    changed = store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=state, consent=True)],
    )
    assert changed.document.sdr_match.active is True


def test_match_snapshot_must_belong_to_loaded_source(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    state = _active_match_state(store, session_id).model_copy(
        update={"captured_source_fingerprint_sha256": "0" * 64}
    )

    with pytest.raises(EditCommandError, match="does not belong"):
        store.apply_edit_commands(
            session_id,
            [_match_command(store, session_id, expected_revision=0, state=state)],
        )
    assert store.get(session_id).edit_revision == 0


def test_match_action_materializes_renders_marks_stale_and_reverts(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.adjustments.sdr.exposure = 0.65

    matched = store.apply_sdr_match_action(
        session_id, expected_revision=0, action="match"
    )
    assert matched.revision == 1
    assert matched.document.sdr_match.active
    assert matched.document.sdr_match.grain_source == "captured_hdr"
    assert matched.document.global_adjustments.sdr.base_section_enabled is False
    assert matched.document.global_adjustments.sdr.highlight_recovery == 0.0
    assert matched.document.sdr_match.revert_state.sdr_adjustments.exposure == 0.65
    assert len(session.undo_history) == 1

    rendered = session.render_cache.adjusted_frame(
        session.adjustments,
        PreviewKind.SDR,
        256,
        local_adjustments=session.local_adjustments,
        sdr_match=session.sdr_match,
    )
    assert np.isfinite(rendered).all()
    assert float(rendered.min()) >= 0.0
    assert float(rendered.max()) <= 1.0

    changed = session.adjustments.model_copy(deep=True)
    changed.hdr.exposure = 0.5
    stale = store.apply_edit_commands(session_id, [EditCommand(
        expected_revision=1,
        command_type="set_global_adjustments",
        payload={"adjustments": changed.model_dump(mode="json")},
    )])
    assert stale.document.sdr_match.stale is True

    restored = store.apply_edit_commands(session_id, [EditCommand(expected_revision=2, command_type="undo")])
    assert restored.document.sdr_match.stale is False
    repeated = store.apply_edit_commands(session_id, [EditCommand(expected_revision=3, command_type="redo")])
    assert repeated.document.sdr_match.stale is True

    rematched = store.apply_sdr_match_action(
        session_id, expected_revision=4, action="rematch"
    )
    assert rematched.document.sdr_match.stale is False
    assert rematched.document.sdr_match.revert_state.sdr_adjustments.exposure == 0.65

    reverted = store.apply_sdr_match_action(
        session_id, expected_revision=5, action="revert"
    )
    assert reverted.document.sdr_match == SdrMatchState()
    assert reverted.document.global_adjustments.sdr.exposure == 0.65
    assert len(session.undo_history) == 4
