"""Match candidates rendered by the page instead of the CPU.

The page is stood in for by a thread that answers each offered candidate. It
renders with the export pipeline and returns half-float pixels, so these tests
cover the bridge and the fit's use of it, not the GPU renderer's agreement
with export (``verify_gpu_candidates`` measures that in the running app).
"""

from __future__ import annotations

import threading
from pathlib import Path

import numpy as np
import pytest
import tifffile

from hdr_finisher.adjustments import SDR_DISPLAY_REFERENCE_WHITE, _acescg_luma, apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
from hdr_finisher.sdr_match import (
    MATCH_SHOULDER_START,
    _quality_metrics,
    build_sdr_match_target,
    materialize_sdr_match,
)
from hdr_finisher.sdr_match_remote import (
    RemoteCandidateBridge,
    RemoteCandidateUnavailable,
    bridge_for,
    close_bridge,
    open_bridge,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hdr_match_scene.tiff"
OPTIONS = dict(reference_white_nits=203, source_pixel_scale=1.0)


def _grade() -> tuple[AdjustmentState, list[LocalAdjustment]]:
    """The calibrated grade of test_sdr_match_materialization: one the CPU fit accepts."""
    adjustments = AdjustmentState()
    hdr = adjustments.hdr
    hdr.exposure = 0.2
    hdr.contrast = 0.12
    hdr.saturation = 0.1
    hdr.tone_equalizer_nodes[-1].adjustment_ev = 0.2
    hdr.luma_curve = [[0, 0], [0.25, 0.23], [0.5, 0.5], [0.75, 0.78], [1, 1]]
    hdr.color_grading.highlights.luminance_ev = 0.15
    hdr.color_grading.highlights.saturation = 18
    hdr.film_look.print_strength = 8
    hdr.film_look.highlight_desaturation = 12
    hdr.film_look.bloom_amount = 6
    hdr.film_look.halation_amount = 5
    hdr.detail.clarity_amount = 4
    hdr.vignette.amount = -4

    local = LocalAdjustment(name="Calibrated highlight mask")
    local.hdr_grade.exposure = 0.2
    local.hdr_grade.highlights = 0.4
    local.hdr_grade.saturation = 0.08
    return adjustments, [local]


class _Page(threading.Thread):
    """Answers candidates the way the page does: half-float RGB, or an empty decline."""

    def __init__(self, bridge: RemoteCandidateBridge, source: np.ndarray, *, decline_at: int | None = None,
                 offset: float = 0.0) -> None:
        super().__init__(daemon=True)
        self.bridge = bridge
        self.source = source
        self.decline_at = decline_at
        self.offset = offset
        self.jobs: list[dict] = []
        self.locals: list[LocalAdjustment] = []

    def run(self) -> None:
        while not self.bridge.closed:
            job = self.bridge.next_job(0.05)
            if job is None:
                continue
            self.jobs.append(job)
            if job.get("local_adjustments") is not None:
                self.locals = [LocalAdjustment.model_validate(item) for item in job["local_adjustments"]]
            if self.decline_at is not None and len(self.jobs) > self.decline_at:
                self.bridge.submit(job["job_id"], None, job["width"], job["height"])
                continue
            rendered = apply_adjustments(
                self.source, AdjustmentState.model_validate(job["adjustments"]), PreviewKind.SDR,
                include_grain=False, local_adjustments=self.locals, source_pixel_scale=1.0,
            )
            pixels = np.clip(rendered + np.float32(self.offset), 0.0, 1.0).astype("<f2").tobytes()
            self.bridge.submit(job["job_id"], pixels, job["width"], job["height"])


def test_bridge_round_trip_and_refusals() -> None:
    bridge = RemoteCandidateBridge()
    answer = np.linspace(0.0, 1.0, 2 * 3 * 3, dtype=np.float32).reshape(2, 3, 3)

    def page() -> None:
        job = bridge.next_job(1.0)
        assert job["width"] == 3 and job["height"] == 2 and job["recipe"] == "first"
        assert bridge.submit(job["job_id"], answer.astype("<f2").tobytes(), 3, 2)

    thread = threading.Thread(target=page, daemon=True)
    thread.start()
    received = bridge.render({"recipe": "first"}, 3, 2)
    thread.join(1.0)
    assert received.dtype == np.float32 and received.shape == (2, 3, 3)
    assert np.allclose(received, answer, atol=1e-3)
    assert bridge.rendered == 1

    # A body of the wrong size is a decline, and a decline ends the bridge.
    def wrong() -> None:
        job = bridge.next_job(1.0)
        assert not bridge.submit(job["job_id"], b"\x00" * 10, 3, 2)

    thread = threading.Thread(target=wrong, daemon=True)
    thread.start()
    with pytest.raises(RemoteCandidateUnavailable):
        bridge.render({"recipe": "second"}, 3, 2)
    thread.join(1.0)
    assert bridge.closed
    assert bridge.next_job(0.0) is None
    with pytest.raises(RemoteCandidateUnavailable):
        bridge.render({"recipe": "third"}, 3, 2)


def test_bridge_times_out_when_no_page_answers() -> None:
    bridge = RemoteCandidateBridge()
    bridge.FIRST_TIMEOUT_S = 0.05
    with pytest.raises(RemoteCandidateUnavailable, match="in time"):
        bridge.render({}, 4, 4)
    assert bridge.closed


def test_one_bridge_per_session_replaces_and_releases() -> None:
    first = open_bridge("session")
    second = open_bridge("session")
    assert first.closed and bridge_for("session") is second
    close_bridge("session", first)
    assert bridge_for("session") is second
    close_bridge("session", second)
    assert bridge_for("session") is None and second.closed


def test_page_rendered_candidates_give_a_cpu_certified_recipe() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments, locals_ = _grade()
    baseline = materialize_sdr_match(source, adjustments, locals_, **OPTIONS)

    # The page's pixels carry a small offset, as a GPU render would differ
    # slightly from export. Whatever recipe the fit reaches from them, the
    # quality it reports has to be the export render's.
    bridge = RemoteCandidateBridge()
    page = _Page(bridge, source, offset=0.002)
    page.start()
    timing: dict[str, object] = {}
    result = materialize_sdr_match(source, adjustments, locals_, timing=timing, candidate_bridge=bridge, **OPTIONS)
    page.join(2.0)

    assert timing["candidate_renderer"] == "gpu"
    assert timing["gpu_candidates"] == len(page.jobs) > 0
    assert bridge.closed
    # The locals travel once; every later candidate reuses them.
    assert sum(job.get("local_adjustments") is not None for job in page.jobs) == 1
    assert all(job["long_edge"] == 768 for job in page.jobs)

    settled = apply_adjustments(source, adjustments, PreviewKind.HDR, include_grain=False,
                                local_adjustments=locals_, color_context=RenderColorContext(203),
                                source_pixel_scale=1.0)
    body = np.maximum(_acescg_luma(settled), 0.0) / np.float32(0.18) * SDR_DISPLAY_REFERENCE_WHITE <= MATCH_SHOULDER_START
    exported = apply_adjustments(source, result.adjustments, PreviewKind.SDR, include_grain=False,
                                 local_adjustments=result.local_adjustments, source_pixel_scale=1.0)
    assert result.quality == _quality_metrics(build_sdr_match_target(settled), exported, body)
    assert result.quality.model_dump() == timing["cpu_certified_quality"]
    assert timing["gpu_explored_quality"] != timing["cpu_certified_quality"]
    # A small rendering difference must not move the result far from the CPU fit.
    assert abs(result.adjustments.sdr.exposure - baseline.adjustments.sdr.exposure) <= 0.1001
    assert abs(result.quality.p95_luma_error - baseline.quality.p95_luma_error) < 0.01


def test_a_page_that_stops_answering_falls_back_to_the_cpu_fit() -> None:
    source = tifffile.imread(FIXTURE).astype(np.float32)
    adjustments, locals_ = _grade()
    baseline = materialize_sdr_match(source, adjustments, locals_, **OPTIONS)

    bridge = RemoteCandidateBridge()
    page = _Page(bridge, source, decline_at=3)
    page.start()
    timing: dict[str, object] = {}
    result = materialize_sdr_match(source, adjustments, locals_, timing=timing, candidate_bridge=bridge, **OPTIONS)
    page.join(2.0)

    assert timing["candidate_renderer"] == "cpu"
    assert "declined" in str(timing["gpu_candidate_fallback"]) or "usable" in str(timing["gpu_candidate_fallback"])
    assert timing["gpu_candidates"] == 3
    # Exactly the CPU result: no decision from the abandoned attempt survives.
    assert result.adjustments.model_dump() == baseline.adjustments.model_dump()
    assert [item.model_dump() for item in result.local_adjustments] == [
        item.model_dump() for item in baseline.local_adjustments
    ]
    assert result.quality == baseline.quality and result.status == baseline.status
