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
        assert first.receive_json()=={"type":"grade-opening", "active":False}
        first.send_json(dict(type="ask",id="large",path=str(damaged),priority=10))
        assert first.receive_json()["reason"]=="paused for Grade"
        with client.websocket_connect("/grants") as second:
            second.receive_json()
            assert second.receive_json()=={"type":"grade-opening", "active":False}
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


def test_channel_reports_gpu_too_large_only_after_configured_budget_arrives(tmp_path, monkeypatch):
    from hdr_finisher import gpu_delivery, library_scheduler
    s = Scheduler()
    s.update(available=4_290_000_000, ram=8_000_000_000)
    monkeypatch.setattr(library_scheduler, 'scheduler', s)
    monkeypatch.setattr(library_grants, 'scheduler', s)
    monkeypatch.setattr(gpu_delivery, '_clients', {})
    monkeypatch.setattr(gpu_delivery, '_activity', dict(gpu_delivery._activity))
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, '')
    monkeypatch.delenv('HDR_FINISHER_DESKTOP_SECRET', raising=False)
    monkeypatch.setattr(library_grants, 'estimate_details',
                        lambda path, kind, ceiling, edge: (1_059_955_200 if kind == 'cpu' else 295_000_000, ''))
    app = FastAPI()
    app.include_router(gpu_delivery.create_gpu_delivery_router())
    router = APIRouter()
    library_grants.add_routes(router, type('Marks', (), {'source_path': staticmethod(Path)})())
    app.include_router(router)
    path = str(tmp_path / 'DSC04375.ARW')
    with TestClient(app) as client, client.websocket_connect('/grants') as window:
        assert window.receive_json()['type'] == 'grade'
        assert window.receive_json()['type'] == 'grade-opening'
        assert client.get('/api/delivery/gpu/permit').json()['budget'] == 512*1024**2
        window.send_json(dict(type='ask', id='gpu', path=path, gpu_bytes=2_109_988_864, gpu_unified=True))
        assert window.receive_json()['reason'] == 'system reserve'
        for payload in ({'id': 'grade'}, {'id': 'grade', 'budget': 0}):
            assert client.post('/api/delivery/gpu/activity', json=payload).status_code == 200
            window.send_json(dict(type='heartbeat'))
            assert window.receive_json()['type'] == 'heartbeat' and 'gpu' in s.jobs
        assert client.post('/api/delivery/gpu/activity', json={'id': 'grade', 'budget': 2**31, 'bytes': 17}).status_code == 200
        refusal = window.receive_json()
        assert (refusal['type'], refusal['id']) == ('gpu-too-large', 'gpu')
        assert 'gpu' not in s.jobs and s.gpu_reserved() == 0
        window.send_json(dict(type='ask', id='cpu', path=path, kind='cpu'))
        granted = window.receive_json()
        assert (granted['type'], granted['id'], granted['estimate'], granted['gpu_bytes']) == ('granted', 'cpu', 1_059_955_200, 0)
        window.send_json(dict(type='finish', id='cpu'))
        window.send_json(dict(type='heartbeat'))
        assert window.receive_json()['type'] == 'heartbeat' and not s.jobs
        gpu_delivery._clients['grade']['expires'] = 0
        assert client.get('/api/delivery/gpu/permit').json()['budget'] == 512*1024**2
        window.send_json(dict(type='ask', id='new-gpu', path=path, gpu_bytes=2_109_988_864, gpu_unified=True))
        assert window.receive_json()['reason'] == 'system reserve' and 'new-gpu' in s.jobs
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


def test_independent_census_retries_a_complete_walk_and_keeps_observing(tmp_path, monkeypatch, capsys):
    import os
    import runpy
    import sys
    import time
    from types import SimpleNamespace
    from hdr_finisher import app_memory, resource_preflight

    row = dict(pid=12, parentPid=11, name='app', chargedBytes=123, workingSetBytes=456)
    outcomes = iter([PermissionError('child exited'), [row], [row], []])
    def census(root):
        value = next(outcomes)
        if isinstance(value, Exception):
            raise value
        return value
    monkeypatch.setattr(app_memory, 'process_tree', census)
    monkeypatch.setattr(resource_preflight, 'detect_memory_resources', lambda: SimpleNamespace(available_ram_bytes=4_000_000_000, total_ram_bytes=8_000_000_000))
    monkeypatch.setattr(time, 'sleep', lambda delay: None)
    monkeypatch.setattr(sys, 'argv', ['measure-library-processes.py', '11', '.25'])
    runpy.run_path(str(Path(__file__).resolve().parents[1] / 'tools/measure-library-processes.py'))
    import json
    output = capsys.readouterr()
    samples = [json.loads(line) for line in output.out.splitlines()]
    assert [sample['censusRetries'] for sample in samples] == [1, 0]
    assert all(sample['totalBytes'] == 123 for sample in samples)
    assert not output.err
