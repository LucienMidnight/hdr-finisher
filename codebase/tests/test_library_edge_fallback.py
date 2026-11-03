"""Scoped reconstruction timing, cancellation and isolation after GPU rejection."""
from concurrent.futures import Future, CancelledError
import numpy as np
import pytest
from hdr_finisher import library_edge_fallback as policy
from hdr_finisher.highlight_edge_colour import reconstruct_edge_colour
from hdr_finisher.library_worker import LibraryWorker, DecoderTimeout
from hdr_finisher.library_scheduler import Scheduler, DEVELOPMENTS
from hdr_finisher.library_estimates import estimate_pixels


def test_allowance_only_enters_reconstruction_after_rejection(monkeypatch):
    clock = [0.]
    monkeypatch.setattr(policy, "monotonic", lambda: clock[0])
    events = []
    with policy.reconstruction(lambda *e: events.append(e)) as check:
        assert check is None
    assert not events
    with policy.rejected_gpu_pixels(), policy.reconstruction(lambda *e: events.append(e)) as check:
        clock[0] = policy.RECONSTRUCTION_TIMEOUT_SECONDS - 1
        assert not check()
    assert events[0][0] == "cpu_edge_fallback"
    assert events[-1][0] != "cpu_edge_fallback"
    assert policy.RECONSTRUCTION_TIMEOUT_SECONDS == 66 <= policy.UPPER_CAP_SECONDS == 120
    assert not policy._active.get()


def test_timeout_is_local_and_next_request_can_reconstruct(monkeypatch):
    clock = [0.]
    monkeypatch.setattr(policy, "monotonic", lambda: clock[0])
    with pytest.raises(TimeoutError, match="timed out"):
        with policy.rejected_gpu_pixels(), policy.reconstruction() as check:
            clock[0] = policy.RECONSTRUCTION_TIMEOUT_SECONDS + 1
            check()
    with policy.rejected_gpu_pixels(), policy.reconstruction() as check:
        assert not check()


def test_cpu_colour_cancels_at_safe_points_without_mutating_source():
    image = np.full((48, 64, 3), .5, np.float32)
    ratio = np.ones((48, 64), np.float32)
    calls = []
    def stop():
        calls.append(1)
        return len(calls) == 4
    with pytest.raises(CancelledError):
        reconstruct_edge_colour(image, ratio, .5, cancelled=stop)
    assert len(calls) == 4
    assert np.all(image == .5) and np.all(ratio == 1)


def test_parent_timeout_cancels_only_reconstruction_without_restarting_helper(tmp_path, monkeypatch):
    helper = LibraryWorker(tmp_path)
    sent = []
    monkeypatch.setattr(helper, "_send", sent.append)
    helper._requests = {"edge": {"command":"live-scene", "path":"a.arw", "gpu_invalid_pixels":True},
                        "other": {"command":"live-scene", "path":"b.arw"}}
    helper._pending = {key:Future() for key in helper._requests}
    other = helper._pending["other"]
    helper._work["edge"] = {"phase":"cpu_edge_fallback", "elapsed":2}
    helper._deadline_sample -= policy.RECONSTRUCTION_TIMEOUT_SECONDS + 1
    helper._check_deadlines()
    assert sent == [{"command":"cancel", "id":"edge"}]
    assert not other.done() and "other" in helper._requests
    assert "edge" not in helper._work


@pytest.mark.parametrize("rejected,phase", [(False,"cpu_edge_fallback"),(True,"reading")])
def test_all_other_decoder_deadlines_stay_unchanged(tmp_path, monkeypatch, rejected, phase):
    helper = LibraryWorker(tmp_path)
    monkeypatch.setattr(helper, "decoder_timeout", lambda path: 5)
    helper._requests = {"job":{"command":"live-scene", "path":"a.arw", "gpu_invalid_pixels":rejected}}
    helper._pending = {"job":Future()}
    helper._work["job"] = {"phase":phase, "elapsed":0}
    helper._deadline_sample -= 6
    with pytest.raises(RuntimeError, match="decoder time limit"):
        helper._check_deadlines()


def test_background_fallback_does_not_take_development_or_save_places():
    scheduler = Scheduler()
    scheduler.update(available=60_000_000_000, ram=68_000_000_000)
    edge = scheduler.ask("edge","window","a.arw","edge-cpu",64_000_000)
    photos = [scheduler.ask(str(i),"window",str(i),"source",64_000_000) for i in range(DEVELOPMENTS)]
    assert edge.granted is not None and not edge.development and not edge.saving
    assert all(photo.granted is not None for photo in photos)
    assert estimate_pixels(".arw",8000,6000,"edge-cpu") == estimate_pixels(".arw",8000,6000,"cpu")
