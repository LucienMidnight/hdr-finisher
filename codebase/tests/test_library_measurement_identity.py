from copy import deepcopy
from types import SimpleNamespace
from test_library_grades import setup, edit, settings, saved
from hdr_finisher.library_grades import grade_key
from hdr_finisher.library_documents import identity, LibraryDocuments


def measurements(store, session):
    document = session.edit_document().model_copy(deep=True)
    document.global_adjustments.hdr.highlight_compression_source_peak_nits += .00001
    document.global_adjustments.sdr.highlight_compression_source_peak_percent += .00001
    store.replace_edit_document(str(session.session_id), document, session.edit_revision)
    return session.edit_document().model_dump(mode="json")


def test_untouched_measurements_preserved_but_not_edited(setup, tmp_path):
    photo, store, session, marks, grades = setup
    default = session.edit_document().model_dump(mode="json")
    measured = measurements(store, session)
    assert measured != default
    assert grade_key(measured) == grade_key(default)
    assert identity(measured) == identity(default)
    calls = []
    marks.kept = SimpleNamespace(schedule=lambda *args, **kwargs: calls.append((args, kwargs)))
    grades.save(str(session.session_id)); marks.writer.drain()
    assert settings(photo)["grade"] == measured
    assert not grades.describe([photo])[str(photo)]["edited"]
    assert not calls
    assert not LibraryDocuments(marks).request(photo)["edited"]
    assert grades.history.available([photo])["counts"]["original"] == 0
    edit(store, session)
    grades.save(str(session.session_id)); marks.writer.drain()
    assert grades.describe([photo])[str(photo)]["edited"]
    assert not calls, "A real edit is saved without starting a finished-picture file job"


def test_measurements_on_real_edit_keep_picture_identity(setup):
    photo, store, session, marks, grades = setup
    original = saved(setup)
    calls = []
    marks.kept = SimpleNamespace(schedule=lambda *args, **kwargs: calls.append((args, kwargs)))
    measured = measurements(store, session)
    grades.save(str(session.session_id)); marks.writer.drain()
    assert identity(original) == identity(measured)
    assert not calls
    assert grades.describe([photo])[str(photo)]["edited"]
    for lane, field in [("hdr", "highlight_compression_manual_peak_nits"),
                        ("hdr", "highlight_compression_peak_measurement"),
                        ("sdr", "highlight_compression_manual_peak_percent"),
                        ("sdr", "highlight_compression_peak_measurement")]:
        changed = deepcopy(measured)
        changed["global_adjustments"][lane][field] = "absolute" if "measurement" in field else 2000
        assert grade_key(changed) != grade_key(measured)
