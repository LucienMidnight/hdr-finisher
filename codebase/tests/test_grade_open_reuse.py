"""Fast source identity and single-decode checks using disposable pixels."""
from pathlib import Path
from time import monotonic, sleep
import numpy as np
import pytest
from PIL import Image
from hdr_finisher.import_jobs import ImportJobManager
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.models import RawImportSettings, SourceInterpretationOverride
from hdr_finisher.projects import open_document, ProjectSourceRelinkRequired
from hdr_finisher.sessions import SessionStore

@pytest.mark.parametrize('manual', [False, True])
def test_saved_grade_open_decodes_and_hashes_once_with_identical_pixels_and_measurements(tmp_path, monkeypatch, manual):
    import hdr_finisher.sessions as sessions
    photo = tmp_path / 'photo.png'
    Image.fromarray(np.random.default_rng(77).integers(1, 240, (48, 64, 3), dtype=np.uint8)).save(photo)
    reference_store = SessionStore()
    initial = reference_store.get(reference_store.create_session(photo, owns_source_path=False).session_id)
    doc = initial.edit_document().model_copy(deep=True)
    doc.hdr_reference_white_nits = 100
    doc.global_adjustments.hdr.exposure = .75
    doc.global_adjustments.sdr.exposure = -.25
    if manual:
        doc.interpretation_override = SourceInterpretationOverride(color_space='BT.2020', transfer_function='LINEAR')
    reference = open_document(reference_store, doc, photo)
    expected_image = reference.image.copy()
    expected_analysis = reference.analysis.model_dump(mode='json')
    expected_doc = reference.edit_document().model_dump(mode='json')
    expected_preview, _ = reference.render_cache.source_pair(32)
    expected_preview = expected_preview.copy()
    reference_store.clear()
    counts = dict(decode=0, hash=0)
    real_load, real_hash = sessions.load_image, sessions._sha256_file
    def load(*args, **kwargs):
        counts['decode'] += 1
        return real_load(*args, **kwargs)
    def hash_file(*args, **kwargs):
        counts['hash'] += 1
        return real_hash(*args, **kwargs)
    monkeypatch.setattr(sessions, 'load_image', load)
    monkeypatch.setattr(sessions, '_sha256_file', hash_file)
    monkeypatch.setattr('hdr_finisher.projects._sha256_file', lambda *_: pytest.fail('reuse rehashed source'))
    store = SessionStore()
    browser = MediaBrowserStore(tmp_path / 'app')
    monkeypatch.setattr(browser, 'thumbnail', lambda *_a, **_k: pytest.fail('unused thumbnail built'))
    manager = ImportJobManager(store, browser)
    try:
        job = manager.start(photo, RawImportSettings(), grade=doc)
        deadline = monotonic() + 10
        while job.state not in {'ready', 'error', 'cancelled'} and monotonic() < deadline:
            sleep(.01)
        assert job.state == 'ready', job.error
        session = open_document(store, doc, photo, reuse_session_id=job.session_id)
        assert str(session.session_id) == job.session_id
        assert counts == dict(decode=1, hash=1)
        np.testing.assert_array_equal(session.image, expected_image)
        assert session.analysis.model_dump(mode='json') == expected_analysis
        assert session.edit_document().model_dump(mode='json') == expected_doc
        np.testing.assert_array_equal(session.render_cache.source_pair(32)[0], expected_preview)
        assert not session.dirty and not session.undo_history
        bad = doc.model_copy(deep=True)
        bad.source.fingerprint_sha256 = '0' * 64
        with pytest.raises(ProjectSourceRelinkRequired, match='fingerprint'):
            open_document(store, bad, photo, reuse_session_id=job.session_id)
    finally:
        manager.close()
        store.clear()

def test_recovery_with_different_decode_settings_reopens_instead_of_reusing_wrong_pixels(tmp_path):
    photo = tmp_path / 'photo.png'
    Image.new('RGB', (16, 12), (128, 80, 40)).save(photo)
    store = SessionStore()
    try:
        initial = store.get(store.create_session(photo, owns_source_path=False).session_id)
        recovery = initial.edit_document().model_copy(deep=True)
        recovery.hdr_reference_white_nits = 100
        opened = open_document(store, recovery, photo, reuse_session_id=str(initial.session_id))
        assert opened.session_id != initial.session_id
        assert opened.render_cache.source_identity.reference_white_nits == 100
    finally:
        store.clear()

def test_recovery_decode_selection_retains_the_original_default(tmp_path):
    from hdr_finisher.library_marks import LibraryMarks
    from hdr_finisher.library_grades import LibraryGrades
    photo = tmp_path / 'photo.png'
    Image.new('RGB', (16, 12), (128, 80, 40)).save(photo)
    store = SessionStore()
    try:
        initial = store.get(store.create_session(photo, owns_source_path=False).session_id)
        grades = LibraryGrades(LibraryMarks(tmp_path / 'app'), store)
        grades.attach(str(initial.session_id))
        baseline = grades._get(str(photo))['default']
        recovery = initial.edit_document().model_copy(deep=True)
        recovery.hdr_reference_white_nits = 100
        state = grades._get(str(photo))
        state['recovery'] = recovery.model_dump(mode='json')
        grades._put(str(photo), state)
        selected = grades.open_settings(photo, recovery=True)
        assert selected == recovery
        assert grades.open_settings(photo) is None
        prepared = store.prepare_session(photo, hdr_reference_white_nits=selected.hdr_reference_white_nits)
        payload = store.activate_session(prepared)
        attached = grades.attach(str(payload.session_id))
        assert attached['recovery'] == recovery.model_dump(mode='json')
        assert grades._get(str(photo))['default'] == baseline
        assert open_document(store, recovery, photo, reuse_session_id=str(payload.session_id)) is prepared
    finally:
        store.clear()
