"""Cancellation and exact grain output from baseline 88775059."""
import asyncio
import threading
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest
from hdr_finisher import film_grain
from hdr_finisher.adjustments import _apply_density_grain, FrameWindow
from hdr_finisher.models import FilmLookAdjustments, PreviewKind, PreviewRequest
from hdr_finisher.grain_work import render_work, grain_allocation
from hdr_finisher.render_cache import StaleRender
from hdr_finisher.instrument_work import InstrumentWork


def grain_cases(render=_apply_density_grain):
    image = np.linspace(.002, .9, 133 * 17 * 3, dtype=np.float32).reshape(133, 17, 3)
    for lane in PreviewKind:
        for film in ("color_negative", "black_and_white"):
            for scale in (1., .6, .2):
                look = FilmLookAdjustments(grain_amount=70, grain_size=100, grain_chroma=40, grain_film_type=film)
                yield f"{lane.value}_{film}_{scale}", render(image, look, lane, 271828, np.float32(1),
                    frame_window=FrameWindow(1500, 2500, 5320, 7968), preview_scale=scale)


def test_uncancelled_pixels_equal_pre_change_output():
    from helpers.grain_before_88775059 import _apply_density_grain as before
    for (key, pixels), (old_key, reference) in zip(grain_cases(), grain_cases(before), strict=True):
        assert key == old_key
        np.testing.assert_array_equal(pixels, reference, err_msg=key)


def test_cancel_during_grain_band(monkeypatch):
    active = True
    calls = []
    original = film_grain._splat_band
    def splat(*args, **kwargs):
        nonlocal active
        calls.append(1)
        result = original(*args, **kwargs)
        active = False
        return result
    monkeypatch.setattr(film_grain, "_splat_band", splat)
    with render_work(lambda: active), pytest.raises(StaleRender): next(grain_cases())
    assert len(calls) == 1


def test_cancel_between_samples(monkeypatch):
    calls = []
    def noise(*args, **kwargs):
        calls.append(kwargs["sample_offset"])
        return np.ones((2, 2, 3), dtype=np.float32)
    monkeypatch.setattr(film_grain, "grain_noise", noise)
    with render_work(lambda: not calls), pytest.raises(StaleRender):
        film_grain.preview_grain_noise(preview_scale=.2)
    assert len(calls) == 1


def test_cpu_log_reason_photo_lane_size(monkeypatch):
    from hdr_finisher.main import _log_cpu_preview
    from hdr_finisher import library_diagnostics
    events = []
    monkeypatch.setattr(library_diagnostics, "_sink", events.append)
    session = SimpleNamespace(image=np.zeros((100, 200, 3)), source_path=Path("DSC07752.ARW"))
    _log_cpu_preview(session, PreviewKind.SDR, 100, PreviewRequest(cpu_fallback_reason="budget-refused"), 100)
    assert len(events) == 1
    event = events[0]
    assert (event["event"], event["reason"], event["lane"], event["width"], event["height"]) == ("grade_preview_cpu", "budget-refused", "sdr", 100, 50)
    assert event["path"] == "DSC07752.ARW"


def test_abandoned_scope_cancels_inside_grain(monkeypatch):
    async def scenario():
        queue = InstrumentWork()
        entered = threading.Event()
        released = threading.Event()
        class Request:
            disconnected = False
            async def is_disconnected(self): return self.disconnected
        request = Request()
        original = film_grain._splat_band
        def splat(*args, **kwargs):
            entered.set()
            assert released.wait(2)
            return original(*args, **kwargs)
        monkeypatch.setattr(film_grain, "_splat_band", splat)
        task = asyncio.create_task(queue.run(("old-session", "hdr", "scopes"), request, lambda current: next(grain_cases())))
        while not entered.is_set(): await asyncio.sleep(.001)
        request.disconnected = True
        await asyncio.sleep(.1)
        released.set()
        result = await asyncio.gather(task, return_exceptions=True)
        assert isinstance(result[0], StaleRender)
        assert not queue.lanes
    asyncio.run(scenario())


def test_grain_allocation_foreground_priority():
    from hdr_finisher import grain_work
    order = []
    errors = []
    def run(label, background):
        try:
            with render_work(background=background), grain_allocation(): order.append(label)
        except StaleRender: errors.append(label)
    with grain_allocation():
        back = threading.Thread(target=run, args=("scope", True))
        front = threading.Thread(target=run, args=("preview", False))
        back.start(); front.start()
        import time
        deadline = time.monotonic() + 2
        while not grain_work._foreground_waiters and time.monotonic() < deadline: time.sleep(.001)
        assert grain_work._foreground_waiters
        assert not order
    front.join(2); back.join(2)
    assert order[0] == "preview"
    assert sorted(order + errors) == ["preview", "scope"]

def test_cpu_pool_dispatches_visible_before_queued_scope():
    from hdr_finisher.cpu_budget import PriorityCpuPool
    pool = PriorityCpuPool(1)
    started = threading.Event()
    released = threading.Event()
    order = []
    def hold():
        started.set()
        assert released.wait(2)
    first = pool.submit(hold)
    assert started.wait(2)
    with render_work(background=True):
        scope = pool.submit(lambda: order.append("scope"))
    preview = pool.submit(lambda: order.append("preview"))
    released.set()
    first.result(2); preview.result(2); scope.result(2)
    pool.pool.shutdown()
    assert order == ["preview", "scope"]


