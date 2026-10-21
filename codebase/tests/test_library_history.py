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
    assert reverted["grade"] is None
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
    restored=rebuilt_store.get(rebuilt_store.create_session(photo,owns_source_path=False).session_id)
    rebuilt.attach(str(restored.session_id))
    start=deepcopy(rebuilt._get(str(photo))["session_start"])
    assert rebuilt._get(str(photo))["session_start"]==start
    edit(rebuilt_store,restored,3)
    assert grade_key(rebuilt._get(str(photo))["session_start"])==grade_key(rebuilt._get(str(photo))["default"])


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


@pytest.mark.parametrize("recorded",[True,False])
def test_closed_original_is_no_saved_grade_and_next_open_is_fresh(setup,recorded):
    from hdr_finisher.library_documents import LibraryDocuments
    photo,store,session,marks,grades=setup
    old=saved(setup);store.clear()
    if not recorded:
        doc=settings(photo);doc.pop("grade_default",None);outside(photo,doc)
        state=grades._get(str(photo));state.pop("default",None);grades._put(str(photo),state)
    assert grades.history.available([photo])["counts"]["original"]==1
    assert grades.history.revert([photo],"original")["count"]==1
    marks.writer.drain();assert settings(photo)["grade"] is None
    assert settings(photo)["grade_history"]["previous_grade"]==old
    assert not LibraryDocuments(marks).request(photo)["edited"]
    fresh_store=SessionStore();fresh=fresh_store.get(fresh_store.create_session(photo,owns_source_path=False).session_id)
    reopened=store.get(store.create_session(photo,owns_source_path=False).session_id)
    attached=grades.attach(str(reopened.session_id))
    assert attached["grade"] is None
    assert grade_key(reopened.edit_document().model_dump(mode="json"))==grade_key(fresh.edit_document().model_dump(mode="json"))
    assert not reopened.dirty
    marks.undo();marks.writer.drain()
    assert grade_key(store._current.edit_document().model_dump(mode="json"))==grade_key(old)
    assert store._current.dirty
    fresh_store.clear()


def test_restore_and_undo_can_return_to_no_saved_grade(setup):
    photo,store,session,marks,grades=setup
    old=saved(setup);store.clear()
    grades.history.revert([photo],"original");marks.writer.drain()
    grades.history.revert([photo],"previous");marks.writer.drain()
    assert settings(photo)["grade"]==old and settings(photo)["grade_history"]["previous_grade"] is None
    grades.history.revert([photo],"previous");marks.writer.drain()
    assert settings(photo)["grade"] is None
    marks.undo();marks.writer.drain();assert settings(photo)["grade"]==old


def test_open_original_still_uses_known_defaults_as_unsaved_work(setup):
    photo,store,session,marks,grades=setup;old=saved(setup)
    default=deepcopy(grades._get(str(photo))["default"])
    result=grades.history.revert([photo],"original")
    assert result["session"]["dirty"] and settings(photo)["grade"]==old
    assert grade_key(store._current.edit_document().model_dump(mode="json"))==grade_key(default)
