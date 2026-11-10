import pytest
import numpy as np
from PIL import Image
from hdr_finisher.library_overlays import exposure_regions, OverlayMaps
from hdr_finisher.library_pictures import LibraryPictureCache


def test_exposure_uses_source_levels_and_regions_not_toned_picture():
    values=np.full((20,30,3),128,dtype=np.uint16);values[:5,:5]=1023;values[15:,25:]=16
    blown,blocked=exposure_regions(values,16,1023)
    assert blown[:5,:5].all() and not blown[5:].any()
    assert blocked[15:,25:].all() and not blocked[:15].any()
    values[:5,:5]=900 # Bright, but the source still holds detail.
    assert not exposure_regions(values,16,1023)[0].any()


def test_map_cache_is_invalidated_after_source_change(tmp_path):
    p=tmp_path/'a.png';Image.fromarray(np.zeros((20,30,3),dtype=np.uint8)).save(p)
    maps=OverlayMaps(tmp_path/'app');first=maps.build(p);assert maps.cached(p,'exposure')['key']==first['key']
    Image.fromarray(np.full((21,30,3),255,dtype=np.uint8)).save(p)
    assert maps.cached(p,'exposure') is None
    second=maps.build(p);assert second['key']!=first['key'];assert maps.png(second['key']).startswith(b'\x89PNG')


def test_thumbnail_allowance_evicts_oldest_overlay(tmp_path):
    cache=LibraryPictureCache(tmp_path);cache.managed.prepare();cache.root.mkdir()
    for name,size in [('a.map.npz',110),('b.npz',10),('c.json',40)]: (cache.root/name).write_bytes(b'x'*size)
    import os
    os.utime(cache.root/"a.map.npz",(1,1))
    cache.managed.trim(limit_bytes=100);assert not(cache.root/'a.map.npz').exists();assert(cache.root/'b.npz').exists();assert(cache.root/'c.json').exists()


def test_normalized_source_does_not_call_midtone_blocked():
    samples=np.full((10,10,3),.5,dtype=np.float32)
    assert not exposure_regions(samples,0.,1.)[1].any()


