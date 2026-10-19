"""Behaviour checks for the shared Library cache and its JPEG transport."""
from concurrent.futures import Future
import os
from pathlib import Path
import numpy as np
import pytest
from hdr_finisher.library_cache import LibraryCache
from hdr_finisher.library_thumbnail_codec import encode
from hdr_finisher.library_thumbnails import build, THUMBNAIL_EDGE, thumbnail_key, Thumbnails
from hdr_finisher.library_kept import jpeg_renditions
from hdr_finisher.color import linear_srgb_to_acescg, acescg_to_linear_srgb


@pytest.mark.parametrize('allowance', ['thumbnail', 'full_size', 'saved_grade'])
def test_allowances_evict_only_their_own_lru_and_never_source(tmp_path, allowance):
    cache = LibraryCache(tmp_path/'profile'); root = cache.prepare()
    assert cache.preferences()['full_size_limit_gb'] == 10
    source = tmp_path/'photo.jpg'; source.write_bytes(b'original')
    paths = {}
    for name, directory, extension in [('thumbnail','library-thumbnails','.jpg'), ('full_size','library-full-pictures','.npz'), ('saved_grade','library-pictures','.jpg')]:
        folder = root/directory; folder.mkdir()
        old = folder/('old'+extension); old.write_bytes(b'x'*60)
        recent = folder/('recent'+extension); recent.write_bytes(b'x'*40)
        os.utime(old,(1,1)); os.utime(recent,(2,2))
        paths[name] = (old,recent)
    metadata = paths['saved_grade'][0].with_suffix('.json');metadata.write_bytes(b'x'*10);os.utime(metadata,(1,1))
    cache.trim(limit_bytes=50, allowance=allowance)
    for name,(old,recent) in paths.items():
        assert old.exists() == (name != allowance)
        assert recent.exists()
    assert metadata.exists() == (allowance != 'saved_grade')
    assert cache.usage()[allowance + '_used_bytes'] == 40
    assert cache.clear()['freed_bytes'] == (240 if allowance == 'saved_grade' else 250)
    assert source.read_bytes() == b'original'


def test_folder_change_leaves_old_and_clear_requires_selected_managed_root(tmp_path):
    cache = LibraryCache(tmp_path/'profile'); old = cache.prepare()
    directory=cache.directory('library-thumbnails'); directory.mkdir()
    (directory/'one.jpg').write_bytes(b'123')
    new=tmp_path/'new'; cache.update({'location':str(new)})
    assert (directory/'one.jpg').exists() and cache.usage()['used_bytes']==0
    assert cache.clear(str(old))['freed_bytes']==3
    unknown=tmp_path/'unrelated'; unknown.mkdir(); (unknown/'photo.jpg').write_bytes(b'photo')
    with pytest.raises(ValueError): cache.clear(str(unknown))
    assert (unknown/'photo.jpg').read_bytes()==b'photo'
    with pytest.raises(ValueError): cache.update({'thumbnail_limit_gb':3})


def test_disabled_thumbnail_is_in_memory_and_identity_tracks_source_and_grade(tmp_path):
    from PIL import Image
    source=tmp_path/'photo.png'; Image.new('RGB',(96,64),(190,90,20)).save(source)
    cache=LibraryCache(tmp_path/'profile');cache.update({'enabled':False})
    before=thumbnail_key(source,96)
    result=build(cache.profile,str(source),96,before)
    assert result['data'] and not cache.directory('library-thumbnails').exists()
    assert not cache.directory('library-pictures').exists()
    assert thumbnail_key(source,96,'grade-b') != before
    assert thumbnail_key(source,96,'','kept-b') != before
    os.utime(source,ns=(source.stat().st_atime_ns,source.stat().st_mtime_ns+1000000))
    assert thumbnail_key(source,96) != before


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


