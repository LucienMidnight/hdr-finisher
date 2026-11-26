"""Behaviour checks for the shared Library cache and its JPEG transport."""
from concurrent.futures import ThreadPoolExecutor
import os
from threading import Barrier
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest
from hdr_finisher.library_cache import GrainScratchSpaceError, LibraryCache
from hdr_finisher.library_thumbnail_codec import encode
from helpers.library_gainmap import jpeg_renditions
from hdr_finisher.color import linear_srgb_to_acescg, acescg_to_linear_srgb


@pytest.mark.parametrize('allowance', ['thumbnail', 'full_size', 'saved_grade'])
def test_allowances_evict_only_their_own_lru_and_never_source(tmp_path, allowance):
    cache = LibraryCache(tmp_path/'profile'); root = cache.prepare()
    assert cache.preferences()['full_size_limit_gb'] == 10
    source = tmp_path/'photo.jpg'; source.write_bytes(b'original')
    paths = {}
    for name, directory, extension in [('thumbnail','library-pictures','.npz'), ('full_size','library-full-pictures','.npz'), ('saved_grade','library-pictures','.json')]:
        folder = root/directory; folder.mkdir(exist_ok=True)
        old = folder/('old'+extension); old.write_bytes(b'x'*60)
        recent = folder/('recent'+extension); recent.write_bytes(b'x'*40)
        os.utime(old,(1,1)); os.utime(recent,(2,2))
        paths[name] = (old,recent)
    cache.trim(limit_bytes=50, allowance=allowance)
    for name,(old,recent) in paths.items():
        assert old.exists() == (name != allowance)
        assert recent.exists()
    assert cache.usage()[allowance + '_used_bytes'] == 40
    assert cache.clear()['freed_bytes'] == 240
    assert source.read_bytes() == b'original'


def test_grade_scratch_uses_full_size_allowance_and_closes(tmp_path):
    cache = LibraryCache(tmp_path / 'profile')
    with pytest.raises(OSError, match='Full-size disk cache'):
        cache.open_grade_scratch(11 * 1024**3)
    handle, close = cache.open_grade_scratch(8192)
    file = Path(handle.name)
    try:
        assert file.stat().st_size == 8192
        assert cache.usage()['full_size_used_bytes'] == 8192
        cache.remove_abandoned_grade_scratch()
        assert file.is_file()
    finally:
        close()
    assert not file.exists()
    assert cache.usage()['full_size_used_bytes'] == 0


def test_unwritten_grain_scratch_is_reserved_on_disk(tmp_path, monkeypatch):
    from hdr_finisher import library_cache

    cache = LibraryCache(tmp_path / "profile")
    grain_source = tmp_path / "selected.raw"
    free = 96
    monkeypatch.setattr(library_cache.shutil, "disk_usage", lambda _: SimpleNamespace(free=free))
    handle, close = cache.open_grade_scratch(64, grain_source=grain_source, preallocate=False)
    try:
        file = Path(handle.name)
        assert file.stat().st_size == 0
        assert cache.usage()["full_size_used_bytes"] == 64
        with pytest.raises(GrainScratchSpaceError, match="drive is too full"):
            cache.open_grade_scratch(40, grain_source=grain_source, preallocate=False)
        handle.write(bytes(32))
        free -= 32
        with pytest.raises(GrainScratchSpaceError, match="drive is too full"):
            cache.open_grade_scratch(40, grain_source=grain_source, preallocate=False)
    finally:
        close()
    assert cache.usage()["full_size_used_bytes"] == 0


@pytest.fixture
def grain_cache(tmp_path, monkeypatch):
    cache = LibraryCache(tmp_path / "profile")
    preferences = cache.preferences() | {"full_size_limit_gb": 128 / 1024**3}
    monkeypatch.setattr(cache, "preferences", lambda: preferences)
    return cache


def publish_grain_candidate(cache, name, size, source, age):
    cache.prepare()
    directory = cache.directory("library-full-pictures")
    directory.mkdir(exist_ok=True)
    temporary = directory / (name + ".tmp")
    temporary.write_bytes(bytes(size))
    os.utime(temporary, (age, age))
    file = directory / (name + ".npz")
    cache.publish(temporary, file, source, cache.publication_epoch(source))
    return file


def test_grain_scratch_leaves_previews_when_it_fits(grain_cache, tmp_path):
    old = publish_grain_candidate(grain_cache, "old", 48, tmp_path / "old.raw", 1)
    handle, close = grain_cache.open_grade_scratch(80, grain_source=tmp_path / "selected.raw")
    try:
        assert old.is_file()
        assert Path(handle.name).stat().st_size == 80
        assert grain_cache.usage()["full_size_used_bytes"] == 128
    finally:
        close()


