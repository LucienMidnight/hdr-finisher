from concurrent.futures import CancelledError
import numpy as np
from PIL import Image
import pytest
from hdr_finisher.library_pictures import LibraryPictureCache


def test_native_crop_is_exact_and_decode_is_only_on_demand(tmp_path, monkeypatch):
    path = tmp_path / "photo.png"
    Image.new("RGB", (300, 200)).save(path)
    pixels = np.linspace(0, 1, 300*200*3, dtype=np.float32).reshape(200, 300, 3)
    calls = []
    def decode(path, edge, quality):
        calls.append((edge, quality))
        return pixels, None, {"route": "test"}
    monkeypatch.setattr("hdr_finisher.library_pictures.decode_picture", decode)
    cache = LibraryPictureCache(tmp_path / "cache")
    original = path.read_bytes()
    assert calls == []
    meta = cache.build_native(path, .5, .5, 100, 80)
    assert (meta["source_width"], meta["source_height"], meta["width"], meta["height"], meta["crop_x"], meta["crop_y"]) == (300, 200, 100, 80, 100, 60)
    with np.load(cache.file(meta["key"])) as stored:
        np.testing.assert_array_equal(stored["pixels"], pixels[60:140,100:200].astype(np.float16))
    moved = cache.build_native(path, 1, 0, 100, 80)
    assert (moved["crop_x"], moved["crop_y"]) == (200, 0)
    assert calls == [(100000, "native")], "Panning reuses one retained source"
    assert cache.build_native(path, 1, 0, 100, 80)["cache_hit"]
    assert path.read_bytes() == original
    with pytest.raises(CancelledError):
        cache.build_native(path, .2, .2, 100, 80, lambda: True)


def test_real_bitmap_native_size_and_single_source_replacement(tmp_path):
    cache = LibraryPictureCache(tmp_path / "cache")
    for name, size in [("one.png", (500, 300)), ("two.png", (240, 120))]:
        path = tmp_path / name
        Image.new("RGB", size, (60, 90, 120)).save(path)
        meta = cache.build_native(path, .5, .5, 256, 128)
        assert (meta["source_width"], meta["source_height"]) == size
        assert meta["width"] == min(size[0], 256)
        assert meta["height"] == min(size[1], 128)
        assert cache._native_source[1].shape[:2] == (size[1], size[0])


def test_native_source_is_released_while_grade_is_busy(tmp_path):
    path = tmp_path / "one.png"
    Image.new("RGB", (500, 300)).save(path)
    cache = LibraryPictureCache(tmp_path / "cache")
    cache.build_native(path, .5, .5, 100, 100)
    assert cache._native_source is not None
    cache.pause_native(True)
    assert cache._native_source is None
    cache.build_native(path, .2, .2, 100, 100)
    assert cache._native_source is None


def test_grade_pause_yields_backend_detail_to_source_mips(tmp_path, monkeypatch):
    from hdr_finisher import app_memory
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.render_cache import SourceMipStore
    monkeypatch.setattr(app_memory, '_caches', {})
    monkeypatch.setattr(app_memory, '_sample', (0, None))
    # Small real arrays reproduce competition for the same share without a
    # hundreds-of-MB fixture. No production allowance changes.
    monkeypatch.setattr(app_memory, 'LIMITS', {**app_memory.LIMITS, 'working': 800})
    caches = []
    original = LibraryPictureCache.__init__
    def record(self, *args, **kwargs):
        original(self, *args, **kwargs)
        caches.append(self)
    monkeypatch.setattr(LibraryPictureCache, '__init__', record)
    worker = LibraryWorker(tmp_path / 'app')
    router = create_library_router(worker, MediaBrowserStore(tmp_path / 'app'))
    backend = caches[0]
    path = tmp_path / 'photo.png'
    Image.new('RGB', (4, 4)).save(path)
    native = np.ones((4, 4, 3), np.float32)
    backend.retain_gpu_native(path, native, {'renderer': 'gpu'}, {})
    mips = SourceMipStore(tmp_path / 'mips')
    mip = np.ones((8, 8, 3), np.float32)
    mips._insert_memory_locked(('photo', 8), mip)
    assert mips._memory_bytes == 0  # Native owner occupies the same share.
    with worker.busy('Grade render'):
        assert backend._native_source is None
        assert app_memory._caches[backend.native_key]['bytes'] == 0
        mips._insert_memory_locked(('photo', 8), mip)
        assert mips._memory_bytes == mip.nbytes
        assert mips._memory[('photo', 8)] is mip
        with pytest.raises(ValueError):
            backend.retain_gpu_native(path, native, {'renderer': 'gpu'}, {})
    assert backend._native_source is None
    assert not backend._native_paused
    assert router is not None
