"""Behaviour checks for the shared Library cache and its JPEG transport."""
import os
from pathlib import Path
import numpy as np
import pytest
from hdr_finisher.library_cache import LibraryCache
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

@pytest.mark.parametrize('category', ['thumbnail', 'full_size'])
def test_idle_headroom_stops_before_evicting_existing_scenes(tmp_path, monkeypatch, category):
    cache = LibraryCache(tmp_path / 'profile')
    assert cache.can_warm()
    used = cache._used(cache._ledger())
    used[category] = cache.preferences()[category + '_limit_gb'] * 1024 ** 3 - 1
    monkeypatch.setattr(cache, '_used', lambda db: used)
    assert not cache.can_warm()
    used[category] = 0
    assert cache.can_warm()
    preferences = cache.preferences() | {'enabled': False}
    monkeypatch.setattr(cache, 'preferences', lambda: preferences)
    assert not cache.can_warm()
