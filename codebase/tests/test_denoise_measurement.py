"""Measurements belong to source pixels, survive restart, and reject stale work."""
import json
import struct
from types import SimpleNamespace
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher import denoise_measurement as dm
from hdr_finisher.library_cache import LibraryCache
from hdr_finisher.models import AdjustmentState
from hdr_finisher.render_cache import SessionRenderCache

MODEL={"algorithm_version":"adaptive-atrous-v1","a":.001,"b":.00001,"c":0.,"band_sigmas":[[1.,.5,.25,.125,.0625]]*3}

@pytest.fixture
def context(tmp_path,monkeypatch):
    image=np.random.default_rng(7).uniform(.01,.8,(64,96,3)).astype(np.float32)
    frame=SimpleNamespace(session_id="test-photo",image=image,sdr_reference_image=None,
        adjustments=AdjustmentState(),edit_revision=0,render_cache=SessionRenderCache(image,None))
    dm._models.clear()
    monkeypatch.setattr(dm,"_cache",lambda:LibraryCache(tmp_path))
    app=FastAPI();app.include_router(dm.create_router(SimpleNamespace(get=lambda _:frame)))
    with TestClient(app) as client:
        yield client,frame
    dm._models.clear()


def source(client,lane="hdr",edge=640):
    url=f"/api/session/test-photo/denoise-measurement/{lane}?long_edge={edge}"
    response=client.get(url+"&source=true");assert response.status_code==200
    length=struct.unpack("<I",response.content[:4])[0]
    return url,json.loads(response.content[4:4+length]),response.content[4+length:]


def save(client,url,description,**extra):
    return client.post(url,json={"key":description["key"],"version":dm.VERSION,"model":MODEL,
        "width":description["source_width"],"height":description["source_height"],
        "measured_pixels":description["width"]*description["height"]*len(description["windows"]),
        "duration_ms":12,**extra})


def test_measurement_reads_original_pixels_and_survives_restart(context):
    client,frame=context
    url,description,body=source(client)
    np.testing.assert_array_equal(np.frombuffer(body,dtype="<f4").reshape(64,96,4)[...,:3],frame.image)
    assert save(client,url,description).status_code==200
    dm._models.clear()  # model is now read from the managed disk cache
    assert client.get(url).json()==MODEL


def test_finishing_grade_and_native_geometry_reuse(context):
    client,frame=context
    url,description,_=source(client)
    save(client,url,description)
    frame.adjustments.hdr.exposure=2
    frame.adjustments.shared.geometry.rotation=90
    frame.edit_revision+=1
    assert client.get(url).json()==MODEL
    assert client.get(url.replace("/hdr?","/sdr?")).json()==MODEL


def test_authored_sdr_is_separate_only_when_used(context):
    client,frame=context
    url,description,_=source(client)
    save(client,url,description)
    frame.sdr_reference_image=frame.image*.5
    frame.render_cache.sdr_reference_image=frame.sdr_reference_image
    assert client.get(url.replace("/hdr?","/sdr?")).status_code==204
    frame.adjustments.sdr.use_authored_base=False
    assert client.get(url.replace("/hdr?","/sdr?")).json()==MODEL


def test_size_and_measured_geometry_keep_separate_results(context):
    client,frame=context
    frame.image=np.tile(frame.image,(8,8,1));frame.render_cache=SessionRenderCache(frame.image,None)
    url,description,_=source(client,edge=256)
    save(client,url,description)
    assert client.get(url.replace("256","512")).status_code==204
    frame.adjustments.shared.geometry.rotation=90
    assert client.get(url).status_code==204


def test_stale_and_invalid_publications_are_rejected(context):
    client,frame=context
    url,description,_=source(client)
    frame.edit_revision=1
    assert save(client,url+"&edit_revision=0",description).status_code==409
    assert save(client,url,description,model={**MODEL,"band_sigmas":[[1]]}).status_code==400
    frame.render_cache.replace_source(frame.image+.1,None)
    assert save(client,url,description).status_code==409


def test_large_source_uses_bounded_original_windows(context):
    client,frame=context
    frame.image=np.tile(frame.image,(24,24,1));frame.render_cache=SessionRenderCache(frame.image,None)
    url,description,body=source(client,edge=4096)
    assert len(description["windows"])==16
    assert len(body)==1024*1024*16
    pixels=np.frombuffer(body,dtype="<f4").reshape(16,256,256,4)
    np.testing.assert_array_equal(pixels[0,...,:3],frame.image[:256,:256])


def test_proof_uses_owner_identity_and_separates_resampled_pixels(context):
    _, frame = context
    proof = SimpleNamespace(delivery_owner=frame, image=frame.image)
    assert dm.source_identity(proof) == dm.source_identity(frame)
    proof.image = frame.image[::2, ::2].copy()
    assert dm.source_identity(proof) != dm.source_identity(frame)
    first = dm.source_identity(proof)
    frame.render_cache._source_epoch += 1
    assert dm.source_identity(proof) != first


def test_cpu_delivery_reuses_persisted_measurement(context, monkeypatch):
    client, frame = context
    expected = dm.cpu_delivery_model(frame).as_dict()
    dm._models.clear()
    from hdr_finisher import denoise_adaptive
    def unexpected(*args, **kwargs):
        raise AssertionError("Stored measurement was measured again")
    monkeypatch.setattr(denoise_adaptive, "estimate_adaptive_model", unexpected)
    assert dm.cpu_delivery_model(frame).as_dict() == expected
    assert client.get("/api/session/test-photo/denoise-measurement/hdr?long_edge=640").json() == expected


def test_library_native_reads_same_pixels_without_grade_frame_setup(context, monkeypatch):
    client, frame = context
    from hdr_finisher import library_live
    meta = {"adjustments": frame.adjustments.model_dump(mode="json"), "scene_width":96,
        "scene_height":64,"source_key":"stored-scene","has_reference":False}
    monkeypatch.setattr(library_live,"metadata",lambda _:meta)
    monkeypatch.setattr(library_live,"native_denoise_pixels",lambda _:frame.image.astype(np.float16))
    def unexpected(_):
        raise AssertionError("Noise measurement built an unrelated grade/peak frame")
    monkeypatch.setattr(library_live,"session",unexpected)
    response=client.get("/api/session/live-test/denoise-measurement/hdr?long_edge=640&source=true")
    assert response.status_code==200
    length=struct.unpack("<I",response.content[:4])[0]
    pixels=np.frombuffer(response.content[4+length:],dtype="<f4").reshape(64,96,4)
    np.testing.assert_array_equal(pixels[...,:3],frame.image.astype(np.float16).astype(np.float32))
