import threading
import time

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
