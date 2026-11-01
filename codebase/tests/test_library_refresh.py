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
    removed = refresh(SimpleNamespace(cache=cache), StoredScreenPreviews(tmp_path / "test-profile"),
                      [f"{photo}|copy|0e0c111fa21246d3b61a462def8a9412"])
    assert removed["scenes"] == 1 and not stored.exists()
