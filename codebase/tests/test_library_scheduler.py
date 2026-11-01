"""Execute the RAM admission rules without sampling the test runner."""
from hdr_finisher.library_scheduler import Scheduler, FLOOR, FAST_BYTES

GB = 1_000_000_000


def fresh(room=2*GB):
    s = Scheduler(ceiling=room+1_300_000_000)
    s.update(available=60*GB, ram=68*GB)
    return s


def ask(s, id, estimate=FAST_BYTES, cls="now", kind="source", owner="window"):
    return s.ask(id, owner, id, kind, estimate, cls)


def test_class_order_and_fifo():
    s = fresh(GB)
    first = ask(s, "first", GB)
    eventually = ask(s, "eventually", GB, "eventually")
    soon = ask(s, "soon", GB, "soon")
    now1 = ask(s, "now1", GB)
    now2 = ask(s, "now2", GB)
    assert not any(j.ready.is_set() for j in [eventually, soon, now1, now2])
    for finishing, following in [(first, now1), (now1, now2), (now2, soon), (soon, eventually)]:
        s.finish(finishing.id)
        assert following.granted is not None


def test_fitting_same_class_skips_blocked_job_but_lower_class_waits():
    s = fresh(2*GB)
    ask(s, "running", GB)
    big = ask(s, "big", 2*GB)
    small = ask(s, "small", FAST_BYTES)
    lower = ask(s, "lower", FAST_BYTES, "soon")
    assert not big.ready.is_set() and small.ready.is_set() and not lower.ready.is_set()
    s.finish("small")
    s.finish("running")
    assert big.ready.is_set() and not lower.ready.is_set()


def test_oversized_job_runs_alone():
    s = fresh(GB)
    big = ask(s, "big", 2*GB)
    small = ask(s, "small", FAST_BYTES)
    assert big.granted is not None and big.alone
    assert small.granted is None
    s.finish("big")
    assert small.granted is not None


def test_floor_and_paused_grade_steps_aside():
    s = fresh()
    s.update(grade_bytes=4*GB, grade_name="scan.dng", available=60*GB, ram=68*GB)
    big = ask(s, "scan", FLOOR+1)
    small = ask(s, "ordinary", FLOOR)
    other = ask(s, "other", FAST_BYTES)
    background = ask(s, "background", FAST_BYTES, "soon")
    assert big.reason == "paused for Grade" and big.granted is None
    assert small.granted is not None and small.floor
    assert other.granted is None and background.granted is None
    s.finish("ordinary")
    assert other.granted is not None
    s.finish("other")
    s.update(available=60*GB, ram=68*GB)
    assert big.granted is not None


def test_system_reserve_and_recheck():
    s = fresh()
    s.update(available=3*GB, ram=8*GB)
    big = ask(s, "big", 2*GB)
    small = ask(s, "small", FAST_BYTES)
    assert big.reason == "system reserve" and big.granted is None
    assert small.granted is not None
    s.finish("small")
    s.update(available=5*GB, ram=8*GB)
    assert big.granted is not None


def test_free_memory_snapshot_cannot_be_spent_twice():
    s = fresh()
    s.update(available=3*GB, ram=8*GB)
    assert ask(s, "first", 600_000_000).granted is not None
    assert ask(s, "second", 600_000_000).reason == "system reserve"


def test_fast_lane_four_and_large_preview_joins_normal_queue():
    s = fresh(GB)
    ask(s, "running", 2*GB)
    fast = [ask(s, str(i), FAST_BYTES, kind="quick") for i in range(5)]
    large = ask(s, "large", FAST_BYTES+1, kind="quick")
    assert all(j.granted is not None for j in fast[:4])
    assert fast[4].reason == "fast lane full"
    assert large.granted is None and not large.fast
    s.finish("0")
    assert fast[4].granted is not None


def test_disconnect_cancels_waiters_and_releases_running():
    s = fresh(GB)
    ask(s, "active", GB, owner="old")
    waiting = ask(s, "waiting", GB, owner="old")
    s.disconnect("old")
    assert not s.jobs and waiting.ready.is_set()
    retry = ask(s, "waiting", GB, owner="new")
    assert retry.granted is not None


def test_heartbeat_expiry_and_cancel_cost_nothing():
    now = [0]
    s = Scheduler(clock=lambda:now[0])
    s.heartbeat("dead")
    ask(s, "held", GB, owner="dead")
    s.finish("held", "somebody-else")
    assert "held" in s.jobs
    now[0] = 16
    s.expire()
    assert not s.jobs


