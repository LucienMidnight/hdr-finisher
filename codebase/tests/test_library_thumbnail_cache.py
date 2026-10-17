"""Behaviour checks for the shared Library cache and its JPEG transport."""
from concurrent.futures import Future
import os
from pathlib import Path
import numpy as np
import pytest
from hdr_finisher.library_cache import LibraryCache
from hdr_finisher.library_thumbnail_codec import encode
from hdr_finisher.library_thumbnails import build, thumbnail_key, Thumbnails
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
    key=thumbnail_key(sources[0],360);(folder/(key+'.jpg')).write_bytes(b'cached')
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
