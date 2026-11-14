"""Failed pictures are durable cache results, never repeated decoder jobs."""
from concurrent.futures import CancelledError
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_picture_errors import PictureErrors
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.sessions import SessionStore


class Helper:
    def __init__(self):
        self.calls = []

    def status(self):
        return {"running": True, "paused": False, "pending": 0, "failure": None}

    def submit_library(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        raise AssertionError("Invalid saved edits must be rejected before a decoder starts")


def client(root, helper):
    app = FastAPI()
    app.include_router(create_library_router(helper, MediaBrowserStore(root), SessionStore()))
    return TestClient(app)


@pytest.fixture
def broken(tmp_path):
    path = tmp_path / "broken.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    root = tmp_path / "app"
    marks = LibraryMarks(root)
    marks.change([path], MarkChange(rating=4, add_tag="keep"))
    marks.album_create("Keep album", [path])
    marks.writer.drain()
    sidecar = Path(str(path) + ".hdrf")
    document = json.loads(sidecar.read_text())
    document["grade"] = SessionStore().prepare_session(path, owns_source_path=False).edit_document().model_dump(mode="json")
    # A value no version can read. (A setting a later version removed is not
    # an error: saved grades drop what they no longer know.)
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 999
    sidecar.write_text(json.dumps(document), encoding="utf-8")
    return root, path, sidecar


def warning_record(api, path):
    response = api.post("/api/library/live-plan", json={"path": str(path)})
    assert response.status_code == 200, response.text
    return next(item for item in api.get("/api/library/health").json()["picture_errors"] if item["path"] == str(path))


def test_grade_with_settings_a_newer_version_removed_still_shows_a_picture(tmp_path):
    path = tmp_path / "old.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    root = tmp_path / "app"
    marks = LibraryMarks(root)
    marks.change([path], MarkChange(rating=2))
    marks.writer.drain()
    sidecar = Path(str(path) + ".hdrf")
    document = json.loads(sidecar.read_text())
    grade = SessionStore().prepare_session(path, owns_source_path=False).edit_document().model_dump(mode="json")
    # Lift/Gamma/Gain and Shadow were removed on 2026-10-27; old sidecars still carry them.
    grade["global_adjustments"]["hdr"].update(lift=0.1, gamma=0.5, gain=-0.2, shadow_lift=0.2, primaries_section_enabled=True)
    grade["global_adjustments"]["sdr"].update(shadow=0.3, lift_pivot=-2.0)
    document["grade"] = grade
    sidecar.write_text(json.dumps(document), encoding="utf-8")
    api = client(root, Helper())
    response = api.post("/api/library/live-plan", json={"path": str(path)})
    assert response.status_code == 200, response.text
    assert api.get("/api/library/health").json()["picture_errors"][0]["grade_warning"]


def test_remembered_error_is_retried_when_the_readable_settings_change(broken, monkeypatch):
    root, path, _ = broken
    api = client(root, Helper())
    assert api.post("/api/library/live-plan", json={"path": str(path)}).status_code == 200
    assert api.get("/api/library/health").json()["picture_errors"]
    import hdr_finisher.library_picture_errors as errors
    monkeypatch.setattr(errors, "_READER", "a later version")
    assert not api.get("/api/library/health").json()["picture_errors"]


def test_grade_warnings_do_not_block_plans_and_other_photos_continue(broken):
    root, path, _ = broken
    helper = Helper(); api = client(root, helper)
    record = warning_record(api, path)
    assert record["grade_warning"] and "HDR Tone" in record["details"]
    assert warning_record(api, path) == record
    other = path.with_name("healthy.png")
    Image.new("RGB",(64,32)).save(other)
    assert api.post("/api/library/live-plan",json={"path":str(other)}).status_code == 200
    assert helper.calls == []
    assert warning_record(client(root,helper),path) == record


def test_leave_as_is_survives_restart_without_touching_grade(broken):
    root,path,sidecar=broken
    before=sidecar.read_bytes(); api=client(root,Helper())
    record=warning_record(api,path)
    command={"path":str(path),"revision":record["revision"],"action":"leave"}
    assert api.post("/api/library/picture-error",json=command).status_code==200
    assert warning_record(client(root,Helper()),path)["grade_warning"]
    assert sidecar.read_bytes()==before


def test_revert_preserves_original_marks_and_previous_grade_and_requeues(broken):
    root, path, sidecar = broken
    source = path.read_bytes()
    previous = json.loads(sidecar.read_text())["grade"]
    api = client(root, Helper())
    record = warning_record(api, path)
    response = api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "original"})
    assert response.status_code == 200, response.text
    assert response.json()["count"] == 1
    marks = LibraryMarks(root)
    from hdr_finisher.library_grades import LibraryGrades
    LibraryGrades(marks, SessionStore())
    marks.writer.drain()
    saved = json.loads(sidecar.read_text())
    assert saved.get("grade") is None
    assert saved["marks"]["rating"] == 4 and saved["marks"]["tags"] == ["keep"]
    assert marks.album_paths("Keep album") == [str(path)]
    state = json.loads(marks._query("SELECT state FROM photo_grades WHERE path=?", (str(path),))[0][0])
    assert state["previous_grade"] == previous
    assert path.read_bytes() == source
    assert api.post("/api/library/live-plan", json={"path": str(path)}).status_code == 200


