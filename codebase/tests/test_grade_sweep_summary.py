"""Release reporting distinguishes frame noise and cancelled work from failures."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("grade_summary", Path(__file__).parents[1] / "tools/grade_sweep_summary.py")
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


def test_slowdown_requires_both_strict_thresholds():
    assert not summary.significant_slowdown(32, 50)  # >25%, less than one frame allowance
    assert not summary.significant_slowdown(100, 125)  # exactly 25%
    assert not summary.significant_slowdown(40, 60)  # exactly 20 ms
    assert summary.significant_slowdown(40, 61)
    assert summary.significant_slowdown(32, 235)
    assert not summary.significant_slowdown(None, 235)


def test_error_triage_keeps_unknown_failures_open():
    assert summary.error_kind({"status": 409, "url": "/api/session/id/source-tile/hdr"}).startswith("expected")
    assert summary.error_kind({"status": 409, "url": "/api/session/id/denoise-measurement/sdr"}).startswith("expected")
    assert summary.error_kind({"status": 500, "url": "/api/session/id/source-tile/hdr"}) == "unresolved"
    assert summary.error_kind({"status": 409, "url": "/different-endpoint"}) == "unresolved"
    assert summary.error_kind({"status": 409, "url": "/api/session/id/source-tile/hdr", "body": '{"detail":{"code":"edit_revision_mismatch"}}'}).startswith("expected")
    assert summary.error_kind({"status": 409, "url": "/api/session/id/source-tile/hdr", "body": '{"detail":"Unexplained refusal"}'}).startswith("unresolved")
    assert summary.error_kind("locator.scrollIntoViewIfNeeded: Timeout") == "driver"
