from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.models import AdjustmentState, EditCommand, LocalAdjustment, MaskExpression, MaskLeaf, MaskPoint
from hdr_finisher.sdr_local_match import fit_local_sdr
from hdr_finisher.sdr_match import SDRMatchMaterializationError
from hdr_finisher.sessions import RevisionConflictError, SessionStore


def fixture():
    values = np.linspace(.004, .16, 48, dtype=np.float32)
    source = np.tile(values[None, :, None], (32, 1, 3))
    adjustments = AdjustmentState()
    local = LocalAdjustment(name="Window gradient", mask=MaskExpression(leaf=MaskLeaf(
        type="linear_gradient", start=MaskPoint(x=0, y=.5), end=MaskPoint(x=1, y=.5))))
    local.hdr_grade.exposure = .25
    local.hdr_grade.saturation = .08
    return source, adjustments, local


@pytest.mark.parametrize("film", [False, True])
def test_fit_preserves_inputs_and_copies_detail_without_hidden_curves(film):
    source, adjustments, local = fixture()
    adjustments.sdr.exposure = -.15
    if film:
        for lane in (adjustments.hdr, adjustments.sdr):
            lane.film_look.film_stock = "kodak_portra_400"
            lane.film_look.look_strength = 50
    local.hdr_grade.detail.texture_amount = 3
    other = local.model_copy(deep=True)
    other.id = "overlap"
    other.hdr_grade.exposure = -.1
    other.sdr_grade.exposure = .1
    before = [adjustments.model_dump(), local.model_dump(), other.model_dump()]
    result = fit_local_sdr(source, adjustments, [local, other], local.id)
    assert result.grade is not None
    assert result.metrics["mean_delta_e"] <= 1
    assert result.metrics["p95_delta_e"] <= 3
    assert result.grade.detail == local.hdr_grade.detail
    for name in ("luma_curve", "red_curve", "green_curve", "blue_curve"):
        assert all(left == right for left, right in getattr(result.grade, name))
    assert before == [adjustments.model_dump(), local.model_dump(), other.model_dump()]


@pytest.mark.parametrize("case", ["disabled", "grade-disabled", "opacity", "empty", "neutral"])
def test_no_contribution_is_no_edit(case):
    source, adjustments, local = fixture()
    if case == "disabled":
        local.enabled = False
    elif case == "grade-disabled":
        local.hdr_grade.enabled = False
    elif case == "opacity":
        local.opacity = 0
    elif case == "empty":
        local.mask = MaskExpression(leaf=MaskLeaf(type="brush"))
    else:
        local.hdr_grade.exposure = local.hdr_grade.saturation = 0
    assert fit_local_sdr(source, adjustments, [local], local.id).grade is None


def store_fixture(tmp_path):
    source, adjustments, local = fixture()
    filename = tmp_path / "source.png"
    Image.fromarray(np.full(source.shape, 100, np.uint8)).save(filename)
    store = SessionStore()
    session_id = store.create_session(filename, owns_source_path=False).session_id
    session = store.get(session_id)
    session.adjustments = adjustments
    session.image = source
    session.render_cache.replace_source(source, None)
    store.apply_edit_commands(session_id, [EditCommand(expected_revision=0, command_type="create_local",
                                                     payload={"local": local.model_dump()})])
    return store, session_id, local.id


def test_one_undo_fresh_rematch_staleness_and_document_roundtrip(tmp_path):
    store, session_id, target_id = store_fixture(tmp_path)
    session = store.get(session_id)
    before = session.edit_document().model_dump()
    matched, _, changed = store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    assert changed
    local = matched.document.local_adjustments[0]
    assert local.sdr_match and not local.sdr_match.out_of_date
    first = local.sdr_grade.model_dump()
    session.adjustments.hdr.highlight_compression_source_peak_nits += .0005
    assert not session.edit_document().local_adjustments[0].sdr_match.out_of_date
    session.adjustments.hdr.highlight_compression_source_peak_nits -= .0005
    rematched, _, _ = store.apply_local_sdr_match_action(session_id, expected_revision=2, target_id=target_id)
    assert rematched.document.local_adjustments[0].sdr_grade.model_dump() == first
    assert session.edit_document().model_validate_json(session.edit_document().model_dump_json()) == session.edit_document()
    store.apply_edit_commands(session_id, [EditCommand(expected_revision=3, command_type="undo")])
    restored = store.apply_edit_commands(session_id, [EditCommand(expected_revision=4, command_type="undo")])
    assert restored.document.model_dump() == before
    store.apply_edit_commands(session_id, [EditCommand(expected_revision=5, command_type="redo")])
    session.adjustments.sdr.exposure += .1
    assert session.edit_document().local_adjustments[0].sdr_match.out_of_date
    session.adjustments.sdr.exposure -= .1
    assert not session.edit_document().local_adjustments[0].sdr_match.out_of_date
    session.local_adjustments[0].mask.leaf.mask_feather += .1
    assert session.edit_document().local_adjustments[0].sdr_match.out_of_date
    with pytest.raises(RevisionConflictError):
        store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)