def test_measurement_unavailable_does_not_stop_estimate_admission():
    s = fresh()
    s.update(total=None, available=None)
    assert ask(s, "ordinary", GB).granted is not None


def test_cancelled_waiter_not_notified_as_failure():
    events = []
    s = fresh(GB)
    ask(s, "held", GB)
    job = s.ask("wait", "owner", "file", "source", GB, notify=events.append)
    assert job.granted is None
    s.finish("wait", "owner", "cancelled")
    assert [e["type"] for e in events] == ["waiting"]
    assert "wait" not in s.jobs


def test_measured_safety_net_allows_only_floor_and_fast_lane_above_ceiling():
    s = fresh(2*GB)
    s.update(total=s.ceiling+1, available=60*GB, ram=68*GB)
    larger = ask(s, "large", FLOOR+1)
    ordinary = ask(s, "ordinary", FLOOR)
    quick = ask(s, "quick", FAST_BYTES, kind="quick")
    assert larger.granted is None and larger.reason in {"room", "reclaiming memory"}
    # The oldest blocked job now protects its turn while reclaiming.
    # The fast lane still runs. Cancelling frees the protected place.
    assert ordinary.granted is None
    assert quick.granted is not None
    s.finish("quick")
    s.finish("large")
    assert ordinary.granted is not None and ordinary.floor


def test_critical_pressure_stops_background_and_limits_now_to_floor():
    s = fresh()
    s.update(pressure="critical", available=60*GB, ram=68*GB)
    ordinary = ask(s, "ordinary", GB)
    second = ask(s, "second", FAST_BYTES)
    background = ask(s, "background", FAST_BYTES,"eventually")
    assert ordinary.granted is not None and ordinary.floor
    assert second.granted is None and background.granted is None


def test_grade_priority_is_not_refused_by_library_reserve():
    s = fresh()
    s.update(available=GB,ram=8*GB)
    grade = ask(s, "Grade",4*GB,"Grade")
    assert grade.granted is not None and grade.estimate == 4*GB
    assert ask(s, "ordinary",FAST_BYTES).granted is None


def test_developments_capped_fifo_across_windows_and_cancel_frees_place():
    s = fresh(20*GB)
    jobs = [ask(s, str(i), owner=f"window-{i%2}") for i in range(30)]
    assert [j.id for j in jobs if j.granted is not None] == ["0", "1"]
    assert all(j.baseline is None for j in jobs[2:])
    s.finish("0", outcome="cancelled")
    assert jobs[2].granted is not None
    assert sum(j.development and j.granted is not None for j in s.jobs.values()) == 2


def test_quick_previews_run_before_next_development():
    s = fresh(20*GB)
    a = ask(s, "a")
    b = ask(s, "b")
    c = ask(s, "c")
    quick = ask(s, "quick", kind="quick")
    assert quick.granted is not None
    s.finish(a.id)
    assert c.granted is None and c.reason == "quick previews first"
    s.finish(quick.id)
    assert c.granted is not None


def test_first_screen_finishes_before_background_development_starts():
    s = fresh(20*GB)
    a, b = ask(s, "a"), ask(s, "b")
    later = ask(s, "second-screen", cls="soon")
    s.finish(a.id)
    assert later.granted is None
    s.finish(b.id)
    assert later.granted is not None


def test_screen_order_survives_out_of_order_cache_probes():
    s = fresh(20*GB)
    blocker = ask(s, "quick", kind="quick")
    later = s.ask("later", "window", "later.jpg", "source", FAST_BYTES, order=8)
    earlier = s.ask("earlier", "window", "earlier.jpg", "source", FAST_BYTES, order=0)
    middle = s.ask("middle", "window", "middle.jpg", "source", FAST_BYTES, order=1)
    s.finish(blocker.id)
    assert earlier.granted is not None and middle.granted is not None
    assert later.granted is None


def test_upkeep_yields_at_checkpoint_until_visible_work_finishes():
    s = fresh(2*GB)
    visible = ask(s, 'visible', 100_000_000)
    upkeep = ask(s, 'upkeep', FAST_BYTES, 'eventually', 'upkeep')
    assert upkeep.granted is None and upkeep.baseline is None
    s.finish(visible.id)
    assert upkeep.granted is not None
    another = ask(s, 'another', 100_000_000)
    assert another.granted is not None  # Upkeep never blocks a visible admission.
    s.finish(upkeep.id)
    next_step = ask(s, 'upkeep', FAST_BYTES, 'eventually', 'upkeep')
    assert next_step.granted is None
    s.finish(another.id)
    assert next_step.granted is not None


