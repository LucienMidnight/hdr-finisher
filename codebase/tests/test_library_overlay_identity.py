from copy import deepcopy
from types import SimpleNamespace

from test_library_grades import setup, edit, saved, settings
from hdr_finisher.library_grades import grade_key
from hdr_finisher.library_documents import identity, LibraryDocuments
from hdr_finisher.models import OverlayMode


def overlay(store, session):
    document = session.edit_document().model_copy(deep=True)
    shared = document.global_adjustments.shared
    shared.overlay_mode = OverlayMode.ZEBRA
    shared.overlay_opacity = .8
    shared.overlay_threshold = 300
    shared.false_color_band_anchor = "203_nits"
    shared.false_color_ceiling_nits = 4000
    store.replace_edit_document(str(session.session_id), document, session.edit_revision)
    return session.edit_document().model_dump(mode="json")


def test_overlay_only_save_is_not_edited(setup, tmp_path):
    photo, store, session, marks, grades = setup
    default = session.edit_document().model_dump(mode="json")
    viewed = overlay(store, session)
    # The full document and preview choice are retained; only grade comparisons ignore them.
    assert viewed != default
    assert grade_key(viewed) == grade_key(default)
    assert identity(viewed) == identity(default)
    grades.save(str(session.session_id))
    marks.writer.drain()
    assert settings(photo)["grade"] == viewed
    assert not grades.describe([photo])[str(photo)]["edited"]
    assert not LibraryDocuments(marks).request(photo)["edited"]
    assert grades.history.available([photo])["counts"]["original"] == 0
    store.clear()
    assert grades.history.available([photo])["counts"]["original"] == 0
    store._current = session
    edit(store, session)
    grades.save(str(session.session_id))
    marks.writer.drain()
    assert grades.describe([photo])[str(photo)]["edited"]


def test_overlay_on_real_edit_reuses_identity_and_does_not_queue_picture(setup):
    photo, store, session, marks, grades = setup
    original = saved(setup)
    calls = []
    marks.kept = SimpleNamespace(schedule=lambda *args: calls.append(args))
    viewed = overlay(store, session)
    assert identity(original) == identity(viewed)
    grades.save(str(session.session_id))
    marks.writer.drain()
    assert not calls
    assert grades.describe([photo])[str(photo)]["edited"]
    assert grades.history.available([photo])["counts"]["saved"] == 0
    assert grades.history.available([photo])["counts"]["session"] == 1
    assert settings(photo)["grade"] == viewed
    # Normalization never removes future shared fields or mutates the document.
    future = deepcopy(viewed)
    future["global_adjustments"]["shared"]["future_setting"] = 3
    assert grade_key(future) != grade_key(viewed)
    assert viewed["global_adjustments"]["shared"]["overlay_mode"] == "zebra"
