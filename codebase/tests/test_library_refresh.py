"""Refresh thumbnail removes one photo's stored pictures and nothing else."""
import json
from io import BytesIO
from types import SimpleNamespace

import numpy as np

from hdr_finisher.library_pictures import LibraryPictureCache
from hdr_finisher.library_refresh import refresh
from hdr_finisher.library_screen_previews import StoredScreenPreviews


def scene(directory, name, path):
    directory.mkdir(parents=True, exist_ok=True)
    buffer = BytesIO()
    np.savez(buffer, pixels=np.ones((4, 6, 3), np.float16), metadata=np.array(json.dumps({"path": str(path), "edge": 640})))
    file = directory / (name + ".npz")
    file.write_bytes(buffer.getvalue())
    return file


def test_refresh_removes_one_photos_pictures_and_keeps_others_and_protected(tmp_path):
    photo, other = tmp_path / "DSC07193.ARW", tmp_path / "DSC07199.ARW"
    for file in (photo, other):
        file.write_bytes(b"raw")
    profile = tmp_path / "test-profile"
    cache = LibraryPictureCache(profile)
    cache.managed.prepare()
    thumb = scene(cache.root, "a" * 64, photo)
    large = scene(cache.full_root, "b" * 64, photo)
    kept = scene(cache.root, "c" * 64, other)
    with cache.transient_lock:
        cache.transient["a" * 64] = b"held"

    surfaces = cache.managed.directory("library-thumbnails")
    surfaces.mkdir(parents=True, exist_ok=True)
    surface = surfaces / ("d" * 64 + ".surface")
    surface.write_bytes(json.dumps({"identity": {"path": str(photo)}}).encode() + b"\n" + b"pixels")
    other_surface = surfaces / ("e" * 64 + ".surface")
    other_surface.write_bytes(json.dumps({"identity": {"path": str(other)}}).encode() + b"\n" + b"pixels")

    previews = StoredScreenPreviews(profile)
    previews.directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, protected in (("plain", False), ("built", True)):
        picture = previews.directory / (name + ".jxl")
        picture.write_bytes(b"jxl")
        manifest = previews.directory / (name + ".json")
        manifest.write_text(json.dumps({"file": picture.name, "protected": protected, "identity": {"path": str(photo)}}), "utf-8")
        files[name] = (manifest, picture)

    for file, owner in ((thumb,photo),(large,photo),(kept,other),(surface,photo),(other_surface,other)):
        cache.managed.record(file, source=owner)
    for name, (manifest, _) in files.items():
        cache.managed.index_refresh_file(manifest, photo, 'screen_previews', name == 'built')
    removed = refresh(SimpleNamespace(cache=cache), previews, [str(photo)])

    assert removed == {"scenes": 2, "surfaces": 1, "screen_previews": 1}
    assert not thumb.exists() and not large.exists() and not surface.exists()
    assert not any(file.exists() for file in files["plain"])
    assert all(file.exists() for file in files["built"])
    assert kept.exists() and other_surface.exists() and photo.exists()
    assert "a" * 64 not in cache.transient


def test_refresh_of_a_virtual_copy_also_refreshes_its_source_scene(tmp_path):
    photo = tmp_path / "IMG_3129.CR2"
    photo.write_bytes(b"raw")
    cache = LibraryPictureCache(tmp_path / "test-profile")
    cache.managed.prepare()
    stored = scene(cache.root, "f" * 64, photo)
    cache.managed.record(stored, source=photo)
    removed = refresh(SimpleNamespace(cache=cache), StoredScreenPreviews(tmp_path / "test-profile"),
                      [f"{photo}|copy|0e0c111fa21246d3b61a462def8a9412"])
    assert removed["scenes"] == 1 and not stored.exists()


def test_refresh_uses_index_without_walking_cache(tmp_path, monkeypatch):
    photo = tmp_path / 'photo.tif'
    photo.write_bytes(b'original')
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    file = scene(cache.root, 'a'*64, photo)
    cache.managed.record(file, source=photo)
    from pathlib import Path
    def no_scan(*args, **kwargs):
        raise AssertionError('Refresh must not walk cache directories')
    monkeypatch.setattr(Path, 'glob', no_scan)
    assert refresh(SimpleNamespace(cache=cache), StoredScreenPreviews(cache.managed.profile), [str(photo)])['scenes'] == 1


