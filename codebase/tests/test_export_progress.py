import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.batch_export import PhotoProgress
from hdr_finisher.export_progress import STAGE_COST, ExportPlan, ExportProgress, estimate_remaining, plan_export
from hdr_finisher.export_timing import active_clock, export_clock, lane, stage, tick
from hdr_finisher.models import ExportResponse, ExportSettings
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


def test_jxl_hdr_plans_sdr_only_for_a_proof(tmp_path):
    store, session = _session(tmp_path)
    try:
        settings = ExportSettings(format="jpegxl_hdr")
        direct = plan_export(session, settings, session.adjustments)
        assert {"hdr", "encode"} == {name for name, _ in direct.items}
        object.__setattr__(settings, "_proof_endpoint_directory", tmp_path)
        proof = plan_export(session, settings, session.adjustments)
        assert {"hdr", "sdr", "encode"} == {name for name, _ in proof.items}
    finally:
        store.clear()


def test_linked_sdr_plan_uses_hdr_grade_and_full_single_lane_denoise_weight(tmp_path):
    store, session = _session(tmp_path)
    try:
        settings = ExportSettings(format="sdr_jpegxl", output_finishing={"resize_mode": "long_edge", "long_edge": 36})
        adjustments = session.adjustments
        adjustments.sdr.linked_to_hdr = True
        adjustments.hdr.film_look_section_enabled = True
        adjustments.hdr.film_look.grain_enabled = True
        adjustments.hdr.film_look.grain_amount = 40
        for denoise in (session.denoise.hdr, session.denoise.sdr):
            denoise.enabled = True
            denoise.controls.method = "clean_grain"
        plan = plan_export(session, settings, adjustments)
        assert ("sdr", "film_grain") in plan.items
        denoise_weight = sum(weight for (_, stage), weight in plan.items.items() if stage == "denoise")
        assert denoise_weight == pytest.approx(STAGE_COST["denoise"] * 48 * 72 / 1e6)
        with export_clock() as clock:
            assert ExportProgress(clock, plan).label() == "Rendering SDR"
    finally:
        store.clear()


def test_photo_progress_uses_version_format_before_the_clock_has_a_plan():
    photo = PhotoProgress(versions=2)
    photo.developed(first_format="sdr_jpeg")
    assert photo.snapshot()["label"] == "Rendering SDR"
    photo.begin(1, None, export_format="sdr_jpegxl")
    with export_clock() as clock:
        photo.begin(1, clock)
        assert photo.snapshot()["label"] == "Rendering SDR"


@pytest.mark.parametrize("format_name,proof", [
    ("sdr_jpegxl", False), ("jpegxl_hdr", False), ("jpegxl_hdr", True),
])
def test_jxl_encodes_after_mask_scope_in_encode_lane(tmp_path, monkeypatch, format_name, proof):
    from hdr_finisher import exporters, local_adjustments
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.models import CapabilityStatus

    capabilities = probe_capabilities()
    if capabilities["jpegxl_export"].status != CapabilityStatus.AVAILABLE:
        pytest.skip("JPEG XL encoder is unavailable")
    store, session = _session(tmp_path)
    try:
        settings = ExportSettings(format=format_name, output_path=str(tmp_path / "out.jxl"))
        if proof:
            object.__setattr__(settings, "_proof_endpoint_directory", tmp_path)
        name = "encode_hdr_jpegxl" if format_name == "jpegxl_hdr" else "encode_sdr_jpegxl"
        encode = getattr(exporters, name)

        def check_encode(*args, **kwargs):
            assert local_adjustments._fixed_mask_memo.get() is None
            clock = active_clock()
            assert clock.current() == ("encode", "encode")
            assert clock.progress.label() == "Encoding"
            return encode(*args, **kwargs)

        monkeypatch.setattr(exporters, name, check_encode)
        with export_clock() as clock:
            response = exporters.build_export_backends(capabilities)[format_name].export(session, settings)
        assert response.accepted, response.message
        assert clock.progress.fraction() == 1.0
        assert "validate" in clock.summary()["lanes"]["encode"]
        if proof:
            assert all(endpoint.path.is_file() for endpoint in settings._proof_endpoints)
    finally:
        store.clear()


def test_finishing_an_older_live_export_keeps_the_newer_export_visible(monkeypatch):
    from hdr_finisher import main

    older, newer = threading.Event(), threading.Event()
    finish_older, finish_newer = threading.Event(), threading.Event()
    session_id = "overlapping-export-progress"
    stored_session = SimpleNamespace(source_path="photo.png", metadata={}, edit_revision=0)
    monkeypatch.setattr(main, "store", SimpleNamespace(get=lambda _id: stored_session))
    monkeypatch.setattr(main, "desktop_authoring_secret", None)

    def export(_session, settings):
        started, finish = (older, finish_older) if settings.format == "sdr_png" else (newer, finish_newer)
        progress = ExportProgress(active_clock(), ExportPlan(default_label=settings.format))
        started.set()
        assert finish.wait(5)
        return ExportResponse(accepted=True, backend=settings.format, message=progress.label())

    backend = SimpleNamespace(export=export)
    monkeypatch.setattr(main, "get_export_backends", lambda: {"sdr_png": backend, "sdr_jpeg": backend})
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            first = pool.submit(main.export, session_id, ExportSettings(format="sdr_png"))
            assert older.wait(5)
            second = pool.submit(main.export, session_id, ExportSettings(format="sdr_jpeg"))
            assert newer.wait(5)
            finish_older.set()
            assert first.result(5).accepted
            assert main.export_progress(session_id)["label"] == "sdr_jpeg"
            finish_newer.set()
            assert second.result(5).accepted
            assert not main.export_progress(session_id)["running"]
        finally:
            finish_older.set()
            finish_newer.set()


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
        # A finished loop counts its stage whole, as does its lane finishing.
        assert seen[-1] == pytest.approx(1 / 3, abs=.01)
        seen.append(progress.fraction())
        assert seen[-1] == pytest.approx(1 / 3, abs=.01)
        with lane("sdr"), stage("film_grain"):
            tick(1, 2)
            seen.append(progress.fraction())
            assert progress.label() == "Rendering SDR"
        # Between renditions the label stays on the last rendition, not RAW.
        assert progress.label() == "Rendering SDR"
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


def test_a_stage_past_its_estimate_keeps_moving_without_reaching_done():
    from hdr_finisher.export_progress import timed_share
    shares = [timed_share(elapsed, 5.0) for elapsed in (0, 2.5, 4.5, 5.0, 6.0, 8.0, 15.0)]
    assert shares == sorted(set(shares)) and shares[-1] < 1.0
    assert timed_share(4.5, 5.0) == pytest.approx(.9)
    # Past the estimate, a half-second update still moves a 5% stage visibly.
    assert (timed_share(10.5, 5.0) - timed_share(10.0, 5.0)) * .05 > 1e-4


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
        assert clock.progress.fraction() == 1.0
        summary = clock.summary()
        assert summary["lanes"]["hdr"]["film_grain"] > 0 and "encode" in summary["lanes"]
        assert summary["unattributed_percent"] < 50
    finally:
        store.clear()