def test_overlay_switch_is_a_body_command_without_writing_settings(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    class Helper:
        def status(self):return {"running":True,"paused":False,"pending":0}
    app=FastAPI();app.include_router(create_library_router(Helper(),MediaBrowserStore(tmp_path)))
    with TestClient(app) as client:
        response=client.post('/api/library/overlay-switch',json={"kind":"exposure","enabled":True})
        assert response.status_code==200 and response.json()["enabled"]
        assert not(tmp_path/'library-preferences.json').exists()


def test_focus_marks_sharp_edges_not_flat_or_even_noise_and_falls_with_blur():
    from hdr_finisher.library_focus import focus_map,gaussian_filter
    scene=np.full((512,768,3),.2,dtype=np.float32);scene[60:240,60:340]=.8
    sharp,_=focus_map(scene);soft,_=focus_map(gaussian_filter(scene,1.4))
    assert sharp[29:122,29:172].max()>180 and not sharp[150:,200:].any()
    assert soft.max()<30 and sharp.mean()>soft.mean()*10
    assert not focus_map(np.full_like(scene,.2))[0].any()
    noisy=np.full_like(scene,.2)+np.random.default_rng(3).normal(0,.02,(*scene.shape[:2],1)).astype(np.float32)
    assert not focus_map(noisy)[0].any()


def test_focus_quality_is_a_separate_small_source_versioned_map(tmp_path):
    p=tmp_path/'a.png';scene=np.full((256,384,3),60,dtype=np.uint8);scene[60:160,80:180]=220;Image.fromarray(scene).save(p)
    maps=OverlayMaps(tmp_path/'app');half=maps.build(p,'focus','half');full=maps.build(p,'focus','full')
    assert half['key']!=full['key'] and half['width']<=512 and full['height']<=512
    assert maps.cached(p,'focus','half')['cache_hit']
    assert maps.png(full['key']).startswith(b'\x89PNG')
    Image.fromarray(scene[:250]).save(p);assert maps.cached(p,'focus','full') is None


def test_focus_work_can_be_cancelled_between_filter_passes():
    from hdr_finisher.library_focus import focus_map
    from concurrent.futures import CancelledError
    import pytest
    calls=[]
    def stop():calls.append(True);return len(calls)>2
    with pytest.raises(CancelledError):focus_map(np.ones((200,300,3),dtype=np.float32),stop)


def test_old_map_pixels_are_not_served_after_source_changes(tmp_path):
    import pytest
    p=tmp_path/'a.png';Image.new('RGB',(40,30)).save(p);maps=OverlayMaps(tmp_path/'app');old=maps.build(p)
    Image.new('RGB',(41,30)).save(p)
    with pytest.raises(ValueError,match='source photo changed'):maps.png(old['key'])


def test_large_map_priority_stays_below_saved_pictures():
    from hdr_finisher.library_api import OverlayRequest
    import pytest
    assert OverlayRequest(path='a',kind='focus',priority=82).priority==82
    assert OverlayRequest(path='a').priority==85
    with pytest.raises(ValueError):OverlayRequest(path='a',priority=80)


def test_rgb16_png_near_white_is_not_falsely_clipped_and_alpha_is_ignored(tmp_path):
    import imagecodecs
    from hdr_finisher.library_overlays import exposure_source
    values=np.full((20,30,4),65500,dtype=np.uint16);values[:,:,3]=65535
    values[0,0,:3]=65535;values[-1,-1,:3]=0
    p=tmp_path/'colour16.png';p.write_bytes(imagecodecs.png_encode(values))
    blown,blocked=exposure_source(p)
    assert blown.sum()==1 and blown[0,0] and blocked.sum()==1 and blocked[-1,-1]


def test_gray16_png_exposure_uses_the_full_stored_range(tmp_path):
    import imagecodecs
    from hdr_finisher.library_overlays import exposure_source
    p=tmp_path/'gray16.png';p.write_bytes(imagecodecs.png_encode(np.asarray([[65500,65535],[32768,0]],dtype=np.uint16)))
    blown,blocked=exposure_source(p);assert blown.tolist()==[[False,True],[False,False]]
    assert blocked.tolist()==[[False,False],[False,True]]


def test_mosaiced_raw_shadow_needs_all_colours_not_one_dark_channel():
    values=np.full((12,16),500,dtype=np.uint16);values[::2,::2]=64;values[6:10,8:12]=64
    blown,blocked=exposure_regions(values,64,4095,np.asarray([[0,1],[3,2]]))
    assert not blown.any() and blocked.sum()==16 and blocked[6:10,8:12].all()
    assert not blocked[:6].any()


def _scene(height=900,width=1350):
    # Linear sensor-like brightness with structure at several scales.
    rng=np.random.default_rng(7);y,x=np.indices((height,width))
    values=.2+.15*np.sin(x/37.)*np.cos(y/53.)+.1*((x//90+y//70)%2)
    values+=np.kron(rng.random((height//30+1,width//30+1)),np.ones((30,30)))[:height,:width]*.2
    return values.astype(np.float32)


def _preview(scene,frame,size):
    h,w=scene.shape;x,y,fw,fh=frame
    crop=scene[round(y*h):round((y+fh)*h),round(x*w):round((x+fw)*w)]
    signal=np.where(crop<=.0031308,crop*12.92,1.055*np.power(np.clip(crop,0,1),1/2.4)-.055)
    return Image.fromarray((np.clip(signal,0,1)*255).astype(np.uint8)).resize(size,Image.BILINEAR)


def test_camera_preview_is_placed_on_the_measured_frame():
    from hdr_finisher.library_overlays import register_preview
    scene=_scene();truth=(.004,.003,.9933,.9931)  # A Canon-like inset crop.
    found=register_preview(scene,_preview(scene,truth,(1200,800)))
    assert np.allclose(found,truth,atol=.0015)
    portrait=np.ascontiguousarray(np.rot90(scene));truth=(.002,.006,.995,.99)
    found=register_preview(portrait,_preview(portrait,truth,(540,808)))
    assert np.allclose(found,truth,atol=.0015)


def test_unrelated_camera_preview_is_refused():
    from hdr_finisher.library_overlays import register_preview,PreviewNotAligned,camera_frame
    scene=_scene();other=np.ascontiguousarray(np.flipud(np.fliplr(_scene())))**2
    with pytest.raises(PreviewNotAligned):register_preview(scene,_preview(other,(0,0,1,1),(1200,800)))
    assert 'camera_frame_error' in camera_frame('unused',scene,_preview(other,(0,0,1,1),(1200,800)))


def test_map_reports_the_measured_frame_inside_pooled_cells(tmp_path):
    p=tmp_path/'a.png';Image.fromarray(np.zeros((1001,1500,3),dtype=np.uint8)).save(p)
    meta=OverlayMaps(tmp_path/'app').build(p)
    assert (meta['width'],meta['height'])==(500,334) and meta['frame']==pytest.approx([0,0,500,1001/3])
    assert 'camera_frame' not in meta  # Direct pictures are shown whole.


@pytest.mark.parametrize("shape",[(13,17),(1,3),(6,7),(1,1),(3,1),(7,6)])
@pytest.mark.parametrize("pattern",[np.array([[0,1],[3,2]]),np.arange(36).reshape(6,6)%4])
@pytest.mark.parametrize("dtype",[np.uint16,np.float32,np.float64])
def test_raw_scalar_slices_match_array_reference(shape,pattern,dtype):
    from hdr_finisher.library_overlays import raw_exposure_regions
    sy,sx=pattern.shape
    y,x=np.indices(shape)
    # Visible sensor origin differs from the recorded full-sensor pattern.
    colors=pattern[(y+1)%sy,(x+1)%sx]
    black=np.array([16,32,64,128]);white=np.array([1023,2047,4095,8191])
    threshold=black[colors]+np.maximum(1 if np.dtype(dtype).kind in 'ui' else 1e-6,(white[colors]-black[colors])*.001)
    for samples in [np.zeros(shape,dtype=dtype),white[colors].astype(dtype),threshold.astype(dtype),np.nextafter(threshold,np.inf).astype(dtype),np.random.default_rng(4).integers(0,9000,shape).astype(dtype)]:
        expected=exposure_regions(samples,black[colors],white[colors],pattern)
        actual=raw_exposure_regions(samples,colors,black,white,pattern)
        for a,b in zip(actual,expected):
            for turns in range(4):np.testing.assert_array_equal(np.rot90(a,turns),np.rot90(b,turns))


def test_raw_nonrepeating_colors_and_no_pattern_keep_reference():
    from hdr_finisher.library_overlays import raw_exposure_regions
    colors=np.random.default_rng(8).integers(0,4,(13,17));samples=np.arange(221).reshape(13,17).astype(np.uint16)
    black=np.array([0,20,50,100]);white=np.array([120,150,180,200])
    for pattern in [None,np.array([[0,1],[3,2]])]:
        for a,b in zip(raw_exposure_regions(samples,colors,black,white,pattern),exposure_regions(samples,black[colors],white[colors],pattern)):
            np.testing.assert_array_equal(a,b)


def test_focus_reuses_fine_smoothing_without_changing_map_or_noise():
    from hdr_finisher.library_focus import focus_map,gaussian_filter,magnitude
    from hdr_finisher.library_overlays import pool_max
    rng=np.random.default_rng(14)
    scenes=[rng.random((257,385,3),dtype=np.float32),np.full((90,120,3),.2,dtype=np.float32)]
    scenes[1][15:65,20:80]=.8
    for pixels in scenes:
        gray=np.maximum(pixels[...,:3]@np.asarray([.2722,.6741,.0537],dtype=np.float32),0)
        scale=max(float(np.percentile(gray[::4,::4],99)),1e-6);gray=np.sqrt(np.minimum(gray/scale,4))
        smooth=gaussian_filter(gray,.7)
        noise=float(np.median(np.abs(gray[::4,::4]-smooth[::4,::4])))*1.4826
        fine=magnitude(gray,.7);coarse=magnitude(gray,1.5)
        ratio=np.maximum(fine-coarse,0)/(coarse+.005)
        confidence=np.clip((ratio-.08)/.45,0,1)*np.clip((fine-coarse-max(2*noise,.012))/.12,0,1)
        expected=(pool_max(confidence)*255).astype(np.uint8)
        actual,measured_noise=focus_map(pixels)
        np.testing.assert_array_equal(actual,expected)
        assert measured_noise==noise