def test_grain_scratch_evicts_only_enough_oldest_previews(grain_cache, tmp_path, capsys):
    old = publish_grain_candidate(grain_cache, "old", 24, tmp_path / "old.raw", 1)
    middle = publish_grain_candidate(grain_cache, "middle", 24, tmp_path / "middle.raw", 2)
    recent = publish_grain_candidate(grain_cache, "recent", 48, tmp_path / "recent.raw", 3)
    _, close = grain_cache.open_grade_scratch(56, grain_source=tmp_path / "selected.raw")
    try:
        assert not old.exists()
        assert middle.is_file() and recent.is_file()
        assert grain_cache.usage()["full_size_used_bytes"] == 128
        logged = capsys.readouterr().err
        assert '"evicted_bytes": 24' in logged
        assert '"outcome": "reserved"' in logged
    finally:
        close()


def test_grain_scratch_protects_kept_previews_selected_scene_and_active_scratch(grain_cache, tmp_path):
    selected = tmp_path / "selected.raw"
    held, close_held = grain_cache.open_grade_scratch(24, grain_source=selected)
    try:
        kept = publish_grain_candidate(grain_cache, "kept-one", 20, tmp_path / "kept.raw", 1)
        protected = publish_grain_candidate(grain_cache, "protected", 20, tmp_path / "protected.raw", 2)
        grain_cache.index_refresh_file(protected, tmp_path / "protected.raw", "screen_previews", protected=True)
        scene = publish_grain_candidate(grain_cache, "selected", 20, selected, 3)
        disposable = publish_grain_candidate(grain_cache, "disposable", 24, tmp_path / "spare.raw", 4)
        _, close = grain_cache.open_grade_scratch(44, grain_source=selected)
        try:
            assert not disposable.exists()
            assert all(file.is_file() for file in (kept, protected, scene, Path(held.name)))
            with pytest.raises(GrainScratchSpaceError, match="cache allowance"):
                grain_cache.open_grade_scratch(1, grain_source=selected)
        finally:
            close()
    finally:
        close_held()


def test_grain_scratch_refuses_full_drive_without_evicting(grain_cache, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from hdr_finisher import library_cache

    old = publish_grain_candidate(grain_cache, "old", 80, tmp_path / "old.raw", 1)
    monkeypatch.setattr(library_cache.shutil, "disk_usage", lambda _: SimpleNamespace(free=16))
    with pytest.raises(GrainScratchSpaceError, match="cache drive is too full"):
        grain_cache.open_grade_scratch(80, grain_source=tmp_path / "selected.raw")
    assert old.is_file()
    assert grain_cache.usage()["full_size_used_bytes"] == 80


def test_grain_scratch_racing_reservations_cannot_claim_the_same_room(grain_cache, tmp_path):
    preview = publish_grain_candidate(grain_cache, "old", 80, tmp_path / "old.raw", 1)
    start = Barrier(2)

    def reserve(_):
        start.wait(timeout=5)
        try:
            return grain_cache.open_grade_scratch(80, grain_source=tmp_path / "selected.raw")
        except GrainScratchSpaceError as error:
            return error

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(reserve, range(2)))
    active = [result for result in results if isinstance(result, tuple)]
    try:
        assert len(active) == 1
        assert any("cache allowance" in str(result) for result in results if isinstance(result, OSError))
        assert not preview.exists()
        assert grain_cache.usage()["full_size_used_bytes"] == 80
    finally:
        for _, close in active:
            close()


def test_grade_scratch_startup_removes_an_abandoned_result(tmp_path, monkeypatch):
    from hdr_finisher import launcher

    cache = LibraryCache(tmp_path / 'profile')
    handle, close = cache.open_grade_scratch(8192)
    file = Path(handle.name)
    handle.close()
    monkeypatch.setattr(launcher, '_parent_is_alive', lambda pid: False)
    try:
        cache.remove_abandoned_grade_scratch()
        assert not file.exists()
        assert cache.usage()['full_size_used_bytes'] == 0
    finally:
        close()