def test_locked_file_is_invalid_immediately_and_removed_later(tmp_path, monkeypatch):
    from pathlib import Path
    photo = tmp_path / 'photo.tif'
    photo.write_bytes(b'original')
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    file = scene(cache.root, 'a'*64, photo)
    cache.managed.record(file, source=photo)
    original = Path.unlink
    locked = True
    def unlink(path, *args, **kwargs):
        if path == file and locked:
            raise PermissionError(32, 'File in use')
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'unlink', unlink)
    old_epoch = cache.managed.publication_epoch(photo)
    assert refresh(SimpleNamespace(cache=cache), StoredScreenPreviews(cache.managed.profile), [str(photo)])['scenes'] == 1
    assert file.exists() and not cache.managed.source_valid(file, photo)
    # Locked bytes remain in the existing allowance until physically deleted.
    assert cache.managed._used(cache.managed._ledger())['thumbnail'] == file.stat().st_size
    temporary = file.with_suffix('.tmp')
    temporary.write_bytes(b'old in-flight pixels')
    import pytest
    with pytest.raises(ValueError):
        cache.managed.publish(temporary, file, photo, old_epoch)
    locked = False
    cache.managed.cleanup_pending()
    assert not file.exists()
    assert cache.managed._used(cache.managed._ledger())['thumbnail'] == 0


def test_pending_delete_does_not_remove_new_replacement(tmp_path, monkeypatch):
    from pathlib import Path
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    file = scene(cache.root, 'a'*64, tmp_path/'photo.tif')
    original = Path.unlink
    def locked(path, *args, **kwargs):
        if path == file: raise PermissionError(32, 'File in use')
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'unlink', locked)
    assert not cache.managed.remove_disposable(file)
    file.write_bytes(b'new picture with a different identity')
    monkeypatch.setattr(Path, 'unlink', original)
    cache.managed.cleanup_pending()
    assert file.read_bytes() == b'new picture with a different identity'


def test_inventory_never_revives_invalidated_or_pending_pixels(tmp_path, monkeypatch):
    from pathlib import Path
    for extension in ('.npz', '.surface'):
        photo = tmp_path / ('photo' + extension + '.tif')
        photo.write_bytes(b'original')
        cache = LibraryPictureCache(tmp_path / ('test-profile' + extension))
        cache.managed.prepare()
        if extension == '.npz':
            file = scene(cache.root, 'a'*64, photo)
        else:
            folder = cache.managed.directory('library-thumbnails')
            folder.mkdir()
            file = folder / ('a'*64 + extension)
            file.write_bytes(json.dumps({'identity': {'path': str(photo), 'cache_epoch': 0}}).encode() + b'\npixels')
        cache.managed.record(file, source=photo)
        original = Path.unlink
        with monkeypatch.context() as patch:
            def locked(path, *args, **kwargs):
                if path == file: raise PermissionError(32, 'File in use')
                return original(path, *args, **kwargs)
            patch.setattr(Path, 'unlink', locked)
            refresh(SimpleNamespace(cache=cache), None, [str(photo)])
            cache.managed.reconcile_background(lambda: None)
            assert not cache.managed.source_valid(file, photo)
            # Even a lost source-index entry must not make old metadata current.
            cache.managed.forget_source(file)
            cache.managed.reconcile_background(lambda: None)
            assert not cache.managed.has_source_record(file)
        # Obsolete generation stays invalid even without a pending-delete row.
        with cache.managed._ledger() as db:
            db.execute('DELETE FROM pending_deletes')
        cache.managed.reconcile_background(lambda: None)
        assert not cache.managed.source_valid(file, photo)


