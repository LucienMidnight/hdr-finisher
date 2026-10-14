from pathlib import Path
from copy import deepcopy
import json
import numpy as np
import pytest
from test_library_grades import setup, saved, edit
from hdr_finisher.library_kept import produce, identity, preferences, KeptPictures, atomic_json, PICTURE_VERSION
from hdr_finisher.library_pictures import LibraryPictureCache
from hdr_finisher import exporters
from hdr_finisher.models import ExportSettings, PreviewKind

class Worker:
    def status(self): return {"paused":False}

def test_corrected_producer_uses_same_export_renditions_and_never_changes_open_grade(setup,monkeypatch,tmp_path):
    photo,store,session,marks,grades=setup
    grade=saved(setup); captured={}
    def encode(path,hdr,sdr,settings,white):
        captured.update(hdr=hdr.copy(),sdr=sdr.copy(),white=white);Path(path).write_bytes(b"test")
    monkeypatch.setattr(exporters,"write_jpeg_gainmap_renditions",encode)
    previous=session.edit_document().model_dump(mode="json")
    result=produce(tmp_path,photo,grade,512)
    settings=ExportSettings(quality=75,jpeg_gain_map_quality=75,jpeg_gain_map_scale="half",dithering="off")
    adjustments=exporters._finishing_adjustments_for_export(session);adjustments.shared.overlay_mode="off"
    np.testing.assert_array_equal(captured["hdr"],exporters._render_export_branch(session,settings,PreviewKind.HDR,adjustments))
    np.testing.assert_array_equal(captured["sdr"],exporters._render_export_branch(session,settings,PreviewKind.SDR,adjustments))
    assert session.edit_document().model_dump(mode="json")==previous
    assert result["width"]==76 and result["height"]==52
    Path(result["temporary"]).unlink()

def test_picture_preferences_preserve_unknown_and_reject_unreadable(tmp_path):
    assert preferences(tmp_path)=={"edited_resolution":"screen","screen_edge":2560,"edited_edge":2560,"limit_bytes":2*1024**3}
    path=tmp_path/"library-picture-preferences.json"
    path.write_text('{"future":17}')
    preferences(tmp_path,{"edited_resolution":512})
    assert json.loads(path.read_text())["future"]==17
    with pytest.raises(ValueError, match="1 GB"):
        preferences(tmp_path,{"limit_bytes":1024**3-1})
    assert preferences(tmp_path,{"limit_bytes":1024**3})["limit_bytes"]==1024**3
    path.write_text('broken')
    with pytest.raises(ValueError): preferences(tmp_path,{"edited_resolution":1920})
    assert path.read_text()=='broken'

def test_picture_matching_and_missing_fallback(setup,tmp_path):
    photo,store,session,marks,grades=setup
    grade=saved(setup);kept=KeptPictures(tmp_path,marks,Worker())
    assert kept.request(photo)["edited"]
    assert kept.cached(photo) is None
    key=kept.key(str(photo),identity(grade));kept.cache.root.mkdir(parents=True)
    (kept.cache.root/(key+".jpg")).write_bytes(b"jpeg")
    atomic_json(kept.cache.root/(key+".json"),{"extension":"jpg","grade_identity":identity(grade),"source_stat":kept.source_stat(photo),"picture_version":PICTURE_VERSION,"edge":2560})
    assert kept.cached(photo)["kept"]
    document=json.loads(Path(str(photo)+".hdrf").read_text());document["grade"]["global_adjustments"]["hdr"]["exposure"]=3
    Path(str(photo)+".hdrf").write_text(json.dumps(document))
    assert kept.cached(photo) is None

def test_disposable_picture_budgets_cannot_evict_saved_grades(tmp_path):
    cache=LibraryPictureCache(tmp_path,limit=100)
    cache.root.mkdir();cache.full_root.mkdir()
    (cache.root/"a.npz").write_bytes(b"x"*180)
    (cache.full_root/"full.npz").write_bytes(b"x"*180)
    (cache.root/"b.jpg").write_bytes(b"x"*50)
    cache.trim()
    assert not (cache.root/"a.npz").exists() and not (cache.full_root/"full.npz").exists()
    assert (cache.root/"b.jpg").exists()