def test_cached_hit_returns_while_a_miss_is_still_queued(tmp_path):
    class Marks:
        def source_path(self,p):return Path(p)
    class Worker:
        def submit_library(self,*args,**kwargs):return 'job',Future()
        def cancel(self,job):pass
    sources=[tmp_path/'a.png',tmp_path/'b.png']
    for p in sources:p.write_bytes(b'photo')
    service=Thumbnails(tmp_path/'profile',Worker(),Marks())
    service.managed.prepare(); folder=service.managed.directory('library-thumbnails');folder.mkdir()
    key=thumbnail_key(sources[0],THUMBNAIL_EDGE);(folder/(key+'.jpg')).write_bytes(b'cached')
    result=service.batch(list(map(str,sources)),360)
    assert result['ready'][0]['path']==str(sources[0])
    assert result['pending']==[str(sources[1])]


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


def test_initial_lookup_never_schedules_a_cpu_render(tmp_path):
    class Marks:
        def source_path(self, path): return Path(path)
    class Worker:
        def submit_library(self, *args, **kwargs):
            raise AssertionError('A lookup must not start background work')
    source = tmp_path/'photo.png'; source.write_bytes(b'photo')
    service = Thumbnails(tmp_path/'profile', Worker(), Marks())
    result = service.batch([str(source)], 360, populate=False)
    assert result == {'ready': [], 'pending': [str(source)], 'errors': [],
        'tickets': {str(source): thumbnail_key(source, THUMBNAIL_EDGE)}}
    assert not service.jobs


def test_any_grid_width_finds_the_one_cached_picture(tmp_path):
    class Marks:
        def source_path(self,p):return Path(p)
    class Worker:
        def submit_library(self,*args,**kwargs):return 'job',Future()
        def cancel(self,job):pass
    source=tmp_path/'a.png';source.write_bytes(b'photo')
    service=Thumbnails(tmp_path/'profile',Worker(),Marks())
    service.managed.prepare(); folder=service.managed.directory('library-thumbnails');folder.mkdir()
    service.batch([str(source)],444)
    made=service.jobs.copy()
    assert len(made)==1
    (folder/(next(iter(made))+'.jpg')).write_bytes(b'cached')
    for width in (360,391,520,1440):
        assert service.batch([str(source)],width)['ready'][0]['cache_hit']



def test_camera_preview_then_gpu_thumbnail_without_raw_decode(tmp_path, monkeypatch):
    from io import BytesIO
    from types import SimpleNamespace
    from PIL import Image
    import rawpy
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_raw import RawBrowsing
    photo = tmp_path/'camera.ARW'; photo.write_bytes(b'original RAW')
    preview = BytesIO(); Image.new('RGB', (48, 32), (140, 90, 30)).save(preview, format='JPEG')
    opened = []
    class Raw:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def open_file(self, path): opened.append(path)
        def extract_thumb(self): return SimpleNamespace(format=rawpy.ThumbFormat.JPEG, data=preview.getvalue())
        def unpack(self): pytest.fail('Camera first paint must not unpack a RAW')
        def postprocess(self, **kwargs): pytest.fail('Camera first paint must not demosaic a RAW')
    monkeypatch.setattr(rawpy, 'RawPy', Raw)
    monkeypatch.setattr(RawBrowsing, 'request', lambda *args, **kwargs: pytest.fail('No full RAW read'))
    class Worker:
        def status(self): return {'paused': False}
        def submit_library(self, *args, **kwargs): pytest.fail('No CPU thumbnail render')
    profile = tmp_path/'profile'
    app = FastAPI(); app.include_router(create_library_router(Worker(), MediaBrowserStore(profile)))
    client = TestClient(app)
    batch = lambda: client.post('/api/library/thumbnails', json={'paths':[str(photo)], 'edge':360}).json()
    miss = batch(); assert miss['pending'] == [str(photo)]
    result = client.post('/api/library/picture', json={'path':str(photo), 'edge':640, 'quality':'fast'})
    assert result.status_code == 200, result.text
    assert result.json()['route'] == 'camera-preview-placeholder'
    assert result.json()['url'].startswith('data:image/jpeg;base64,') and len(opened) == 1
    sdr = np.full((32, 48, 3), .25, np.float32)
    hdr = linear_srgb_to_acescg(sdr * .18)
    body = np.stack((hdr, sdr)).astype('<f2').tobytes()
    key = miss['tickets'][str(photo)]
    uploaded = client.post('/api/library/thumbnail/'+key, params={'path':str(photo), 'width':48, 'height':32}, content=body)
    assert uploaded.status_code == 200, uploaded.text
    ready = batch()
    assert not ready['pending'] and ready['ready'][0]['cache_hit'] and len(opened) == 1
    file = client.get(ready['ready'][0]['url'])
    assert file.content.startswith(b'\xff\xd8')
    assert photo.read_bytes() == b'original RAW'
    # A source replacement invalidates the upload ticket and cannot publish stale pixels.
    photo.write_bytes(b'changed RAW source')
    stale = client.post('/api/library/thumbnail/'+key, params={'path':str(photo), 'width':48, 'height':32}, content=body)
    assert stale.status_code == 409
    assert batch()['pending'] == [str(photo)]


