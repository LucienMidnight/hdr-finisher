from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path

import numpy as np
import pytest

from hdr_finisher.adjustments import apply_sdr_output_highlight_compression
from hdr_finisher.models import AdjustmentState, SDRMatchQualityMetrics


SPEC = spec_from_file_location("linked_sdr_tail_probe", Path(__file__).parents[1] / "tools/linked_sdr_tail_probe.py")
PROBE = module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


def test_fixed_luma_gamut_keeps_legal_luminance_and_bounds():
    source = np.array([[[1.5, .3, -.1], [-.2, .8, 1.3], [.2, .2, .2]]], dtype=np.float32)
    mapped = PROBE.fixed_luma_gamut(source)
    weights = np.array([.2126, .7152, .0722])
    assert np.all((mapped >= 0) & (mapped <= 1))
    np.testing.assert_allclose(mapped @ weights, source @ weights, atol=1e-7, rtol=0)
    np.testing.assert_array_equal(mapped[0, 2], source[0, 2])


def test_neutral_output_trims_use_unchanged_incumbent_tail():
    source = np.array([[[.1, .2, .3], [2, .5, -.1]]], dtype=np.float32)
    state = AdjustmentState()
    state.sdr.highlight_compression_mode = "soft_ceiling"
    state.sdr.highlight_compression_softness = 100
    np.testing.assert_array_equal(PROBE.finish(source, state, "adaptive"), apply_sdr_output_highlight_compression(source, state))


@pytest.mark.parametrize("field,limit", [
    ("p95_oklab_error", .050), ("median_oklab_error", .015),
    ("median_luma_error", .010), ("p95_luma_error", .030),
])
def test_original_body_limits_are_inclusive_but_never_widened(field, limit):
    quality = SDRMatchQualityMetrics(median_luma_error=0, p95_luma_error=0, median_oklab_error=0, p95_oklab_error=0)
    setattr(quality, field, limit)
    assert PROBE.body_pass(quality)
    setattr(quality, field, limit + 1e-6)
    assert not PROBE.body_pass(quality)


def test_measure_reports_all_original_hue_stop_groups_and_json_booleans():
    hdr = np.full((22, 8, 3), .1, dtype=np.float32)
    target = np.full_like(hdr, .2)
    metrics = PROBE.measure(hdr, target, target, target, 176)
    assert metrics["body_pass"]
    assert metrics["order_pass"]
    assert metrics["white_growth_pass"]
    assert metrics["bright_family_stop_p95_max"] == 0
    assert len(metrics["bright_family_stop_p95"]) == 7
    assert metrics["bright_family_stop_p95"]["denim"] == {"1": 0, "2": 0, "3": 0}
    json.dumps(metrics, allow_nan=False)


def test_measure_refuses_different_population_or_misaligned_pixels():
    source = np.zeros((22, 8, 3), dtype=np.float32)
    with pytest.raises(ValueError, match="aligned original"):
        PROBE.measure(source, source, source, source, 175)
    with pytest.raises(ValueError, match="aligned original"):
        PROBE.measure(source, source, source[:1], source, 176)