def test_publication_request_not_tied_to_open_grade(setup,tmp_path):
    photo,store,session,marks,grades=setup
    saved(setup);store.clear()
    assert KeptPictures(tmp_path,marks,Worker()).request(photo)["edited"]


def test_library_jpeg_file_reader_matches_sdr_and_reconstructs_hdr(tmp_path):
    from hdr_finisher.library_kept import jpeg_renditions
    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg
    from hdr_finisher.color import linear_srgb_to_acescg
    x = np.linspace(.03, .8, 96, dtype=np.float32)
    sdr = np.broadcast_to(np.stack((x, x*.7, x*.4), axis=1), (64,96,3)).copy()
    hdr = linear_srgb_to_acescg(sdr * .18 * 2)
    path = tmp_path / "kept.jpg"
    exporters.write_jpeg_gainmap_renditions(path, hdr, sdr, ExportSettings(quality=75, jpeg_gain_map_quality=75, jpeg_gain_map_scale="half", dithering="off"))
    reference, base, _ = decode_ultrahdr_jpeg(path)
    np.testing.assert_allclose(jpeg_renditions(path), base, atol=1e-6)
    assert np.mean(np.abs(jpeg_renditions(path, True)-reference)) / np.mean(reference) < .01


def test_no_headroom_kept_picture_preserves_distinct_views(setup,monkeypatch,tmp_path):
    from hdr_finisher.color import linear_srgb_to_acescg
    from hdr_finisher.library_kept import jpeg_renditions
    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg, inspect_jpeg_gain_map
    photo,store,session,marks,grades=setup
    grade=saved(setup)
    sdr=np.full((32,48,3),.4,dtype=np.float32)
    hdr=linear_srgb_to_acescg(sdr*.18*.5)
    monkeypatch.setattr(exporters,"_render_export_branch",lambda frame,settings,lane,adjustments: hdr.copy() if lane==PreviewKind.HDR else sdr.copy())
    result=produce(tmp_path,photo,grade)
    path=Path(result["temporary"])
    try:
        assert result["extension"]=="jpg" and result["route"]=="saved-gain-map"
        metadata=inspect_jpeg_gain_map(path)
        assert metadata.hdr_capacity_max>metadata.hdr_capacity_min==1
        decoded_hdr,decoded_sdr,_=decode_ultrahdr_jpeg(path)
        np.testing.assert_allclose(jpeg_renditions(path),decoded_sdr,atol=1e-6)
        assert np.mean(np.abs(jpeg_renditions(path,True)-decoded_hdr))/np.mean(decoded_hdr)<.01
        assert np.mean(np.abs(decoded_hdr-hdr))/np.mean(hdr)<.01
        assert np.mean(np.abs(decoded_sdr-sdr))/np.mean(sdr)<.01
    finally: path.unlink(missing_ok=True)


def test_failed_encode_retries_after_cooldown_without_another_save(setup,monkeypatch,tmp_path):
    from concurrent.futures import Future
    from test_library_open_kept import wait_for
    from hdr_finisher import library_kept
    photo,store,session,marks,grades=setup
    grade=saved(setup);calls=[];events=[]
    def encode(path,*args):
        calls.append(path)
        if len(calls)==1: raise exporters.ExportProcessError("forced encoder failure")
        Path(path).write_bytes(b"picture")
    monkeypatch.setattr(exporters,"write_jpeg_gainmap_renditions",encode)
    monkeypatch.setattr(library_kept,"log",lambda event,**fields: events.append((event,fields)))
    class RetryWorker(Worker):
        def submit_library(self,kind,**request):
            future=Future()
            try: future.set_result(produce(tmp_path,request["path"],request["grade"],request["edge"]))
            except Exception as error: future.set_exception(error)
            return str(len(calls)),future
        def cancel(self,job): pass
    kept=KeptPictures(tmp_path,marks,RetryWorker())
    try:
        kept.ensure(photo)
        wait_for(lambda: any(event=="kept_picture_failed" for event,_ in events) and not kept._requested)
        for _ in range(10): kept.ensure(photo)
        assert len(calls)==1 and kept.cached(photo) is None
        kept._retry_after[str(photo)]=library_kept.time.monotonic()-1
        kept.ensure(photo)
        wait_for(lambda: kept.cached(photo) is not None)
        assert len(calls)==2
        assert kept.request(photo)["grade_identity"]==identity(grade)
    finally: kept.close()


