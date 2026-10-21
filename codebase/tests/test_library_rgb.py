import hashlib
from pathlib import Path

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

@pytest.mark.parametrize("suffix",["png","jxl"])
def test_http_source_coalesces_before_decode_and_clear_blocks_publication(tmp_path, monkeypatch, suffix):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_gpu_raw import unframe, frame
    class Helper:
        def status(self):return {'running':True,'paused':False,'pending':0,'failure':None}
    path=tmp_path/('photo.'+suffix)
    if suffix=='jxl':
        from hdr_finisher.jpegxl import encode_sdr_jpegxl
        path.write_bytes(encode_sdr_jpegxl(np.full((4,8,3),.5,np.float32),100))
    else:Image.new('RGB',(8,4)).save(path)
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


@pytest.mark.parametrize("dtype,planar", [("uint16",False),("float32",True)])
def test_precision_tiff_preserves_decoder_samples_and_override_order(tmp_path, dtype, planar):
    import tifffile
    from hdr_finisher import loader
    path=tmp_path/"photo.tif"
    array=np.arange(120,dtype=np.float32).reshape(5,8,3)/20-.5
    if dtype=="uint16":array=np.clip(array*10000,0,65535).astype(dtype)
    else:array=array.astype(dtype)
    tifffile.imwrite(path,array.transpose(2,0,1) if planar else array,photometric="rgb",
        planarconfig="separate" if planar else "contig",extratags=[(274,"H",1,6,False)])
    inputs=recipe(None)
    with pytest.raises(library_rgb.NotEligible,match="primaries"):
        library_rgb.decoded(path,inputs)
    inputs["interpretation_override"].update(color_space="BT.2020",transfer_function="LINEAR",linear_reference="diffuse_white_1_0")
    header,parts=library_rgb.decoded(path,inputs)
    actual=np.frombuffer(parts[0],dtype="<f4").reshape(5,8,3)
    np.testing.assert_array_equal(actual,loader._load_tiff(path)[0])
    assert header["orientation"]=={"original":6,"applied":False}
    assert header["colour"]["scale"]==.18 and not header["colour"]["authored_sdr"]
    assert header["layout"]["dtype"]=="float32"
    assert header["layout"]["decoder_facts"]["bits_per_sample"]==array.dtype.itemsize*8
    if dtype=="float32":assert actual.min()<0


def test_precision_exr_windows_layers_and_conflict_gate(tmp_path):
    import OpenEXR,Imath
    path=tmp_path/"layer.exr"
    header=OpenEXR.Header(8,4)
    header["channels"]={n:Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for n in ["Combined.R","Combined.G","Combined.B"]}
    header["dataWindow"]=Imath.Box2i(Imath.V2i(-3,2),Imath.V2i(4,5))
    header["colorInteropID"]=b"lin_rec2020_scene"
    values=np.linspace(-.5,4,32,dtype=np.float32)
    file=OpenEXR.OutputFile(str(path),header)
    file.writePixels({n:values.tobytes() for n in header["channels"]});file.close()
    result,parts=library_rgb.decoded(path,recipe(None))
    assert result["layout"]["channels"]==["Combined.R","Combined.G","Combined.B"]
    assert result["layout"]["data_window"]==[-3,2,5,6]
    assert result["layout"]["origin"]==[-3,2]
    np.testing.assert_array_equal(np.frombuffer(parts[0],dtype="<f4").reshape(4,8,3)[...,0].ravel(),values)


def test_precision_hdr_backend_failure_has_explicit_fallback(tmp_path,monkeypatch):
    path=tmp_path/"photo.pfm";path.write_bytes(b"PF")
    def unavailable(path):raise OSError("No imageio backend for PFM")
    monkeypatch.setattr(library_rgb.loader,"_load_hdr_like",unavailable)
    with pytest.raises(library_rgb.NotEligible,match="imageio decoder unavailable.*PFM"):
        library_rgb.decoded(path,recipe(None))


