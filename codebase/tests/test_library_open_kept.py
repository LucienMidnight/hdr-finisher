from concurrent.futures import CancelledError
from pathlib import Path
from threading import Event, current_thread, main_thread
import time
import weakref
import numpy as np
import pytest

from test_library_grades import setup, saved, edit
from hdr_finisher import exporters
from hdr_finisher.library_kept import KeptPictures, capture_source, produce


class Worker:
    def status(self): return {"paused": False}
    def submit_library(self, *args, **kwargs):
        pytest.fail("A Grade save must not reopen its photo in the helper")


def wait_for(predicate):
    end = time.monotonic() + 5
    while not predicate() and time.monotonic() < end:
        time.sleep(.01)
    assert predicate()


def test_open_and_reopened_sources_have_identical_renditions(setup, monkeypatch, tmp_path):
    photo, store, session, marks, grades = setup
    grade = saved(setup)
    renditions = []
    def encode(path, hdr, sdr, *args):
        renditions.append((hdr.copy(), sdr.copy()))
        Path(path).write_bytes(b"test")
    monkeypatch.setattr(exporters, "write_jpeg_gainmap_renditions", encode)
    before = produce(tmp_path, photo, grade, 64)
    snapshot = capture_source(session)
    after = produce(tmp_path, photo, grade, 64, source=snapshot)
    for lane in range(2):
        np.testing.assert_array_equal(renditions[0][lane], renditions[1][lane])
    assert not snapshot
    for result in (before, after): Path(result["temporary"]).unlink()


@pytest.mark.parametrize("opened_white,saved_white", [(203, 203), (100, 100), (203, 100), (100, 203)])
def test_absolute_hdr_white_guard_preserves_exact_renditions_and_jpeg(tmp_path, monkeypatch, opened_white, saved_white):
    from hdr_finisher.color import linear_srgb_to_acescg
    from hdr_finisher.models import EditCommand, ExportSettings
    from hdr_finisher.sessions import SessionStore
    photo = tmp_path / "authored.jpg"
    x = np.linspace(.03, .8, 96, dtype=np.float32)
    sdr = np.broadcast_to(np.stack((x, x*.7, x*.4), axis=1), (64, 96, 3)).copy()
    hdr = linear_srgb_to_acescg(sdr * .18 * 2)
    writer = exporters.write_jpeg_gainmap_renditions
    writer(photo, hdr, sdr, ExportSettings(quality=75, jpeg_gain_map_quality=75,
        jpeg_gain_map_scale="half", dithering="off"))
    store = SessionStore()
    session = store.prepare_session(photo, owns_source_path=False, hdr_reference_white_nits=opened_white)
    store.activate_session(session)
    try:
        store.apply_edit_commands(str(session.session_id), [EditCommand(expected_revision=session.edit_revision,
            command_type="set_hdr_reference_white", payload={"hdr_reference_white_nits": saved_white})])
        source = capture_source(session)
        assert (source is not None) == (opened_white == saved_white)
        grade = session.edit_document().model_dump(mode="json")
        captures = []
        def encode(path, hdr, sdr, *args):
            captures.append((hdr.copy(), sdr.copy()))
            writer(path, hdr, sdr, *args)
        monkeypatch.setattr(exporters, "write_jpeg_gainmap_renditions", encode)
        old = produce(tmp_path, photo, grade, 64)
        guarded = produce(tmp_path, photo, grade, 64, source=source)
        assert guarded["source_route"] == ("open-photo" if opened_white == saved_white else "reopened-photo")
        for lane in range(2): np.testing.assert_array_equal(captures[0][lane], captures[1][lane])
        assert Path(old["temporary"]).read_bytes() == Path(guarded["temporary"]).read_bytes()
        for result in (old, guarded): Path(result["temporary"]).unlink()
    finally:
        store.clear()


def test_capture_rejects_changed_decode_recipe(setup):
    from dataclasses import replace
    photo, store, session, marks, grades = setup
    session.render_cache.source_identity = replace(session.render_cache.source_identity, interpretation="different recipe")
    assert capture_source(session) is None


@pytest.mark.parametrize("change", ["next_photo", "new_save", "source_changed", "external_grade"])
def test_open_save_is_async_and_guards_publication(setup, monkeypatch, tmp_path, change):
    photo, store, session, marks, grades = setup
    grade = saved(setup)
    entered, release = Event(), Event()
    calls = []
    def encode(path, hdr, sdr, *args):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(5)
        Path(path).write_bytes(b"test")
    monkeypatch.setattr(exporters, "write_jpeg_gainmap_renditions", encode)
    kept = marks.kept = KeptPictures(tmp_path, marks, Worker())
    snapshot = capture_source(session)
    # The fixture retains its Grade session. Use a separate large source to
    # measure only references held by the producer, including its reduced frame.
    if change == "next_photo":
        snapshot["image"] = np.tile(session.image, (17, 12, 1))
    image_ref = weakref.ref(snapshot["image"])
    checking_save = [True]
    original_stat = kept.source_stat
    def source_stat(path):
        assert not checking_save[0] or current_thread() is not main_thread(), "Source reads must stay off saving"
        return original_stat(path)
    monkeypatch.setattr(kept, "source_stat", source_stat)
    try:
        kept.schedule(photo, grade, source=snapshot)
        checking_save[0] = False
        assert entered.wait(5)
        assert not snapshot, "Full-size references must be released before encoding"
        if change == "next_photo":
            store.clear()
            del session
        elif change == "new_save":
            edit(store, session, exposure=2)
            # Returns while the previous encode is blocked, and cancels that job.
            grades.save(str(session.session_id))
            wait_for(lambda: list(kept.jobs.values())[0].is_set() is False and len(calls) == 1)
        elif change == "source_changed":
            photo.write_bytes(photo.read_bytes() + b"changed")
        else:
            state = grades._get(str(photo))
            state["baseline"]["global_adjustments"]["hdr"]["exposure"] = 3
            state["indexed_grade"] = state["baseline"]
            grades._put(str(photo), state)
            import json
            document = json.loads(Path(str(photo)+".hdrf").read_text())
            document["grade"] = state["baseline"]
            Path(str(photo)+".hdrf").write_text(json.dumps(document))
        release.set()
        if change in {"next_photo", "new_save"}:
            wait_for(lambda: kept.cached(photo) is not None)
            assert kept.cached(photo)["grade_identity"] == kept.request(photo)["grade_identity"]
        else:
            kept._open_producer.shutdown(wait=True)
            assert kept.cached(photo) is None
        if change == "next_photo":
            wait_for(lambda: image_ref() is None)
    finally:
        release.set()
        kept.close()