def test_replaced_picture_job_has_a_reason_not_a_failure(setup,monkeypatch,tmp_path):
    from concurrent.futures import Future
    from test_library_open_kept import wait_for
    from hdr_finisher import library_kept
    photo,store,session,marks,grades=setup
    saved(setup);events=[]
    monkeypatch.setattr(library_kept,"log",lambda event,**fields: events.append((event,fields)))
    class PendingWorker(Worker):
        def __init__(self): self.futures=[]
        def submit_library(self,*args,**kwargs):
            future=Future();self.futures.append(future);return str(len(self.futures)),future
        def cancel(self,job): self.futures[int(job)-1].cancel()
    worker=PendingWorker();kept=KeptPictures(tmp_path,marks,worker)
    try:
        kept.schedule(photo)
        wait_for(lambda: len(worker.futures)==1 and not kept._requested)
        kept.schedule(photo)
        wait_for(lambda: len(worker.futures)==2 and not kept._requested)
        assert any(event=="kept_picture_replaced" and "newer" in fields["reason"] for event,fields in events)
        assert not any(event=="kept_picture_failed" for event,_ in events)
    finally: kept.close()


def test_replaced_picture_is_not_a_recent_problem():
    from hdr_finisher.library_diagnostics import log, recent
    photo="replaced-picture-regression"
    log("kept_picture_replaced",photo=photo,reason="replaced by a newer saved grade")
    assert not any(row.get("photo")==photo for row in recent())


@pytest.mark.parametrize("extension", ["jpg", "avif", "npz"])
def test_unreadable_kept_picture_is_missing_and_remade_without_another_save(setup, monkeypatch, tmp_path, extension):
    from concurrent.futures import Future
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher import library_api
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    from test_library_open_kept import wait_for
    photo, store, session, marks, grades = setup
    grade = saved(setup)
    source_before = photo.read_bytes()
    sidecar = Path(str(photo) + ".hdrf")
    grade_before = sidecar.read_bytes()
    class PendingWorker(Worker):
        def __init__(self): self.requests = []
        def submit_library(self, kind, **request):
            future = Future()
            self.requests.append((request, future))
            return "remake", future
        def cancel(self, job): pass
    worker = PendingWorker()
    monkeypatch.setattr(library_api, "LibraryMarks", lambda root: marks)
    app = FastAPI()
    app.include_router(create_library_router(worker, MediaBrowserStore(marks.database.parent), store))
    client = TestClient(app)
    kept = marks.kept
    grade_id = identity(grade)
    key = kept.key(str(photo), grade_id)
    kept.cache.root.mkdir(parents=True, exist_ok=True)
    picture = kept.cache.root / (key + "." + extension)
    if extension == "npz":
        np.savez(picture, pixels=np.ones((2, 3, 3), dtype=np.float16))
    else:
        picture.write_bytes(b"damaged picture")
    metadata = kept.cache.root / (key + ".json")
    atomic_json(metadata, {"extension": extension, "grade_identity": grade_id,
        "source_stat": kept.source_stat(photo), "picture_version": PICTURE_VERSION, "edge": 2560})
    try:
        assert kept.cached(photo) and kept.current_meta(str(photo), grade_id)
        response = client.get(f"/api/library/kept-pixels/{key}?lane=hdr")
        assert response.status_code == 404
        assert not picture.exists() and not metadata.exists()
        assert kept.cached(photo) is None
        assert kept.current_meta(str(photo), grade_id) is None
        for _ in range(2):
            status = client.post("/api/library/settings-status", json={"paths": [str(photo)]}).json()
            assert not status["photos"][0]["pictureCurrent"]
        wait_for(lambda: len(worker.requests) == 1 and not kept._requested)
        request, future = worker.requests[0]
        assert request["grade"] == grade
        future.set_result(produce(marks.database.parent, request["path"], request["grade"], request["edge"]))
        assert kept.cached(photo)["extension"] == "jpg"
        status = client.post("/api/library/settings-status", json={"paths": [str(photo)]}).json()
        assert status["photos"][0]["pictureCurrent"]
        for lane in ("hdr", "sdr"):
            response = client.get(f"/api/library/kept-pixels/{key}?lane={lane}")
            assert response.status_code == 200 and response.content
        assert len(worker.requests) == 1
        assert photo.read_bytes() == source_before and sidecar.read_bytes() == grade_before
    finally:
        kept.close()


