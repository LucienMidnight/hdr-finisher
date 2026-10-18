"""Slice 3 Stage A: real grade documents, disposable files, writer/recovery boundaries."""
from copy import deepcopy
import errno
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

from hdr_finisher.library_grades import LibraryGrades, grade_key
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.models import EditDocument, EditCommand, CropRectangle
from hdr_finisher.projects import open_document, open_project, save_project
from hdr_finisher.sessions import SessionStore
from test_proof_export_identity import _four_mask_locals


@pytest.fixture
def setup(tmp_path):
    photo = tmp_path / "photo.png"
    rng = np.random.default_rng(21)
    Image.fromarray(rng.integers(1, 240, (64, 96, 3), dtype=np.uint8)).save(photo)
    store = SessionStore()
    session = store.get(store.create_session(photo, owns_source_path=False).session_id)
    marks = LibraryMarks(tmp_path / "app")
    grades = LibraryGrades(marks, store)
    grades.attach(str(session.session_id))
    yield photo, store, session, marks, grades
    store.clear()


def edit(store, session, exposure=1):
    document = session.edit_document().model_copy(deep=True)
    document.global_adjustments.hdr.exposure = exposure
    document.global_adjustments.sdr.exposure = -.25
    document.global_adjustments.shared.geometry.crop = CropRectangle(x=.1, y=.1, width=.8, height=.8)
    document.local_adjustments = _four_mask_locals()
    store.replace_edit_document(str(session.session_id), document, session.edit_revision)
    return session.edit_document().model_dump(mode="json")


def settings(photo):
    return json.loads(Path(str(photo) + ".hdrf").read_text(encoding="utf-8"))


def outside(photo, document):
    Path(str(photo) + ".hdrf").write_text(json.dumps(document), encoding="utf-8")


def saved(setup):
    photo, store, session, marks, grades = setup
    doc = edit(store, session)
    grades.save(str(session.session_id))
    marks.writer.drain()
    return doc


def test_browsing_and_attaching_write_no_settings(setup):
    photo, store, session, marks, grades = setup
    grades.check(str(session.session_id))
    assert not Path(str(photo) + ".hdrf").exists()
    assert not grades._get(str(photo)).get("recovery")


def test_round_trip_complete_document_keeps_latest_marks_albums_unknown_fields(setup):
    photo, store, session, marks, grades = setup
    marks.change([photo], MarkChange(rating=3, add_tag="Sea"))
    marks.writer.drain()
    document = settings(photo)
    document.update(albums=["Portfolio"], future={"something": [1, 2, 3]})
    outside(photo, document)
    expected = edit(store, session)
    assert grades.save(str(session.session_id))["pending"]
    marks.change([photo], MarkChange(rating=5, pick="pick"))
    marks.writer.drain()
    result = settings(photo)
    assert result["grade"] == expected
    assert result["marks"]["rating"] == 5 and result["marks"]["tags"] == ["Sea"]
    assert result["albums"] == ["Portfolio"] and result["future"] == {"something": [1, 2, 3]}
    reopened = open_document(store, EditDocument.model_validate(result["grade"]), photo)
    assert reopened.edit_document().model_dump(mode="json") == expected


def test_outside_non_grade_changes_never_conflict_or_get_lost(setup):
    photo, store, session, marks, grades = setup
    saved(setup)
    edit(store, session, 2)
    document = settings(photo)
    document["marks"].update(rating=4, tags=["External"])
    document.update(albums=["Outside"], future="keep")
    outside(photo, document)
    assert not grades.save(str(session.session_id))["conflict"]
    marks.writer.drain()
    assert settings(photo)["marks"]["tags"] == ["External"]
    assert settings(photo)["albums"] == ["Outside"] and settings(photo)["future"] == "keep"


@pytest.mark.parametrize("choice", ["mine", "file", "cancel"])
def test_grade_conflict_preserves_both_choices_and_cancel_pauses(setup, choice):
    photo, store, session, marks, grades = setup
    saved(setup)
    mine = edit(store, session, 2)
    document = settings(photo)
    external = deepcopy(document["grade"])
    external["global_adjustments"]["hdr"]["exposure"] = 3
    document["grade"] = external
    outside(photo, document)
    assert grades.save(str(session.session_id))["conflict"]
    assert settings(photo)["grade"] == external
    assert grades._get(str(photo))["recovery"] == mine
    result = grades.resolve(str(session.session_id), choice, external)
    if choice == "cancel":
        assert result["conflict"]
        assert grades.check(str(session.session_id))["conflict"]
        assert marks.writer.status()["attention"][0]["reason"] == "grade_conflict"
    else:
        assert grades._get(str(photo))["previous_grade"] == (external if choice == "mine" else mine)
        if choice == "mine":
            marks.writer.drain()
            assert settings(photo)["grade"] == mine
        else:
            assert result["reload"] and result["grade"] == external
            assert settings(photo)["grade"] == external