@pytest.mark.parametrize("authored",[False,True])
def test_precision_publication_matches_grade_document(tmp_path,authored):
    import tifffile
    from hdr_finisher.library_pictures import LibraryPictureCache
    path=tmp_path/"photo.tif"
    values=np.linspace(0,65535,120,dtype=np.uint16).reshape(5,8,3)
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    tifffile.imwrite(path,values,photometric="rgb",extratags=[(34675,"B",len(profile),profile,False)])
    inputs=recipe(None)
    if not authored:inputs["interpretation_override"].update(color_space="BT.2020",transfer_function="LINEAR")
    from hdr_finisher.models import SourceInterpretationOverride
    expected=SessionStore().prepare_session(path,owns_source_path=False,hdr_reference_white_nits=100,
        interpretation_override=SourceInterpretationOverride.model_validate(inputs["interpretation_override"]))
    inputs["hdr_reference_white_nits"]=100
    header,_=library_rgb.decoded(path,inputs)
    a=expected.analysis
    header.update(height=5,width=8,source_height=5,source_width=8,edge=640,source_quality=quality(None),memory_peak_bytes=1,
        peaks={"peak":a.peak_linear,"peak_luma":a.peak_luma_linear,"peak_bt2020":a.peak_bt2020_linear,
            "sdr":float(np.max(expected.sdr_reference_image)) if authored else 0},
        robust={"channel":a.robust_peak_linear,"luma":a.robust_peak_luma_linear,"bt2020":a.robust_peak_bt2020_linear})
    planes=[expected.image.transpose(2,0,1)]
    if authored:planes.append(expected.sdr_reference_image.transpose(2,0,1))
    body=np.concatenate(planes).astype("<f4").tobytes()
    cache=LibraryPictureCache(tmp_path/"cache")
    result=library_rgb.developed(cache,path,header,body)
    assert result["has_reference"]==authored
    assert cache.default_document(path)==expected.edit_document().model_dump(mode="json")

@pytest.mark.parametrize("transfer,bits,dtype",[("sRGB",8,"uint8"),("PQ",12,"uint16"),("HLG",16,"uint16"),("PQ",32,"float32")])
def test_jxl_samples_precision_gate_and_normalized_override_order(tmp_path, transfer, bits, dtype):
    import sys
    sys.path.insert(0,str(Path(__file__).parent/'helpers'))
    from library_codec_samples import marked_jxl
    from hdr_finisher import jpegxl,color
    path=tmp_path/'photo.jxl'
    values=np.linspace(0,1,120,dtype=np.float32).reshape(5,8,3)
    if dtype.startswith('uint'):values=np.round(values*((1<<bits)-1)).astype(dtype)
    marked_jxl(path,values,transfer,bits=bits)
    raw,metadata=jpegxl.decode_jpegxl(path,encoded_samples=True)
    expected,normal=jpegxl.decode_jpegxl(path)
    np.testing.assert_array_equal(color.normalize_to_acescg_bounded(raw.copy(),'sRGB' if transfer=='sRGB' else 'BT.2020',transfer),expected)
    assert metadata['color_space']==normal['color_space']=='ACEScg'
    header,parts=library_rgb.decoded(path,recipe(None))
    np.testing.assert_array_equal(np.frombuffer(parts[0],dtype='<f4').reshape(values.shape),raw)
    assert header['layout']['effective_bits']==bits and header['layout']['dtype']=='float32'
    assert header['colour']['transfer']==transfer and not header['colour']['authored_sdr']
    inputs=recipe(None);inputs['hdr_reference_white_nits']=100
    inputs['interpretation_override'].update(color_space='BT.2020',transfer_function='BT.709')
    overridden,parts=library_rgb.decoded(path,inputs)
    np.testing.assert_array_equal(np.frombuffer(parts[0],dtype='<f4').reshape(values.shape),expected)
    assert overridden['colour']['transfer']=='BT.709' and overridden['colour']['eotf_applied']
    # The marker is required even when libjxl can decode the samples.
    path.write_bytes(__import__('imagecodecs').jpegxl_encode(np.zeros((5,8,3),np.uint8),lossless=True))
    with pytest.raises(library_rgb.NotEligible,match='primaries'):library_rgb.decoded(path,recipe(None))
    inputs['interpretation_override']['color_space']=None
    with pytest.raises(library_rgb.NotEligible,match='primaries'):library_rgb.decoded(path,inputs)


def test_plain_avif_rejects_gainmap_before_primary_decode(tmp_path,monkeypatch):
    from hdr_finisher import gainmap_decoders as gain
    path=tmp_path/'photo.avif';path.write_bytes(b'not read')
    monkeypatch.setattr(gain,'resolve_binary',lambda name:path)
    monkeypatch.setattr(gain,'inspect_avif',lambda path:{'gain_map_present':True})
    def forbidden(*a,**k):pytest.fail('gain-map primary decoded as a final scene')
    monkeypatch.setattr(gain,'_decode_avif_pixels',forbidden)
    with pytest.raises(library_rgb.NotEligible,match='Gain-map AVIF'):library_rgb.decoded(path,recipe(None))


def test_plain_heif_selects_primary_and_rejects_auxiliary(tmp_path,monkeypatch):
    import pillow_heif
    from hdr_finisher import loader
    path=tmp_path/'photo.heic';path.write_bytes(b'not read')
    class Primary:
        mode='RGB;16'
        info={'bit_depth':10,'nclx_profile':{'color_primaries':9,'transfer_characteristics':18}}
    primary=Primary()
    class Container:
        primary_index=1;mimetype='image/heic'
        def __getitem__(self,index):assert index==1;return primary
        def __array__(self,dtype=None,copy=None):return np.full((4,8,3),32768,dtype=np.uint16)
    monkeypatch.setattr(pillow_heif,'open_heif',lambda *a,**k:Container())
    monkeypatch.setattr(loader,'_read_apple_hdr_metadata',lambda path:{})
    header,parts=library_rgb.decoded(path,recipe(None))
    assert header['layout']['decoder_facts']['primary_index']==1
    assert header['colour']['transfer']=='HLG' and header['layout']['effective_bits']==10
    np.testing.assert_allclose(np.frombuffer(parts[0],dtype='<f4'),32768/65535)
    primary.info['aux']={'urn:com:apple:photo:2020:aux:hdrgainmap':[2]}
    with pytest.raises(library_rgb.NotEligible,match='auxiliary'):library_rgb.decoded(path,recipe(None))