def test_changed_settings_expire_error_and_stale_reset_cannot_overwrite_them(broken):
    root, path, sidecar = broken
    api = client(root, Helper())
    record = warning_record(api, path)
    document = json.loads(sidecar.read_text())
    document["grade"]["global_adjustments"]["hdr"]["exposure"] = 0
    sidecar.write_text(json.dumps(document), encoding="utf-8")
    assert api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "original"}).status_code == 409
    assert api.post("/api/library/live-plan", json={"path": str(path)}).status_code == 200
    assert not api.get("/api/library/health").json()["picture_errors"]


@pytest.mark.parametrize("error", [CancelledError(), RuntimeError("helper restarting"), ValueError("Insufficient memory"), ValueError("Import cancelled"), ValueError("Source preparation expired or was invalidated")])
def test_interruptions_and_resource_failures_are_not_remembered(tmp_path, error):
    from types import SimpleNamespace
    import asyncio
    errors = PictureErrors(LibraryMarks(tmp_path))
    @errors.guard
    async def operation(command):
        raise error
    with pytest.raises(Exception):
        asyncio.run(operation(SimpleNamespace(path=str(tmp_path / "photo.png"))))
    assert errors.all() == []


def test_pending_reset_and_source_changes_invalidate_inflight_errors(broken):
    from fastapi import HTTPException
    from hdr_finisher.library_grades import LibraryGrades
    root, path, _ = broken
    marks = LibraryMarks(root)
    grades = LibraryGrades(marks, SessionStore())
    errors = PictureErrors(marks)
    revision = errors.revision(path)
    grades._put(str(path), {"pending": True, "desired": None})
    with pytest.raises(HTTPException) as error:
        errors.remember(path, ValueError("old failed grade"), revision)
    assert error.value.status_code == 409
    errors.remember(path, ValueError("failed source"), errors.revision(path))
    path.write_bytes(path.read_bytes() + b"changed")
    assert errors.get(path) is None


def test_two_real_decoder_failures_release_helper_for_next_photo(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from hdr_finisher.library_worker import LibraryWorker
    root = tmp_path / "app"
    bad = [tmp_path / f"bad-{i}.png" for i in range(2)]
    for path in bad:
        path.write_bytes(b"broken image")
    good = tmp_path / "good.png"
    Image.new("RGB", (64, 32), (90, 120, 130)).save(good)
    worker = LibraryWorker(root)
    try:
        api = client(root, worker)
        def load(path):
            return api.post("/api/library/live-scene", json={"path": str(path), "gpu": False})
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(load, [*bad, good]))
        assert [response.status_code for response in results] == [422, 422, 200]
        assert worker.status()["pending"] == 0
        assert len(api.get("/api/library/health").json()["picture_errors"]) == 2
        assert load(bad[0]).status_code == 422
        assert worker.status()["pending"] == 0
    finally:
        worker.close()

