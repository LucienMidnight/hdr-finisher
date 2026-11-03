"""Saved-grade hand-offs: identity, persistent pixels, and no development."""
import numpy as np
import pytest
from fastapi import HTTPException
from test_library_grades import setup, edit
from hdr_finisher.library_documents import LibraryDocuments
from hdr_finisher.library_live import LivePictures
from hdr_finisher.library_grade_pictures import GradePictures


def service(setup):
    photo, store, session, marks, grades = setup
    stat = photo.stat()
    with marks._connect() as db:
        db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,NULL)", (str(photo), stat.st_size, stat.st_mtime_ns))
    live = LivePictures(marks.database.parent, marks, LibraryDocuments(marks))
    return GradePictures(live, store)


def pixels():
    image = np.ones((16, 32, 4), dtype="<f2")
    image[..., :3] = np.linspace(.02, .8, 32, dtype="<f2")[None, :, None]
    return image


def test_unsaved_recovery_never_publishes_as_the_library_grade(setup):
    photo, store, session, marks, grades = setup
    cache = service(setup)
    edit(store, session)
    grades.capture(str(session.session_id))
    from hdr_finisher.library_documents import identity
    grade = identity(session.edit_document().model_dump(mode="json"))
    with pytest.raises(HTTPException) as error:
        cache.owner(str(session.session_id), grade, session.edit_revision)
    assert error.value.status_code == 409
    assert "picture" not in grades.status(str(session.session_id))


def test_saved_capture_survives_restart_with_both_thumbnail_formats_and_hdr_cap(setup, monkeypatch):
    photo, store, session, marks, grades = setup
    cache = service(setup)
    edit(store, session)
    ticket = grades.save(str(session.session_id))["picture"]
    # A capture must never ask any decoder to develop the source again.
    monkeypatch.setattr(store, "prepare_session", lambda *a, **k: pytest.fail("redevelopment"))
    image = pixels()
    for lane in ("sdr", "hdr"):
        cache.write(str(session.session_id), ticket["grade_identity"], ticket["revision"], lane, image.tobytes(), 32, 16, 256)
        for format in ("bgra8unorm", "rgba8unorm"):
            info, body = cache.thumbnails.read(str(photo), lane, format)
            assert len(body) == info["stride"]*16
        restarted = GradePictures(cache.live, store)
        current = restarted.screens.identity(str(photo), 2560, 2560, lane)
        info, body = restarted.screens.read(current)
        assert info["grade_picture"]
        if lane == "hdr":
            from colour.models import eotf_ST2084
            encoded = np.frombuffer(body, "<u2").reshape(16, 32, 4)[..., :3]
            assert eotf_ST2084(encoded.astype(np.float32)/65535).max() <= 1000
        else:
            from hdr_finisher.jpegxl import _srgb_oetf
            info, exact = restarted.thumbnails.read(str(photo), lane, "rgba8unorm")
            rows = np.frombuffer(exact, "u1").reshape(16, info["stride"])
            actual = rows[:, :128].reshape(16, 32, 4)[..., :3]
            np.testing.assert_array_equal(actual, np.round(_srgb_oetf(image[..., :3].astype(np.float32))*255).astype("u1"))


def test_old_capture_cannot_replace_newer_saved_grade(setup):
    photo, store, session, marks, grades = setup
    cache = service(setup)
    edit(store, session, 1)
    older = grades.save(str(session.session_id))["picture"]
    edit(store, session, 2)
    newer = grades.save(str(session.session_id))["picture"]
    image = pixels()
    cache.write(str(session.session_id), newer["grade_identity"], newer["revision"], "sdr", image.tobytes(), 32, 16, 256)
    expected = cache.thumbnails.read(str(photo), "sdr", "bgra8unorm")
    with pytest.raises(HTTPException) as error:
        cache.write(str(session.session_id), older["grade_identity"], older["revision"], "sdr", image.tobytes(), 32, 16, 256)
    assert error.value.status_code == 409
    assert cache.thumbnails.read(str(photo), "sdr", "bgra8unorm") == expected


def test_fallback_loans_the_open_grade_source_without_another_import(setup, monkeypatch):
    photo, store, session, marks, grades = setup
    cache = service(setup)
    edit(store, session)
    ticket = grades.save(str(session.session_id))["picture"]
    from hdr_finisher.sessions import SessionStore
    monkeypatch.setattr(SessionStore, "prepare_session", lambda *a, **k: pytest.fail("redevelopment"))
    result = cache.sources(str(session.session_id), ticket["grade_identity"])
    assert [scene["edge"] for scene in result["scenes"]] == [640, 2560]
    for scene in result["scenes"]:
        assert scene["adjustments"]["hdr"]["exposure"] == 1
        assert cache.live.cache.open(scene["source_key"])


def test_sony_fallback_never_enters_the_raw_band_decoder(setup, monkeypatch):
    photo, store, session, marks, grades = setup
    cache = service(setup)
    edit(store, session)
    grades.save(str(session.session_id))
    saved = cache.live.document(str(photo))
    raw = photo.with_suffix(".ARW")
    raw.write_bytes(photo.read_bytes())
    from hdr_finisher import library_cpu_bands, library_gpu_raw, library_rgb
    monkeypatch.setattr(library_cpu_bands, "develop", lambda *a, **k: pytest.fail("RAW band development"))
    monkeypatch.setattr(library_gpu_raw, "xtrans_cpu", lambda path: False)
    monkeypatch.setattr(library_rgb, "assumed_interpretation", lambda *args: None)
    from hdr_finisher.library_live import _develop_cpu
    result = _develop_cpu(cache.live.root, raw, saved, 640,
        cache=cache.live.cache, prepared={"source": session})
    assert result["edge"] == 640
