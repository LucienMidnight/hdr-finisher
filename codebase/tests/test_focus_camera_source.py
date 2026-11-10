from io import BytesIO
from types import SimpleNamespace
from concurrent.futures import CancelledError
import numpy as np
import pytest
from PIL import Image
from hdr_finisher import library_overlays as overlays


def fake_raw(monkeypatch, image, jpeg=True):
    import rawpy
    stream=BytesIO()
    if jpeg:image.save(stream,format='JPEG',exif=image.getexif())
    calls=[]
    class Raw:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def open_file(self,path):calls.append('open')
        def extract_thumb(self):
            calls.append('thumb')
            return SimpleNamespace(format=rawpy.ThumbFormat.JPEG if jpeg else rawpy.ThumbFormat.BITMAP,
                data=stream.getvalue() if jpeg else np.asarray(image))
    monkeypatch.setattr(rawpy,'RawPy',Raw)
    monkeypatch.setattr(rawpy,'imread',lambda *a,**k:pytest.fail('sensor decoding forbidden'))
    return calls


@pytest.mark.parametrize('jpeg',[True,False])
def test_source_is_bounded_linear_float_and_preview_oriented(monkeypatch,jpeg):
    image=Image.new('RGB',(3200,1600),(128,128,128))
    if jpeg:image.getexif()[274]=6
    calls=fake_raw(monkeypatch,image,jpeg)
    pixels,info=overlays.camera_focus_source('unused.arw')
    assert calls==['open','thumb']
    assert pixels.dtype==np.float32 and max(pixels.shape[:2])<=2560
    assert .20<float(pixels.mean())<.23
    assert info['provisional'] and info['source_provenance']=='embedded-camera-preview'
    if jpeg:assert pixels.shape[0]>pixels.shape[1]


def test_small_missing_and_cancelled_sources(monkeypatch):
    fake_raw(monkeypatch,Image.new('RGB',(160,120)))
    with pytest.raises(overlays.CameraFocusUnavailable):overlays.camera_focus_source('unused.arw')
    with pytest.raises(CancelledError):overlays.camera_focus_source('unused.arw',lambda:True)


def test_camera_map_direct_frame_and_quality_identity(monkeypatch,tmp_path):
    path=tmp_path/'a.arw';path.write_bytes(b'fixture')
    fake_raw(monkeypatch,Image.new('RGB',(768,512)))
    monkeypatch.setattr(overlays,'camera_frame',lambda *a:pytest.fail('camera map must not register'))
    maps=overlays.OverlayMaps(tmp_path/'app')
    result=maps.build(path,'focus','camera')
    assert result['camera_frame']==result['frame']
    assert result['provisional'] and result['quality']=='camera'
    assert maps.cached(path,'focus','half') is None
    assert maps.png(result['key']).startswith(b'\x89PNG')
    path.write_bytes(b'changed fixture')
    assert maps.cached(path,'focus','camera') is None


def test_unavailable_does_not_publish_or_decode(monkeypatch,tmp_path):
    path=tmp_path/'a.arw';path.write_bytes(b'fixture')
    fake_raw(monkeypatch,Image.new('RGB',(160,120)))
    maps=overlays.OverlayMaps(tmp_path/'app')
    assert 'unavailable' in maps.build(path,'focus','camera')
    assert maps.cached(path,'focus','camera') is None


def test_camera_uses_existing_foreground_lane_and_bounded_admission(monkeypatch):
    from hdr_finisher.library_worker import helper_lane
    from hdr_finisher import library_estimates as estimates
    assert helper_lane({'command':'overlay','quality':'camera'})=='main'
    assert helper_lane({'command':'overlay','quality':'full'})=='kept'
    monkeypatch.setattr(estimates,'dimensions',lambda *a:pytest.fail('must not inspect sensor dimensions'))
    assert estimates.estimate_details('unused.arw','camera')==(max(estimates.MINIMUM,23*2560**2),'')