def test_two_windows_hide_restore_and_priority_updates():
    s = fresh(2*GB)
    quick = ask(s, 'quick', kind='quick')
    hidden = ask(s, 'hidden', owner='hidden-window')
    visible = ask(s, 'visible', owner='visible-window')
    s.set_visible('hidden-window', False)
    assert hidden.cls == 'eventually'
    s.change(hidden.id, hidden.owner, 'soon')
    assert hidden.cls == 'eventually' and hidden.requested_cls == 'soon'
    s.finish(quick.id)
    assert visible.granted is not None and hidden.granted is None
    hidden_quick = ask(s, 'hidden-quick', kind='quick', owner='hidden-window')
    assert hidden_quick.granted is None
    s.set_visible('hidden-window', True)
    assert hidden.cls == 'soon' and hidden_quick.cls == 'now'
    assert hidden_quick.granted is not None
    s.finish(hidden_quick.id)
    s.finish(visible.id)
    assert hidden.granted is not None
    s.disconnect('hidden-window')
    assert not s.hidden and hidden.id not in s.jobs


def test_visibility_publishes_class_even_when_wait_reason_does_not_change():
    s = fresh(2*GB)
    ask(s, 'a'); ask(s, 'b')
    messages = []
    waiting = s.ask('queued', 'window', 'photo', 'source', FAST_BYTES, 'now', notify=messages.append)
    reason = waiting.reason
    s.set_visible('window', False)
    assert waiting.reason == reason
    assert messages[-1]['type'] == 'waiting' and messages[-1]['cls'] == 'eventually'
    s.set_visible('window', True)
    assert messages[-1]['cls'] == 'now' and waiting.granted is None


def test_measured_total_and_new_estimate_must_fit():
    s = fresh(2_700_000_000)
    s.update(total=2_720_000_000, available=60*GB, ram=68*GB)
    large = ask(s, "avif", 1_602_741_504)
    assert large.granted is None and large.reason == "measured memory"
    s.update(total=2_000_000_000, available=60*GB, ram=68*GB)
    assert large.granted is not None


def test_new_grants_charge_sample_once_until_measured():
    s = fresh(2_700_000_000)
    s.update(total=2_500_000_000, available=60*GB, ram=68*GB)
    first = ask(s, "first", GB)
    second = ask(s, "second", GB)
    assert first.granted is not None and second.granted is None
    s.update(total=2_000_000_000, sampled_grants={first.id}, available=60*GB, ram=68*GB)
    assert second.granted is not None


def test_grant_during_sample_is_still_charged():
    s = fresh(2_700_000_000)
    s.update(total=2_500_000_000, available=60*GB, ram=68*GB)
    first = ask(s, "first", GB)
    s.update(total=2_500_000_000, sampled_grants=set(), available=60*GB, ram=68*GB)
    second = ask(s, "second", GB)
    assert first.granted is not None and second.granted is None


def test_prefetch_quick_does_not_delay_visible_development():
    s = fresh(20*GB)
    prefetch = ask(s, "prefetch", kind="quick", cls="soon")
    assert prefetch.granted is not None
    assert ask(s, "visible").granted is not None


def test_gpu_end_frees_place_but_keeps_memory_until_save_finishes():
    s = fresh(20*GB)
    first, second, next_job = [ask(s, name) for name in ["first", "second", "next"]]
    assert next_job.granted is None
    s.gpu_done(first.id, first.owner)
    assert first.id in s.jobs and first.granted is not None
    assert first.saving == "active" and not first.development
    assert next_job.granted is not None
    assert sum(j.development for j in s.jobs.values()) == 2
    s.finish(first.id, first.owner)
    assert first.id not in s.jobs


def test_saving_bounded_and_pipeline_backpressures_new_developments():
    s = fresh(20*GB)
    a, b, c, d, e = [ask(s, name) for name in "abcde"]
    s.gpu_done(a.id, a.owner)
    assert c.granted is not None
    s.gpu_done(b.id, b.owner)
    assert d.granted is None
    s.gpu_done(c.id, c.owner)
    assert c.saving == "waiting"
    assert sum(j.saving == "active" for j in s.jobs.values()) == 2
    s.finish(a.id)
    assert c.saving == "active" and d.granted is None
    s.finish(b.id)
    assert d.granted is not None and e.granted is not None


def test_saving_memory_estimate_still_prevents_new_admission():
    s = fresh(GB)
    a, b = ask(s, "a", GB), ask(s, "b", GB)
    s.gpu_done(a.id, a.owner)
    assert b.granted is None
    s.finish(a.id)
    assert b.granted is not None