def test_running_total_publications_replacements_drift_and_clear(tmp_path, monkeypatch):
    from time import perf_counter
    cache = LibraryCache(tmp_path)
    root = cache.prepare()
    folder = cache.directory('library-thumbnails'); folder.mkdir()
    for index in range(5000):
        (folder / f'{index}.jpg').write_bytes(b'x')
    assert cache.usage()['used_bytes'] == 5000
    entries = cache.entries
    monkeypatch.setattr(cache, 'entries', lambda *args: pytest.fail('Routine save must not list the cache'))
    times = []
    for size in range(10, 20):
        file = folder / 'new.jpg'; file.write_bytes(b'x' * size)
        start = perf_counter(); cache.record(file); cache.trim_soon()
        times.append((perf_counter() - start) * 1000)
        assert cache._used(cache._ledger())['thumbnail'] == 5000 + size
    print(f'Cache bookkeeping at 5000 entries: worst {max(times):.2f} ms (limit 50 ms)')
    assert max(times) < 50
    monkeypatch.setattr(cache, 'entries', entries)
    # Outside deletion and replacement are recovered when settings reads usage.
    (folder / '0.jpg').unlink(); (folder / '1.jpg').write_bytes(b'xxxxx')
    assert cache.usage()['used_bytes'] == 5022
    cache.trim(limit_bytes=10)
    assert cache.usage()['used_bytes'] <= 10
    cache.clear()
    assert cache._used(cache._ledger())['thumbnail'] == 0


def test_cache_total_shared_with_another_process_and_recovers_on_restart(tmp_path):
    import subprocess, sys
    cache = LibraryCache(tmp_path); root = cache.prepare()
    folder = cache.directory('library-thumbnails'); folder.mkdir()
    assert cache.usage()['used_bytes'] == 0
    code = "from hdr_finisher.library_cache import LibraryCache; from pathlib import Path; import sys; c=LibraryCache(sys.argv[1]); p=c.directory('library-thumbnails')/'child.jpg'; p.write_bytes(b'123'); c.record(p); c.trim_soon()"
    subprocess.run([sys.executable, '-c', code, str(tmp_path)], check=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")})
    assert cache._used(cache._ledger())['thumbnail'] == 3
    (folder / 'child.jpg').unlink()
    subprocess.run([sys.executable, '-c', "from hdr_finisher.library_cache import LibraryCache; import sys; c=LibraryCache(sys.argv[1]); assert c._used(c._ledger())['thumbnail'] == 0", str(tmp_path)], check=True, env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")})
    assert cache._used(cache._ledger())['thumbnail'] == 0
