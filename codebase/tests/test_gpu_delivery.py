"""Fast broker checks; the Electron driver checks real decoded GPU pixels."""
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import time
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher import gpu_delivery, delivery
from hdr_finisher.models import AdjustmentState, DenoiseDocumentSettings, ExportSettings


def test_paired_handoff_reuses_compatible_versions_and_proof_owner(tmp_path, monkeypatch):
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "policy.json")
    monkeypatch.delenv(delivery.FORCE_CPU_ENV, raising=False)
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app = FastAPI(); app.include_router(gpu_delivery.create_gpu_delivery_router())
    frame = SimpleNamespace(image=np.full((4,6,3), .18, dtype=np.float32), local_adjustments=[],
        adjustments=AdjustmentState(), denoise=DenoiseDocumentSettings())
    settings=ExportSettings()
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending=worker.submit(gpu_delivery.render_pair, frame, settings, frame.adjustments)
        deadline=time.monotonic()+5
        while True:
            job=client.get("/api/delivery/gpu/next").json()
            if job is not None: break
            assert time.monotonic()<deadline
            time.sleep(.01)
        for lane, value in (("hdr", .18), ("sdr", .3)):
            pixels=np.full((4,6,4), value, dtype="<f4").tobytes()
            assert client.post(f"/api/delivery/gpu/{job['id']}/pixels/{lane}", content=pixels).status_code==204
        assert client.post(f"/api/delivery/gpu/{job['id']}/complete", json={}).status_code==200
        pair=pending.result(timeout=5)
        np.testing.assert_allclose(pair["hdr"], .18)
        np.testing.assert_allclose(pair["sdr"], .3)
        proof=SimpleNamespace(**vars(frame)); proof.delivery_owner=frame
        compatible=ExportSettings(format="sdr_png")
        assert gpu_delivery.render_pair(proof, compatible, frame.adjustments) is pair
        assert proof._delivery_record=={"renderer":"gpu", "fallback_reason":None}
        assert client.get("/api/delivery/gpu/next").json() is None


def test_foreground_residency_is_shared_and_pause_is_priority(tmp_path, monkeypatch):
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app=FastAPI();app.include_router(gpu_delivery.create_gpu_delivery_router())
    with TestClient(app) as client:
        client.post("/api/delivery/gpu/activity",json={"id":"library", "bytes":20,"budget":1000,"active":False})
        value=client.post("/api/delivery/gpu/activity",json={"id":"grade", "bytes":30,"budget":1000,"active":True}).json()
        assert value["budget"]==980
        permit=client.get("/api/delivery/gpu/permit").json()
        assert permit["budget"]==950 and permit["preempt"] and not permit["ready"]
        client.post("/api/delivery/gpu/activity",json={"id":"grade", "bytes":30,"budget":1000,"active":False})
        assert client.get("/api/delivery/gpu/permit").json()["ready"]


def test_visible_picture_preempts_export_and_cancelled_requests_are_skipped(monkeypatch):
    import json
    from pathlib import Path
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app = FastAPI(); app.include_router(gpu_delivery.create_gpu_delivery_router())
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        frame = SimpleNamespace(image=np.full((4,6,3), .18, dtype=np.float32),
            local_adjustments=[], adjustments=AdjustmentState(), denoise=DenoiseDocumentSettings())
        pending = worker.submit(gpu_delivery.render_pair, frame, ExportSettings(), frame.adjustments)
        deadline = time.monotonic()+5
        while True:
            job = client.get("/api/delivery/gpu/next").json()
            if job is not None: break
            assert time.monotonic()<deadline
            time.sleep(.01)
        root = Path(gpu_delivery.os.environ[gpu_delivery.ROOT_ENV])
        visible = root / "delivery-visible"; visible.mkdir()
        (visible / "request.json").write_text(json.dumps({"priority":15,"created":0}))
        permit = client.get("/api/delivery/gpu/permit", params={"identity":job["id"]}).json()
        assert permit["preempt"] and "higher-priority" in permit["reason"]
        (visible / "cancelled").touch()
        assert not client.get("/api/delivery/gpu/permit", params={"identity":job["id"]}).json()["preempt"]
        client.post(f"/api/delivery/gpu/{job['id']}/complete", json={"error":"Released for visible picture."})
        assert pending.result(timeout=5) is None
        assert frame._delivery_record["fallback_reason"] == "Released for visible picture."
        assert client.get("/api/delivery/gpu/next").json() is None


def test_delivery_does_not_hold_the_blanket_library_pause(monkeypatch):
    from contextlib import contextmanager
    from hdr_finisher import main
    pauses=[]
    @contextmanager
    def busy():
        pauses.append(True)
        yield
    monkeypatch.setattr(main, "library_worker", SimpleNamespace(busy=busy))
    monkeypatch.setattr(main, "desktop_authoring_secret", "")
    app=FastAPI()
    app.add_middleware(main.DesktopRequestBoundary)
    @app.post("/api/session/{identity}/{operation:path}")
    def operation(identity, operation): return {}
    with TestClient(app) as client:
        assert client.post("/api/session/photo/export").status_code==200
        assert client.post("/api/session/photo/proof/artifact").status_code==200
        assert pauses==[]
        assert client.post("/api/session/photo/adjustments").status_code==200
        assert pauses==[True]