def test_overrun_logs_active_types_duration_and_repeated_proposal_without_rate_change(monkeypatch):
    events, now = [], [0]
    monkeypatch.setattr("hdr_finisher.library_scheduler.log", lambda event, **fields: events.append((event, fields)))
    s = Scheduler(clock=lambda: now[0])
    s.update(total=2*GB, available=60*GB, ram=68*GB)
    job = s.ask("avif", "window", "photo.avif", "source", 2*GB)
    for start in (1, 5):
        now[0] = start
        s.update(total=4_011_418_177, available=60*GB, ram=68*GB)
        now[0] = start+2
        s.update(total=3*GB, available=60*GB, ram=68*GB)
    starts = [fields for event, fields in events if event == "library_memory_over_ceiling"]
    ends = [fields for event, fields in events if event == "library_memory_under_ceiling"]
    proposals = [fields for event, fields in events if event == "library_estimate_proposal"]
    assert len(starts) == len(ends) == 2
    assert starts[0]["active_grants"][0]["file_type"] == ".avif"
    assert ends[0]["duration_ms"] == 2000 and ends[0]["over_bytes"] == 11_418_177
    assert len(proposals) == 1 and proposals[0]["overrun_count"] == 2
    assert job.estimate == 2*GB


def test_atomic_gpu_wait_holds_neither_resource_and_saving_releases_gpu():
    s = fresh(20*GB)
    s.gpu_draw_room = 100
    s.update_gpu(1000, external=200)
    a = s.ask('a', 'w', 'a.raw', 'source', GB, gpu_bytes=500)
    b = s.ask('b', 'w', 'b.raw', 'source', GB, gpu_bytes=300)
    assert a.granted is not None and b.granted is None
    assert s.gpu_reserved() == 500
    assert s.gpu_refine('a', 350)
    assert b.granted is not None and s.gpu_reserved() == 650
    s.gpu_done('a', 'w')
    assert s.gpu_reserved() == 300 and a.saving
    assert a.estimate == GB


def test_unified_gpu_is_charged_to_ram_without_changing_base_estimate():
    s = fresh(GB)
    s.update_gpu(4*GB)
    ask(s, 'busy', 64_000_000)
    job = s.ask('a', 'w', 'a.raw', 'source', 800_000_000, gpu_bytes=400_000_000, gpu_unified=True)
    assert job.estimate == 1_200_000_000 and job.granted is None
    s.set_ceiling(4*GB)
    assert job.granted is not None


def test_priority_preemption_frees_unused_gpu_and_waits_for_active_safe_point(monkeypatch):
    events, notifications, now = [], [], [1]
    monkeypatch.setattr('hdr_finisher.library_scheduler.log', lambda event, **fields: events.append((event,fields)))
    s = Scheduler(ceiling=20*GB, clock=lambda:now[0])
    s.update_gpu(4*GB)
    a = s.ask('a','w','a.raw','source',GB,gpu_bytes=GB,notify=notifications.append)
    b = s.ask('b','w','b.raw','source',GB,gpu_bytes=GB)
    assert s.gpu_refine('b',GB)
    s.preempt_gpu()
    assert a.gpu_bytes == 0 and b.gpu_bytes == GB
    assert notifications[-1]['type'] == 'gpu-preempt'
    now[0] = 1.125
    s.finish('b','w')
    release = [fields for event,fields in events if event == 'library_gpu_priority_release']
    assert release[-1]['wait_ms'] == 125


def test_oldest_reclaims_then_starts_without_starvation_or_lower_admission():
    s = fresh(2_700_000_000)
    s.update(total=2_500_000_000, caches=800_000_000, available=60*GB, ram=68*GB)
    s.heartbeat("window")
    big = ask(s, "big", 2*GB)
    small = ask(s, "small", FAST_BYTES)
    lower = ask(s, "lower", FAST_BYTES, "soon")
    assert s.reclamation and small.granted is None and lower.granted is None
    request = s.reclamation_request()
    # A backend acknowledgement alone cannot grant or refuse before the window.
    s.reclaimed(request["epoch"])
    s.update(total=1_500_000_000, available=60*GB, ram=68*GB)
    assert big.granted is None
    s.reclaimed(request["epoch"], "window")
    s.update(total=1_500_000_000, available=60*GB, ram=68*GB)
    assert big.granted is not None and small.granted is None


