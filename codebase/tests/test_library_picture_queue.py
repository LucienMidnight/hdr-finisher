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