def test_failed_fit_keeps_previous_grade_and_history(tmp_path, monkeypatch):
    from hdr_finisher import sdr_local_match
    store, session_id, target_id = store_fixture(tmp_path)
    session = store.get(session_id)
    before = session.edit_document().model_dump()
    def refuse(*args, **kwargs):
        raise SDRMatchMaterializationError("Previous grade unchanged")
    monkeypatch.setattr(sdr_local_match, "fit_local_sdr", refuse)
    with pytest.raises(SDRMatchMaterializationError):
        store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    assert session.edit_revision == 1
    assert len(session.undo_history) == 1
    assert session.edit_document().model_dump() == before


def test_noop_has_no_history_entry(tmp_path):
    store, session_id, target_id = store_fixture(tmp_path)
    session = store.get(session_id)
    session.local_adjustments[0].hdr_grade.enabled = False
    before = session.edit_document().model_dump()
    _, message, changed = store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    assert not changed and "disabled" in message
    assert session.edit_revision == 1 and len(session.undo_history) == 1
    assert session.edit_document().model_dump() == before


def test_inflight_edit_rejects_stale_fit(tmp_path, monkeypatch):
    from hdr_finisher import sdr_local_match
    store, session_id, target_id = store_fixture(tmp_path)
    original = sdr_local_match.fit_local_sdr
    def edit_during_fit(*args, **kwargs):
        result = original(*args, **kwargs)
        changed = store.get(session_id).local_adjustments[0].model_copy(deep=True)
        changed.sdr_grade.exposure = .4
        store.apply_edit_commands(session_id, [EditCommand(expected_revision=1, command_type="update_local",
            target_id=target_id, payload={"local": changed.model_dump()})])
        return result
    monkeypatch.setattr(sdr_local_match, "fit_local_sdr", edit_during_fit)
    with pytest.raises(RevisionConflictError):
        store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    session = store.get(session_id)
    assert session.local_adjustments[0].sdr_grade.exposure == .4
    assert session.local_adjustments[0].sdr_match is None
    assert session.edit_revision == 2 and len(session.undo_history) == 2


def test_project_preserves_individual_match_record(tmp_path):
    from hdr_finisher.projects import save_project, open_project
    store, session_id, target_id = store_fixture(tmp_path)
    store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    session = store.get(session_id)
    expected = session.edit_document().local_adjustments[0]
    filename = tmp_path / "local-match.hdrfinisher"
    save_project(session, filename)
    reopened = open_project(SessionStore(), filename)
    assert reopened.edit_document().local_adjustments[0] == expected


@pytest.mark.parametrize("change", ["hdr", "other-local", "geometry", "reference", "sdr-manual"])
def test_relevant_context_marks_match_out_of_date(tmp_path, change):
    store, session_id, target_id = store_fixture(tmp_path)
    store.apply_local_sdr_match_action(session_id, expected_revision=1, target_id=target_id)
    session = store.get(session_id)
    if change == "hdr":
        session.local_adjustments[0].hdr_grade.exposure += .1
    elif change == "other-local":
        session.local_adjustments.append(LocalAdjustment(name="New overlap"))
    elif change == "geometry":
        session.adjustments.shared.geometry.rotation = 90
    elif change == "reference":
        session.hdr_reference_white_nits = 100
    else:
        session.local_adjustments[0].sdr_grade.exposure += .1
    assert session.edit_document().local_adjustments[0].sdr_match.out_of_date
