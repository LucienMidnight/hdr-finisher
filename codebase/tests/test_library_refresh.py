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
