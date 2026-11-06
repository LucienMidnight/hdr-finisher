from pathlib import Path
from fastapi import FastAPI, APIRouter
from fastapi.testclient import TestClient
from hdr_finisher import library_grants
from hdr_finisher.library_scheduler import Scheduler
from PIL import Image


def test_channel_queues_once_promotes_finishes_and_cleans_up_two_windows(tmp_path,monkeypatch):
    scheduler=Scheduler(2_500_000_000)
    scheduler.update(grade_bytes=4_000_000_000,grade_name="scan.dng",available=20_000_000_000,ram=32_000_000_000)
    monkeypatch.setattr(library_grants,"scheduler",scheduler)
    monkeypatch.delenv("HDR_FINISHER_DESKTOP_SECRET",raising=False)
    class Marks:
        def source_path(self,path):return Path(path)
    app=FastAPI();router=APIRouter();library_grants.add_routes(router,Marks());app.include_router(router)
    damaged=tmp_path/"damaged.jpg";damaged.write_bytes(b"bad header")
    small=tmp_path/"small.jpg";Image.new("RGB",(20,20)).save(small)
    with TestClient(app) as client,client.websocket_connect("/grants") as first:
        assert first.receive_json()["name"]=="scan.dng"
        first.send_json(dict(type="ask",id="large",path=str(damaged),priority=10))
        assert first.receive_json()["reason"]=="paused for Grade"
        with client.websocket_connect("/grants") as second:
            second.receive_json()
            second.send_json(dict(type="ask",id="small",path=str(small),priority=10))
            assert second.receive_json()["type"]=="granted"
            assert scheduler.jobs["small"].floor
            second.send_json(dict(type="heartbeat"));assert second.receive_json()["type"]=="heartbeat"
            second.send_json(dict(type="finish",id="small"))
            second.send_json(dict(type="heartbeat"));second.receive_json()
            assert "small" not in scheduler.jobs
        first.send_json(dict(type="cancel",id="large"))
        first.send_json(dict(type="heartbeat"));first.receive_json()
        assert not scheduler.jobs


def test_grade_retention_does_not_trigger_own_target_trims_but_os_pressure_does(monkeypatch):
    from hdr_finisher import app_memory
    monkeypatch.setattr(app_memory,"grade_bytes_provider",lambda:5_000_000_000)
    monkeypatch.setattr(app_memory,"process_tree",lambda root:[dict(workingSetBytes=6_000_000_000,chargedBytes=6_000_000_000)])
    monkeypatch.setattr(app_memory,"system_pressure",lambda:"none")
    assert app_memory.snapshot(refresh=True)["level"]=="none"
    monkeypatch.setattr(app_memory,"system_pressure",lambda:"critical")
    assert app_memory.snapshot(refresh=True)["level"]=="critical"


def test_measurement_failure_logs_once_and_keeps_estimate_admission(monkeypatch):
    from types import SimpleNamespace
    scheduler=Scheduler(2_500_000_000)
    monkeypatch.setattr(library_grants,"scheduler",scheduler)
    events=[]
    monkeypatch.setattr(library_grants,"log",lambda event,**fields:events.append((event,fields)))
    def unavailable(**kwargs):raise OSError("measurement unavailable")
    monkeypatch.setattr(library_grants.app_memory,"snapshot",unavailable)
    monkeypatch.setattr(library_grants.app_memory,"cache_snapshot",lambda:{})
    monkeypatch.setattr(library_grants,"detect_memory_resources",lambda:SimpleNamespace(available_ram_bytes=20_000_000_000,total_ram_bytes=32_000_000_000))
    runtime=library_grants.Runtime()
    runtime.sample();runtime.sample()
    job=scheduler.ask("small","window","photo.jpg","source",64_000_000,"now")
    assert job.granted is not None
    assert len(events)==1 and events[0][0]=="library_memory_unavailable"


def test_changed_source_response_is_not_logged_as_a_request_failure(monkeypatch):
    from fastapi import HTTPException
    from hdr_finisher import library_api
    events=[]
    monkeypatch.setattr(library_api,"log",lambda event,**fields:events.append(event))
    app=FastAPI();router=APIRouter(route_class=library_api.LibraryRoute)
    @router.post("/changed")
    def changed():raise HTTPException(409,"Photo or source settings changed during development.")
    app.include_router(router)
    with TestClient(app) as client:
        response=client.post("/changed")
    assert response.status_code==409 and response.json()["changed"]
    assert events==["request_changed"]

def test_backend_request_holds_cancelled_mezzanine_until_exit(monkeypatch):
    import asyncio
    import pytest
    s = Scheduler()
    s.update(available=20_000_000_000, ram=32_000_000_000)
    monkeypatch.setattr(library_grants, "scheduler", s)

    async def run():
        first = s.ask("first", "window", "first.tif", "source", 100_000_000)
        with pytest.raises(ValueError, match="decode stopped"):
            async with library_grants.backend_grant("first.tif", token=first.id):
                following = s.ask("following", "other-window", "following.tif", "cpu", 100_000_000)
                s.finish(first.id, "window", "cancelled")
                assert not s.valid(first.id, first.path)
                assert following.granted is None
                raise ValueError("decode stopped")
        assert following.granted is not None
        assert first.id not in s.jobs

    asyncio.run(run())