def _broker(tmp_path, monkeypatch):
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "policy.json")
    monkeypatch.delenv(delivery.FORCE_CPU_ENV, raising=False)
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app = FastAPI(); app.include_router(gpu_delivery.create_gpu_delivery_router())
    return app


def _frame(priority=20):
    return SimpleNamespace(image=np.full((4,6,3), .18, dtype=np.float32), local_adjustments=[],
        adjustments=AdjustmentState(), denoise=DenoiseDocumentSettings(), delivery_priority=priority)


def test_a_queued_job_waits_past_the_render_deadline_and_still_uses_the_gpu(tmp_path, monkeypatch):
    # Waiting behind other delivery work is not a GPU failure (Steve's batch
    # fell back to the CPU while visible Library pictures held the queue).
    app = _broker(tmp_path, monkeypatch)
    monkeypatch.setattr(gpu_delivery, "RENDER_DEADLINE_SECONDS", .2)
    frame = _frame()
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending = worker.submit(gpu_delivery.render_pair, frame, ExportSettings(), frame.adjustments)
        end = time.monotonic() + .6
        while time.monotonic() < end:
            client.get("/api/delivery/gpu/permit")
            time.sleep(.05)
        assert not pending.done()
        job = client.get("/api/delivery/gpu/next").json()
        for lane in ("hdr", "sdr"):
            client.post(f"/api/delivery/gpu/{job['id']}/pixels/{lane}", content=np.full((4,6,4), .18, dtype="<f4").tobytes())
        client.post(f"/api/delivery/gpu/{job['id']}/complete", json={})
        assert pending.result(timeout=5) is not None
        assert frame._delivery_record == {"renderer": "gpu", "fallback_reason": None}


def test_a_claimed_job_past_the_render_deadline_falls_back(tmp_path, monkeypatch):
    app = _broker(tmp_path, monkeypatch)
    monkeypatch.setattr(gpu_delivery, "RENDER_DEADLINE_SECONDS", .2)
    frame = _frame()
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending = worker.submit(gpu_delivery.render_pair, frame, ExportSettings(), frame.adjustments)
        while client.get("/api/delivery/gpu/next").json() is None: time.sleep(.01)
        end = time.monotonic() + 3
        while not pending.done() and time.monotonic() < end:
            client.get("/api/delivery/gpu/permit"); time.sleep(.05)
        assert pending.result(timeout=1) is None
        assert frame._delivery_record["renderer"] == "cpu"


def test_waiting_export_gets_the_gpu_before_newer_visible_library_pictures(tmp_path, monkeypatch):
    app = _broker(tmp_path, monkeypatch)
    with TestClient(app) as client, gpu_delivery.DeliveryMemory() as memory:
        client.get("/api/delivery/gpu/permit")
        root = gpu_delivery.Path(gpu_delivery.os.environ[gpu_delivery.ROOT_ENV])
        now = time.time()
        for name, priority, created in (("delivery-export", 20, now - 60), ("delivery-library", 15, now)):
            directory = root / name; directory.mkdir()
            description, _ = memory.allocate((4,6,3), np.zeros((4,6,3), np.float32))
            gpu_delivery._atomic(directory / "request.json", {"memory": {"source": description, "reference": None}, "id": name, "width": 6, "height": 4, "output": [6, 4], "white": 203,
                "adjustments": AdjustmentState().model_dump(mode="json"), "locals": [], "denoise": DenoiseDocumentSettings().model_dump(mode="json"),
                "finishing": {}, "priority": priority, "created": created})
        assert client.get("/api/delivery/gpu/next").json()["id"] == "delivery-export"


def test_finished_and_stale_spools_are_removed(tmp_path, monkeypatch):
    app = _broker(tmp_path, monkeypatch)
    import os
    with TestClient(app) as client:
        client.get("/api/delivery/gpu/permit")
        root = gpu_delivery.Path(gpu_delivery.os.environ[gpu_delivery.ROOT_ENV])
        old = time.time() - 3600
        finished = root / "delivery-finished"; finished.mkdir()
        (finished / "result.json").write_text("{}"); (finished / "hdr.bin").write_bytes(b"x" * 16)
        os.utime(finished / "result.json", (old, old))
        fresh = root / "delivery-fresh"; fresh.mkdir(); (fresh / "result.json").write_text("{}")
        client.get("/api/delivery/gpu/permit")
        assert not finished.exists() and fresh.exists()
    stale = root.parent / "hdr-gpu-delivery-stale-test"; stale.mkdir(exist_ok=True)
    (stale / "heartbeat").touch(); os.utime(stale / "heartbeat", (old, old))
    _broker(tmp_path, monkeypatch)
    assert not stale.exists()


