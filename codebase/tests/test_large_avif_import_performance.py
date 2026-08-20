from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter, sleep

import pytest

from hdr_finisher.import_jobs import ImportJobManager
from hdr_finisher.media_browser import MediaBrowserStore
from hdr_finisher.models import RawImportSettings
from hdr_finisher.sessions import SessionStore


LARGE_AVIF = os.environ.get("HDR_FINISHER_LARGE_AVIF")


@pytest.mark.skipif(not LARGE_AVIF, reason="Set HDR_FINISHER_LARGE_AVIF to run the local 40+ MP AVIF gate.")
def test_large_gain_map_avif_builds_a_staged_session_within_budget(tmp_path: Path) -> None:
    source = Path(str(LARGE_AVIF)).expanduser().resolve(strict=True)
    assert source.suffix.lower() == ".avif"
    budget_seconds = float(os.environ.get("HDR_FINISHER_LARGE_AVIF_BUDGET_SECONDS", "120"))

    sessions = SessionStore()
    browser = MediaBrowserStore(tmp_path / "app-data")
    manager = ImportJobManager(sessions, browser, workers=1)
    started = perf_counter()
    try:
        job = manager.start(source, RawImportSettings())
        while job.state not in {"ready", "error", "cancelled"}:
            if perf_counter() - started >= budget_seconds:
                manager.cancel(job.job_id)
                pytest.fail(
                    f"Large staged AVIF import exceeded its {budget_seconds:.1f}s budget in "
                    f"phase {job.phase!r}: {job.phase_label}"
                )
            sleep(0.05)
        elapsed = perf_counter() - started
        assert job.state == "ready", job.error or job.phase_label
        session = sessions.current()
        assert session is not None
    finally:
        manager.close()

    assert session.source.width * session.source.height >= 40_000_000
    assert session.metadata.get("gain_map_applied") is True
    assert session.metadata.get("decoder_normalized_to_acescg") is True
    assert session.image.dtype.name == "float32"
    assert session.sdr_reference_image is not None
    assert elapsed < budget_seconds, (
        f"Large AVIF import took {elapsed:.1f}s; budget is {budget_seconds:.1f}s. "
        f"Timings: {session.metadata.get('decode_timings_ms')}"
    )
