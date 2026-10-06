from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
import pytest

from hdr_finisher.analysis import classify_hdr
from hdr_finisher.models import (
    DenoiseLaneSettings,
    EditCommand,
    LocalAdjustment,
    LocalGrade,
    SDRMatchQualityMetrics,
    SdrMatchState,
    SourceImageDescriptor,
)
from hdr_finisher.sessions import EditCommandError, LoadedSession, SessionStore


def _store_with_source(tmp_path: Path) -> tuple[SessionStore, str]:
    source = tmp_path / "revert-source.png"
    Image.fromarray(np.full((12, 16, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    return store, payload.session_id


def _revert(store: SessionStore, session_id: str, lane: str):
    revision = store.get(session_id).edit_revision
    return store.apply_edit_commands(session_id, [EditCommand(
        expected_revision=revision, command_type="revert_rendition", payload={"lane": lane},
    )])


def _edit_everything(store: SessionStore, session_id: str) -> None:
    session = store.get(session_id)
    session.adjustments.hdr.exposure = 0.8
    session.adjustments.hdr.contrast = 0.2
    session.adjustments.sdr.exposure = -0.4
    session.adjustments.sdr.film_look.grain_amount = 30.0
    session.adjustments.shared.geometry.rotation = 90
    session.denoise.hdr.enabled = True
    session.denoise.hdr.controls.amount = 0.9
    session.denoise.sdr.enabled = True
    session.denoise.sdr.controls.amount = 0.2
    local = LocalAdjustment(name="Sky", opacity=0.6)
    local.hdr_grade.exposure = 0.5
    local.sdr_grade.exposure = -0.25
    session.local_adjustments = [local]
    session.sdr_match = SdrMatchState(
        materialized_status="matched",
        materialized_metrics=SDRMatchQualityMetrics(
            median_luma_error=0.001, p95_luma_error=0.01, median_oklab_error=0.002, p95_oklab_error=0.02
        ),
    )


@pytest.mark.parametrize("lane", ("hdr", "sdr"))
def test_revert_restores_one_rendition_and_leaves_the_rest(tmp_path: Path, lane: str) -> None:
    store, session_id = _store_with_source(tmp_path)
    session = store.get(session_id)
    starting = session.adjustments.model_copy(deep=True)
    _edit_everything(store, session_id)
    edited = session.edit_document().model_copy(deep=True)
    other = "sdr" if lane == "hdr" else "hdr"

    reverted = _revert(store, session_id, lane).document

    assert getattr(reverted.global_adjustments, lane) == getattr(starting, lane)
    assert getattr(reverted.denoise, lane) == DenoiseLaneSettings()
    assert getattr(reverted.local_adjustments[0], f"{lane}_grade") == LocalGrade()

    assert getattr(reverted.global_adjustments, other) == getattr(edited.global_adjustments, other)
    assert getattr(reverted.denoise, other) == getattr(edited.denoise, other)
    assert getattr(reverted.local_adjustments[0], f"{other}_grade") == getattr(edited.local_adjustments[0], f"{other}_grade")
    assert reverted.global_adjustments.shared == edited.global_adjustments.shared
    assert reverted.local_adjustments[0].mask == edited.local_adjustments[0].mask
    assert reverted.local_adjustments[0].name == "Sky"
    assert reverted.local_adjustments[0].opacity == 0.6
    assert reverted.source == edited.source
    # Only an SDR revert clears the record of the last Match.
    assert reverted.sdr_match == (SdrMatchState() if lane == "sdr" else edited.sdr_match)


def test_revert_is_one_undo_step_and_redo_repeats_it(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    _edit_everything(store, session_id)
    session = store.get(session_id)
    edited = session.edit_document().model_dump(mode="json")

    reverted = _revert(store, session_id, "sdr")
    assert len(session.undo_history) == 1

    undone = store.apply_edit_commands(
        session_id, [EditCommand(expected_revision=reverted.revision, command_type="undo")]
    )
    assert undone.document.model_dump(mode="json") == edited

    redone = store.apply_edit_commands(
        session_id, [EditCommand(expected_revision=undone.revision, command_type="redo")]
    )
    assert redone.document.model_dump(mode="json") == reverted.document.model_dump(mode="json")


def test_revert_works_on_a_rendition_that_was_never_edited(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    before = store.get(session_id).edit_document().model_dump(mode="json")

    reverted = _revert(store, session_id, "hdr")

    assert reverted.document.model_dump(mode="json") == before


def test_revert_rejects_an_unknown_lane(tmp_path: Path) -> None:
    store, session_id = _store_with_source(tmp_path)
    with pytest.raises(EditCommandError, match="lane"):
        _revert(store, session_id, "both")
    assert store.get(session_id).edit_revision == 0


def _loaded_session(tmp_path: Path, *, suffix: str, metadata: dict, authored_sdr: bool) -> LoadedSession:
    source_path = tmp_path / f"source{suffix}"
    source_path.write_bytes(b"synthetic")
    image = np.full((4, 4, 3), 0.18, dtype=np.float32)
    descriptor = SourceImageDescriptor(
        filename=source_path.name, suffix=suffix, width=4, height=4, channels=3, dtype="float32",
        source_color_space="ACEScg", transfer_function="LINEAR", interpretation_mode="auto",
        color_space_confident=True,
    )
    return LoadedSession(
        session_id="starting-state",
        source_path=source_path,
        image=image,
        sdr_reference_image=image.copy() if authored_sdr else None,
        source=descriptor,
        analysis=classify_hdr(image, {"transfer_function": "LINEAR"}, suffix),
        metadata=metadata,
    )


@pytest.mark.parametrize(("suffix", "metadata", "authored_sdr"), (
    (".arw", {"raw_input": True, "recommended_exposure_ev": 1.25}, False),
    (".avif", {}, True),
    (".tif", {}, False),
))
def test_the_starting_state_is_the_one_a_new_import_gets(
    tmp_path: Path, suffix: str, metadata: dict, authored_sdr: bool
) -> None:
    session = _loaded_session(tmp_path, suffix=suffix, metadata=dict(metadata), authored_sdr=authored_sdr)
    imported = session.adjustments.model_copy(deep=True)

    session.adjustments.hdr.exposure = -2.0
    session.adjustments.sdr.exposure = 2.0
    session.adjustments.sdr.use_authored_base = False
    session.adjustments.sdr.highlight_section_enabled = True

    assert session.starting_adjustments() == imported
    if authored_sdr:
        assert imported.sdr.use_authored_base is True
        assert imported.sdr.highlight_section_enabled is False
    if metadata.get("raw_input"):
        assert imported.hdr.exposure == pytest.approx(1.25)
        assert imported.sdr.exposure == pytest.approx(1.25)
