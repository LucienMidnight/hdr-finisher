from threading import Event

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher.import_jobs import ImportJobManager
from hdr_finisher.import_opening import add_opening_routes
from hdr_finisher.library_scheduler import Scheduler
from hdr_finisher.models import RawImportSettings


@pytest.mark.parametrize("release", ["disconnect", "retire", "cancel", "close"])
def test_opening_loss_keeps_native_work_charged_until_it_unwinds(tmp_path, monkeypatch, release):
    scheduler = Scheduler()
    monkeypatch.setattr("hdr_finisher.library_scheduler.scheduler", scheduler)
    manager = ImportJobManager(None, None)
    entered, unwind = Event(), Event()

    def run(job, grant):
        entered.set()
        assert unwind.wait(5)
        job.session_id = "session"
        job.state = "ready"

    monkeypatch.setattr(manager, "_run", run)
    manager.connect_owner("renderer")
    job = manager.start(tmp_path / "photo.png", RawImportSettings(), opening_owner="renderer")
    try:
        assert entered.wait(3)
        job.session_id = "session"
        if release == "disconnect":
            manager.disconnect_owner("renderer")
        elif release == "retire":
            manager.retire("session")
        elif release == "cancel":
            manager.cancel(job.job_id)
        else:
            manager.close()
        assert scheduler.opening
        assert "grade-import-" + job.job_id in scheduler.jobs
    finally:
        unwind.set()
        manager._executor.shutdown(wait=True)
        manager.close()
    assert not scheduler.opening
    assert not scheduler.jobs


@pytest.mark.parametrize("release", ["disconnect", "retire", "presented"])
def test_ready_opening_is_released_without_a_renderer_picture(tmp_path, monkeypatch, release):
    scheduler = Scheduler()
    monkeypatch.setattr("hdr_finisher.library_scheduler.scheduler", scheduler)
    manager = ImportJobManager(None, None)

    def run(job, grant):
        job.session_id = "session"
        job.state = "ready"

    monkeypatch.setattr(manager, "_run", run)
    manager.connect_owner("renderer")
    job = manager.start(tmp_path / "photo.png", RawImportSettings(), opening_owner="renderer")
    try:
        manager._executor.submit(lambda: None).result(timeout=3)
        assert scheduler.opening
        if release == "disconnect":
            manager.disconnect_owner("renderer")
        elif release == "retire":
            manager.retire("session")
        else:
            assert manager.presented("session")
            assert manager.presented("session")
        assert not scheduler.opening
        assert not scheduler.jobs
    finally:
        manager.close()


def test_websocket_loss_retires_the_registered_renderer(monkeypatch):
    monkeypatch.delenv("HDR_FINISHER_DESKTOP_SECRET", raising=False)
    manager = ImportJobManager(None, None)
    app = FastAPI()
    add_opening_routes(app, manager)
    try:
        with TestClient(app) as client:
            with client.websocket_connect("/api/import-opening") as socket:
                owner = socket.receive_json()["owner"]
                assert owner in manager._owners
                socket.send_json({"type": "heartbeat"})
                assert socket.receive_json() == {"type": "heartbeat"}
            assert not manager._owners
    finally:
        manager.close()


def test_an_old_same_session_ack_cannot_release_a_new_import(tmp_path, monkeypatch):
    scheduler = Scheduler()
    monkeypatch.setattr("hdr_finisher.library_scheduler.scheduler", scheduler)
    manager = ImportJobManager(None, None)

    def run(job, grant):
        job.session_id = "session"
        job.state = "ready"

    monkeypatch.setattr(manager, "_run", run)
    try:
        first = manager.start(tmp_path / "photo.png", RawImportSettings())
        manager._executor.submit(lambda: None).result(timeout=3)
        second = manager.start(tmp_path / "photo.png", RawImportSettings())
        manager._executor.submit(lambda: None).result(timeout=3)
        assert not manager.presented("session", first.job_id)
        assert scheduler.opening
        assert manager.presented("session", second.job_id)
        assert not scheduler.opening
    finally:
        manager.close()


def test_renderer_heartbeat_expiry_releases_a_ready_opening(tmp_path, monkeypatch):
    import asyncio

    monkeypatch.delenv("HDR_FINISHER_DESKTOP_SECRET", raising=False)
    scheduler = Scheduler()
    monkeypatch.setattr("hdr_finisher.library_scheduler.scheduler", scheduler)
    manager = ImportJobManager(None, None)

    def run(job, grant):
        job.session_id = "session"
        job.state = "ready"

    monkeypatch.setattr(manager, "_run", run)
    app = FastAPI()
    add_opening_routes(app, manager)

    class Socket:
        headers = {}

        async def accept(self):
            pass

        async def send_json(self, message):
            manager.start(tmp_path / "photo.png", RawImportSettings(), opening_owner=message["owner"])
            manager._executor.submit(lambda: None).result(timeout=3)
            assert scheduler.opening

        async def receive_json(self):
            raise asyncio.TimeoutError()

    try:
        asyncio.run(app.routes[-1].endpoint(Socket()))
        assert not manager._owners
        assert not scheduler.opening
    finally:
        manager.close()