def test_renderer_development_failure_is_remembered_until_explicit_retry(tmp_path):
    path = tmp_path / "photo.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    helper = Helper()
    api = client(tmp_path / "app", helper)
    reason = "Development stopped after 3 attempts: Invalid source data."
    identity = api.post("/api/library/live-plan", json={"path": str(path), "edge": 640}).json()["source_identity"]
    response = api.post("/api/library/development-error", json={"path": str(path), "source_identity": identity, "reason": reason})
    assert response.status_code == 200, response.text
    record = response.json()["error"]
    # People read plain words; the diagnostic stays under Error details.
    assert record["reason"] == reason
    assert record["details"] == reason
    blocked = api.post("/api/library/live-scene", json={"path": str(path), "edge": 640})
    assert blocked.status_code == 422
    assert blocked.json()["library_error"]["reason"] == record["reason"]
    assert not helper.calls
    retry = api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "retry"})
    assert retry.status_code == 200, retry.text
    assert not api.get("/api/library/health").json()["picture_errors"]

def test_failed_old_development_does_not_mark_changed_source_failed(tmp_path):
    path = tmp_path / "photo.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    api = client(tmp_path / "app", Helper())
    identity = api.post("/api/library/live-plan", json={"path": str(path), "edge": 640}).json()["source_identity"]
    path.write_bytes(path.read_bytes() + b"changed")
    response = api.post("/api/library/development-error", json={"path": str(path), "source_identity": identity, "reason": "Old development failed"})
    assert response.status_code == 409
    assert not api.get("/api/library/health").json()["picture_errors"]


def test_disconnected_read_is_offline_without_a_broken_photo_receipt(tmp_path):
    import errno
    from pydantic import BaseModel
    class PhotoRequest(BaseModel):
        path: str
    path = tmp_path / 'photo.jpg'; path.write_bytes(b'photo')
    marks = LibraryMarks(tmp_path / 'profile')
    errors = PictureErrors(marks)
    offline = [True]
    app = FastAPI()
    @app.post('/read')
    @errors.guard
    def read(command: PhotoRequest):
        if offline[0]: raise OSError(errno.ENODEV, 'simulated device disconnected')
        return {'ready': True}
    with TestClient(app) as api:
        result = api.post('/read', json={'path': str(path)})
        assert result.status_code == 503 and result.json()['offline']
        assert errors.all() == []
        offline[0] = False
        assert api.post('/read', json={'path': str(path)}).json() == {'ready': True}
        assert errors.all() == []


def test_corrupt_image_is_distinct_from_offline_device(tmp_path):
    import errno
    from hdr_finisher.library_picture_errors import source_offline
    assert not source_offline(OSError('corrupt pixels'), tmp_path / 'a.jpg')
    assert not source_offline(FileNotFoundError(errno.ENOENT, 'deleted file'), tmp_path / 'a.jpg')
    assert source_offline(FileNotFoundError(errno.ENOENT, 'missing folder'), tmp_path / 'removed' / 'a.jpg')


def test_timeout_returns_retryable_response_without_broken_photo_receipt(tmp_path):
    from concurrent.futures import Future
    from hdr_finisher.library_worker import DecoderTimeout
    class TimedOutHelper(Helper):
        def submit_library(self,*args,**kwargs):
            future=Future()
            future.set_exception(DecoderTimeout("This photo took too long. Try again."))
            return "timeout-job",future
        submit_browse_picture=submit_library
        def cancel(self,job): pass
    path=tmp_path/"photo.png"
    Image.new("RGB",(64,32),(100,120,80)).save(path)
    api=client(tmp_path/"profile",TimedOutHelper())
    response=api.post("/api/library/picture",json={"path":str(path),"edge":640})
    assert response.status_code==408,response.text
    assert response.json()["library_timeout"] is True
    assert api.get("/api/library/health").json()["picture_errors"]==[]

