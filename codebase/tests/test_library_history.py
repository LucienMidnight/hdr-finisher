from copy import deepcopy
import json
from pathlib import Path
import pytest
from test_library_grades import setup, saved, edit, settings, outside
from hdr_finisher.library_grades import LibraryGrades, grade_key
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.models import EditDocument
from hdr_finisher.projects import open_document
from hdr_finisher.sessions import SessionStore


def test_session_start_is_first_change_and_survives_restart_without_autosaving(setup):
    photo, store, session, marks, grades = setup
    default = deepcopy(grades._get(str(photo))["default"])
    edit(store, session, 1)
    edit(store, session, 2)
    assert not Path(str(photo)+".hdrf").exists()
    assert grades._get(str(photo))["session_start"] == default
    restarted = LibraryGrades(LibraryMarks(marks.database.parent), SessionStore())
    assert restarted._get(str(photo))["session_start"] == default
    grades.save(str(session.session_id)); marks.writer.drain()
    assert settings(photo)["grade_history"]["session_start"] == default
    assert settings(photo)["grade"]["global_adjustments"]["hdr"]["exposure"] == 2


def test_open_reverts_previous_can_restore_a_revert_and_last_saved_drops_unsaved(setup):
    photo, store, session, marks, grades = setup
    saved_grade = saved(setup)
    unsaved = edit(store, session, 2)
    result = grades.history.revert([photo], "saved")
    assert not store._current.dirty
    assert grade_key(store._current.edit_document().model_dump(mode="json")) == grade_key(saved_grade)
    assert settings(photo)["grade"] == saved_grade
    grades.history.revert([photo], "previous")
    assert store._current.dirty
    assert grade_key(store._current.edit_document().model_dump(mode="json")) == grade_key(unsaved)
    grades.history.revert([photo], "previous")
    assert grade_key(store._current.edit_document().model_dump(mode="json")) == grade_key(saved_grade)


def test_closed_photo_revert_and_one_undo_keep_marks_unknown_and_history_in_sidecar(setup):
    photo, store, session, marks, grades = setup
    original = saved(setup)
    marks.change([photo], MarkChange(rating=4,add_tag="Keep"));marks.writer.drain()
    doc = settings(photo);doc["albums"]=["Album"];doc["unknown"]={"keep":42};outside(photo,doc)
    store.clear()
    result=grades.history.revert([photo],"original");assert result["count"]==1
    marks.writer.drain();reverted=settings(photo)
    assert grade_key(reverted["grade"])==grade_key(grades._get(str(photo))["default"])
    assert reverted["grade_history"]["previous_grade"] == original
    assert reverted["marks"]["rating"]==4 and reverted["marks"]["tags"]==["Keep"]
    assert reverted["albums"]==["Album"] and reverted["unknown"]=={"keep":42}
    marks.change([photo],MarkChange(pick="pick"));marks.writer.drain();marks.undo();marks.writer.drain()
    marks.undo();marks.writer.drain()
    assert settings(photo)["grade"]==original
    assert settings(photo)["grade_history"]["previous_grade"]==reverted["grade"]
    assert settings(photo)["marks"]["rating"]==4


def test_history_rebuilds_from_settings_file_and_next_run_replaces_start_only_on_edit(setup,tmp_path):
    photo, store, session, marks, grades = setup
    saved_grade = saved(setup);store.clear();grades.history.revert([photo],"original");marks.writer.drain()
    rebuilt_marks=LibraryMarks(tmp_path/"fresh");rebuilt_store=SessionStore();rebuilt=LibraryGrades(rebuilt_marks,rebuilt_store)
    rebuilt_marks.read([photo])
    assert rebuilt._get(str(photo))["previous_grade"]==saved_grade
    restored=open_document(rebuilt_store,EditDocument.model_validate(settings(photo)["grade"]),photo)
    rebuilt.attach(str(restored.session_id))
    start=deepcopy(rebuilt._get(str(photo))["session_start"])
    assert rebuilt._get(str(photo))["session_start"]==start
    edit(rebuilt_store,restored,3)
    assert rebuilt._get(str(photo))["session_start"]==settings(photo)["grade"]


def test_bulk_preflight_and_changed_grade_undo_never_overwrite(setup):
    photo,store,session,marks,grades=setup
    saved_grade=saved(setup);store.clear()
    bad=photo.with_name("bad.png");bad.write_bytes(photo.read_bytes());Path(str(bad)+".hdrf").write_text('broken')
    with pytest.raises(ValueError):grades.history.revert([photo,bad],"original")
    assert settings(photo)["grade"]==saved_grade
    grades.history.revert([photo],"original");marks.writer.drain()
    doc=settings(photo);doc["grade"]=deepcopy(saved_grade);doc["grade"]["global_adjustments"]["hdr"]["exposure"]=4;outside(photo,doc)
    with pytest.raises(ValueError,match="changed since"):marks.undo()
    assert settings(photo)["grade"]["global_adjustments"]["hdr"]["exposure"]==4
    assert marks._undo


def test_restore_session_is_unsaved_when_open_and_preserves_its_picture_identity(setup):
    photo,store,session,marks,grades=setup
    saved(setup)
    default=deepcopy(grades._get(str(photo))["session_start"])
    result=grades.history.revert([photo],"session")
    assert result["session"]["dirty"]
    assert grade_key(store._current.edit_document().model_dump(mode="json"))==grade_key(default)
    assert settings(photo)["grade"]["global_adjustments"]["hdr"]["exposure"]==1