@pytest.mark.parametrize("suffix,transfer",[("jxl",16),("avif",18),("heic",13)])
def test_codec_publication_preserves_grade_start_document(tmp_path,suffix,transfer):
    from hdr_finisher.library_pictures import LibraryPictureCache
    from hdr_finisher import jpegxl
    import imagecodecs,pillow_heif
    path=tmp_path/('photo.'+suffix)
    values=np.linspace(0,1,120,dtype=np.float32).reshape(5,8,3)
    if suffix=='jxl':path.write_bytes(jpegxl.encode_hdr_jpegxl(values*2,100,'uint12'))
    elif suffix=='avif':path.write_bytes(imagecodecs.avif_encode(np.round(values*4095).astype(np.uint16),level=100,speed=10,
        bitspersample=12,primaries=9,transfer=transfer,matrix=9))
    else:
        h=pillow_heif.from_bytes('RGB',(8,5),np.round(values*255).astype(np.uint8).tobytes())
        h.save(path,quality=100,save_nclx_profile=True,color_primaries=9,transfer_characteristics=transfer,matrix_coefficients=9)
    expected=SessionStore().prepare_session(path,owns_source_path=False,hdr_reference_white_nits=100)
    header,_=library_rgb.decoded(path,recipe({'hdr_reference_white_nits':100}))
    a=expected.analysis;reference=expected.sdr_reference_image
    header.update(height=5,width=8,source_height=5,source_width=8,edge=640,source_quality=quality(None),memory_peak_bytes=1,
        peaks={'peak':a.peak_linear,'peak_luma':a.peak_luma_linear,'peak_bt2020':a.peak_bt2020_linear,
               'sdr':float(np.max(reference)) if reference is not None else 0},
        robust={'channel':a.robust_peak_linear,'luma':a.robust_peak_luma_linear,'bt2020':a.robust_peak_bt2020_linear})
    planes=[expected.image.transpose(2,0,1)]
    if reference is not None:planes.append(reference.transpose(2,0,1))
    cache=LibraryPictureCache(tmp_path/'cache')
    result=library_rgb.developed(cache,path,header,np.concatenate(planes).astype('<f4').tobytes())
    assert result['has_reference']==(reference is not None)
    assert cache.default_document(path)==expected.edit_document().model_dump(mode='json')


def test_real_gainmap_files_keep_existing_route():
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    for path in [root/'samples/hdr_reference.avif',root/'local-test-media/inputs/iphone-12-pro-HDR.heic']:
        if not path.exists():continue
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        with pytest.raises(library_rgb.NotEligible,match='reconstruction route'):
            library_rgb.decoded(path,recipe(None))
        assert hashlib.sha256(path.read_bytes()).hexdigest()==before


def test_backend_preparation_reports_file_until_cancelled_execution_returns():
    from hdr_finisher.library_source_jobs import SourceJobs
    jobs = SourceJobs()
    def decode():
        assert jobs.snapshot() == [{"path": "one.dng", "stage": "Reading and developing source", "state": "running"}]
        jobs.release("token")
        assert jobs.snapshot()[0]["state"] == "stopping"
        return 12
    assert jobs.preparing("token", "one.dng", decode) == 12
    assert jobs.snapshot() == []
    def fail():
        raise ValueError("Missing camera colour matrix")
    with pytest.raises(ValueError, match="camera colour"):
        jobs.preparing("token", "bad.dng", fail)
    assert jobs.snapshot() == []


def test_backend_preparation_reports_stage_and_invalidation_until_return(tmp_path):
    from hdr_finisher.library_source_jobs import SourceJobs
    jobs=SourceJobs()
    path=tmp_path/"camera.dng";path.write_bytes(b"source")
    token=jobs.claim(path,"quality",640,30,0)
    def decode():
        assert not jobs.cancelled(token)
        jobs.stage(token,"dng_gain_map","Correcting DNG brightness")
        assert jobs.snapshot()==[dict(path="camera.dng",stage="Correcting DNG brightness",state="running")]
        jobs.invalidate()
        assert jobs.cancelled(token)
        assert jobs.snapshot()[0]["state"]=="stopping"
    jobs.preparing(token,"camera.dng",decode)
    assert jobs.snapshot()==[]
