from concurrent.futures import CancelledError
import os
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

from hdr_finisher.library_folders import scan_folder, folder_tree
from hdr_finisher.library_pictures import LibraryPictureCache, SIDECAR_SUFFIX, picture_key
from hdr_finisher.library_worker import LibraryWorker


def test_raw_thumbnail_keeps_grade_pixels_and_full_source_start(tmp_path, monkeypatch):
    from hdr_finisher import library_pictures as pictures
    from hdr_finisher.analysis import classify_hdr
    from hdr_finisher.import_defaults import starting_adjustments
    source = tmp_path / "photo.ARW"
    source.write_bytes(b"read-only fixture")
    pixels = np.full((80, 160, 3), .18, dtype=np.float32)
    pixels[1, 1] = 20
    analysis = classify_hdr(pixels, {}, ".arw")
    expected = starting_adjustments(analysis).model_dump(mode="json")
    calls = []
    def load(path):
        calls.append(path)
        return pixels, None, {"raw_input": True}, analysis, None
    monkeypatch.setattr(pictures.loader, "load_image", load)
    cache = LibraryPictureCache(tmp_path / "cache")
    result = cache.build(source, 64, "grade-thumbnail")
    assert result["route"] == "grade-raw-thumbnail"
    assert result["adjustments"] == expected
    with np.load(cache.file(result["key"])) as stored:
        np.testing.assert_array_equal(stored["pixels"], pictures.reduce_picture(pixels, 64).astype(np.float16))
    assert cache.build(source, 64, "grade-thumbnail")["cache_hit"]
    assert len(calls) == 1
    assert source.read_bytes() == b"read-only fixture"


def test_raw_camera_placeholder_does_not_load_grade(tmp_path, monkeypatch):
    from hdr_finisher import library_pictures as pictures
    source = tmp_path / "photo.ARW"
    monkeypatch.setattr(pictures.loader, "load_image", lambda *_: pytest.fail("Placeholder decoded Grade"))
    monkeypatch.setattr(pictures, "embedded_picture", lambda *_: np.ones((4, 8, 3), dtype=np.float32))
    assert pictures.decode_picture(source, 64, "fast")[2]["route"] == "embedded-placeholder"


def photo(tmp_path, name="photo.png"):
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (240, 120), (160, 90, 60)).save(path)
    return path


