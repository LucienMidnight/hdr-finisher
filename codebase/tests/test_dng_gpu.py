"""Grade DNG correction hands bounded work to delivery without altering its source."""
from concurrent.futures import CancelledError
from multiprocessing.shared_memory import SharedMemory
import json

import numpy as np
import pytest

from hdr_finisher import delivery, dng_gpu, gpu_delivery, library_dng
from hdr_finisher.delivery_memory import DeliveryMemory
from hdr_finisher.highlight_edge_gpu import source_work


@pytest.fixture
def bridge(monkeypatch, tmp_path):
    root = tmp_path / "gpu"
    root.mkdir()
    (root / "heartbeat").touch()
    monkeypatch.setenv(gpu_delivery.ROOT_ENV, str(root))
    monkeypatch.setattr(delivery, "preferences", lambda: {"effective_force_cpu": False})
    audit = [{"name": "GainMap", "status": "applied_gpu"},
             {"name": "WarpRectilinear", "status": "applied_gpu"}]
    def correction(image, inspection, cancelled):
        return {"width": 3, "height": 2, "colour": {"scale": 1}}, audit
    monkeypatch.setattr(library_dng, "correction", correction)
    return root, audit


def assert_released(root, descriptions):
    assert not list(root.glob("delivery-*"))
    for description in descriptions:
        with pytest.raises(FileNotFoundError):
            SharedMemory(name=description["name"])


@pytest.mark.parametrize("priority", [0, 15, 20])
def test_success_preserves_signed_pixels_and_inherited_priority(monkeypatch, bridge, priority):
    root, audit = bridge
    image = np.arange(36, dtype=np.float32).reshape(3, 4, 3) / 16
    before = image.copy()
    expected = np.array([[[-.1, .2, 4], [.3, .4, .5], [.6, .7, .8]],
                         [[.9, 1, 1.1], [1.2, 1.3, 1.4], [1.5, 1.6, 1.7]]], np.float32)
    descriptions = []
    def wait(directory, spool, frame):
        request = json.loads((directory / "request.json").read_text())
        assert spool == root and request["priority"] == priority
        assert request["operation"] == "dng_correction"
        assert request["dng"]["preserve_signed"] is True
        assert request["dng"]["colour"]["scale"] == 1
        assert (request["width"], request["height"]) == (3, 2)
        assert not frame.delivery_cancelled()
        descriptions.extend(request["memory"].values())
        with DeliveryMemory() as memory:
            np.testing.assert_array_equal(memory.attach(request["memory"]["dng_input"]), image)
            np.copyto(memory.attach(request["memory"]["dng"]), expected.transpose(2, 0, 1))
        return {"dng_diagnostics": {"memory_peak_bytes": 1234}}
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", wait)
    with source_work(priority=priority, cancelled=lambda: False):
        result, diagnostics = dng_gpu.correct(image, object())
    np.testing.assert_array_equal(result, expected)
    np.testing.assert_array_equal(image, before)
    assert result.flags.c_contiguous and result.dtype == np.float32
    assert diagnostics["renderer"] == "gpu" and diagnostics["operations"] == audit
    assert diagnostics["memory_peak_bytes"] == 1234
    assert diagnostics["fallback_reason"] is None
    assert_released(root, descriptions)


def test_force_cpu_and_unavailable_renderer_preserve_input(monkeypatch, bridge):
    root, _ = bridge
    image = np.full((3, 4, 3), .5, np.float32)
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", lambda *a: pytest.fail("GPU was contacted"))
    monkeypatch.setattr(delivery, "preferences", lambda: {"effective_force_cpu": True})
    result, diagnostics = dng_gpu.correct(image, object())
    assert result is None and diagnostics["renderer"] == "cpu"
    assert "CPU rendering" in diagnostics["fallback_reason"]
    monkeypatch.setattr(delivery, "preferences", lambda: {"effective_force_cpu": False})
    (root / "heartbeat").unlink()
    result, diagnostics = dng_gpu.correct(image, object())
    assert result is None and "unavailable" in diagnostics["fallback_reason"]
    np.testing.assert_array_equal(image, np.full_like(image, .5))
    assert_released(root, [])