def test_folder_change_leaves_old_and_clear_requires_selected_managed_root(tmp_path):
    cache = LibraryCache(tmp_path/'profile'); old = cache.prepare()
    directory=cache.directory('library-pictures'); directory.mkdir()
    (directory/'one.npz').write_bytes(b'123')
    new=tmp_path/'new'; cache.update({'location':str(new)})
    assert (directory/'one.npz').exists() and cache.usage()['used_bytes']==0
    assert cache.clear(str(old))['freed_bytes']==3
    unknown=tmp_path/'unrelated'; unknown.mkdir(); (unknown/'photo.jpg').write_bytes(b'photo')
    with pytest.raises(ValueError): cache.clear(str(unknown))
    assert (unknown/'photo.jpg').read_bytes()==b'photo'
    with pytest.raises(ValueError): cache.update({'thumbnail_limit_gb':3})


def test_sdr_colour_and_hdr_peak_white_roundtrip(tmp_path):
    import colour
    # Smooth multicolour fields plus neutral reference-white and peak patches.
    y,x=np.mgrid[0:128,0:360].astype(np.float32);x/=359;y/=127
    sdr=np.stack((.02+.85*x,.03+.7*y,.04+.6*(1-x)*y),axis=-1)
    rgb=sdr*3;rgb[:20,:40]=1;rgb[:20,40:80]=1000/203
    hdr=linear_srgb_to_acescg(rgb*.18)
    file=tmp_path/'thumb.jpg';file.write_bytes(encode(hdr,sdr))
    base=jpeg_renditions(file)
    labs=lambda a:colour.XYZ_to_Lab(colour.RGB_to_XYZ(a,colour.RGB_COLOURSPACES['sRGB']))
    delta=colour.delta_E(labs(sdr),labs(base),method='CIE 2000')
    assert np.mean(delta)<=1 and np.percentile(delta,99)<=3
    decoded=acescg_to_linear_srgb(jpeg_renditions(file,True))/.18
    assert abs(float(decoded.max())/float(rgb.max())-1)<=.02
    assert abs(float(decoded[4:16,4:36].mean())-1)<=.02


def test_disabled_scene_transport_stays_in_ram_and_gpu_pixels_still_work(tmp_path):
    from PIL import Image
    from hdr_finisher.library_pictures import LibraryPictureCache
    source=tmp_path/'photo.png';Image.new('RGB',(96,64),(120,70,20)).save(source)
    profile=tmp_path/'profile';LibraryCache(profile).update({'enabled':False})
    producer=LibraryPictureCache(profile);consumer=LibraryPictureCache(profile)
    result=producer.build(source,128)
    assert result['_transient'] and result['stored_bytes']==0
    consumer.accept_transient(result)
    assert '_transient' not in result
    body,width,height,stride,space=consumer.pixels(result['key'])
    assert (width,height,space)==(96,64,'acescg') and len(body)==height*stride
    assert not producer.root.exists() and LibraryCache(profile).usage()['used_bytes']==0


def test_disabled_overlay_is_transient_and_raw_save_is_skipped(tmp_path):
    from PIL import Image
    from hdr_finisher.library_overlays import OverlayMaps
    from hdr_finisher.library_raw_thumbnails import RawThumbnails
    source=tmp_path/'photo.png';Image.new('RGB',(20,20),'white').save(source)
    profile=tmp_path/'profile';LibraryCache(profile).update({'enabled':False})
    producer=OverlayMaps(profile);consumer=OverlayMaps(profile)
    result=producer.build(source,'exposure')
    assert result['_transient']
    consumer.cache.accept_transient(result)
    assert consumer.png(result['key']).startswith(b'\x89PNG')
    assert not consumer.cache.root.exists()
    RawThumbnails(profile).store({},b'')
    assert not LibraryCache(profile).directory('library-raw-thumbnails').exists()


def test_running_total_publications_replacements_drift_and_clear(tmp_path, monkeypatch):
    from time import perf_counter
    cache = LibraryCache(tmp_path)
    root = cache.prepare()
    folder = cache.directory('library-pictures'); folder.mkdir(exist_ok=True)
    for index in range(5000):
        (folder / f'{index}.npz').write_bytes(b'x')
    assert cache.usage()['used_bytes'] == 5000
    entries = cache.entries
    monkeypatch.setattr(cache, 'entries', lambda *args: pytest.fail('Routine save must not list the cache'))
    times = []
    for size in range(10, 20):
        file = folder / 'new.npz'; file.write_bytes(b'x' * size)
        start = perf_counter(); cache.record(file); cache.trim_soon()
        times.append((perf_counter() - start) * 1000)
        assert cache._used(cache._ledger())['thumbnail'] == 5000 + size
    print(f'Cache bookkeeping at 5000 entries: worst {max(times):.2f} ms (limit 50 ms)')
    assert max(times) < 50
    monkeypatch.setattr(cache, 'entries', entries)
    # Outside deletion and replacement are recovered when settings reads usage.
    (folder / '0.npz').unlink(); (folder / '1.npz').write_bytes(b'xxxxx')
    assert cache.usage()['used_bytes'] == 5022
    cache.trim(limit_bytes=10)
    assert cache.usage()['used_bytes'] <= 10
    cache.clear()
    assert cache._used(cache._ledger())['thumbnail'] == 0


