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