def test_cancelled_wait_propagates_and_releases_input_and_output(monkeypatch, bridge):
    root, _ = bridge
    image = np.ones((3, 4, 3), np.float32)
    descriptions = []
    checks = iter([False, True])
    def cancelled():
        return next(checks)
    def wait(directory, spool, frame):
        request = json.loads((directory / "request.json").read_text())
        descriptions.extend(request["memory"].values())
        assert frame.delivery_cancelled()
        raise CancelledError("DNG correction cancelled")
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", wait)
    with source_work(priority=15, cancelled=cancelled), pytest.raises(CancelledError):
        dng_gpu.correct(image, object())
    np.testing.assert_array_equal(image, np.ones_like(image))
    assert_released(root, descriptions)


@pytest.mark.parametrize("reply", [{"error": "device lost"}, {}, {"dng_diagnostics": {}}])
def test_failure_preserves_source_for_cpu_fallback(monkeypatch, bridge, reply):
    root, _ = bridge
    image = np.arange(36, dtype=np.float32).reshape(3, 4, 3)
    before = image.copy()
    descriptions = []
    def wait(directory, spool, frame):
        request = json.loads((directory / "request.json").read_text())
        descriptions.extend(request["memory"].values())
        with DeliveryMemory() as memory:
            memory.attach(request["memory"]["dng"]).fill(np.nan)
        return reply
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", wait)
    result, diagnostics = dng_gpu.correct(image, object())
    assert result is None and diagnostics["renderer"] == "cpu"
    assert diagnostics["fallback_reason"]
    np.testing.assert_array_equal(image, before)
    assert_released(root, descriptions)


def test_preemption_requeues_before_returning_success(monkeypatch, bridge):
    root, _ = bridge
    image = np.ones((3, 4, 3), np.float32)
    calls = []
    def wait(directory, spool, frame):
        calls.append(directory)
        if len(calls) == 1:
            (directory / "claimed").touch()
            (directory / "result.json").write_text("{}")
            return {"error": "A higher-priority delivery needs the GPU."}
        assert not (directory / "claimed").exists()
        assert not (directory / "result.json").exists()
        request = json.loads((directory / "request.json").read_text())
        with DeliveryMemory() as memory:
            memory.attach(request["memory"]["dng"]).fill(.25)
        return {"dng_diagnostics": {}}
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", wait)
    result, diagnostics = dng_gpu.correct(image, object())
    assert len(calls) == 2 and calls[0] == calls[1]
    assert diagnostics["renderer"] == "gpu" and np.all(result == .25)
    assert_released(root, [])


def test_opcode_preparation_cancellation_is_not_cpu_fallback(monkeypatch, bridge):
    from hdr_finisher.dng_opcodes import DngImportCancelled
    root, _ = bridge
    image = np.ones((3, 4, 3), np.float32)
    def correction(*args):
        raise DngImportCancelled("Opcode preparation cancelled")
    monkeypatch.setattr(library_dng, "correction", correction)
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", lambda *a: pytest.fail("Cancelled preparation queued GPU work"))
    with pytest.raises(DngImportCancelled, match="Opcode preparation cancelled"):
        dng_gpu.correct(image, object())
    np.testing.assert_array_equal(image, np.ones_like(image))
    assert_released(root, [])


@pytest.mark.parametrize("reply", [{"dng_diagnostics": {}}, {"error": "device lost"}])
def test_cancellation_after_reply_wins_over_success_or_fallback(monkeypatch, bridge, reply):
    root, _ = bridge
    image = np.ones((3, 4, 3), np.float32)
    stopped = False
    descriptions = []
    def wait(directory, spool, frame):
        nonlocal stopped
        request = json.loads((directory / "request.json").read_text())
        descriptions.extend(request["memory"].values())
        with DeliveryMemory() as memory:
            memory.attach(request["memory"]["dng"]).fill(.25)
        stopped = True
        return reply
    monkeypatch.setattr(gpu_delivery, "_wait_for_result", wait)
    with pytest.raises(CancelledError, match="DNG correction cancelled"):
        dng_gpu.correct(image, object(), cancelled=lambda: stopped)
    np.testing.assert_array_equal(image, np.ones_like(image))
    assert_released(root, descriptions)