def test_cache_total_shared_with_another_process_and_recovers_after_first_page(tmp_path):
    import subprocess, sys
    cache = LibraryCache(tmp_path); root = cache.prepare()
    folder = cache.directory('library-pictures'); folder.mkdir(exist_ok=True)
    assert cache.usage()['used_bytes'] == 0
    code = "from hdr_finisher.library_cache import LibraryCache; from pathlib import Path; import sys; c=LibraryCache(sys.argv[1]); p=c.directory('library-pictures')/'child.npz'; p.write_bytes(b'123'); c.record(p); c.trim_soon()"
    subprocess.run([sys.executable, '-c', code, str(tmp_path)], check=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")})
    assert cache._used(cache._ledger())['thumbnail'] == 3
    (folder / 'child.npz').unlink()
    subprocess.run([sys.executable, '-c', "from hdr_finisher.library_cache import LibraryCache; import sys; c=LibraryCache(sys.argv[1]); assert c._used(c._ledger())['thumbnail'] == 3; c.reconcile_background(lambda: None); assert c._used(c._ledger())['thumbnail'] == 0", str(tmp_path)], check=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")})
    assert cache._used(cache._ledger())['thumbnail'] == 0


def test_normal_cleanup_removes_retired_pictures_in_current_and_old_cache(tmp_path):
    import json
    cache = LibraryCache(tmp_path/'profile'); old = cache.prepare()
    cache.update({'location':str(tmp_path/'next-cache')})
    current = cache.prepare()
    retired = []; retained = []
    for root in (old, current):
        pictures = root/'library-pictures'; pictures.mkdir(exist_ok=True)
        thumbnails = root/'library-thumbnails'; thumbnails.mkdir(exist_ok=True)
        for name, body in [('finished.jpg',b'jpeg'), ('finished.json',b'{}'),
                           ('finished.avif',b'avif'), ('kept-abandoned.jpg',b'temporary'),
                           ('orphan.json',json.dumps({'picture_version':1}).encode())]:
            file=pictures/name; file.write_bytes(body); retired.append(file)
        for name in ('tile.jpg','capture.tmp'):
            file=thumbnails/name; file.write_bytes(b'obsolete'); retired.append(file)
        for name, body in [('scene.npz',b'scene'), ('start.json',b'{"default_document":{}}')]:
            file=pictures/name; file.write_bytes(body); retained.append((file,body))
    outside = tmp_path/'photos'; outside.mkdir()
    for name in ('original.jpg','original.jpg.hdrf','project.hdrproj'):
        file=outside/name; file.write_bytes(b'untouched'); retained.append((file,b'untouched'))
    cache.usage()
    assert all(not file.exists() for file in retired)
    assert all(file.read_bytes()==body for file,body in retained)
    # A folder without the app's cache marker must never be swept.
    unmarked = tmp_path/'unmarked'; folder=unmarked/'library-pictures'; folder.mkdir(parents=True)
    file=folder/'photo.jpg'; file.write_bytes(b'untouched')
    cache._discard_finished_pictures(unmarked)
    assert file.read_bytes()==b'untouched'

def test_over_budget_publication_evicts_from_ledger_without_disk_rescan(tmp_path, monkeypatch):
    cache = LibraryCache(tmp_path/'profile'); root = cache.prepare()
    directory = root/'library-pictures'; directory.mkdir(exist_ok=True)
    old = directory/'old.npz'; old.write_bytes(b'x'*60)
    recent = directory/'recent.npz'; recent.write_bytes(b'x'*40)
    os.utime(old,(1,1)); os.utime(recent,(2,2))
    cache.record(old); cache.record(recent)
    monkeypatch.setattr(cache, 'entries', lambda *a, **k: pytest.fail('Publication rescanned disk'))
    cache.trim(limit_bytes=50)
    assert not old.exists() and recent.exists()
    monkeypatch.undo()
    assert cache.usage()['thumbnail_used_bytes'] == 40
