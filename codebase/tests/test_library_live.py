"""Stored source identity, read-only grades and the existing cache controls."""
from copy import deepcopy
from types import SimpleNamespace
import numpy as np
from PIL import Image
import pytest
from hdr_finisher.library_live import LivePictures, develop_cpu, quality, session
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.models import AdjustmentState, RawImportSettings


def photo(tmp_path):
    path=tmp_path/"photo.png"
    Image.new("RGB",(800,400),(160,90,60)).save(path)
    return path


def test_one_import_stores_both_sizes_and_finishing_reuses_source(tmp_path, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    original=SessionStore.prepare_session; calls=[]
    def prepare(self,*args,**kwargs):
        calls.append(args[0]);return original(self,*args,**kwargs)
    monkeypatch.setattr(SessionStore,"prepare_session",prepare)
    path=photo(tmp_path);before=path.read_bytes();root=tmp_path/"cache"
    small=develop_cpu(root,path,None,640)
    large=develop_cpu(root,path,None,2560)
    assert len(calls)==1
    assert (small["width"],small["height"])==(640,320)
    assert (large["width"],large["height"])==(800,400)
    service=LivePictures(root,LibraryMarks(root))
    a=service.describe(path,small)
    document={"global_adjustments":deepcopy(a["adjustments"])}
    document["global_adjustments"]["hdr"]["exposure"]=2
    service.documents=SimpleNamespace(request=lambda path:{"grade":document})
    b=service.describe(path,small)
    assert a["source_key"]==b["source_key"] and a["key"]!=b["key"]
    assert b["adjustments"]["hdr"]["exposure"]==2
    assert quality(None)==quality(document)
    assert session(b["key"]).adjustments.hdr.exposure==2
    assert service.cache.default_document(path) is not None
    assert path.read_bytes()==before and not list(tmp_path.glob("*.hdrf"))


def test_source_settings_invalidate_scene_but_not_another_finishing_edit():
    a={"source":{"raw_import_settings":RawImportSettings().model_dump(mode="json")}}
    b=deepcopy(a);b["source"]["raw_import_settings"]["lens"]["mode"]="off"
    assert quality(a)!=quality(b)
    assert quality({"hdr_reference_white_nits":100})!=quality(None)


def test_native_scene_is_requested_separately_and_retained_in_full_cache(tmp_path, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    original = SessionStore.prepare_session
    calls = []
    def prepare(self, *args, **kwargs):
        calls.append(args[0])
        return original(self, *args, **kwargs)
    monkeypatch.setattr(SessionStore, "prepare_session", prepare)
    path = tmp_path / "large.png"
    Image.new("RGB", (3000, 400), (160, 90, 60)).save(path)
    root = tmp_path / "cache"
    fit = develop_cpu(root, path, None, 2560)
    service = LivePictures(root, LibraryMarks(root))
    assert not service.cache.cached(path, 100000, quality(None))
    native = develop_cpu(root, path, None, 100000)
    again = develop_cpu(root, path, None, 100000)
    assert len(calls) == 2, "Only the explicit native request develops the photo again"
    assert fit["width"] == 2560 and native["width"] == 3000
    assert again["key"] == native["key"] and again["cache_hit"]
    assert service.cache.file(native["key"]).parent == service.cache.full_root
    assert service.cache.managed.preferences()["enabled"]


def test_cache_off_keeps_scene_in_memory_and_clear_removes_stored_scene(tmp_path):
    path=photo(tmp_path);root=tmp_path/"cache"
    live=LivePictures(root,LibraryMarks(root))
    live.cache.managed.update({"enabled":False})
    meta=develop_cpu(root,path,None,640)
    live.cache.accept_transient(meta)
    described=live.describe(path,meta)
    body,width,height,stride,space=live.pixels(described["key"],"hdr")
    assert (width,height)==(640,320) and len(body)==stride*height
    assert not list(root.rglob("*.npz"))
    live.cache.managed.update({"enabled":True})
    stored=develop_cpu(root,path,None,640)
    assert live.cache.file(stored["key"]).is_file()
    live.cache.managed.clear()
    assert not live.cache.file(stored["key"]).is_file()


def test_worker_accepts_live_scene_and_cancelled_work_stays_cancelled(tmp_path):
    from hdr_finisher.library_worker import LibraryWorker
    worker=LibraryWorker(tmp_path/"cache")
    try:
        worker.pause("grading",True)
        job,future=worker.submit_library("live-scene",path=str(photo(tmp_path)),document=None,edge=640)
        worker.cancel(job)
        worker.pause("grading",False)
        with pytest.raises(Exception):future.result(timeout=10)
        job,future=worker.submit_library("live-scene",path=str(tmp_path/"photo.png"),document=None,edge=640)
        assert future.result(timeout=20)["quality"]==quality(None)
    finally:worker.close()


def test_live_geometry_and_visible_cpu_fallback_keep_the_saved_grade(tmp_path):
    from hdr_finisher.library_live import fallback_picture
    from hdr_finisher.sessions import SessionStore
    from base64 import b64decode
    from io import BytesIO
    path=photo(tmp_path);root=tmp_path/"cache"
    default=SessionStore().prepare_session(path,owns_source_path=False).edit_document().model_dump(mode="json")
    saved=deepcopy(default);saved["global_adjustments"]["shared"]["geometry"]["rotation"]=90
    saved["global_adjustments"]["sdr"]["exposure"]=1
    service=LivePictures(root,LibraryMarks(root),SimpleNamespace(request=lambda path:{"grade":saved}))
    metadata=develop_cpu(root,path,saved,640)
    meta=service.describe(path,metadata)
    body,width,height,stride,_=service.pixels(meta["key"],"sdr")
    assert (width,height)==(320,640)==(meta["width"],meta["height"])
    assert len(body)==stride*height
    rendered=fallback_picture(root,path,saved,640)
    with Image.open(BytesIO(b64decode(rendered["url"].split(",",1)[1]))) as image:
        assert image.size==(320,640)
    assert not list(root.rglob("*.jpg"))
    service.cache.managed.update({"enabled":False})
    assert fallback_picture(root,path,saved,640)["url"].startswith("data:image/jpeg;base64,")


def test_save_revert_and_copy_do_not_launch_finished_picture_work(tmp_path):
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_grades import LibraryGrades
    from hdr_finisher.library_copies import LibraryCopies
    from test_library_grades import edit
    path=photo(tmp_path); before=path.read_bytes()
    store=SessionStore(); opened=store.get(store.create_session(path,owns_source_path=False).session_id)
    marks=LibraryMarks(tmp_path/"app"); grades=LibraryGrades(marks,store)
    grades.attach(str(opened.session_id))
    def forbidden(*args,**kwargs):
        raise AssertionError("Saving settings must not launch a finished-picture job")
    marks.kept=SimpleNamespace(schedule=forbidden,enqueue=forbidden)
    edit(store,opened); grades.save(str(opened.session_id))
    marks.writer.drain()
    copies=LibraryCopies(marks); made=copies.create(str(path),"current","Live copy")
    assert made["path"]
    store.clear()
    result=grades.history.revert([str(path)],"original")
    assert result["count"]==1
    marks.writer.drain()
    assert path.read_bytes()==before
    assert not list((tmp_path/"app").rglob("*.jpg"))


def test_retired_file_routes_are_gone_and_scene_resume_preserves_other_pauses(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_worker import LibraryWorker
    from hdr_finisher.media_browser import MediaBrowserStore
    profile=tmp_path/"profile"; worker=LibraryWorker(profile)
    app=FastAPI(); app.include_router(create_library_router(worker,MediaBrowserStore(profile)))
    client=TestClient(app)
    try:
        for method, route in [('post','kept-picture'),('post','thumbnails'),('get','thumbnail/old'),
                              ('post','thumbnail/old'),('get','kept-pixels/old'),('post','thumbnail-work'),
                              ('get','paste-pictures'),('post','paste-pictures'),
                              ('get','picture-settings'),('post','picture-settings')]:
            assert getattr(client,method)('/api/library/'+route).status_code==404
        worker.pause('grading',True)
        paused=client.post('/api/library/scene-work',json={'action':'pause'}).json()
        assert paused['paused'] and paused['manual_paused']
        resumed=client.post('/api/library/scene-work',json={'action':'resume'}).json()
        assert resumed['paused'] and not resumed['manual_paused']
        worker.pause('grading',False)
        assert not worker.status()['paused']
        assert client.post('/api/library/scene-work',json={'action':'clear'}).status_code==400
    finally:
        client.close(); worker.close()


def test_live_plan_checks_cache_and_size_without_starting_preparation(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    class NoPreparation:
        def submit_library(self, *args, **kwargs):
            pytest.fail("A cache check must never start preparation")
    path = photo(tmp_path)
    before = path.read_bytes()
    profile = tmp_path / "profile"
    app = FastAPI()
    app.include_router(create_library_router(NoPreparation(), MediaBrowserStore(profile)))
    with TestClient(app) as client:
        cold = client.post('/api/library/live-plan', json={'path':str(path),'edge':640})
        assert cold.status_code == 200
        assert cold.json()['cached'] is None
        assert cold.json()['bytes'] == len(before)
        develop_cpu(profile, path, None, 640)
        warm = client.post('/api/library/live-plan', json={'path':str(path),'edge':640})
        assert warm.status_code == 200
        assert warm.json()['cached']['edge'] == 640
        assert warm.json()['cached']['key']
        assert warm.json()['revision'] == cold.json()['revision']
    assert path.read_bytes() == before


@pytest.mark.parametrize("route", ["live-scene", "fallback-picture"])
def test_source_request_survives_grade_pause_without_restarting(tmp_path, route):
    from concurrent.futures import Future
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    path = photo(tmp_path)
    profile = tmp_path / "profile"
    # Prepare the worker result, then remove its disk entry so the request
    # actually queues development instead of hitting the source cache.
    result = develop_cpu(profile, path, None, 640)
    from hdr_finisher.library_live import LivePictures
    live = LivePictures(profile, LibraryMarks(profile))
    live.cache.managed.clear()
    if route == "fallback-picture":
        result = {"url": "data:image/jpeg;base64,test", "width": 640, "height": 320}

    class PausingHelper:
        def __init__(self):
            self.future = Future()
            self.submitted = 0
            self.polls = 0
        def status(self):
            if self.submitted:
                self.polls += 1
                if self.polls == 4:
                    self.future.set_result(result)
            return {"paused": bool(self.submitted)}
        def submit_library(self, command, **arguments):
            self.submitted += 1
            return "source-job", self.future
        def prioritize(self, *args):
            pass
        def cancel(self, job):
            assert self.future.done(), "A Grade pause must not discard source work"

    helper = PausingHelper()
    app = FastAPI()
    app.include_router(create_library_router(helper, MediaBrowserStore(profile)))
    with TestClient(app) as client:
        response = client.post('/api/library/' + route,
            json={"path": str(path), "edge": 640, "gpu": False})
    assert response.status_code == 200
    assert helper.submitted == 1
    assert helper.polls >= 4
    assert response.json()["width"] == 640