def test_inventory_recovers_current_source_without_renewing_pending_delete(tmp_path):
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    photo = tmp_path / 'photo.tif'
    file = scene(cache.root, 'a'*64, photo)
    cache.managed.reconcile_background(lambda: None)
    assert cache.managed.source_valid(file, photo)
    cache.managed.forget_source(file)
    stat = file.stat()
    with cache.managed._ledger() as db:
        db.execute('INSERT INTO pending_deletes VALUES (?,?,?)', (str(file), stat.st_size, stat.st_mtime_ns))
    cache.managed.reconcile_background(lambda: None)
    assert not cache.managed.source_valid(file, photo)


def test_cleanup_and_publication_interleaving_preserves_replacement(tmp_path, monkeypatch):
    from pathlib import Path
    from threading import Event, Thread
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    photo = tmp_path / 'photo.tif'
    file = scene(cache.root, 'a'*64, photo)
    stat = file.stat()
    with cache.managed._ledger() as db:
        db.execute('INSERT INTO pending_deletes VALUES (?,?,?)', (str(file), stat.st_size, stat.st_mtime_ns))
    temporary = file.with_suffix('.tmp')
    temporary.write_bytes(b'fresh replacement')
    comparing, attempting, published = Event(), Event(), Event()
    errors = []
    def publish():
        try:
            assert comparing.wait(3)
            attempting.set()
            cache.managed.publish(temporary, file, photo, 0)
            published.set()
        except BaseException as error: errors.append(error)
    original = Path.stat
    def interleave(path, *args, **kwargs):
        value = original(path, *args, **kwargs)
        if path == file and not comparing.is_set():
            comparing.set()
            assert attempting.wait(3)
            # The old implementation let publication finish here and then
            # deleted the replacement. The corrected one serializes both.
            published.wait(.1)
        return value
    monkeypatch.setattr(Path, 'stat', interleave)
    worker = Thread(target=publish)
    worker.start()
    try:
        cache.managed.cleanup_pending()
    finally:
        worker.join(3)
    assert not worker.is_alive() and not errors and published.is_set()
    assert file.read_bytes() == b'fresh replacement'
    assert cache.managed.source_valid(file, photo)


def test_refresh_fences_its_family_but_other_source_work_completes(tmp_path):
    from hdr_finisher.library_source_jobs import SourceJobs
    photo, other = tmp_path / 'a.tif', tmp_path / 'b.tif'
    for path in (photo, other): path.write_bytes(b'original')
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    jobs = SourceJobs()
    commands = SimpleNamespace(epoch=7)
    selected = jobs.claim(str(photo), 'quality', 640, 10, commands.epoch)
    unaffected = jobs.claim(str(other), 'quality', 640, 10, commands.epoch)
    old_a, old_b = [cache.managed.publication_epoch(p) for p in (photo, other)]
    refresh(SimpleNamespace(cache=cache, source_jobs=jobs, marks=SimpleNamespace(file_commands=commands)), None,
            [str(photo)+'|copy|copy-id'])
    import pytest
    with pytest.raises(ValueError): jobs.check(selected, commands.epoch)
    assert jobs.check(unaffected, commands.epoch)['path'] == str(other)
    temporary = cache.root / 'b.tmp'
    temporary.parent.mkdir(exist_ok=True)
    temporary.write_bytes(b'completed unrelated work')
    target = temporary.with_suffix('.npz')
    cache.managed.publish(temporary, target, other, old_b)
    assert cache.managed.source_valid(target, other)
    assert cache.managed.publication_epoch(photo) != old_a
    assert commands.epoch == 7



def test_new_publication_retires_old_pending_delete_immediately(tmp_path):
    cache = LibraryPictureCache(tmp_path / 'test-profile')
    cache.managed.prepare()
    photo = tmp_path / 'photo.tif'
    file = scene(cache.root, 'a'*64, photo)
    stat = file.stat()
    with cache.managed._ledger() as db:
        db.execute('INSERT INTO pending_deletes VALUES (?,?,?)', (str(file), stat.st_size, stat.st_mtime_ns))
    temporary = file.with_suffix('.tmp')
    temporary.write_bytes(b'fresh current pixels')
    cache.managed.publish(temporary, file, photo, 0)
    assert cache.managed.source_valid(file, photo)
    cache.managed.cleanup_pending()
    assert file.read_bytes() == b'fresh current pixels'