def test_external_grade_changed_again_while_notice_open_does_not_choose_silently(setup):
    photo, store, session, marks, grades = setup
    saved(setup)
    edit(store, session, 2)
    document = settings(photo)
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 3
    outside(photo, document)
    grades.save(str(session.session_id))
    expected = deepcopy(document["grade"])
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 4
    outside(photo, document)
    assert grades.resolve(str(session.session_id), "mine", expected)["changed_again"]
    assert settings(photo)["grade"] == document["grade"]


def test_queued_autosave_rechecks_grade_before_write(setup):
    photo, store, session, marks, grades = setup
    saved(setup)
    mine = edit(store, session, 2)
    grades.save(str(session.session_id))
    document = settings(photo)
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 4
    outside(photo, document)
    marks.writer.drain()
    assert settings(photo)["grade"] == document["grade"]
    assert grades.status(str(session.session_id))["conflict"]
    assert grades._get(str(photo))["recovery"] == mine


def test_clean_grade_picks_up_external_grade_without_question(setup):
    photo, store, session, marks, grades = setup
    saved(setup)
    document = settings(photo)
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 3
    outside(photo, document)
    result = grades.check(str(session.session_id))
    assert result["reload"] and not result["conflict"]
    assert result["grade"] == document["grade"]


def test_autosave_off_recovery_and_conflict_survive_restart_without_applying(setup):
    photo, store, session, marks, grades = setup
    initial = saved(setup)
    mine = edit(store, session, 2)
    assert settings(photo)["grade"] == initial
    restarted_store = SessionStore()
    restarted_session = restarted_store.get(restarted_store.create_session(photo).session_id)
    restarted = LibraryGrades(LibraryMarks(marks.database.parent), restarted_store)
    result = restarted.attach(str(restarted_session.session_id))
    assert result["recovery"] == mine and result["grade"] == initial
    assert restarted_session.edit_document().model_dump(mode="json") != mine
    restarted_store.clear()


@pytest.mark.parametrize("failure", [errno.EACCES, errno.ENOSPC, errno.EBUSY])
def test_write_failure_retains_grade_and_recovers(setup, monkeypatch, failure):
    photo, store, session, marks, grades = setup
    expected = edit(store, session)
    grades.save(str(session.session_id))
    original = marks._write_sidecar
    def blocked(*args, **kwargs):
        raise OSError(failure, "test interruption")
    monkeypatch.setattr(marks, "_write_sidecar", blocked)
    marks.writer.drain()
    assert grades.status(str(session.session_id))["pending"]
    assert grades._get(str(photo))["recovery"] == expected
    monkeypatch.setattr(marks, "_write_sidecar", original)
    marks.writer.retry(str(photo.parent), grades.status(str(session.session_id))["reason"])
    marks.writer.drain()
    assert settings(photo)["grade"] == expected
    assert not grades.status(str(session.session_id))["pending"]


def test_unreadable_file_is_untouched_then_recovers(setup):
    photo, store, session, marks, grades = setup
    initial = saved(setup)
    expected = edit(store, session, 2)
    Path(str(photo) + ".hdrf").write_bytes(b"invalid settings")
    grades.save(str(session.session_id))
    marks.writer.drain()
    assert Path(str(photo) + ".hdrf").read_bytes() == b"invalid settings"
    restored = marks._new_document(marks._rows([str(photo)])[str(photo)])
    restored["grade"] = initial
    outside(photo, restored)
    marks.writer.retry(str(photo.parent), "unreadable")
    marks.writer.drain()
    assert settings(photo)["grade"] == expected


def test_external_change_during_temporary_preparation_keeps_whole_file(setup, monkeypatch):
    photo, store, session, marks, grades = setup
    saved(setup)
    edit(store, session, 2)
    grades.save(str(session.session_id))
    original = marks.writer.is_current
    def change_before_replace(path, revision):
        document = settings(photo)
        document["grade"]["global_adjustments"]["hdr"]["exposure"] = 4
        outside(photo, document)
        return original(path, revision)
    monkeypatch.setattr(marks.writer, "is_current", change_before_replace)
    marks.writer.drain()
    assert settings(photo)["grade"]["global_adjustments"]["hdr"]["exposure"] == 4
    monkeypatch.setattr(marks.writer, "is_current", original)
    marks.writer.drain()
    assert grades.status(str(session.session_id))["conflict"]


