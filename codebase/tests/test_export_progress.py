import threading
import time

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.batch_export import PhotoProgress
from hdr_finisher.export_progress import ExportPlan, ExportProgress, estimate_remaining, plan_export
from hdr_finisher.export_timing import export_clock, lane, stage, tick
from hdr_finisher.models import ExportSettings
from hdr_finisher.sessions import SessionStore


def _session(tmp_path, size=(48, 72)):
    source = tmp_path / "photo.png"
    pixels = (np.random.default_rng(3).random((*size, 3)) * 255).astype(np.uint8)
    Image.fromarray(pixels).save(source)
    store = SessionStore()
    return store, store.get(store.create_session(source).session_id)


def _settings(tmp_path, **finishing):
    return ExportSettings(format="avif_gain_map", output_path=str(tmp_path / "out.avif"),
                          output_finishing={"resize_mode": "original", **finishing})


def test_plan_weighs_only_the_stages_that_will_run(tmp_path):
    store, session = _session(tmp_path)
    try:
        adjustments = session.adjustments.model_copy(deep=True)
        plain = plan_export(session, _settings(tmp_path), adjustments)
        stages = {name for _, name in plain.items}
        assert "film_grain" not in stages and "halation" not in stages and "geometry" not in stages
        for branch in (adjustments.hdr, adjustments.sdr):
            branch.film_look_section_enabled = True
            branch.film_look.grain_enabled = True
            branch.film_look.grain_amount = 40.0
        resized = plan_export(session, _settings(tmp_path, resize_mode="long_edge", long_edge=36), adjustments)
        assert {("hdr", "film_grain"), ("sdr", "film_grain"), ("hdr", "tone_colour")} <= set(resized.items)
        assert all(seconds > 0 for seconds in resized.items.values())
    finally:
        store.clear()


def test_progress_follows_ticks_and_lanes_and_never_goes_back():
    with export_clock() as clock:
        plan = ExportPlan()
        plan.add("hdr", "film_grain", 1.0)
        plan.add("sdr", "film_grain", 1.0)
        plan.add("encode", "encode", 1.0)
        progress = ExportProgress(clock, plan)
        seen = [progress.fraction()]
        with lane("hdr"), stage("film_grain"):
            for done in range(1, 5):
                tick(done, 4)
                seen.append(progress.fraction())
            assert progress.label() == "Rendering HDR"
        # Ticks cap a running stage below done; the finished lane counts whole.
        assert seen[-1] == pytest.approx(.95 / 3, abs=.01)
        seen.append(progress.fraction())
        assert seen[-1] == pytest.approx(1 / 3, abs=.01)
        with lane("sdr"), stage("film_grain"):
            tick(1, 2)
            seen.append(progress.fraction())
        with lane("encode"), stage("validate"):
            assert progress.label() == "Finishing"
        seen.append(progress.fraction())
    assert seen == sorted(seen)
    assert seen[-1] == .99  # Only the caller marks the export done.


def test_photo_progress_moves_during_development_and_continues_from_it():
    photo = PhotoProgress(versions=2)
    first = photo.fraction()
    time.sleep(.05)
    during = photo.fraction()
    assert 0 < first < during < PhotoProgress.DEVELOP_SHARE
    assert photo.snapshot()["label"] == "Developing RAW"
    photo.developed()
    with export_clock() as clock:
        plan = ExportPlan()
        plan.add("hdr", "tone_colour", 1.0)
        ExportProgress(clock, plan)
        photo.begin(0, clock)
        assert photo.fraction() >= during
        with lane("hdr"):
            pass
        halfway = photo.fraction()
        assert halfway == pytest.approx(photo.base + (1 - photo.base) / 2, abs=.01)


def test_remaining_time_waits_for_enough_progress():
    assert estimate_remaining(.04, 10) is None
    assert estimate_remaining(.5, 2) is None
    assert estimate_remaining(.25, 10) == 30
    assert estimate_remaining(1.0, 10) == 0


def test_a_real_export_reports_rising_progress_and_stage_timing(tmp_path):
    from hdr_finisher.binaries import resolve_binary
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    if resolve_binary("avifgainmaputil") is None:
        pytest.skip("avifgainmaputil is not installed")
    store, session = _session(tmp_path, size=(256, 384))
    try:
        for branch in (session.adjustments.hdr, session.adjustments.sdr):
            branch.film_look_section_enabled = True
            branch.film_look.grain_enabled = True
            branch.film_look.grain_amount = 40.0
        backend = build_export_backends(probe_capabilities())["avif_gain_map"]
        seen, done = [], threading.Event()
        with export_clock() as clock:
            def watch():
                while not done.is_set():
                    if clock.progress is not None:
                        seen.append(clock.progress.fraction())
                    time.sleep(.002)
            watcher = threading.Thread(target=watch)
            watcher.start()
            try:
                response = backend.export(session, _settings(tmp_path, resize_mode="long_edge", long_edge=300))
            finally:
                done.set()
                watcher.join()
        assert response.accepted, response.message
        assert len(seen) > 2 and seen == sorted(seen)
        assert clock.progress.fraction() == .99  # Every lane finished; the caller reports done.
        summary = clock.summary()
        assert summary["lanes"]["hdr"]["film_grain"] > 0 and "encode" in summary["lanes"]
        assert summary["unattributed_percent"] < 50
    finally:
        store.clear()
