from threading import Thread
import time
import multiprocessing

from hdr_finisher.library_raw import RawBrowsing, allowances, identity, MIB


def test_auto_limits_scale_down_without_losing_foreground_lane():
    small, large = allowances(8 * 1024**3), allowances(64 * 1024**3)
    assert large["raw_files"] == 40 and large["ahead"] == 12 and large["gpu_pictures"] == 10
    assert small["raw_bytes"] < large["raw_bytes"]
    assert small["ahead"] == 2 and small["gpu_pictures"] == 2


def test_windows_priority_promotion_uses_a_real_process_handle():
    process = multiprocessing.get_context("spawn").Process(target=time.sleep, args=(.3,))
    process.start()
    try:
        RawBrowsing._promote(process)
        RawBrowsing._promote(process, False)
    finally:
        process.join(timeout=3)


def test_promoting_inflight_decode_reuses_future(tmp_path, monkeypatch):
    source = tmp_path / "a.arw"
    source.write_bytes(b"raw")
    service = RawBrowsing(tmp_path)
    monkeypatch.setattr(service, "start", lambda: None)
    promoted = []
    monkeypatch.setattr(service, "_promote", lambda process: promoted.append(process))
    future = service.request(source, 50)
    job = service.jobs[identity(source)[0]]
    job.update(active=True, process="background")
    assert service.request(source, 0) is future
    assert job["priority"] == 0 and promoted == ["background"]
    service.close()
    assert future.cancelled()


def test_full_size_disk_eviction_cannot_remove_thumbnail(tmp_path, monkeypatch):
    import numpy as np
    from hdr_finisher.library_pictures import LibraryPictureCache
    from PIL import Image
    source = tmp_path / "photo.png"
    Image.new("RGB", (8, 8)).save(source)
    cache = LibraryPictureCache(tmp_path / "cache", limit=10000)
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture", lambda *args: (
        np.ones((8, 8, 3), dtype=np.float32), None, {"route": "test"}))
    thumb = cache.build(source, 128)
    full = cache.build(source, 2560)
    assert cache.file(full["key"]).parent == cache.full_root
    assert cache.file(thumb["key"]).parent == cache.root
    cache.limit = thumb["stored_bytes"] + 1
    cache.trim()
    assert cache.file(thumb["key"]).is_file()


def test_one_reader_bounds_raw_bytes_and_stale_plans(tmp_path, monkeypatch):
    files = []
    for i in range(5):
        path = tmp_path / f"{i}.arw"
        path.write_bytes(bytes([i]) * (MIB + 9))
        files.append(path)
    service = RawBrowsing(tmp_path)
    service.limits.update(raw_files=2, raw_bytes=3*MIB)
    monkeypatch.setattr(service, "start", lambda: None)
    future = service.request(files[0], 60)
    service.plan([files[4]])
    assert future.cancelled(), "Stale queued read-ahead must be discarded"
    reader = Thread(target=service._read, daemon=True)
    service.threads.append(reader)
    reader.start()
    deadline = time.monotonic() + 5
    while identity(files[4])[0] not in service.raw and time.monotonic() < deadline:
        time.sleep(.01)
    key = identity(files[4])[0]
    assert key in service.raw
    assert bytes(service.raw[key][0].buf) == files[4].read_bytes()
    with service.cv:
        assert service._trim_raw(2*MIB)
        assert sum(item[1] for item in service.raw.values()) + 2*MIB <= service.limits["raw_bytes"]
    service.close()
    assert not service.raw and service.partial is None


def test_pause_prevents_disk_work_and_changed_source_changes_identity(tmp_path, monkeypatch):
    path = tmp_path / "a.arw"
    path.write_bytes(b"before")
    before = identity(path)[0]
    path.write_bytes(b"after")
    assert identity(path)[0] != before
    service = RawBrowsing(tmp_path, paused=lambda: True)
    monkeypatch.setattr(service, "start", lambda: None)
    service.request(path)
    reader = Thread(target=service._read, daemon=True)
    service.threads.append(reader)
    reader.start()
    time.sleep(.05)
    assert service.partial is None and not service.raw
    service.close()