def test_untagged_exr_plan_is_not_a_broken_photo(tmp_path, monkeypatch):
    # Untagged colour is assumed (linear Rec.709), never remembered as a failure.
    import OpenEXR, numpy as np
    path=tmp_path/"unknown.exr"
    out=OpenEXR.OutputFile(str(path),OpenEXR.Header(2,2))
    out.writePixels({c:np.zeros(4,np.float32).tobytes() for c in "RGB"});out.close()
    from hdr_finisher import loader
    monkeypatch.setattr(loader,"_load_exr",lambda *a,**k:pytest.fail("plan decoded pixels"))
    helper=Helper()
    with client(tmp_path/"profile",helper) as api:
        result=api.post("/api/library/live-plan",json={"path":str(path),"edge":640})
        assert result.status_code==200,result.text
        assert api.get("/api/library/health").json()["picture_errors"]==[]
    assert not helper.calls


def test_development_failures_show_plain_words_and_keep_the_diagnostic():
    from hdr_finisher.library_picture_errors import plain_development_reason
    internal="RGB transfer ST2084 retains Grade's CPU normalization"
    plain=plain_development_reason(internal)
    assert "Grade's" not in plain and "retain" not in plain and "CPU" not in plain
    assert plain_development_reason("Not supported: X-Trans sensor development is not available in the Library.")\
        .startswith("Not supported: X-Trans")


def test_failure_saved_by_an_older_version_is_retried(tmp_path, monkeypatch):
    # Nov 2: TIFFs kept a failure saved before assumed colour existed.
    path = tmp_path / "photo.png"
    Image.new("RGB", (64, 32), (100, 120, 80)).save(path)
    api = client(tmp_path / "app", Helper())
    identity = api.post("/api/library/live-plan", json={"path": str(path), "edge": 640}).json()["source_identity"]
    from hdr_finisher import library_picture_errors
    monkeypatch.setattr(library_picture_errors, "_READER", "an older version")
    assert api.post("/api/library/development-error", json={"path": str(path), "source_identity": identity, "reason": "old failure"}).status_code == 200
    assert api.get("/api/library/health").json()["picture_errors"]
    monkeypatch.undo()
    assert not api.get("/api/library/health").json()["picture_errors"]


def test_virtual_copy_warnings_survive_health_cleanup_and_clear_after_repair(broken):
    root,path,sidecar=broken
    document=json.loads(sidecar.read_text())
    damaged=document.pop('grade')
    healthy=SessionStore().prepare_session(path,owns_source_path=False).edit_document().model_dump(mode='json')
    newer={**healthy,'app_version':'99.0.0'}
    document['virtual_copies']=[dict(photo_id=key,name=key,marks={},grade=grade)
        for key,grade in [('damaged',damaged),('unreadable','unreadable grade'),('newer',newer)]]
    sidecar.write_text(json.dumps(document),encoding='utf-8')
    before=path.read_bytes();saved=sidecar.read_bytes()
    api=client(root,Helper())
    keys=[str(path)+'|copy|'+item['photo_id'] for item in document['virtual_copies']]
    for key in keys:
        result=api.post('/api/library/live-plan',json={'path':key})
        assert result.status_code==200,result.text
    for _ in range(2):
        warnings=api.get('/api/library/health').json()['picture_errors']
        assert {record['path'] for record in warnings}==set(keys)
        assert all(record['grade_warning'] for record in warnings)
    assert path.read_bytes()==before and sidecar.read_bytes()==saved
    for item in document['virtual_copies']: item['grade']=healthy
    sidecar.write_text(json.dumps(document),encoding='utf-8')
    assert api.get('/api/library/health').json()['picture_errors']==[]
    for key in keys:
        assert api.post('/api/library/live-plan',json={'path':key}).status_code==200
    assert api.get('/api/library/health').json()['picture_errors']==[]
    assert path.read_bytes()==before


