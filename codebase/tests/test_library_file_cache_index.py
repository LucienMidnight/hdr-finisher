import json
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Event
from time import monotonic, sleep

import numpy as np
import pytest

from hdr_finisher.library_cache import LibraryCache
from hdr_finisher.library_file_commands import FileCommands, FileRequest
from hdr_finisher.library_file_state import pictures
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_pictures import LibraryPictureCache, picture_key
from hdr_finisher.media_browser import MediaBrowserStore


def scene(cache, source, edge=512):
    cache.prepare()
    key = picture_key(source, edge, 'quick')
    directory = cache.directory('library-full-pictures' if edge >= 1280 else 'library-pictures')
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / (key + '.npz')
    pixels = np.arange(18, dtype=np.float32).reshape(2, 3, 3)
    with file.open('wb') as stream:
        np.savez_compressed(stream, pixels=pixels, metadata=np.asarray(json.dumps({
            'path': str(source), 'edge': edge, 'quality': 'quick'})))
    cache.record(file, source=source)
    return file, pixels


@pytest.mark.parametrize('delete', [False, True])
def test_index_retargets_only_related_scenes_without_a_cache_walk(tmp_path, monkeypatch, delete):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    unrelated = tmp_path / 'photo-other.png'
    unrelated.write_bytes(b'other original')
    profile = tmp_path / 'profile'
    cache = LibraryCache(profile)
    cache.prepare()
    stored = [scene(cache, source, edge) for edge in (512, 1280)]
    other, _ = scene(cache, unrelated)
    original_other = other.read_bytes()
    with cache._ledger() as database:
        database.executemany('INSERT INTO sources VALUES (?, ?, ?, ?)',
                             [(str(other.parent / f'unrelated-{index}.npz'), str(unrelated), 1, 1)
                              for index in range(5475)])
    target = tmp_path / 'renamed.png'
    source.rename(target)
    monkeypatch.setattr(Path, 'glob', lambda *args: pytest.fail('File commands must not scan the cache'))
    pictures(profile, {'old': str(source), 'new': str(target)}, delete=delete)
    for old, pixels in stored:
        assert not old.exists()
        destination = old.parent / (picture_key(target, 1280 if old.parent.name == 'library-full-pictures' else 512, 'quick') + '.npz')
        assert destination.exists() == (not delete)
        if not delete:
            with np.load(destination, allow_pickle=False) as data:
                np.testing.assert_array_equal(data['pixels'], pixels)
                assert json.loads(str(data['metadata']))['path'] == str(target)
    assert other.read_bytes() == original_other
    assert list(cache.source_files(source)) == []