def test_disconnected_folder_queues_grade_without_false_conflict_and_recovers(setup, tmp_path):
    import os
    photo, store, session, marks, grades = setup
    saved(setup)
    expected = edit(store, session, 2)
    # Move just this disposable photo's folder, never an owner's folder.
    disconnected = tmp_path / "disconnected"
    connected = tmp_path / "connected"
    connected.mkdir()
    # The fixture photo is in tmp_path itself; give it a private folder first.
    new_photo = connected / photo.name
    photo.replace(new_photo)
    Path(str(photo) + ".hdrf").replace(Path(str(new_photo) + ".hdrf"))
    session.durable_source_path = new_photo
    grades.sessions[str(session.session_id)] = str(new_photo)
    state = grades._get(str(photo))
    state["baseline"]["source"]["durable_path"] = str(new_photo)
    grades._put(str(new_photo), state)
    os.rename(connected, disconnected)
    result = grades.save(str(session.session_id))
    assert result["pending"] and not result["conflict"]
    marks.writer.drain()
    assert grades.status(str(session.session_id))["reason"] == "offline"
    os.rename(disconnected, connected)
    marks.writer.retry(str(connected), "offline")
    marks.writer.drain()
    assert grade_key(settings(new_photo)["grade"]) == grade_key(expected)


def test_opened_sidecar_and_project_produce_identical_reference_branches(setup, tmp_path):
    from hdr_finisher.exporters import _render_export_branch
    from hdr_finisher.models import PreviewKind, ExportSettings
    photo, store, session, marks, grades = setup
    expected = saved(setup)
    project = tmp_path / "same.hdrfinisher"
    save_project(session, project)
    from_project = open_project(store, project)
    project_frames = [_render_export_branch(from_project, ExportSettings(), lane, from_project.adjustments) for lane in PreviewKind]
    from_settings = open_document(store, EditDocument.model_validate(settings(photo)["grade"]), photo)
    assert from_settings.edit_document().model_dump(mode="json") == expected
    for lane, reference in zip(PreviewKind, project_frames):
        actual = _render_export_branch(from_settings, ExportSettings(), lane, from_settings.adjustments)
        np.testing.assert_array_equal(actual, reference)


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
def test_sidecar_and_project_export_and_proof_are_byte_identical(setup, tmp_path, format_name):
    import hashlib
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    from hdr_finisher.models import CapabilityStatus, ExportSettings, ProofArtifactRequest
    from hdr_finisher.proofing import ProofArtifactStore
    from test_proof_export_identity import FORMATS
    capability, suffix = FORMATS[format_name]
    capabilities = probe_capabilities()
    if capabilities[capability].status != CapabilityStatus.AVAILABLE:
        pytest.skip(f"{capability} is not available")
    backend = build_export_backends(capabilities)[format_name]
    photo, store, session, marks, grades = setup
    saved(setup)
    project = tmp_path / "reference.hdrfinisher"
    save_project(session, project)
    opened = [open_project(store, project), open_document(store, EditDocument.model_validate(settings(photo)["grade"]), photo)]
    hashes = []
    proofs = ProofArtifactStore()
    try:
        for index, graded in enumerate(opened):
            result = backend.export(graded, ExportSettings(format=format_name,
                output_path=str(tmp_path / f"export-{index}{suffix}"), overwrite=True))
            assert result.accepted, result.message
            digest = hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
            proof = proofs.create(graded, ProofArtifactRequest(adjustments=graded.adjustments,
                format=format_name, quality=ExportSettings().quality, full_size=True), backend)
            assert proof.sha256 == digest
            hashes.append(digest)
        assert hashes[0] == hashes[1]
    finally:
        proofs.clear()


def test_indexing_many_large_saved_grades_does_not_lock_the_library(setup, tmp_path):
    """A big indexing write must not wait on its own reads (October 18, 2026)."""
    _, _, _, marks, grades = setup
    folder = tmp_path / "shoot"
    folder.mkdir()
    paths = [str(folder / f"DSC{n:05}.ARW") for n in range(45)]
    bulky = {"history": ["x" * 4000] * 40}
    for path in paths:
        grades._put(path, {"default": bulky, "previous_grade": bulky})
    documents = [{"grade": {"exposure": n}, "grade_history": {}} for n in range(45)]
    grades.observe_documents(paths, documents)
    assert [grades._get(path)["indexed_grade"] for path in paths] == [{"exposure": n} for n in range(45)]


def test_conflict_clears_when_the_file_returns_to_the_saved_grade(setup):
    """Steve, October 18, 2026: a stale conflict reopened its dialog on every close."""
    photo, store, session, marks, grades = setup
    saved(setup)
    edit(store, session, 2)
    document = settings(photo)
    baseline = deepcopy(document["grade"])
    external = deepcopy(baseline)
    external["global_adjustments"]["hdr"]["exposure"] = 3
    document["grade"] = external
    outside(photo, document)
    assert grades.save(str(session.session_id))["conflict"]
    document["grade"] = baseline
    outside(photo, document)

    assert not grades.check(str(session.session_id), unsaved=True)["conflict"]
    assert grades._get(str(photo))["previous_grade"] == external
    assert "changed_again" not in grades.resolve(str(session.session_id), "mine", external)
