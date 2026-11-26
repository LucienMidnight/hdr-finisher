"""Metadata helper shutdown releases pipes as well as the child process."""
import gc
import sys
import weakref

from hdr_finisher import export_metadata as metadata


def test_close_releases_helper_resources(monkeypatch):
    script = "import sys\nfor line in sys.stdin:\n if line.strip() == '-execute': print('ok\\n{ready}', flush=True)"
    monkeypatch.setattr(metadata, "command", lambda: [sys.executable, "-u", "-c", script])
    tool = metadata.ExifTool()
    try:
        assert tool.execute("-ver").strip() == "ok"
    finally:
        tool.close()
    assert tool.process.poll() is not None
    assert tool.process.stdin.closed
    assert tool.process.stdout.closed
    assert not tool.reader.is_alive()
    tool.close()  # Explicit close and application shutdown may both run.
    reference = weakref.ref(tool)
    del tool
    gc.collect()
    assert reference() is None
