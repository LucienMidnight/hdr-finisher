"""Edge-colour uses the shared delivery queue without changing source identity."""
from concurrent.futures import CancelledError, ThreadPoolExecutor
from pathlib import Path
import time

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher import delivery, gpu_delivery, highlight_edge_gpu


def test_unavailable_gpu_reports_fallback_without_mutating_input(monkeypatch, tmp_path):
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "policy.json")
    monkeypatch.delenv(gpu_delivery.ROOT_ENV, raising=False)
    image = np.full((12, 16, 3), .5, np.float32)
    result, diagnostics = highlight_edge_gpu.reconstruct(image, image[..., 0], .5)
    assert result is None and diagnostics["renderer"] == "cpu"
    assert diagnostics["fallback_reason"]
    assert np.all(image == .5)


@pytest.mark.parametrize("sample,renderer", [(.75, "gpu"), (-.25, "gpu"), (8, "gpu"),
    (1e38, "cpu"), (-1e38, "cpu"), (np.nan, "cpu"), (np.inf, "cpu")])
def test_edge_turn_round_trips_planes_and_cancelled_turn_releases_memory(monkeypatch, tmp_path, sample, renderer):
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "policy.json")
    monkeypatch.delenv(delivery.FORCE_CPU_ENV, raising=False)
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app = FastAPI()
    app.include_router(gpu_delivery.create_gpu_delivery_router())
    image = np.full((12, 16, 3), .5, np.float32)
    ratio = np.ones((12, 16), np.float32)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        future = worker.submit(highlight_edge_gpu.reconstruct, image, ratio, .5)
        deadline = time.monotonic() + 5
        while True:
            job = client.get("/api/delivery/gpu/next").json()
            if job is not None:
                break
            assert time.monotonic() < deadline
            time.sleep(.01)
        assert job["operation"] == "edge_colour" and job["priority"] == 0
        url = "/api/delivery/gpu/" + job["id"]
        packed = np.frombuffer(client.get(url + "/edge-source").content, "<f4").reshape(4, 12, 16)
        np.testing.assert_array_equal(packed[:3].transpose(1, 2, 0), image)
        np.testing.assert_array_equal(packed[3], ratio)
        assert client.post(url + "/pixels/hdr", content=b"bad").status_code == 400
        output = np.full((3, 12, 16), .75, "<f4")
        output[0, 0, 0] = sample
        assert client.post(url + "/pixels/edge", content=output.tobytes()).status_code == 204
        client.post(url + "/complete", json={"edge_diagnostics": {"applied": True}})
        result, diagnostics = future.result(timeout=5)
        assert diagnostics["renderer"] == renderer
        if renderer == "gpu":
            np.testing.assert_array_equal(result, output.transpose(1, 2, 0))
        else:
            assert result is None and diagnostics["fallback_reason"] == "GPU edge colour returned invalid pixels."
        np.testing.assert_array_equal(image, np.full_like(image, .5))
        assert client.get("/api/delivery/gpu/next").json() is None
        assert not list(Path(gpu_delivery.os.environ[gpu_delivery.ROOT_ENV]).glob("delivery-*"))
        with pytest.raises(CancelledError):
            highlight_edge_gpu.reconstruct(image, ratio, .5, lambda: True)


def test_cpu_source_does_not_reenter_delivery_after_gpu_rejection(monkeypatch):
    image = np.ones((2, 3, 3), np.float32)
    monkeypatch.setattr(delivery, "preferences", lambda: (_ for _ in ()).throw(AssertionError("CPU fallback consulted GPU policy")))
    with highlight_edge_gpu.source_work(priority=15, cpu_only=True):
        result, diagnostics = highlight_edge_gpu.reconstruct(image, image[..., 0], .5)
    assert result is None and diagnostics["renderer"] == "cpu"
    assert highlight_edge_gpu._work.get() == (0, None)
    assert not highlight_edge_gpu._cpu_only.get()
    np.testing.assert_array_equal(image, np.ones_like(image))


def test_rejected_gpu_pixels_go_straight_to_the_cpu(monkeypatch, tmp_path):
    """One GPU attempt: a range-check rejection is not retried (master PRD GPU fallback rule)."""
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "policy.json")
    monkeypatch.delenv(delivery.FORCE_CPU_ENV, raising=False)
    monkeypatch.setattr(gpu_delivery, "_clients", {})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, "")
    app = FastAPI()
    app.include_router(gpu_delivery.create_gpu_delivery_router())
    image = np.full((12, 16, 3), .5, np.float32)
    ratio = np.ones((12, 16), np.float32)
    reason = "GPU edge colour produced 1 invalid pixels; using the CPU."
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as worker:
        client.get("/api/delivery/gpu/permit")
        future = worker.submit(highlight_edge_gpu.reconstruct, image, ratio, .5)
        deadline = time.monotonic() + 5
        while (job := client.get("/api/delivery/gpu/next").json()) is None:
            assert time.monotonic() < deadline
            time.sleep(.01)
        client.post("/api/delivery/gpu/" + job["id"] + "/complete", json={"error": reason})
        result, diagnostics = future.result(timeout=5)
        assert result is None and diagnostics == {"renderer": "cpu", "fallback_reason": reason}
        assert client.get("/api/delivery/gpu/next").json() is None