def test_virtual_copy_warning_disappears_when_its_source_is_deleted(tmp_path):
    path=tmp_path/'photo.png'; Image.new('RGB',(8,4)).save(path)
    marks=LibraryMarks(tmp_path/'profile'); errors=PictureErrors(marks)
    key=str(path)+'|copy|copy-id'
    errors.remember(key,ValueError('damaged'),errors.revision(key))
    assert [record['path'] for record in errors.all()]==[key]
    path.unlink()
    assert errors.all()==[]


@pytest.mark.parametrize("reason", ["Library upload timed out.", "Library grant expired; request it again.",
    "Library request cancelled.", "Waiting for memory", "Save stalled"])
def test_recoverable_renderer_failure_never_blocks_next_open(tmp_path, reason):
    from hdr_finisher.library_picture_errors import temporary_development_failure
    path=tmp_path/"photo.png"; Image.new("RGB",(8,4)).save(path)
    api=client(tmp_path/"app",Helper())
    identity=api.post("/api/library/live-plan",json={"path":str(path)}).json()["source_identity"]
    assert temporary_development_failure(reason)
    result=api.post("/api/library/development-error",json={"path":str(path),"source_identity":identity,"reason":reason})
    assert result.json()["temporary"]
    assert api.get("/api/library/health").json()["picture_errors"]==[]
    assert api.post("/api/library/live-plan",json={"path":str(path)}).status_code==200


@pytest.mark.parametrize("reason", ["Library upload timed out.", "Library grant expired", "Save stalled", "Operation aborted", "Library helper stopped after repeated problems.", "Library decoder time limit exceeded"])
def test_temporary_wording_and_guard_do_not_write_a_receipt(tmp_path, reason):
    import asyncio
    from types import SimpleNamespace
    from fastapi import HTTPException
    from hdr_finisher.library_picture_errors import plain_development_reason
    errors=PictureErrors(LibraryMarks(tmp_path))
    assert plain_development_reason(reason)=="Couldn't finish preparing this photo. Try again."
    @errors.guard
    def fail(command): raise ValueError(reason)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(fail(SimpleNamespace(path=str(tmp_path/"photo.png"))))
    assert caught.value.status_code==503
    assert errors.all()==[]


def test_single_attempt_wording_does_not_claim_repeated_attempts():
    from hdr_finisher.library_picture_errors import plain_development_reason
    reason="Development stopped after 1 attempt: Invalid source data."
    assert plain_development_reason(reason)==reason


def test_new_source_route_reconsiders_old_failure_without_changing_photo(tmp_path, monkeypatch):
    from hdr_finisher import library_picture_errors as module
    path = tmp_path / "photo.png"
    Image.new("RGB", (32, 24), (100, 120, 80)).save(path)
    marks = LibraryMarks(tmp_path / "app")
    marks.change([path], MarkChange(rating=4, add_tag="keep"))
    marks.writer.drain()
    sidecar = Path(str(path) + ".hdrf")
    document = json.loads(sidecar.read_text())
    grade = SessionStore().prepare_session(path, owns_source_path=False).edit_document().model_dump(mode="json")
    grade["global_adjustments"]["hdr"]["exposure"] = 1.25
    document["grade"] = grade
    sidecar.write_text(json.dumps(document))
    original = sidecar.read_bytes()
    errors = PictureErrors(marks)
    current = module._READER
    monkeypatch.setattr(module, "_READER", "old-unsupported-gpu-route")
    errors.remember(path, ValueError("DNG GPU warp requires a mosaiced DNG with mandatory corrections"), errors.revision(path))
    assert errors.get(path) is not None
    monkeypatch.setattr(module, "_READER", current)
    assert errors.get(path) is None
    assert sidecar.read_bytes() == original


