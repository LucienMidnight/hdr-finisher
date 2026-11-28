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


def test_file_hash_and_decode_overlap_without_another_image(tmp_path, monkeypatch):
    from threading import Event
    import hdr_finisher.sessions as sessions
    photo = tmp_path / 'overlap.png'
    Image.new('RGB', (32, 24), (128, 80, 40)).save(photo)
    hash_started, decoding = Event(), Event()
    real_load, real_hash = sessions.load_image, sessions._sha256_file
    def hash_file(path):
        hash_started.set()
        assert decoding.wait(2), 'hash blocked decoding'
        return real_hash(path)
    def load(*args, **kwargs):
        assert hash_started.wait(2), 'decode blocked hashing'
        decoding.set()
        return real_load(*args, **kwargs)
    monkeypatch.setattr(sessions, '_sha256_file', hash_file)
    monkeypatch.setattr(sessions, 'load_image', load)
    store = SessionStore()
    session = store.prepare_session(photo)
    assert session.source_fingerprint_sha256 == real_hash(photo)
    store.clear()


def test_unchanged_raw_apply_retains_pixels_preparation_and_save_state(tmp_path, monkeypatch):
    import lensfunpy
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    from hdr_finisher import main, raw_import, sessions
    from hdr_finisher.desktop_security import DesktopPathGrants

    # Exercise import/session ownership without a large or platform-specific RAW.
    photo = tmp_path / 'sensor.ARW'
    Image.fromarray(np.random.default_rng(16).integers(1, 240, (48, 64, 3), dtype=np.uint8)).save(photo, format='PNG')
    bundle = tmp_path / 'db_files'
    bundle.mkdir()
    xml = bundle / 'calibrations.xml'
    xml.write_bytes(b'calibration1')
    monkeypatch.setattr(lensfunpy, '__file__', str(tmp_path / '__init__.py'))
    bundle_identity = raw_import._read_lens_database_identity()
    loaded_db = SimpleNamespace(has_common_profiles=False)
    fresh_db = SimpleNamespace(has_common_profiles=False)
    monkeypatch.setattr(raw_import, '_lens_database_identity', lambda: bundle_identity)
    monkeypatch.setattr(raw_import, '_lens_database', lambda: loaded_db)
    monkeypatch.setattr(raw_import, 'native_lens_database', lambda *, load_bundled: fresh_db)

    real_load = sessions.load_image
    decodes = []
    def load(path, **kwargs):
        decodes.append(kwargs['raw_import_settings'])
        png = tmp_path / 'decode.png'
        png.write_bytes(path.read_bytes())
        image, source, metadata, analysis, sdr = real_load(png, **kwargs)
        source.suffix = '.arw'
        metadata['lens_correction'] = {
            'applied': True, 'profile': {'id': 'resolved profile'}, 'database_version': bundle_identity,
        }
        return image, source, metadata, analysis, sdr
    monkeypatch.setattr(sessions, 'load_image', load)

    store, legacy = SessionStore(), SessionStore()
    manager = ImportJobManager(store, MediaBrowserStore(tmp_path / 'app'))
    grants = DesktopPathGrants()
    monkeypatch.setattr(main, 'store', store)
    monkeypatch.setattr(main, 'import_jobs', manager)
    monkeypatch.setattr(main, 'desktop_path_grants', grants)
    client = TestClient(main.app)
    settings = RawImportSettings()
    observed = []
    store.grade_recovery_observer = lambda session: observed.append(session.edit_state())
    # A stored Auto grade carries resolved provenance. The Apply form does not.
    saved = settings.model_copy(deep=True)
    saved.lens.profile_id, saved.lens.database_version = 'resolved profile', bundle_identity
    try:
        initial = store.create_session(photo, raw_import_settings=saved)
        session = store.get(initial.session_id)
        image, cache = session.image, session.render_cache
        preview, _ = cache.source_pair(32)
        url = f'/api/session/{initial.session_id}/raw-apply-reuse'

        def apply(requested=settings, revision=None, grant=None):
            grant = grant or grants.issue(str(photo), 'source-open')[0]
            result = client.post(url, json={'grant': grant, 'raw_import_settings': requested.model_dump(mode='json'),
                                            'expected_revision': session.edit_revision if revision is None else revision})
            assert result.status_code == 200, result.text
            return result.json()['session']

        grant, _ = grants.issue(str(photo), 'source-open')
        accepted = apply(grant=grant)
        assert len(decodes) == 1
        assert accepted['dirty'] and accepted['edit_revision'] == initial.edit_revision + 1
        assert store.get(initial.session_id) is session and session.image is image and session.render_cache is cache
        assert observed[0].dirty and observed[0].revision == accepted['edit_revision']
        assert apply(grant=grant) is None
        assert apply(revision=initial.edit_revision) is None

        original = legacy.create_session(photo, raw_import_settings=saved)
        full = legacy.redevelop_session(original.session_id, legacy.prepare_session(photo, raw_import_settings=settings))
        assert full.edit_document == session.edit_document()
        assert full.dirty == accepted['dirty'] and full.edit_revision == accepted['edit_revision']
        assert full.can_undo == accepted['can_undo'] and full.can_redo == accepted['can_redo']
        rebuilt = legacy.get(original.session_id)
        np.testing.assert_array_equal(rebuilt.image, image)
        np.testing.assert_array_equal(rebuilt.render_cache.source_pair(32)[0], preview)

        for group, changes in {
            'pixel_cleanup': {'remove_hot_pixels': False, 'even_out_specks': False, 'speck_threshold': 3.1},
            'highlight_reconstruction': {'enabled': False, 'method': 'edge_colour_v1',
                                         'clipping_threshold': .9, 'edge_colour_expand_percent': 1.0},
            'lens': {'mode': 'off', 'distortion': False, 'chromatic_aberration': False, 'vignetting': False,
                     'focal_length_mm': 65, 'aperture': 2, 'focus_distance_m': 4},
        }.items():
            for control, value in changes.items():
                changed = settings.model_copy(deep=True)
                setattr(getattr(changed, group), control, value)
                assert apply(changed) is None, (group, control)
        xml.write_bytes(b'calibration2')
        assert apply() is None
        xml.write_bytes(b'calibration1')
        fresh_db.has_common_profiles = True
        assert apply() is None
        fresh_db.has_common_profiles = False
        loaded_db.has_common_profiles = True
        assert apply() is None
        loaded_db.has_common_profiles = False
        assert session.edit_revision == accepted['edit_revision'] and len(observed) == 1

        # Even an identical replacement at the same path needs the normal
        # route. The preflight must not spend the grant intended for that job.
        replacement = tmp_path / 'replacement.ARW'
        replacement.write_bytes(photo.read_bytes())
        replacement.replace(photo)
        grant, _ = grants.issue(str(photo), 'source-open')
        assert apply(grant=grant) is None
        before = len(decodes)
        response = client.post('/api/import-jobs', json={
            'grant': grant, 'replace_session_id': initial.session_id,
            'raw_import_settings': settings.model_dump(mode='json'),
        })
        assert response.status_code == 202, response.text
        job = manager.get(response.json()['job_id'])
        deadline = monotonic() + 10
        while job.state not in {'ready', 'error', 'cancelled'} and monotonic() < deadline:
            sleep(.01)
        assert job.state == 'ready', job.error
        assert len(decodes) == before + 1
        assert store.get(initial.session_id) is not session
    finally:
        manager.close()
        store.clear()
        legacy.clear()
