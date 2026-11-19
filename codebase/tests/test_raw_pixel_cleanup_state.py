from copy import deepcopy
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

from hdr_finisher.models import EditCommand, EditDocument, RawImportSettings
from test_library_grades import setup


def test_light_guard_replaces_only_enabled_cached_developments(setup, monkeypatch):
    from hdr_finisher import loader, sessions
    from hdr_finisher.library_live import quality

    _, _, session, _, _ = setup

    def identities():
        return sessions._source_mip_identity(session), quality(session.edit_document().model_dump(mode="json"))

    off = identities()
    session.raw_import_settings.pixel_cleanup.even_out_specks = True
    enabled = identities()
    for module in (loader, sessions):
        monkeypatch.setattr(module, "source_decoder_version", lambda _: loader.SOURCE_DECODER_VERSION)
    assert all(current != old for current, old in zip(enabled, identities(), strict=True))
    session.raw_import_settings.pixel_cleanup.even_out_specks = False
    assert identities() == off


@pytest.mark.parametrize('field,value', [('remove_hot_pixels', True), ('even_out_specks', True), ('speck_threshold', 3.1)])
def test_saved_recipe_copy_selection_and_development_identity(tmp_path, field, value):
    from hdr_finisher.library_live import quality
    from hdr_finisher.library_paste import LibraryPaste
    from hdr_finisher.sessions import SessionStore
    source = tmp_path / 'sensor.png'
    Image.new('RGB', (16, 16), (80, 120, 160)).save(source)
    store = SessionStore()
    payload = store.create_session(source)
    document = store.get(payload.session_id).edit_document().model_dump(mode='json')
    edited = deepcopy(document)
    edited['source']['raw_import_settings']['pixel_cleanup'][field] = value
    saved = EditDocument.model_validate_json(EditDocument.model_validate(edited).model_dump_json())
    assert getattr(saved.source.raw_import_settings.pixel_cleanup, field) == value
    assert quality(edited) != quality(document)
    schema = LibraryPaste.schema(None, edited, document)
    selected = next(group for group in schema if group['id'] == 'raw-development')
    setting = next(item for item in selected['settings'] if item['id'].endswith('pixel_cleanup.' + field))
    assert setting['modified'] and {'remove_hot_pixels': 'Remove hot pixels', 'even_out_specks': 'Even out harsh specks', 'speck_threshold': 'Speck threshold'}[field] in setting['label']


@pytest.mark.parametrize('field,value', [('remove_hot_pixels', True), ('even_out_specks', True), ('speck_threshold', 3.1)])
def test_selective_raw_copy_paste_and_undo_persist_cleanup(setup, field, value):
    from hdr_finisher.library_paste import LibraryPaste
    photo, store, session, marks, grades = setup
    setattr(session.raw_import_settings.pixel_cleanup, field, value)
    grades.capture(str(session.session_id))
    grades.save(str(session.session_id))
    marks.writer.drain()
    copied = session.edit_document().model_dump(mode='json')
    paste = LibraryPaste(grades)
    paste.copy(str(photo))
    store.clear()
    folder = photo.parent / 'detachable'
    folder.mkdir()
    target = folder / 'target.ARW'
    target.write_bytes(photo.read_bytes())
    starting = deepcopy(copied)
    starting['source']['filename'] = target.name
    starting['source']['durable_path'] = str(target)
    starting['source']['raw_import_settings']['pixel_cleanup'][field] = 2.5 if field == 'speck_threshold' else False
    document = dict(format='HDR Finisher Photo', schema_version=1, photo_id='raw-target', marks={},
                    albums=[], grade=starting, grade_default=starting)
    Path(str(target) + '.hdrf').write_text(json.dumps(document), encoding='utf-8')
    marks.read([target])
    folder.rename(photo.parent / 'disconnected')
    selection = {'lanes': ['hdr', 'sdr'], 'settings': ['source.raw_import_settings.pixel_cleanup.' + field]}
    result = paste.paste([str(target)], selection)
    assert result['count'] == 1
    assert grades._get(str(target))['desired']['source']['raw_import_settings']['pixel_cleanup'][field] == value
    marks.undo()
    assert grades._get(str(target))['desired'] == starting
    (photo.parent / 'disconnected').rename(folder)
    marks.writer.drain()
    assert json.loads(Path(str(target) + '.hdrf').read_text())['grade'] == starting


@pytest.mark.parametrize('field', ['remove_hot_pixels', 'even_out_specks'])
def test_cleanup_redevelopment_can_undo_redo_pixels_and_saved_setting(tmp_path, monkeypatch, field):
    from hdr_finisher import sessions as module
    from hdr_finisher.sessions import SessionStore, _source_mip_identity
    source = tmp_path / 'sensor.png'
    Image.new('RGB', (32, 24), (80, 120, 160)).save(source)
    store = SessionStore()
    initial = store.create_session(source)
    current = store.get(initial.session_id)
    original_pixels = current.image.copy()
    original_identity = _source_mip_identity(current)
    enabled = RawImportSettings(pixel_cleanup={field: True})
    actual_load = module.load_image
    calls = []

    def load(*args, **kwargs):
        image, descriptor, information, analysis, reference = actual_load(*args, **kwargs)
        active = getattr(kwargs['raw_import_settings'].pixel_cleanup, field)
        calls.append(active)
        if active:
            image = image.copy()
            image[12, 12] = 0
        return image, descriptor, information, analysis, reference

    monkeypatch.setattr(module, 'load_image', load)
    developed = store.prepare_session(source, raw_import_settings=enabled)
    store.redevelop_session(initial.session_id, developed)
    active = store.get(initial.session_id)
    assert getattr(active.raw_import_settings.pixel_cleanup, field)
    assert not np.array_equal(active.image, original_pixels)
    assert _source_mip_identity(active) != original_identity
    for command, expected in [('undo', False), ('redo', True)]:
        store.apply_edit_commands(active.session_id, [EditCommand(expected_revision=active.edit_revision, command_type=command)])
        assert getattr(active.raw_import_settings.pixel_cleanup, field) is expected
        assert (not np.array_equal(active.image, original_pixels)) is expected
        assert (active.render_cache.source_identity != original_identity) is expected
    assert calls == [True, False, True]


@pytest.mark.parametrize('field', ['remove_hot_pixels', 'even_out_specks'])
def test_failed_raw_undo_keeps_pixels_recipe_and_history(tmp_path, monkeypatch, field):
    from hdr_finisher import sessions as module
    from hdr_finisher.sessions import SessionStore
    source = tmp_path / 'sensor.png'
    Image.new('RGB', (16, 16), (80, 120, 160)).save(source)
    store = SessionStore()
    initial = store.create_session(source)
    developed = store.prepare_session(source, raw_import_settings=RawImportSettings(pixel_cleanup={field: True}))
    store.redevelop_session(initial.session_id, developed)
    session = store.get(initial.session_id)
    previous = session.edit_document().model_dump_json()
    pixels, identity, revision = session.image, session.render_cache.source_identity, session.edit_revision
    history = list(session.undo_history)

    def fail(*args, **kwargs):
        raise ValueError('unavailable source')

    monkeypatch.setattr(module, 'load_image', fail)
    with pytest.raises(ValueError, match='unavailable source'):
        store.apply_edit_commands(session.session_id, [EditCommand(expected_revision=revision, command_type='undo')])
    assert session.edit_document().model_dump_json() == previous
    assert session.image is pixels and session.render_cache.source_identity == identity
    assert session.edit_revision == revision and session.undo_history == history and not session.redo_history
