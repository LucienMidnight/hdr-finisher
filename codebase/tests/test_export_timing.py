from concurrent.futures import ThreadPoolExecutor
import threading
import time
from types import SimpleNamespace

import pytest

from hdr_finisher import batch_export, export_timing
from hdr_finisher.export_timing import export_clock, lane, stage


def _busy(seconds):
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        pass


def test_nested_stages_count_once_and_other_threads_are_not_counted():
    with export_clock() as clock:
        with lane("hdr"):
            with stage("tone_colour"):
                _busy(.02)
                with stage("film_grain"):
                    _busy(.03)
                    # A helper thread's work belongs to the stage waiting for it.
                    helper = threading.Thread(target=lambda: [stage("detail").__enter__(), _busy(.01)])
                    helper.start()
                    helper.join()
        with lane("encode"), stage("encode"):
            _busy(.01)
    summary = clock.summary()
    hdr = summary["lanes"]["hdr"]
    assert set(hdr) == {"tone_colour", "film_grain"}
    assert 15 <= hdr["tone_colour"] < 30
    assert 35 <= hdr["film_grain"] < 60
    attributed = sum(sum(stages.values()) for stages in summary["lanes"].values())
    assert abs(attributed + summary["unattributed_ms"] - summary["total_ms"]) < 1
    assert summary["unattributed_percent"] < 10


def test_stages_without_a_clock_do_nothing():
    with stage("film_grain"), lane("hdr"):
        pass
    with export_clock() as outer, export_clock() as inner:
        assert inner is outer


@pytest.mark.parametrize("setting", [None, "0", "true"])
def test_stage_trace_requires_exact_opt_in(monkeypatch, setting):
    if setting is None:
        monkeypatch.delenv("HDR_FINISHER_EXPORT_STAGE_TRACE", raising=False)
    else:
        monkeypatch.setenv("HDR_FINISHER_EXPORT_STAGE_TRACE", setting)
    with export_clock() as clock:
        monkeypatch.setenv("HDR_FINISHER_EXPORT_STAGE_TRACE", "1")
        with stage("detail"):
            pass
    assert "stage_trace" not in clock.summary()


def test_stage_trace_records_exclusive_epoch_slices_and_batch_development(monkeypatch):
    monkeypatch.setenv("HDR_FINISHER_EXPORT_STAGE_TRACE", "1")
    counter = iter([50, 51, 52, 54, 55, 56])
    monkeypatch.setattr(export_timing, "perf_counter", lambda: next(counter))
    monkeypatch.setattr(export_timing.time, "time", lambda: 1700000000.0)
    monkeypatch.setattr(batch_export, "log", lambda *_args, **_kwargs: None)
    with export_clock() as clock, lane("hdr"), stage("tone_colour"):
        with stage("film_grain"):
            pass
    summary = batch_export._log_export_timing(
        clock, SimpleNamespace(accepted=True, timings_ms={}), {"path": "photo.raw"}, "avif_gain_map", 2.5,
    )
    assert summary["total_ms"] == 8500
    assert summary["lanes"] == {"hdr": {"tone_colour": 2000, "film_grain": 2000},
                                "source": {"develop_raw": 2500}}
    assert summary["stage_trace"] == [
        ["source", "develop_raw", 1699999997.5, 1700000000.0],
        ["hdr", "tone_colour", 1700000001.0, 1700000002.0],
        ["hdr", "film_grain", 1700000002.0, 1700000004.0],
        ["hdr", "tone_colour", 1700000004.0, 1700000005.0],
    ]


def test_clock_readers_see_consistent_stages_while_export_transitions():
    start, stop = threading.Barrier(5), threading.Event()
    valid = {("source", None), ("hdr", None), ("hdr", "tone_colour"), ("hdr", "film_grain"),
             ("sdr", None), ("sdr", "vignette")}
    with export_clock() as clock:
        def poll():
            start.wait(timeout=5)
            previous = 0.0
            reads = 0
            while reads == 0 or not stop.is_set():
                assert clock.current() in valid
                assert clock.current_lane in {"source", "hdr", "sdr"}
                assert clock.current_stage in {None, "tone_colour", "film_grain", "vignette"}
                elapsed = clock.elapsed("hdr", "tone_colour")
                assert elapsed >= previous
                previous = elapsed
                summary = clock.summary()
                attributed = sum(sum(stages.values()) for stages in summary["lanes"].values())
                assert attributed <= summary["total_ms"] + .2
                reads += 1
            return reads

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(poll) for _ in range(4)]
            start.wait(timeout=5)
            try:
                for _ in range(250):
                    with lane("hdr"), stage("tone_colour"):
                        with stage("film_grain"):
                            time.sleep(0)
                    with lane("sdr"), stage("vignette"):
                        pass
            finally:
                stop.set()
            assert all(future.result() > 0 for future in futures)
        assert clock.lane_finished("hdr") and clock.lane_finished("sdr")
