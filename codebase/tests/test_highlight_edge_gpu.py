"""Edge-colour uses the shared delivery queue without changing source identity."""
from concurrent.futures import CancelledError, ThreadPoolExecutor
from pathlib import Path
import time

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher import delivery, gpu_delivery, highlight_edge_gpu, raw_import
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour


def available_renderer(monkeypatch, tmp_path):
    monkeypatch.setattr(delivery, "preferences", lambda: {"effective_force_cpu": False})
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, str(tmp_path))
    (tmp_path / "heartbeat").touch()


def test_raw_clip_ratio_is_unchanged_for_all_camera_channels():
    camera_rgb = np.random.default_rng(13).uniform(-.05, 1.05, (130, 16, 3)).astype(np.float32)
    clipping_threshold = .98
    level = np.float32(clipping_threshold * raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY)
    expected = np.max(camera_rgb, axis=-1) / level
    ratio = raw_import._edge_clip_ratio(camera_rgb, clipping_threshold, None)
    assert ratio.dtype == np.float32
    np.testing.assert_array_equal(ratio, expected)


@pytest.mark.parametrize("ratio_value", [np.float32(.5), np.float32(.96)])
def test_no_edge_seed_skips_delivery_and_preserves_pixels(monkeypatch, tmp_path, ratio_value):
    available_renderer(monkeypatch, tmp_path)

    def unexpected_handoff(*args):
        pytest.fail("A no-op should not allocate delivery memory.")

    monkeypatch.setattr(highlight_edge_gpu.DeliveryMemory, "allocate", unexpected_handoff)
    image = np.linspace(-.5, 2, 130 * 16 * 3, dtype=np.float32).reshape(130, 16, 3)
    ratio = np.full(image.shape[:2], .5, np.float32)
    ratio[-1, -1] = ratio_value
    original = image.copy()
    cpu_image, cpu_diagnostics = reconstruct_edge_colour(image, ratio, .5)
    result, diagnostics = highlight_edge_gpu.reconstruct(image, ratio, .5)

    assert result is cpu_image is image
    np.testing.assert_array_equal(result, original)
    assert diagnostics["applied"] is cpu_diagnostics["applied"] is False
    assert diagnostics["clipped_pixel_fraction"] == cpu_diagnostics["clipped_pixel_fraction"] == 0
    assert diagnostics["reason"] == "no_clipped_pixels"
    assert diagnostics["total_ms"] >= 0
    assert not list(tmp_path.glob("delivery-*"))


@pytest.mark.parametrize("sample", [np.nan, np.inf, -np.finfo(np.float32).max])
def test_no_edge_seed_does_not_bypass_invalid_image_validation(monkeypatch, tmp_path, sample):
    available_renderer(monkeypatch, tmp_path)
    image = np.ones((12, 16, 3), np.float32)
    image[-1, -1, -1] = sample
    ratio = np.full(image.shape[:2], .5, np.float32)

    def reject_invalid_input(*args):
        return {"error": "GPU rejected invalid input pixels."}

    monkeypatch.setattr(gpu_delivery, "_wait_for_result", reject_invalid_input)
    result, diagnostics = highlight_edge_gpu.reconstruct(image, ratio, .5)
    assert result is None
    assert diagnostics["fallback_reason"] == "GPU rejected invalid input pixels."


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
    ratio = np.full((12, 16), np.float32(.96))
    ratio[-1, -1] = np.nextafter(np.float32(.96), np.float32(1))
    _, cpu_diagnostics = reconstruct_edge_colour(image, ratio, .5)
    assert cpu_diagnostics["clipped_pixel_fraction"] == 1 / ratio.size
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