def test_recursive_scan_reads_only_supported_photos_and_does_not_write(tmp_path):
    one = photo(tmp_path)
    two = photo(tmp_path, "nested/second.png")
    sidecar = one.with_name(one.name + SIDECAR_SUFFIX)
    sidecar.write_text("untouched")
    (tmp_path / "old.hdrfinisher").write_text("project")
    before = {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    result = scan_folder(str(tmp_path))
    assert {item["path"] for item in result["photos"]} == {str(one), str(two)}
    assert folder_tree(tmp_path)["children"] == [{"name": "nested", "path": str(tmp_path / "nested")}]
    assert before == {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    with pytest.raises(CancelledError):
        scan_folder(tmp_path, lambda: True)


def test_scene_cache_retains_hdr_and_does_not_depend_on_display_grade(tmp_path, monkeypatch):
    source = photo(tmp_path)
    scene = np.ones((12, 24, 3), dtype=np.float32) * 4
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture", lambda *args: (scene, None, {"route": "test"}))
    cache = LibraryPictureCache(tmp_path / "app-data")
    result = cache.build(source, 128)
    with np.load(cache.file(result["key"])) as stored:
        assert stored["pixels"].dtype == np.float16
        assert np.max(stored["pixels"]) == 4
    assert cache.cached(source, 128, "quick")["cache_hit"]
    hdr = cache.pixels(result["key"], "hdr")
    sdr = cache.pixels(result["key"], "sdr")
    assert hdr == sdr  # Same scene data, display conversion happens on the GPU.
    assert hdr[3] % 256 == 0
    assert len(hdr[0]) == hdr[2] * hdr[3]
    assert list(tmp_path.glob("*.hdrf")) == []


def test_cache_identity_tracks_file_changes_and_cancelled_jobs_publish_nothing(tmp_path):
    source = photo(tmp_path)
    cache = LibraryPictureCache(tmp_path / "cache")
    before = picture_key(source, 128, "quick")
    source.write_bytes(source.read_bytes() + b"changed")
    assert picture_key(source, 128, "quick") != before
    with pytest.raises(CancelledError):
        cache.build(source, 128, cancelled=lambda: True)
    assert not list(cache.root.glob("*.npz"))
    with pytest.raises(ValueError):
        cache.file("../photo.png")


def test_cache_discards_oldest_in_a_batch(tmp_path):
    cache = LibraryPictureCache(tmp_path / "cache")
    a = cache.build(photo(tmp_path, "a.png"), 128)
    b = cache.build(photo(tmp_path, "b.png"), 128)
    os.utime(cache.file(a["key"]), (1, 1))
    cache.managed.trim(limit_bytes=int(b["stored_bytes"] / .9) + 1)
    assert not cache.file(a["key"]).exists()
    assert cache.file(b["key"]).exists()


def test_picture_and_scan_run_in_helper_and_cached_picture_survives_pause(tmp_path):
    source = photo(tmp_path)
    helper = LibraryWorker(tmp_path / "app-data")
    try:
        _, scan = helper.submit_library("scan", path=str(tmp_path), priority=0)
        assert len(scan.result(timeout=20)["photos"]) == 1
        _, pending = helper.submit_library("picture", path=str(source), edge=128, quality="quick")
        result = pending.result(timeout=20)
        assert result["route"] == "quick-png"
        assert result["width"] == 128 and result["height"] == 64
        assert helper.info["pid"] != os.getpid()
        assert helper.info["picture_workers"] == 6
        helper.pause("grade", True)
        cache = LibraryPictureCache(helper.root)
        assert cache.cached(source, 128, "quick")["cache_hit"]
        job, paused = helper.submit_library("picture", path=str(source), edge=192, quality="quick")
        assert helper.cancel(job) and paused.cancelled()
    finally:
        helper.close()


def test_linear_dng_quick_route_uses_primary_pixels_without_grade_corrections(tmp_path, monkeypatch):
    import tifffile
    from hdr_finisher.library_pictures import decode_picture
    source = tmp_path / "linear.dng"
    matrix = tuple(value for item in np.eye(3, dtype=int).reshape(-1) for value in (int(item), 1))
    tags = [(50706, "B", 4, b"\x01\x04\x00\x00", False),
            (50721, "2i", 9, matrix, False), (50964, "2i", 9, matrix, False),
            (50778, "H", 1, 23, False), (50728, "2I", 3, (96422, 100000, 1, 1, 82521, 100000), False)]
    pixels = np.asarray([[[65535, 0, 32768], [8000, 16000, 24000]]], np.uint16)
    tifffile.imwrite(source, pixels, photometric=34892, planarconfig="contig", metadata={"axes": "YXS"}, extratags=tags)
    before = source.read_bytes()
    def forbidden(*args, **kwargs):
        raise AssertionError("Library used Grade's corrected DNG decoder")
    monkeypatch.setattr("hdr_finisher.linear_dng.decode_linear_dng", forbidden)
    picture, reference, meta = decode_picture(source, 128, "quick")
    assert meta["route"] == "quick-linear-dng"
    assert reference is None and picture.shape == pixels.shape
    assert np.all(np.isfinite(picture))
    assert np.ptp(picture[0, 0]) == 0  # Source saturation becomes neutral, without reconstruction.
    assert source.read_bytes() == before


def test_large_browse_cache_avoids_compression_without_changing_pixels(tmp_path, monkeypatch):
    from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED
    source = photo(tmp_path)
    pixels = np.random.default_rng(7).random((12, 24, 3)).astype(np.float32)
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture", lambda *args: (pixels, None, {"route": "test"}))
    cache = LibraryPictureCache(tmp_path / "cache")
    for edge, compression in [(512, ZIP_DEFLATED), (2560, ZIP_STORED)]:
        meta = cache.build(source, edge)
        with ZipFile(cache.file(meta["key"])) as archive:
            assert all(entry.compress_type == compression for entry in archive.infolist())
        with np.load(cache.file(meta["key"]), allow_pickle=False) as stored:
            np.testing.assert_array_equal(stored["pixels"], pixels.astype(np.float16))
        assert cache.cached(source, edge, "quick")["key"] == meta["key"]


def test_non_raw_decode_keeps_completed_pixels_after_viewer_cancels(tmp_path, monkeypatch):
    from threading import Event
    source = photo(tmp_path)
    cancelled = Event()
    def decode(*args):
        cancelled.set()  # Viewer left during the native decoder call.
        return np.ones((12, 24, 3), np.float32), None, {"route": "test"}
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture", decode)
    cache = LibraryPictureCache(tmp_path / "cache")
    result = cache.build(source, 2560, cancelled=cancelled.is_set)
    assert cache.cached(source, 2560, "quick")["key"] == result["key"]


def test_non_raw_browse_waiters_share_job_across_pause_and_promote_it(tmp_path):
    source = photo(tmp_path)
    helper = LibraryWorker(tmp_path / "cache")
    try:
        helper.pause("test", True)
        job, future = helper.submit_browse_picture(path=str(source), edge=2560, quality="quick", priority=50)
        retry, shared = helper.submit_browse_picture(path=str(source), edge=2560, quality="quick", priority=0)
        assert retry == job and shared is future
        assert helper.status()["pending"] == 1
        assert helper._requests[job]["priority"] == 0
        helper.pause("test", False)
        result = future.result(timeout=20)
        assert LibraryPictureCache(helper.root).cached(source, 2560, "quick")["key"] == result["key"]
    finally:
        helper.close()


def test_stand_in_request_gets_the_real_picture_once_it_is_cached(tmp_path, monkeypatch):
    source = photo(tmp_path)
    routes = {"fast": "embedded-placeholder", "quick": "quick-linear-dng"}
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture",
        lambda path, edge, quality: (np.ones((12, 24, 3), dtype=np.float32), None, {"route": routes[quality]}))
    cache = LibraryPictureCache(tmp_path / "app-data")
    assert cache.build(source, 512, "fast")["route"] == "embedded-placeholder"
    real = cache.build(source, 512, "quick")
    assert real["route"] == "quick-linear-dng"
    assert cache.cached(source, 512, "fast")["key"] == real["key"]
    assert cache.build(source, 512, "fast")["route"] == "quick-linear-dng"