def test_a_preempted_job_returns_to_the_queue_instead_of_falling_back(tmp_path, monkeypatch):
    # Steve's batch photos were rendered on the CPU whenever a visible Library
    # picture arrived; giving the GPU up is not a GPU failure.
    app = _broker(tmp_path, monkeypatch)
    frame = _frame()
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending = worker.submit(gpu_delivery.render_pair, frame, ExportSettings(), frame.adjustments)
        while (job := client.get("/api/delivery/gpu/next").json()) is None: time.sleep(.01)
        client.post(f"/api/delivery/gpu/{job['id']}/complete", json={"error": "A higher-priority delivery needs the GPU."})
        deadline = time.monotonic() + 5
        while (again := client.get("/api/delivery/gpu/next").json()) is None:
            assert time.monotonic() < deadline and not pending.done()
            client.get("/api/delivery/gpu/permit"); time.sleep(.01)
        assert again["id"] == job["id"]
        for lane in ("hdr", "sdr"):
            client.post(f"/api/delivery/gpu/{again['id']}/pixels/{lane}", content=np.full((4,6,4), .18, dtype="<f4").tobytes())
        client.post(f"/api/delivery/gpu/{again['id']}/complete", json={})
        assert pending.result(timeout=5) is not None
        assert frame._delivery_record == {"renderer": "gpu", "fallback_reason": None}


def test_memory_job_has_no_pixel_files_and_rejects_incomplete_lanes(tmp_path, monkeypatch):
    import json
    from multiprocessing.shared_memory import SharedMemory
    import pytest
    app = _broker(tmp_path, monkeypatch)
    frame = _frame()
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending = worker.submit(gpu_delivery.render_pair, frame, ExportSettings(), frame.adjustments)
        while (job := client.get("/api/delivery/gpu/next").json()) is None:
            time.sleep(.01)
        assert "memory" not in job
        directory = gpu_delivery.Path(gpu_delivery.os.environ[gpu_delivery.ROOT_ENV]) / job["id"]
        record = json.loads((directory / "request.json").read_text())
        assert {path.name for path in directory.iterdir()} == {"request.json", "claimed"}
        np.testing.assert_array_equal(gpu_delivery.session(job["id"]).image, frame.image)
        assert client.post(f"/api/delivery/gpu/{job['id']}/pixels/hdr", content=b"short").status_code == 400
        client.post(f"/api/delivery/gpu/{job['id']}/complete", json={})
        assert pending.result(timeout=5) is None
        assert "incomplete lanes" in frame._delivery_record["fallback_reason"]
        assert not directory.exists()
        for description in record["memory"].values():
            if description:
                with pytest.raises(FileNotFoundError):
                    SharedMemory(name=description["name"])


def test_raw_job_keeps_sensor_and_developed_pixels_in_memory(tmp_path, monkeypatch):
    from hdr_finisher import library_gpu_raw
    from hdr_finisher.models import EditDocument, SourceReference, SourceLuminanceDescriptor
    app = _broker(tmp_path, monkeypatch)
    photo = tmp_path / "camera.ARW"; photo.write_bytes(b"sensor fixture")
    document = EditDocument(hdr_reference_white_nits=203, source=SourceReference(filename=photo.name,
        luminance=SourceLuminanceDescriptor(luminance_semantics="scene_relative", transfer_function="linear")))
    stat = photo.stat()
    header = {"width": 6, "height": 4, "flip": 6, "identity": [stat.st_size, stat.st_mtime_ns]}
    seen = []
    def sensor(path, settings):
        seen.append(settings)
        return header, [b"sensor!!"]
    monkeypatch.setattr(library_gpu_raw, "sensor", sensor)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        pending = worker.submit(gpu_delivery.render_raw_picture, photo, document, 256)
        while (job := client.get("/api/delivery/gpu/next").json()) is None:
            time.sleep(.01)
        assert (job["width"], job["height"]) == (4, 6)
        meta, payload = library_gpu_raw.unframe(client.get(f"/api/delivery/gpu/{job['id']}/raw-sensor").content)
        assert meta == header and bytes(payload) == b"sensor!!"
        planes = np.arange(72, dtype="<f4").reshape(3,4,6)
        measurements = {"peaks": {"peak": 2.}, "robust": {"channel": 1.5}}
        response = client.post(f"/api/delivery/gpu/{job['id']}/raw-developed",
            content=library_gpu_raw.frame(measurements, planes.tobytes()))
        assert response.status_code == 204
        np.testing.assert_array_equal(gpu_delivery.session(job["id"]).image,
            np.rot90(planes.transpose(1,2,0), k=-1))
        for lane in ("hdr", "sdr"):
            assert client.post(f"/api/delivery/gpu/{job['id']}/pixels/{lane}",
                content=np.full((6,4,4), .2, dtype="<f4").tobytes()).status_code == 204
        client.post(f"/api/delivery/gpu/{job['id']}/complete", json={})
        result = pending.result(timeout=5)
        assert result["measurements"] == measurements
        assert seen == [document.source.raw_import_settings]
        assert result["source_width"] == 4 and result["source_height"] == 6