@pytest.mark.parametrize("reason", [
    "System memory could not be measured. Large-file safety cannot be confirmed for this 8,000 x 6,000 Experimental DNG.",
    "Opening this 8,000 x 6,000 Experimental DNG is estimated to require 1.2 GiB of additional memory; only 0.5 GiB is safely available.",
    "1 validation error for saved settings: memory limit is invalid",
    "cannot identify image file memory.png",
])
def test_deterministic_refusal_runs_once_releases_grant_and_allows_explicit_retry(tmp_path, monkeypatch, reason):
    import asyncio
    from types import SimpleNamespace
    from hdr_finisher import library_grants
    from hdr_finisher.library_scheduler import Scheduler
    errors = PictureErrors(LibraryMarks(tmp_path / "app"))
    path = tmp_path / "photo.png"
    Image.new("RGB", (8, 4)).save(path)
    scheduler = Scheduler(2_500_000_000)
    monkeypatch.setattr(library_grants, "scheduler", scheduler)
    calls = []
    @errors.guard
    async def prepare(command):
        async with library_grants.backend_grant(command.path):
            calls.append(command.path)
            raise ValueError(reason)
    command = SimpleNamespace(path=str(path))
    for _ in range(4):
        assert asyncio.run(prepare(command)).status_code == 422
        assert not scheduler.jobs
    assert len(calls) == 1
    errors.clear(path)  # Existing folder refresh / user retry action.
    assert asyncio.run(prepare(command)).status_code == 422
    assert len(calls) == 2
    path.write_bytes(path.read_bytes() + b"changed")
    assert asyncio.run(prepare(command)).status_code == 422
    assert len(calls) == 3
    assert not scheduler.jobs


def test_helper_preflight_refusal_is_returned_once_through_live_scene_api(tmp_path):
    from concurrent.futures import Future
    from hdr_finisher.media_browser import MediaBrowserError
    class RefusedHelper(Helper):
        def submit_library(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            future = Future()
            future.set_exception(MediaBrowserError("Opening this Experimental DNG is estimated to require 1.63 GiB of additional memory; only 0.00 GiB is safely available."))
            return "refused-job", future
        def cancel(self, job):
            pass
        def prioritize(self, job, priority):
            pass
    path = tmp_path / "photo.png"
    Image.new("RGB", (8, 4)).save(path)
    helper = RefusedHelper()
    api = client(tmp_path / "app", helper)
    for _ in range(3):
        result = api.post("/api/library/live-scene", json={"path": str(path), "gpu": False})
        assert result.status_code == 422, result.text
        assert "safely available" in result.json()["library_error"]["details"]
    assert len(helper.calls) == 1
    record = result.json()["library_error"]
    assert api.post("/api/library/picture-error", json={"path": str(path), "revision": record["revision"], "action": "retry"}).status_code == 200
    assert api.post("/api/library/live-scene", json={"path": str(path), "gpu": False}).status_code == 422
    assert len(helper.calls) == 2


def test_cache_probe_reports_the_refusal_without_hiding_an_original_picture(tmp_path):
    path = tmp_path / 'photo.png'
    Image.new('RGB', (64, 32), (100, 120, 80)).save(path)
    helper = Helper()
    with client(tmp_path / 'app', helper) as api:
        plan = api.post('/api/library/live-plan', json={'path': str(path), 'edge': 640}).json()
        record = api.post('/api/library/development-error', json={'path': str(path), 'source_identity': plan['source_identity'], 'reason': 'Opening this DNG is estimated to require 1.63 GiB; only 1.52 GiB is safely available.'}).json()['error']
        for _ in range(2):
            result = api.post('/api/library/live-plan', json={'path': str(path), 'edge': 640})
            assert result.status_code == 200
            assert result.json()['original_file'] is True
            assert result.json()['development_error']['revision'] == record['revision']
    assert not helper.calls