def test_crash_drift_is_a_miss_and_background_rebuild_never_reads_marks(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    sidecar = Path(str(source) + '.hdrf')
    sidecar.write_text('{"marks":{"rating":5},"grade":{"authored":true}}')
    authored = sidecar.read_bytes()
    cache = LibraryCache(tmp_path / 'profile')
    cache.prepare()
    file, _ = scene(cache, source)
    cache.forget_source(file)
    assert list(cache.source_files(source)) == []
    cache.reconcile_background(lambda: None)
    assert list(cache.source_files(source)) == [file]
    file.unlink()
    assert list(cache.source_files(source)) == []
    assert cache._ledger().execute('SELECT * FROM sources').fetchall() == []
    assert sidecar.read_bytes() == authored


def test_replaced_file_and_eviction_remove_source_rows(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    cache = LibraryCache(tmp_path / 'profile')
    cache.prepare()
    file, _ = scene(cache, source)
    file.write_bytes(b'replaced after crash')
    assert list(cache.source_files(source)) == []
    file, _ = scene(cache, source)
    cache.trim(limit_bytes=0)
    assert not file.exists()
    assert list(cache.source_files(source)) == []


@pytest.mark.parametrize('metadata', [['not source metadata'], {'path': 27}])
def test_bad_cached_metadata_is_only_a_cache_miss(tmp_path, metadata):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    profile = tmp_path / 'profile'
    cache = LibraryCache(profile)
    file, _ = scene(cache, source)
    with file.open('wb') as stream:
        np.savez(stream, metadata=np.asarray(json.dumps(metadata)))
    cache.record(file, source=source)
    pictures(profile, {'old': str(source), 'new': str(tmp_path / 'renamed.png')})
    cache.reconcile_background(lambda: None)
    assert not cache.source_valid(file, source)
    assert source.read_bytes() == b'original'


def test_publication_started_before_a_command_cannot_recreate_old_cache_entries(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    cache = LibraryCache(tmp_path / 'profile')
    cache.prepare()
    file, _ = scene(cache, source)
    before = cache.publication_epoch(source)
    temporary = file.with_suffix('.tmp')
    temporary.write_bytes(file.read_bytes())
    owner = tmp_path / 'command.json'
    owner.write_text('{}')
    with cache.mutation([source], owner):
        with pytest.raises(ValueError, match='file command'):
            cache.publication_epoch(source)
        with pytest.raises(ValueError, match='moved or was deleted'):
            cache.publish(temporary, file, source, before)
    with pytest.raises(ValueError, match='moved or was deleted'):
        cache.publish(temporary, file, source, before)
    assert not cache.source_valid(file, source)
    cache.reconcile_background(lambda: None)
    assert cache.source_valid(file, source)
    cache.publish(temporary, file, source, cache.publication_epoch(source))
    assert cache.source_valid(file, source)


def test_stale_cached_starting_document_is_a_miss_without_changing_authored_state(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    sidecar = Path(str(source) + '.hdrf')
    sidecar.write_text('{"marks":{"rating":5},"grade":{"authored":true}}')
    authored = sidecar.read_bytes()
    cache = LibraryPictureCache(tmp_path / 'profile')
    cache.keep_default_document(source, {'cached_starting_look': True})
    assert cache.default_document(source) == {'cached_starting_look': True}
    with cache.managed.mutation([source], tmp_path / 'command.json'):
        assert cache.default_document(source) is None
    assert cache.default_document(source) is None
    assert sidecar.read_bytes() == authored


def test_direct_pixel_read_rejects_stale_cache_index(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    cache = LibraryPictureCache(tmp_path / 'profile')
    result = cache.build(source, 512, decoded=(np.ones((2, 3, 3)), None, {}))
    assert cache.pixels(result['key'])[1:3] == (3, 2)
    cache.managed.forget_source(cache.file(result['key']))
    with pytest.raises(FileNotFoundError, match='index is stale'):
        cache.pixels(result['key'])
    cache.managed.reconcile_background(lambda: None)
    assert cache.pixels(result['key'])[1:3] == (3, 2)


def test_replace_before_index_commit_is_a_cache_miss_rebuilt_from_metadata(tmp_path, monkeypatch):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    cache = LibraryCache(tmp_path / 'profile')
    cache.prepare()
    file, _ = scene(cache, source)
    temporary = file.with_suffix('.tmp')
    with temporary.open('wb') as stream:
        np.savez_compressed(stream, pixels=np.ones((4, 4, 3)), metadata=np.asarray(json.dumps({
            'path': str(source), 'edge': 512, 'quality': 'quick'})))
    original = cache._record

    def interrupted(*args, **kwargs):
        raise OSError('crash after replacement')

    monkeypatch.setattr(cache, '_record', interrupted)
    with pytest.raises(OSError, match='crash after replacement'):
        cache.publish(temporary, file, source, cache.publication_epoch(source))
    assert not cache.source_valid(file, source)
    monkeypatch.setattr(cache, '_record', original)
    cache.reconcile_background(lambda: None)
    assert cache.source_valid(file, source)


def test_orphaned_mutation_recovers_without_releasing_an_unfinished_command(tmp_path):
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    cache = LibraryCache(tmp_path / 'profile')
    cache.prepare()
    owner = tmp_path / 'command.json'
    owner.write_text('{}')
    database = cache._ledger()
    with database:
        database.execute('INSERT INTO source_mutations VALUES (?, ?, ?)', (os.path.normcase(str(source.resolve())), 1, str(owner)))
    cache.reconcile_background(lambda: None)
    with pytest.raises(ValueError):
        cache.publication_epoch(source)
    owner.unlink()
    cache.reconcile_background(lambda: None)
    assert cache.publication_epoch(source) == 1


def test_folder_index_prefix_and_generation_do_not_include_similarly_named_folders(tmp_path):
    old = tmp_path / 'เที่ยว_100%'
    sibling = tmp_path / 'เที่ยว_100%-other'
    old.mkdir()
    sibling.mkdir()
    source = old / '📷.png'
    source.write_bytes(b'original')
    other = sibling / 'photo.png'
    other.write_bytes(b'other')
    profile = tmp_path / 'profile'
    cache = LibraryCache(profile)
    cache.prepare()
    file, _ = scene(cache, source)
    untouched, _ = scene(cache, other)
    before = untouched.read_bytes()
    owner = tmp_path / 'command.json'
    owner.write_text('{}')
    target = tmp_path / 'renamed'
    with cache.mutation([old, target], owner):
        assert cache.publication_epoch(other) == 0
        old.rename(target)
        pictures(profile, {'old': str(old), 'new': str(target), 'folder': True})
    assert not file.exists()
    assert cache.source_valid(untouched, other)
    assert untouched.read_bytes() == before
    assert len(list(cache.source_files(target, folder=True))) == 1


def test_cache_generation_fence_is_shared_with_helper_processes(tmp_path):
    import subprocess
    import sys
    source = tmp_path / 'photo.png'
    source.write_bytes(b'original')
    profile = tmp_path / 'profile'
    cache = LibraryCache(profile)
    before = cache.publication_epoch(source)
    code = ('from hdr_finisher.library_cache import LibraryCache; import sys; '
            'cache=LibraryCache(sys.argv[1]); '
            'with_mutation=cache.mutation([sys.argv[2]],sys.argv[3]); '
            'with_mutation.__enter__(); with_mutation.__exit__(None,None,None)')
    subprocess.run([sys.executable, '-c', code, str(profile), str(source), str(tmp_path / 'command.json')],
                   check=True, env={**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1] / 'backend')})
    assert cache.publication_epoch(source) > before


def commands(tmp_path):
    folder = tmp_path / 'photos'
    folder.mkdir()
    source = folder / 'photo.png'
    source.write_bytes(b'original photo bytes')
    other = folder / 'other.png'
    other.write_bytes(b'unrelated photo bytes')
    profile = tmp_path / 'profile'
    marks = LibraryMarks(profile)
    browser = MediaBrowserStore(profile)
    index = LibraryIndex(marks, browser, None)
    marks.read([str(source), str(other)])
    return FileCommands(marks, browser, index), source, other


def unrelated_mark(service, other):
    started = monotonic()
    service.marks.change([str(other)], MarkChange(rating=5))
    acknowledged = monotonic() - started
    sidecar = Path(str(other) + '.hdrf')
    deadline = started + 1
    while not sidecar.exists() and monotonic() < deadline:
        sleep(.005)
    assert acknowledged < .25
    assert sidecar.exists()
    assert json.loads(sidecar.read_text())['marks']['rating'] == 5
    assert monotonic() - started < 1


@pytest.mark.parametrize('stage', ['plan', 'cache'])
def test_unrelated_marks_acknowledged_and_written_during_slow_file_work(tmp_path, monkeypatch, stage):
    from hdr_finisher import library_file_commands, library_file_io
    service, source, other = commands(tmp_path)
    entered, release = Event(), Event()
    monkeypatch.setattr(library_file_commands, 'FILE_COMMANDS_SUPPORTED', True)

    @contextmanager
    def checked_destination(path, stamp, checksum):
        assert library_file_io.same(path, stamp, checksum)
        yield

    monkeypatch.setattr(library_file_io, 'read_guard', checked_destination)
    if stage == 'plan':
        digest = library_file_commands.digest

        def delayed_digest(path):
            if Path(path) == source:
                entered.set()
                assert release.wait(5)
            return digest(path)

        monkeypatch.setattr(library_file_commands, 'digest', delayed_digest)
        action = lambda: service.plan(FileRequest(action='rename', paths=[str(source)], name='renamed'))
    else:
        plan = service.plan(FileRequest(action='rename', paths=[str(source)], name='renamed'))

        def delayed_cache(*args, **kwargs):
            entered.set()
            assert release.wait(5)

        monkeypatch.setattr(library_file_commands, 'pictures', delayed_cache)
        action = lambda: service.execute(plan['token'])
    service.marks.writer.start()
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            work = executor.submit(action)
            try:
                assert entered.wait(5)
                with pytest.raises(ValueError, match='file command'):
                    service.marks.change([str(source)], MarkChange(rating=2))
                unrelated_mark(service, other)
            finally:
                release.set()
            result = work.result(timeout=5)
        if stage == 'cache':
            assert result['count'] == 1
            assert source.with_name('renamed.png').read_bytes() == b'original photo bytes'
    finally:
        service.marks.writer.close()


def test_folder_fence_protects_children_and_copies_but_not_similarly_named_folders(tmp_path):
    service, source, other = commands(tmp_path)
    with service.fence([source.parent]):
        with ThreadPoolExecutor(max_workers=1) as executor:
            assert executor.submit(service.blocked, str(source)).result()
            assert executor.submit(service.blocked, str(source) + '|copy|alternative').result()
            assert not executor.submit(service.blocked, str(source.parent) + '-other/photo.png').result()
    assert not service.blocked(source)