def test_exhausted_reclamation_ends_once_and_releases_the_queue():
    s = fresh()
    events = []
    s.update(total=2_500_000_000, available=60*GB, ram=68*GB)
    big = s.ask("big", "window", "big.avif", "source", 2*GB, notify=events.append)
    small = ask(s, "small", FAST_BYTES)
    request = s.reclamation_request()
    s.reclaimed(request["epoch"])
    s.update(total=2_500_000_000, available=60*GB, ram=68*GB)
    assert big.outcome == "needs more memory" and big.ready.is_set()
    assert "big" not in s.jobs and small.granted is not None
    s.update(total=2_300_000_000, available=60*GB, ram=68*GB)
    assert sum(e["type"] == "needs-memory" for e in events) == 1


def test_higher_classes_and_fast_lane_bypass_starvation_guard():
    s = fresh()
    s.update(total=2_300_000_000, available=60*GB, ram=68*GB)
    blocked = ask(s, "blocked", 2*GB, "soon")
    ask(s, "later", FAST_BYTES, "soon")
    assert s.reclamation
    now = ask(s, "visible", FAST_BYTES)
    grade = ask(s, "grade", GB, "Grade")
    quick = ask(s, "preview", FAST_BYTES, kind="quick")
    assert blocked.granted is None
    assert now.granted is not None and grade.granted is not None and quick.granted is not None


def test_grade_preempts_guard_before_reclamation_and_during_owner_wait():
    s = Scheduler()
    s.update(total=2_500_000_000, available=60*GB, ram=68*GB)
    active = ask(s, "active", 200_000_000)
    blocked = ask(s, "blocked", 2*GB)
    ask(s, "later", FAST_BYTES)
    assert blocked.granted is None and blocked.bypassed
    grade = ask(s, "grade-before", 8*GB, "Grade")
    assert grade.ready.is_set() and grade.granted is not None
    s.finish(grade.id)
    s.heartbeat("window")
    s.finish(active.id)
    s.finish("later")
    request = s.reclamation_request()
    assert request and not blocked.ready.is_set()
    grade = ask(s, "grade-during", 8*GB, "Grade")
    assert grade.ready.is_set() and grade.granted is not None
    assert s.reclamation["owners"] == {"window"}
    assert not s.reclamation["backend_done"]
    s.reclaimed(request["epoch"])
    s.reclaimed(request["epoch"], "window")
    # A census still has not arrived; Grade did not need it.
    assert s.reclamation and not blocked.ready.is_set()


def test_guarded_admission_uses_elastic_limit_but_ordinary_admission_does_not():
    for total, expected in [(2_400_000_000, True), (2_400_000_001, False)]:
        s = Scheduler()
        s.update(total=total, available=60*GB, ram=68*GB)
        big = ask(s, "big", 2*GB)
        assert big.granted is None  # Ordinary admission still stops at 4 GB.
        s.update(total=total, available=60*GB, ram=68*GB)
        if not expected:
            request = s.reclamation_request()
            assert request
            s.reclaimed(request["epoch"])
            s.update(total=total, available=60*GB, ram=68*GB)
            assert big.outcome == "needs more memory"
        assert (big.granted is not None) == expected


def test_elastic_guard_requires_same_class_to_drain_and_keeps_reserve_hard():
    s = Scheduler()
    s.update(total=2_400_000_000, available=60*GB, ram=68*GB)
    active = ask(s, "active", FAST_BYTES)
    big = ask(s, "big", 2*GB)
    ask(s, "later", FAST_BYTES)
    assert big.bypassed and big.granted is None
    s.update(total=2_400_000_000, available=8_000_000_000, ram=68*GB)
    s.finish(active.id)
    s.finish("later")
    assert big.granted is None and big.reason == "system reserve"
    s.update(total=2_400_000_000, available=8_800_000_000, ram=68*GB)
    assert big.granted is None  # Recovery first restores the measured-memory guard.
    s.update(total=2_400_000_000, available=8_800_000_000, ram=68*GB)
    assert big.granted is not None  # Exactly the hard reserve remains.


def test_guarded_gpu_preemption_keeps_grade_safe_point_release():
    s = Scheduler()
    s.update(total=2_400_000_000, available=60*GB, ram=68*GB)
    s.update_gpu(4*GB)
    job = s.ask("big", "window", "big.raw", "source", 2*GB, gpu_bytes=GB)
    s.update(total=2_400_000_000, available=60*GB, ram=68*GB)
    assert job.granted is not None and s.gpu_refine(job.id, GB)
    s.preempt_gpu()
    grade = ask(s, "grade", 8*GB, "Grade")
    assert grade.granted is not None
    assert s.gpu_reserved() == GB  # Active work reaches its existing safe point.
    s.finish(job.id)
    assert s.gpu_reserved() == 0
