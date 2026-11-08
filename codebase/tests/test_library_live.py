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


def test_only_requested_size_is_developed_and_finishing_reuses_source(tmp_path, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    original=SessionStore.prepare_session; calls=[]
    def prepare(self,*args,**kwargs):
        calls.append(args[0]);return original(self,*args,**kwargs)
    monkeypatch.setattr(SessionStore,"prepare_session",prepare)
    path=photo(tmp_path);before=path.read_bytes();root=tmp_path/"cache"
    small=develop_cpu(root,path,None,640)
    from hdr_finisher.library_pictures import LibraryPictureCache
    assert LibraryPictureCache(root).cached(path,2560,quality(None)) is None
    large=develop_cpu(root,path,None,2560)
    assert len(calls)==2
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


@pytest.mark.parametrize("authored", [False, True])
def test_direct_stored_half_transport_matches_geometry_renderer_bytes(tmp_path, authored):
    from hdr_finisher.render_cache import encode_rgba_proxy_rows
    from hdr_finisher.models import PreviewKind
    path = photo(tmp_path)
    service = LivePictures(tmp_path/"cache", LibraryMarks(tmp_path/"cache"))
    meta = service.describe(path, develop_cpu(tmp_path/"cache", path, None, 640))
    # Include signed, very small and bright values, padded rows and an authored base.
    rng = np.random.default_rng(4)
    pixels = rng.uniform(-0.01, 20, (19, 37, 3)).astype(np.float16)
    reference = rng.uniform(0, 1, pixels.shape).astype(np.float16)
    scene = tmp_path/"transport.npz"
    np.savez(scene, pixels=pixels, reference=reference)
    service.cache.open = lambda key: scene
    meta["adjustments"]["sdr"]["use_authored_base"] = authored
    # describe registers a copy, so use the registered settings too.
    import hdr_finisher.library_live as live
    live._registry[meta["key"]][1]["adjustments"]["sdr"]["use_authored_base"] = authored
    for lane in ("hdr", "sdr"):
        frame = service.frame(meta)
        expected, space, _ = frame.render_cache.geometry_source_proxy(PreviewKind(lane), meta["edge"], frame.adjustments)
        body, width, height, stride, actual_space = service.pixels(meta["key"], lane)
        expected_body, expected_stride = encode_rgba_proxy_rows(expected, pixel_format="rgba16float")
        assert (body, stride, actual_space) == (expected_body, expected_stride, space)
        assert (width, height) == (37, 19)


@pytest.mark.parametrize("invalidate", [False, True])
def test_fresh_scene_draws_from_memory_before_atomic_store(tmp_path, invalidate):
    from hdr_finisher.library_pictures import LibraryPictureCache
    cache = LibraryPictureCache(tmp_path / "profile")
    path = photo(tmp_path)
    pixels = np.full((4, 8, 3), .18, dtype=np.float32)
    valid = [True]
    def owner_check():
        if not valid[0]:
            raise ValueError("owner changed")
    result = cache.build(path, 640, quality(None), decoded=(pixels, None,
        {"source_width": 8, "source_height": 4}), defer_store=True, store_validate=owner_check)
    service = LivePictures(tmp_path / "profile", None)
    service.cache = cache
    meta = service.describe(path, result)
    assert not cache.file(result["key"]).exists()
    body, width, height, stride, space = service.pixels(meta["key"], "hdr")
    assert (width, height, space) == (8, 4, "acescg")
    np.testing.assert_allclose(np.frombuffer(body, dtype=np.float16).reshape(height, stride // 2)[:, :width*4].reshape(height, width, 4)[..., :3], pixels, atol=.0001)
    if invalidate:
        valid[0] = False
        with pytest.raises(ValueError, match="owner changed"):
            cache.persist_pending(str(path.resolve()), lambda _: None)
        assert not cache.file(result["key"]).exists()
    else:
        cache.persist_pending(str(path.resolve()), lambda _: None)
        assert cache.file(result["key"]).is_file()
        assert cache.cached(path, 640, quality(None))["key"] == result["key"]
    assert result["key"] not in cache.transient
    assert not list((tmp_path / "profile").rglob("*.tmp"))


def test_cpu_fallback_hands_only_requested_size_to_draw_before_store(tmp_path, monkeypatch):
    import gc
    import weakref
    from hdr_finisher import library_live
    from hdr_finisher.sessions import SessionStore
    sources = []
    prepare = SessionStore.prepare_session
    def track_source(self, *args, **kwargs):
        source = prepare(self, *args, **kwargs)
        sources.append(weakref.ref(source))
        return source
    monkeypatch.setattr(SessionStore, "prepare_session", track_source)
    path = photo(tmp_path)
    result = develop_cpu(tmp_path / "profile", path, None, 640, draw_first=True)
    scenes = result.pop("_pending_scenes")
    assert {scene["edge"] for scene in scenes} == {640}
    assert all(scene.get("_transient") for scene in scenes)
    assert not list((tmp_path / "profile").rglob("*.npz"))
    gc.collect()
    assert sources and all(source() is None for source in sources)
    assert not library_live._cpu_flights


def test_changed_photo_during_memory_encoding_never_publishes(tmp_path, monkeypatch):
    from hdr_finisher.library_pictures import LibraryPictureCache
    cache = LibraryPictureCache(tmp_path / "profile")
    path = photo(tmp_path)
    encode = np.savez
    def changed(stream, **arrays):
        encode(stream, **arrays)
        path.write_bytes(path.read_bytes() + b"changed")
    monkeypatch.setattr(np, "savez", changed)
    with pytest.raises(ValueError, match="Photo changed"):
        cache.build(path, 640, quality(None), decoded=(np.ones((4, 8, 3)), None, {}), defer_store=True)
    assert not cache.transient and not cache.pending_stores
    assert not list((tmp_path / "profile").rglob("*.npz"))


def test_materialised_neutral_highlight_default_reuses_authored_scene_identity():
    from hdr_finisher.models import EditDocument
    from hdr_finisher.projects import validate_saved
    document = {"source": {"raw_import_settings": RawImportSettings().model_dump(mode="json")}}
    document["source"]["raw_import_settings"]["lens"]["mode"] = "off"
    document["source"]["raw_import_settings"]["highlight_reconstruction"].pop("edge_colour_expand_percent")
    assert quality(None) == quality({})
    from hdr_finisher.library_live import recipe, _quality
    authored = recipe(document)
    authored["raw_import_settings"] = deepcopy(document["source"]["raw_import_settings"])
    # An equivalent RAW default shares only the current decoder/adapter identity.
    stored_quality = _quality(authored)
    before = quality(document)
    from hdr_finisher.library_live import equivalent_qualities
    assert stored_quality in equivalent_qualities(before)
    normalised = validate_saved(EditDocument, document).model_dump(mode="json")
    assert quality(normalised) == before
    normalised["source"]["raw_import_settings"]["highlight_reconstruction"]["edge_colour_expand_percent"] = 1
    assert quality(normalised) == before
    normalised["source"]["raw_import_settings"]["highlight_reconstruction"]["method"] = "edge_colour_v1"
    assert quality(normalised) != before


@pytest.mark.parametrize("lens_mode", ["auto", "off"])
def test_stored_scene_survives_materialised_defaults(tmp_path, lens_mode):
    from hdr_finisher.library_live import recipe, _quality
    from hdr_finisher.library_pictures import LibraryPictureCache
    path = photo(tmp_path)
    document = {"source": {"raw_import_settings": RawImportSettings().model_dump(mode="json")}}
    document["source"]["raw_import_settings"]["lens"]["mode"] = lens_mode
    authored = recipe(document)
    authored["raw_import_settings"]["highlight_reconstruction"].pop("edge_colour_expand_percent")
    cache = LibraryPictureCache(tmp_path / "profile")
    stored = cache.build(path, 640, _quality(authored), decoded=(np.ones((4,8,3)), None, {"source_width":8,"source_height":4}))
    found = cache.cached(path, 640, quality(document))
    assert found["cache_hit"] and found["key"] == stored["key"]
    assert found["quality"] == quality(document)
    service=LivePictures(tmp_path/'profile', LibraryMarks(tmp_path/'profile'),
        SimpleNamespace(request=lambda path:{'grade':document}))
    before=service.describe(path,found)
    from hdr_finisher.library_pictures import picture_key
    from shutil import copyfile
    canonical_key=picture_key(path,640,quality(document))
    if canonical_key != stored['key']:
        copyfile(cache.file(stored['key']),cache.file(canonical_key))
    canonical=cache.cached(path,640,quality(document))
    after=service.describe(path,canonical)
    assert before['key']==after['key']
    if lens_mode == 'off':
        assert before['source_key']!=after['source_key']
    document["source"]["raw_import_settings"]["highlight_reconstruction"]["clipping_threshold"] = 1.1
    assert cache.cached(path, 640, quality(document)) is None


def test_scene_identity_ignores_inactive_controls_and_repair_labels():
    from hdr_finisher.library_live import recipe
    document = {"source": {"raw_import_settings": RawImportSettings().model_dump(mode="json")}}
    document["source"]["raw_import_settings"]["highlight_reconstruction"]["enabled"] = False
    before = quality(document)
    document["source"]["raw_import_settings"]["highlight_reconstruction"]["clipping_threshold"] = .8
    assert quality(document) == before
    from hdr_finisher.retouch_recipe import InpaintRecipe
    repair = {"id":"first", "name":"Dust", "enabled":True, "recipe":InpaintRecipe(
        source_size=(64,64), search_rect=(0,0,64,64), points=[dict(x=.5,y=.5)]).model_dump(mode="json")}
    document["repairs"] = [repair]
    before = quality(document)
    repair.update(id="renamed", name="New label")
    assert quality(document) == before
    repair["recipe"]["points"][0]["x"] = .6
    assert quality(document) != before
    repair["enabled"] = False
    document["repairs"] = [repair]
    disabled = quality(document)
    document["repairs"] = []
    assert quality(document) == disabled


def test_draw_identity_ignores_document_metadata_but_tracks_finishing(tmp_path):
    path=photo(tmp_path)
    root=tmp_path/'profile'
    scene=develop_cpu(root,path,None,640)
    from hdr_finisher.library_pictures import LibraryPictureCache
    document=LibraryPictureCache(root).default_document(path)
    service=LivePictures(root,LibraryMarks(root),SimpleNamespace(request=lambda path:{'grade':document}))
    before=service.describe(path,scene)
    document['app_version']='old-version'
    document['source']['filename']='renamed.png'
    document['source']['raw_import_settings']['highlight_reconstruction'].pop('edge_colour_expand_percent',None)
    assert service.describe(path,scene)['key']==before['key']
    document['global_adjustments']['hdr']['exposure']=1
    after=service.describe(path,scene)
    assert after['key']!=before['key'] and after['source_key']==before['source_key']

@pytest.mark.parametrize("admission_refused", [False, True])
def test_waiting_visible_preview_survives_handoff_reclamation(tmp_path, monkeypatch, admission_refused):
    from hdr_finisher.library_pictures import LibraryPictureCache
    from hdr_finisher import app_memory
    cache = LibraryPictureCache(tmp_path / "profile")
    path = photo(tmp_path)
    pixels = np.full((4, 8, 3), .18, dtype=np.float32)
    if admission_refused:
        monkeypatch.setattr(app_memory, "claim", lambda *args: False)
    result = cache.build(path, 640, quality(None), decoded=(pixels, None,
        {"source_width": 8, "source_height": 4}), defer_store=True)
    service = LivePictures(tmp_path / "profile", None)
    service.cache = cache
    meta = service.describe(path, result)
    # Simulate other developments reclaiming the handoff while this draw waits.
    cache.trim_memory(0)
    assert not cache.transient
    assert cache.file(result["key"]).is_file()
    body, width, height, stride, space = service.pixels(meta["key"], "hdr")
    assert (width, height, space) == (8, 4, "acescg")
    np.testing.assert_allclose(np.frombuffer(body, dtype=np.float16).reshape(height, stride // 2)[:, :width*4].reshape(height, width, 4)[..., :3], pixels, atol=.0001)
    assert not cache.pending_stores
    assert not list((tmp_path / "profile").rglob("*.tmp"))

def test_pending_preview_stays_owned_until_disk_publication_finishes(tmp_path, monkeypatch):
    from hdr_finisher.library_pictures import LibraryPictureCache
    cache = LibraryPictureCache(tmp_path / "profile")
    path = photo(tmp_path)
    result = cache.build(path, 640, quality(None), decoded=(np.full((4, 8, 3), .18), None,
        {"source_width": 8, "source_height": 4}), defer_store=True)
    service = LivePictures(tmp_path / "profile", None)
    service.cache = cache
    meta = service.describe(path, result)
    build = cache.build
    def while_storing(*args, **kwargs):
        cache.trim_memory(0)
        assert service.pixels(meta["key"], "hdr")[1:3] == (8, 4)
        return build(*args, **kwargs)
    monkeypatch.setattr(cache, "build", while_storing)
    cache.persist_pending(str(path.resolve()), lambda _: None)
    assert not cache.transient and not cache.pending_stores
    assert cache.file(result["key"]).is_file()


@pytest.mark.parametrize("gpu", [False, True])
def test_xtrans_api_reuses_measured_cpu_grant_and_existing_cancellable_helper(tmp_path, monkeypatch, gpu):
    from concurrent.futures import Future
    from contextlib import asynccontextmanager
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher import library_api, library_gpu_raw, library_estimates
    from hdr_finisher import library_grants
    from hdr_finisher.library_grants import backend_grant
    from hdr_finisher.library_scheduler import scheduler
    from hdr_finisher.media_browser import MediaBrowserStore
    import struct
    profile = tmp_path / "profile"
    png = photo(tmp_path)
    result = develop_cpu(profile, png, None, 640)
    from hdr_finisher.library_live import LivePictures
    LivePictures(profile, LibraryMarks(profile)).cache.managed.clear()
    raf = tmp_path / "fuji.raf"
    header = bytearray(100)
    header[:16] = b"FUJIFILMCCD-RAW "
    data = struct.pack(">IHH", 1, 0x0131, 36) + bytes([0, 1, 2] * 12)
    header[92:100] = struct.pack(">II", 100, len(data))
    raf.write_bytes(header + data + bytes(2000))
    monkeypatch.setattr(library_estimates, "dimensions", lambda path: (4992, 3296))
    monkeypatch.setattr(library_gpu_raw, "sensor", lambda *a, **k: pytest.fail("X-Trans entered Bayer sensor route"))
    admitted = []
    @asynccontextmanager
    async def grant(path, kind, priority, token, cancelled, edge):
        async with backend_grant(path, kind, priority, token, cancelled, edge) as owned:
            admitted.append((kind, scheduler.jobs[owned].estimate))
            yield owned
    monkeypatch.setattr(library_grants, "backend_grant", grant)
    class Helper:
        def status(self): return {"paused": False}
        def submit_library(self, command, **arguments):
            assert command == "live-scene" and arguments["path"] == str(raf)
            future = Future(); future.set_result(dict(result)); return "fuji", future
        def prioritize(self, *args): pass
        def cancel(self, *args): pass
    app = FastAPI(); app.include_router(library_api.create_library_router(Helper(), MediaBrowserStore(profile)))
    with TestClient(app) as client:
        plan = client.post('/api/library/live-plan', json={"path":str(raf),"edge":640})
        assert plan.status_code == 200
        assert plan.json()["cpu_route"] == "xtrans" and plan.json()["gpu_meta"] is None
        response = client.post('/api/library/live-scene', json={"path":str(raf),"edge":640,"gpu":gpu})
        assert response.status_code == 200, response.text
    assert admitted == [("cpu", 740_413_440)]


def test_non_xtrans_gpu_refusal_never_submits_cpu_helper(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher import library_api, library_rgb, library_gpu_raw
    from hdr_finisher.media_browser import MediaBrowserStore
    path = photo(tmp_path)
    def refuse(*args, **kwargs):
        raise library_gpu_raw.NotEligible("unsupported source recipe")
    monkeypatch.setattr(library_rgb, "decoded", refuse)
    class Helper:
        def status(self): return {"paused": False}
        def submit_library(self, *args, **kwargs): pytest.fail("refusal submitted CPU work")
    app = FastAPI(); app.include_router(library_api.create_library_router(Helper(), MediaBrowserStore(tmp_path/"profile")))
    with TestClient(app) as client:
        response = client.post('/api/library/live-scene', json={"path":str(path),"edge":640,"gpu":True})
    assert response.status_code == 204
    assert response.headers["X-Library-Fallback"] == "unsupported source recipe"


def test_native_requests_share_one_source_and_release_it_after_the_hold(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    import gc, weakref
    from hdr_finisher import library_live
    service = LivePictures(tmp_path/'cache',None)
    calls = []
    def read(meta):
        calls.append(meta['key'])
        return library_live._NativeFrame(image=np.ones((8,12,3),np.float32))
    monkeypatch.setattr(service,'_frame',read)
    meta = {'edge':100000,'key':'native-one'}
    barrier = Barrier(3)
    def request():
        frame = service.frame(meta)
        barrier.wait(timeout=5)  # Both endpoints retain their source together.
        return frame
    with ThreadPoolExecutor(2) as workers:
        a,b = workers.submit(request),workers.submit(request)
        barrier.wait(timeout=5)
        first,second = a.result(),b.result()
    assert first is second and calls == ['native-one']
    reference = weakref.ref(first)
    del first,second,a,b
    gc.collect()
    # A zoom's next request (Fit proxy, then tile batches) follows within a
    # second; it reuses the held frame instead of reading the scene again.
    assert service.frame(meta) is reference() and calls == ['native-one']
    timer = service._held_timer
    timer.cancel()
    timer.function()  # the hold ends
    del timer
    gc.collect()
    assert reference() is None and not service._native_frames
    replacement = service.frame(meta)
    assert calls == ['native-one','native-one']
    assert service.frame({'edge':100000,'key':'different-grade'}) is not replacement


def test_remembered_failure_does_not_hide_current_grade_cached_scene(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_picture_errors import PictureErrors
    from hdr_finisher.media_browser import MediaBrowserStore
    class NoPreparation:
        def submit_library(self,*args,**kwargs): pytest.fail("Cached scene must not redevelop")
    path=photo(tmp_path); profile=tmp_path/"profile"
    develop_cpu(profile,path,None,640)
    app=FastAPI();app.include_router(create_library_router(NoPreparation(),MediaBrowserStore(profile)))
    errors=PictureErrors(LibraryMarks(profile))
    errors.remember(path,ValueError("Later native development failed"),errors.revision(path))
    with TestClient(app) as api:
        result=api.post('/api/library/live-plan',json={'path':str(path),'edge':640})
        assert result.status_code==200,result.text
        assert result.json()['cached']['edge']==640
        missing=api.post('/api/library/live-plan',json={'path':str(path),'edge':2560})
        assert missing.status_code==422,missing.text


@pytest.mark.parametrize("edge", [640, 100000])
@pytest.mark.parametrize("used", [1_090_000_000, 3_000_000_000])
def test_detail_handoff_admission_precedes_source_work(tmp_path, monkeypatch, edge, used):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher import library_api, library_estimates, app_memory
    from hdr_finisher.media_browser import MediaBrowserStore
    path = photo(tmp_path)
    monkeypatch.setattr(library_estimates, "dimensions", lambda _: (7952, 5304))
    monkeypatch.setattr(app_memory, "TARGET", 3_400_000_000)
    monkeypatch.setattr(app_memory, "snapshot", lambda **_: {"totalBytes": used})
    class NoSource:
        def status(self): return {"paused": True}
        def submit_library(self, *a, **k): pytest.fail("Refused detail decoded source")
    app=FastAPI();app.include_router(library_api.create_library_router(NoSource(),MediaBrowserStore(tmp_path/'profile')))
    with TestClient(app) as api:
        plan=api.post('/api/library/live-plan',json={'path':str(path),'edge':edge})
        assert plan.status_code == 200, plan.text
        if edge == 640:
            assert plan.json()['detail_memory'] is None
        else:
            memory=plan.json()['detail_memory']
            assert memory['bytes'] == 7952*5304*24+65536
            assert memory['available'] is (used == 1_090_000_000)
            result=api.post('/api/library/live-scene',json={'path':str(path),'edge':edge,'gpu':True})
            if memory['available']:
                # Admission passed; the paused worker is the next gate.
                assert result.status_code == 202, result.text
            else:
                assert result.status_code == 409 and result.json()['needs_memory']


def test_next_photo_detail_releases_previous_frame_without_breaking_active_draw(tmp_path, monkeypatch):
    import gc, weakref
    from hdr_finisher import library_live
    service = LivePictures(tmp_path/'cache', None)
    def read(meta):
        return library_live._NativeFrame(session_id=meta['key'], image=np.ones((8,12,3),np.float32),
            sdr_reference_image=None, source=SimpleNamespace(path=meta['path']))
    monkeypatch.setattr(service, '_frame', read)
    first = service.frame(dict(edge=100000, key='first', path='first.arw'))
    reference = weakref.ref(first)
    assert service.release_other_frame('first.arw') is None
    old_timer = service._held_timer
    released = service.release_other_frame('next.arw')
    assert released == dict(key='first', path='first.arw', bytes=first.image.nbytes)
    # An already-running draw owns its reference until completion.
    assert reference() is first
    del first
    gc.collect()
    assert reference() is None and not service._native_frames
    next_frame = service.frame(dict(edge=100000, key='next', path='next.arw'))
    old_timer.function()  # A cancelled old callback cannot clear the new hold.
    assert service._held is next_frame
    service.release_other_frame('third.arw')
