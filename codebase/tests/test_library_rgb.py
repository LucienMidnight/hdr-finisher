from concurrent.futures import ThreadPoolExecutor, CancelledError
from threading import Event

import numpy as np
import pytest
from PIL import Image, ImageCms

from hdr_finisher import library_rgb
from hdr_finisher.library_live import develop_cpu, recipe, quality
from hdr_finisher.library_source_jobs import SourceJobs
from hdr_finisher.sessions import SessionStore


def test_rgb_boundary_keeps_cpu_icc_and_orientation(tmp_path):
    path = tmp_path / 'oriented.jpg'
    exif = Image.Exif(); exif[274] = 6
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.new('RGB', (80, 40), (150, 80, 30)).save(path, exif=exif, icc_profile=profile)
    before = path.read_bytes()
    header, parts = library_rgb.decoded(path, recipe(None))
    assert (header['width'], header['height']) == (40, 80)
    assert header['orientation'] == {'original': 6, 'applied': True}
    assert header['colour']['icc_applied_cpu'] and not header['colour']['eotf_applied']
    assert header['layout']['dtype'] == 'uint8' and header['layout']['effective_bits'] == 8
    pixels = np.frombuffer(parts[0], dtype='uint8').reshape(80,40,3)
    from hdr_finisher.loader import _load_with_pillow
    np.testing.assert_array_equal(pixels, _load_with_pillow(path, encoded_samples=True)[0])
    assert path.read_bytes() == before
    changed = recipe(None); changed['interpretation_override']['color_space'] = 'BT.2020'
    with pytest.raises(library_rgb.NotEligible, match='overrides'):
        library_rgb.decoded(path, changed)


def test_cpu_simultaneous_tiers_prepare_once_and_survive_one_cancel(tmp_path, monkeypatch):
    path = tmp_path/'photo.png'; Image.new('RGB',(800,400),(140,70,30)).save(path)
    original=SessionStore.prepare_session; entered=Event(); proceed=Event(); calls=[]
    cancelled=Event()
    def prepare(self,*args,**kwargs):
        calls.append(1);entered.set();assert proceed.wait(5)
        return original(self,*args,**kwargs)
    monkeypatch.setattr(SessionStore,'prepare_session',prepare)
    with ThreadPoolExecutor(2) as pool:
        a=pool.submit(develop_cpu,tmp_path/'cache',path,None,640,cancelled.is_set)
        assert entered.wait(5)
        b=pool.submit(develop_cpu,tmp_path/'cache',path,None,2560)
        # Wait until the second demand is registered, without assuming timing.
        from hdr_finisher import library_live
        import time
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            with library_live._cpu_condition:
                if any(len(f['users'])==2 for f in library_live._cpu_flights.values()):break
            time.sleep(.005)
        else: pytest.fail('second demand did not register')
        cancelled.set();proceed.set()
        with pytest.raises(CancelledError):a.result()
        assert b.result()['width']==800
    assert len(calls)==1


def test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication(tmp_path):
    path=tmp_path/'photo.png';Image.new('RGB',(8,4)).save(path)
    jobs=SourceJobs(); q=quality(None)
    token=jobs.claim(path,q,640,80,0)
    assert jobs.claim(path,q,2560,0,0) is None
    assert jobs.check(token,0)['priority']==0
    native=jobs.claim(path,q,100000,0,0)
    assert native and native!=token
    finishing={'global_adjustments':{'hdr':{'exposure':2}}}
    assert jobs.claim(path,quality(finishing),2560,10,0) is None
    assert jobs.claim(path,quality({'hdr_reference_white_nits':100}),640,10,0)
    with pytest.raises(ValueError):jobs.check(token,1)
    Image.new('RGB',(9,4)).save(path)
    with pytest.raises(ValueError):jobs.check(token,0)
    jobs.release(token)
    with pytest.raises(ValueError):jobs.check(token,0)


