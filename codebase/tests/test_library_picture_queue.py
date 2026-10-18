from threading import Lock
from types import SimpleNamespace

from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_picture_queue import PictureQueue


def test_paused_picture_work_resumes_on_the_next_launch(tmp_path):
    """Steve, October 18, 2026: a pause from an earlier session left pictures waiting for hours."""
    kept = SimpleNamespace(marks=LibraryMarks(tmp_path), worker=None, jobs={}, _lock=Lock())
    queue = PictureQueue(kept)
    queue.command({"action": "pause"})
    assert queue.paused

    relaunched = PictureQueue(SimpleNamespace(marks=LibraryMarks(tmp_path), worker=None, jobs={}, _lock=Lock()))

    assert relaunched.paused is False


def test_two_pictures_are_made_at_once_and_never_the_same_photo_twice(tmp_path):
    """One photo's CPU preparation overlaps the previous photo's GPU render."""
    import time
    scheduled = []
    kept = SimpleNamespace(marks=LibraryMarks(tmp_path), worker=object(), jobs={}, _lock=Lock(),
        _requested=set(), _retry_after={}, _closed=False)
    kept.request = lambda path: {"edited": True, "grade_identity": "g"}
    kept.cached = lambda path: False
    def schedule(path, priority, _queued):
        scheduled.append(path); kept.jobs[path] = object()
    kept.schedule = schedule
    queue = PictureQueue(kept)
    for name in ("a", "b", "c"):
        queue.enqueue(str(tmp_path / name), "g")
    deadline = time.monotonic() + 5
    while len(scheduled) < 2 and time.monotonic() < deadline:
        time.sleep(.05)
    time.sleep(.6)
    queue.stop.set()
    assert len(scheduled) == 2 and len(set(scheduled)) == 2
