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


def test_maps_go_before_quick_and_edited_pictures(tmp_path):
    cache=LibraryPictureCache(tmp_path,limit=100);cache.root.mkdir()
    for name,size in [('a.map.npz',70),('b.npz',10),('c.jpg',40)]: (cache.root/name).write_bytes(b'x'*size)
    cache.trim();assert not(cache.root/'a.map.npz').exists();assert(cache.root/'b.npz').exists();assert(cache.root/'c.jpg').exists()


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
