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


def test_edge_turn_round_trips_planes_and_cancelled_turn_releases_memory(monkeypatch, tmp_path):
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
        assert client.post(url + "/pixels/edge", content=output.tobytes()).status_code == 204
        client.post(url + "/complete", json={"edge_diagnostics": {"applied": True}})
        result, diagnostics = future.result(timeout=5)
        assert np.all(result == .75) and diagnostics["renderer"] == "gpu"
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


def test_rejected_gpu_pixels_get_one_more_gpu_try_before_the_cpu(monkeypatch):
    image = np.ones((2, 3, 3), np.float32)
    rejected = {"renderer": "cpu", "fallback_reason": "GPU edge colour produced 1 invalid pixels; using the CPU."}
    clean = np.full_like(image, .25)
    replies = [(None, rejected), (clean, {"renderer": "gpu", "fallback_reason": None})]
    monkeypatch.setattr(highlight_edge_gpu, "_attempt", lambda *args: replies.pop(0))
    result, diagnostics = highlight_edge_gpu.reconstruct(image, image[..., 0], .5)
    assert result is clean and diagnostics["renderer"] == "gpu"
    assert diagnostics["rejected_gpu_attempts"] == [rejected["fallback_reason"]]

    calls = []
    monkeypatch.setattr(highlight_edge_gpu, "_attempt", lambda *args: calls.append(1) or (None, rejected))
    result, diagnostics = highlight_edge_gpu.reconstruct(image, image[..., 0], .5)
    assert result is None and diagnostics["renderer"] == "cpu" and len(calls) == 2
    assert len(diagnostics["rejected_gpu_attempts"]) == 2

    calls.clear()
    unavailable = {"renderer": "cpu", "fallback_reason": "The GPU delivery renderer is unavailable."}
    monkeypatch.setattr(highlight_edge_gpu, "_attempt", lambda *args: calls.append(1) or (None, unavailable))
    result, diagnostics = highlight_edge_gpu.reconstruct(image, image[..., 0], .5)
    assert result is None and len(calls) == 1 and "rejected_gpu_attempts" not in diagnostics