def test_screen_default_ignores_retired_resolution_and_size_changes_invalidate_cache(setup, tmp_path):
    photo,store,session,marks,grades=setup
    grade=saved(setup)
    atomic_json(tmp_path/"library-picture-preferences.json", {"edited_edge":1024})
    assert preferences(tmp_path)["edited_edge"]==2560
    preferences(tmp_path,{"screen_edge":1920})
    kept=KeptPictures(tmp_path,marks,Worker())
    key=kept.key(str(photo),identity(grade));kept.cache.root.mkdir(parents=True)
    (kept.cache.root/(key+".jpg")).write_bytes(b"old")
    meta={"extension":"jpg","grade_identity":identity(grade),"source_stat":kept.source_stat(photo),"edge":1920}
    atomic_json(kept.cache.root/(key+".json"),meta)
    assert kept.cached(photo) is None and kept.current_meta(str(photo),identity(grade)) is None
    atomic_json(kept.cache.root/(key+".json"),meta|{"picture_version":PICTURE_VERSION})
    assert kept.cached(photo)
    preferences(tmp_path,{"screen_edge":2560})
    assert kept.cached(photo) is None
    kept.close()


def test_saved_picture_is_fitted_after_crop_and_encoded_for_screen(setup, tmp_path, monkeypatch):
    from hdr_finisher.models import CropRectangle
    photo,store,session,marks,grades=setup
    session.image=np.ones((180,300,3),np.float32)
    session.adjustments.shared.geometry.crop=CropRectangle(x=.1,y=.1,width=.5,height=.5)
    grade=session.edit_document().model_dump(mode="json")
    monkeypatch.setattr("hdr_finisher.sessions.SessionStore.prepare_session",lambda *a,**k:session)
    captured={}
    def encode(path,hdr,sdr,settings,white):
        captured.update(settings=settings,size=hdr.shape[:2]);Path(path).write_bytes(b"test")
    monkeypatch.setattr(exporters,"write_jpeg_gainmap_renditions",encode)
    result=produce(tmp_path,photo,grade,128)
    try:
        assert max(captured["size"])==128
        assert captured["settings"].quality==95 and captured["settings"].jpeg_chroma_subsampling=="444"
        assert captured["settings"].jpeg_gain_map_quality==95 and captured["settings"].jpeg_gain_map_scale=="full"
        assert result["source_width"]>result["width"]
    finally: Path(result["temporary"]).unlink()


def test_background_refresh_remakes_existing_grade_without_save(setup, tmp_path, monkeypatch):
    from concurrent.futures import Future
    from test_library_open_kept import wait_for
    photo,store,session,marks,grades=setup
    grade=saved(setup)
    sidecar=Path(str(photo)+".hdrf");before=sidecar.read_bytes();requests=[]
    def encode(path,*args): Path(path).write_bytes(b"picture")
    monkeypatch.setattr(exporters,"write_jpeg_gainmap_renditions",encode)
    class BackgroundWorker(Worker):
        def submit_library(self,kind,**request):
            requests.append(request);future=Future()
            future.set_result(produce(tmp_path,request["path"],request["grade"],request["edge"]))
            return "background",future
        def cancel(self,job): pass
    kept=KeptPictures(tmp_path,marks,BackgroundWorker())
    try:
        kept.remake_missing()
        wait_for(lambda: kept.cached(photo) is not None)
        assert len(requests)==1 and requests[0]["edge"]==2560
        assert sidecar.read_bytes()==before
        kept.remake_missing()
        wait_for(lambda: not kept._refreshing)
        assert len(requests)==1
    finally: kept.close()