def test_large_cpu_jobs_share_a_limit_without_blocking_unrelated_work():
    from hdr_finisher.cpu_budget import CpuWorkLimit, PriorityCpuPool

    pool = PriorityCpuPool(3)
    limit = CpuWorkLimit(1)
    started = threading.Event()
    released = threading.Event()
    order = []

    def hold():
        started.set()
        assert released.wait(5)

    try:
        first = pool.submit(hold, background=True, work_limit=limit)
        assert started.wait(5)
        background = pool.submit(lambda: order.append("background"), background=True, work_limit=limit)
        viewport = pool.submit(lambda: order.append("viewport"), work_limit=limit)
        pool.submit(lambda: order.append("other")).result(5)
        assert order == ["other"]
        released.set()
        first.result(5)
        viewport.result(5)
        background.result(5)
        assert order == ["other", "viewport", "background"]
    finally:
        released.set()
        pool.pool.shutdown()


@pytest.mark.slow
def test_export_grain_on_several_workers_matches_the_serial_render():
    from hdr_finisher import cpu_budget
    from hdr_finisher.adjustments import EXPORT_GRAIN_CHUNK_ROWS, grain_export_workers
    from hdr_finisher.export_timing import export_clock
    height, width = 1100, 40
    if cpu_budget.logical_cpus() < 2:
        pytest.skip("Multiple CPU workers are needed")
    assert grain_export_workers(height, EXPORT_GRAIN_CHUNK_ROWS, width=width) > 1
    image = np.random.default_rng(5).random((height, width, 3), dtype=np.float32) * 2
    for lane in PreviewKind:
        look = FilmLookAdjustments(grain_amount=70, grain_size=60, grain_chroma=40, grain_film_type="color_negative")
        for delta in (False, True):
            serial = _apply_density_grain(image, look, lane, 271828, np.float32(1), density_delta=delta)
            with export_clock():
                parallel = _apply_density_grain(image, look, lane, 271828, np.float32(1), density_delta=delta)
            assert parallel.dtype == serial.dtype == np.float32
            np.testing.assert_array_equal(parallel, serial, err_msg=f"{lane.value} delta={delta}")


def test_film_grain_worker_count_budgets_a_100_mp_frame(monkeypatch):
    from hdr_finisher import adjustments, cpu_budget

    monkeypatch.setattr(cpu_budget, "logical_cpus", lambda: 16)
    budget = adjustments.MAX_GRAIN_SCRATCH_BYTES
    assert budget == 192 * 1024 ** 2
    rows = adjustments.EXPORT_GRAIN_CHUNK_ROWS
    width, height = 11648, 8736
    scratch = width * rows * adjustments.GRAIN_SCRATCH_BYTES_PER_PIXEL
    workers = adjustments.grain_export_workers(height, rows, width=width)
    assert workers == 1
    assert workers * scratch <= budget < (workers + 1) * scratch
    assert adjustments.grain_export_workers(100, rows, width=width) == 1
    assert adjustments.grain_export_workers(8000, rows, width=24000) == 1


def test_export_grain_yields_to_grade_between_spans(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from hdr_finisher import adjustments, cpu_budget

    pool = cpu_budget.PriorityCpuPool(1)
    monkeypatch.setattr(cpu_budget, "_cpu_pool", pool)
    first_worker_span, release = threading.Event(), threading.Event()
    rows = adjustments.EXPORT_GRAIN_CHUNK_ROWS
    order = []

    def render(top, bottom):
        order.append(top)
        if top == rows:
            first_worker_span.set()
            assert release.wait(5)
        return np.zeros((bottom - top, 5, 3), dtype=np.float32)

    try:
        with ThreadPoolExecutor(max_workers=1) as export_thread:
            export = export_thread.submit(adjustments._render_grain_chunks_in_parallel, render, rows * 4)
            try:
                assert first_worker_span.wait(5)
                grade = pool.submit(lambda: order.append("grade"))
            finally:
                release.set()
            grade.result(5)
            assert export.result(5).shape == (rows * 4, 5, 3)
        assert order == [0, rows, "grade", rows * 2, rows * 3]
    finally:
        pool.pool.shutdown()


def test_export_grain_stops_submitting_spans_after_a_failure():
    from hdr_finisher import adjustments

    rows = adjustments.EXPORT_GRAIN_CHUNK_ROWS
    visited = []

    def render(top, bottom):
        visited.append(top)
        if top:
            raise ValueError("bad grain span")
        return np.zeros((bottom - top, 4, 3), dtype=np.float32)

    with pytest.raises(ValueError, match="bad grain span"):
        adjustments._render_grain_chunks_in_parallel(render, rows * 4)
    assert visited == [0, rows]


def test_wide_grain_allocation_stays_within_its_slots_and_yields_to_grade():
    from hdr_finisher import grain_work
    import time
    active, most, lock = 0, 0, threading.Lock()
    order = []

    def wide(label):
        nonlocal active, most
        with grain_allocation(slots=3):
            with lock:
                active += 1
                most = max(most, active)
            time.sleep(.02)
            order.append(label)
            with lock:
                active -= 1

    def grade():
        with grain_allocation():
            order.append("grade")

    deadline = time.monotonic() + 2
    with grain_allocation():
        waiting_grade = threading.Thread(target=grade)
        waiting_grade.start()
        while not grain_work._narrow_waiters and time.monotonic() < deadline:
            time.sleep(.001)
        exports = [threading.Thread(target=wide, args=(f"export{index}",)) for index in range(6)]
        for worker in exports:
            worker.start()
        while grain_work._foreground_waiters < 7 and time.monotonic() < deadline:
            time.sleep(.001)
        assert not order
    waiting_grade.join(2)
    for worker in exports:
        worker.join(2)
    # The queued Grade chunk is served before any export chunk starts.
    assert order[0] == "grade" and len(order) == 7
    assert most <= 3 and grain_work._holders == 0