def test_source_expiry_and_clear_reject_late_owner(tmp_path, monkeypatch):
    from hdr_finisher import library_source_jobs
    path=tmp_path/'photo.png'; Image.new('RGB',(8,4)).save(path)
    now=[0.0];monkeypatch.setattr(library_source_jobs,'monotonic',lambda:now[0])
    jobs=SourceJobs();token=jobs.claim(path,quality(None),640,10,0)
    now[0]=61
    with pytest.raises(ValueError):jobs.check(token,0)
    fresh=jobs.claim(path,quality(None),2560,0,0)
    assert fresh!=token
    jobs.invalidate()
    with pytest.raises(ValueError):jobs.check(fresh,0)

def test_rgb_publishes_equivalent_start_document_without_grade_session(tmp_path, monkeypatch):
    from hdr_finisher.library_pictures import LibraryPictureCache
    path=tmp_path/'photo.png';Image.new('RGB',(80,40),(150,80,30)).save(path)
    expected=SessionStore().prepare_session(path, owns_source_path=False, hdr_reference_white_nits=100)
    header,_=library_rgb.decoded(path, recipe({'hdr_reference_white_nits':100}))
    a=expected.analysis
    header.update(height=40,width=80,source_height=40,source_width=80,edge=640,
        source_quality=quality({'hdr_reference_white_nits':100}),memory_peak_bytes=1,
        peaks={'peak':a.peak_linear,'peak_luma':a.peak_luma_linear,'peak_bt2020':a.peak_bt2020_linear,
               'sdr':float(np.max(expected.sdr_reference_image))},
        robust={'channel':a.robust_peak_linear,'luma':a.robust_peak_luma_linear,'bt2020':a.robust_peak_bt2020_linear})
    body=np.concatenate([expected.image.transpose(2,0,1),expected.sdr_reference_image.transpose(2,0,1)]).astype('<f4').tobytes()
    def forbidden(*args,**kwargs):pytest.fail('RGB publication constructed a full Grade session')
    monkeypatch.setattr(SessionStore,'prepare_session',forbidden)
    cache=LibraryPictureCache(tmp_path/'cache')
    result=library_rgb.developed(cache,path,header,body)
    assert result['renderer']=='gpu' and result['has_reference']
    assert cache.default_document(path)==expected.edit_document().model_dump(mode='json')


def test_shared_source_priority_and_clear_reach_bound_helper(tmp_path):
    path=tmp_path/'photo.png';Image.new('RGB',(8,4)).save(path)
    jobs=SourceJobs();promoted=[];cancelled=[]
    token=jobs.claim(path,quality(None),640,80,0)
    jobs.bind(token,lambda:cancelled.append(True),promoted.append)
    assert jobs.claim(path,quality(None),2560,0,0) is None
    assert promoted==[80,0]
    jobs.invalidate()
    assert cancelled==[True]

def test_http_source_coalesces_before_decode_and_clear_blocks_publication(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_gpu_raw import unframe, frame
    class Helper:
        def status(self):return {'running':True,'paused':False,'pending':0,'failure':None}
    path=tmp_path/'photo.png';Image.new('RGB',(8,4)).save(path)
    app=FastAPI();app.include_router(create_library_router(Helper(),MediaBrowserStore(tmp_path/'profile')))
    client=TestClient(app);calls=[];original=library_rgb.decoded
    def counted(*args,**kwargs):calls.append(1);return original(*args,**kwargs)
    monkeypatch.setattr(library_rgb,'decoded',counted)
    try:
        a=client.post('/api/library/live-scene',json={'path':str(path),'edge':640,'gpu':True,'priority':80})
        assert a.status_code==200,a.text
        header,_=unframe(a.content);token=header['source_job']
        b=client.post('/api/library/live-scene',json={'path':str(path),'edge':2560,'gpu':True,'priority':0})
        assert b.status_code==202 and len(calls)==1
        assert client.post('/api/library/live-source/'+token).json()['priority']==0
        assert client.post('/api/library/cache-clear',json={}).status_code==200
        assert client.post('/api/library/live-source/'+token).status_code==409
        assert client.post('/api/library/live-developed',content=frame(header)).status_code==409
        assert not list((tmp_path/'profile').rglob('*.npz'))
        assert path.read_bytes() and not path.with_name(path.name+'.hdrf').exists()
    finally:client.close()
