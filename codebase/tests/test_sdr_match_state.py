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
    BranchDetailAdjustments,
    EditCommand,
    EditDocument,
    PreviewKind,
    SDRMatchQualityMetrics,
    SdrMatchState,
)
from hdr_finisher.projects import ProjectError, open_project, save_project
from hdr_finisher.sessions import EditCommandError, RevisionConflictError, SessionStore
from hdr_finisher.sdr_match import (
    MATCH_SHOULDER_START,
    automatic_sdr_match_luma,
    build_sdr_match_target,
)


def _store_with_source(tmp_path: Path) -> tuple[SessionStore, str]:
    source = tmp_path / "match-source.png"
    Image.fromarray(np.full((12, 16, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    return store, payload.session_id


def _matched_state() -> SdrMatchState:
    return SdrMatchState(
        materialized_status="matched",
        materialized_metrics=SDRMatchQualityMetrics(
            median_luma_error=0.001, p95_luma_error=0.01, median_oklab_error=0.002, p95_oklab_error=0.02
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
    replaces_authored: bool = False,
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
            "replaces_authored_sdr": replaces_authored,
        },
    )


def test_schema_v4_has_neutral_detail_and_no_match_recorded(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    document = store.get(session_id).edit_document()

    assert document.schema_version == 4
    assert document.global_adjustments.hdr.detail == BranchDetailAdjustments()
    assert document.global_adjustments.sdr.detail == BranchDetailAdjustments()
    assert document.sdr_match == SdrMatchState()


def test_match_status_and_metrics_are_stored_together() -> None:
    with pytest.raises(ValidationError, match="stored together"):
        SdrMatchState(materialized_status="matched")


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
    state = _matched_state()
    target = store.get(session_id).adjustments.model_copy(deep=True)
    target.sdr.exposure = 0.75

    changed = store.apply_edit_commands(
        session_id,
        [_match_command(store, session_id, expected_revision=0, state=state, adjustments=target)],
    )
    session = store.get(session_id)
    assert changed.revision == 1
    assert changed.document.sdr_match.materialized_status == "matched"
    assert changed.document.global_adjustments.sdr.exposure == 0.75
    assert len(session.undo_history) == 1
    assert session.undo_history[0].forward.command_type == "set_sdr_match"
    assert session.undo_history[0].inverse.command_type == "set_sdr_match"

    undone = store.apply_edit_commands(
        session_id,
        [EditCommand(expected_revision=1, command_type="undo")],
    )
    assert undone.revision == 2
    assert undone.document.sdr_match == SdrMatchState()
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


def test_match_target_preserves_body_and_rolls_only_top_sdr_headroom() -> None:
    transition_scene = 0.18 * 0.90 / (100.0 / 203.0)
    luma = np.array([0.0, 0.18, transition_scene - 1e-5, transition_scene, transition_scene + 1e-5, 0.72, 2.0])
    image = np.repeat(luma[None, :, None], 3, axis=2).astype(np.float32)
    target = build_sdr_match_target(image)
    output = np.einsum("...c,c->...", target[0], np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))

    np.testing.assert_allclose(output[1], 100.0 / 203.0, atol=1e-4)
    np.testing.assert_allclose(output[2], luma[2] / 0.18 * (100.0 / 203.0), atol=1e-4)
    np.testing.assert_allclose(output[3], MATCH_SHOULDER_START, atol=2e-4)
    assert np.all(np.diff(output) >= 0.0)
    assert output[-1] <= 1.0
    left_slope = (output[3] - output[2]) / 1e-5
    right_slope = (output[4] - output[3]) / 1e-5
    assert abs(left_slope - right_slope) / left_slope < 0.02


@pytest.mark.parametrize("reference_white", (100, 203))
def test_automatic_transition_tracks_project_reference_white(reference_white: int) -> None:
    transition_nits = reference_white * 0.90 / (100.0 / 203.0)
    transition_scene = 0.18 * transition_nits / reference_white
    mapped = automatic_sdr_match_luma(np.array([transition_scene], dtype=np.float32))[0]
    np.testing.assert_allclose(mapped, 0.90, atol=1e-6)


def test_v4_project_persists_the_match_result(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    state = _matched_state()
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


def test_an_old_project_with_a_legacy_match_opens_as_a_plain_sdr_grade(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.adjustments.sdr.exposure = 0.4
    document = session.edit_document().model_dump(mode="json")
    document["sdr_match"] = {
        "active": True,
        "stale": False,
        "grain_source": "captured_hdr",
        "algorithm_version": "hdr-to-sdr-match-v1",
        "captured_hdr_adjustments": document["global_adjustments"]["hdr"],
        "captured_shared_adjustments": document["global_adjustments"]["shared"],
        "captured_locals": [],
        "captured_reference_white_nits": 203,
        "captured_source_fingerprint_sha256": session.source_fingerprint_sha256,
        "automatic_highlight_boundary_ratio": 0.8,
        "manual_highlight_boundary_ratio": None,
        "signature": "legacy",
        "revert_state": {"sdr_adjustments": document["global_adjustments"]["sdr"]},
        "materialized_status": None,
        "materialized_metrics": None,
    }
    project = tmp_path / "legacy-match.hdrfinisher"
    with zipfile.ZipFile(project, "w") as archive:
        archive.writestr("manifest.json", json.dumps({
            "format": "HDR Finisher Project",
            "schema_version": 4,
            "contains_source_pixels": False,
        }))
        archive.writestr("edit-state.json", json.dumps(document))

    reopened = open_project(store, project)
    assert reopened.sdr_match == SdrMatchState()
    assert reopened.adjustments.sdr.exposure == 0.4


def test_replacing_an_authored_sdr_rendition_requires_consent(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.sdr_reference_image = np.zeros_like(session.image)
    state = _matched_state()

    with pytest.raises(EditCommandError, match="explicit consent"):
        store.apply_edit_commands(
            session_id,
            [_match_command(store, session_id, expected_revision=0, state=state, replaces_authored=True)],
        )
    with pytest.raises(EditCommandError, match="explicit consent"):
        store.apply_sdr_match_action(session_id, expected_revision=0)
    assert session.edit_revision == 0
    assert session.sdr_match == SdrMatchState()
    assert session.undo_history == []

    changed = store.apply_edit_commands(
        session_id,
        [_match_command(
            store, session_id, expected_revision=0, state=state, consent=True, replaces_authored=True
        )],
    )
    assert changed.document.sdr_match.materialized_status == "matched"



def test_match_action_materializes_visible_controls_and_is_one_undo_step(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.adjustments.sdr.exposure = 0.65
    session.denoise.hdr.enabled = True
    session.denoise.hdr.controls.amount = 0.82
    session.denoise.sdr.enabled = True
    session.denoise.sdr.controls.amount = 0.17

    matched = store.apply_sdr_match_action(session_id, expected_revision=0)
    assert matched.revision == 1
    assert matched.document.sdr_match.materialized_status in {"matched", "needs_review"}
    assert matched.document.global_adjustments.sdr.use_authored_base is False
    assert matched.document.global_adjustments.sdr.highlight_section_enabled is True
    assert matched.document.global_adjustments.sdr.highlight_compression_mode == "peak_fit"
    assert all(abs(x - y) < 1e-7 for x, y in matched.document.global_adjustments.sdr.luma_curve)
    assert any(
        abs(node.adjustment_ev) > 0.001
        for node in matched.document.global_adjustments.sdr.tone_equalizer_nodes
    )
    assert matched.document.denoise.sdr == matched.document.denoise.hdr
    assert len(session.undo_history) == 1

    rendered = session.render_cache.adjusted_frame(
        session.adjustments,
        PreviewKind.SDR,
        256,
        local_adjustments=session.local_adjustments,
    )
    assert np.isfinite(rendered).all()
    assert float(rendered.min()) >= 0.0
    assert float(rendered.max()) <= 1.0

    restored = store.apply_edit_commands(session_id, [EditCommand(expected_revision=1, command_type="undo")])
    assert restored.document.sdr_match == SdrMatchState()
    assert restored.document.global_adjustments.sdr.exposure == 0.65
    assert restored.document.denoise.sdr.controls.amount == 0.17
    repeated = store.apply_edit_commands(session_id, [EditCommand(expected_revision=2, command_type="redo")])
    assert repeated.document.sdr_match.materialized_status in {"matched", "needs_review"}
    assert repeated.document.denoise.sdr.controls.amount == 0.82


def test_repeated_materialized_match_recomputes_and_copies_current_hdr_denoise(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    session.denoise.hdr.enabled = True
    session.denoise.hdr.controls.amount = 0.62
    session.denoise.sdr.enabled = True
    session.denoise.sdr.controls.amount = 0.24

    matched = store.apply_sdr_match_action(session_id, expected_revision=0)
    assert matched.document.denoise.sdr.controls.amount == 0.62

    changed = session.denoise.model_copy(deep=True)
    changed.hdr.controls.amount = 0.88
    changed.hdr.controls.luminance = 0.31
    changed_state = store.apply_edit_commands(session_id, [EditCommand(
        expected_revision=1,
        command_type="set_denoise_settings",
        payload={"denoise": changed.model_dump(mode="json")},
    )])
    assert changed_state.document.sdr_match == matched.document.sdr_match
    assert changed_state.document.denoise.sdr.controls.amount == 0.62

    rematched = store.apply_sdr_match_action(session_id, expected_revision=2)
    assert rematched.document.denoise.sdr == rematched.document.denoise.hdr
    assert rematched.document.denoise.sdr.controls.amount == 0.88

    undone = store.apply_edit_commands(session_id, [EditCommand(expected_revision=3, command_type="undo")])
    assert undone.document.denoise.sdr.controls.amount == 0.62
