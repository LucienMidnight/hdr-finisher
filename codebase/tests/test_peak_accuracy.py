from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher.peak_accuracy import measurement_warnings
from hdr_finisher.peak_candidates import source_candidates, positioned_candidates, MAX_CANDIDATES
from hdr_finisher.models import AdjustmentState, ExportSettings, PreviewKind
from hdr_finisher.exporters import _render_export_branch
from hdr_finisher.color_context import RenderColorContext


def test_real_isolated_source_peaks_survive_evidence_and_crop_rotation():
    image = np.zeros((140, 160, 3), np.float32)
    image[41, 62] = [4, 10, 2]
    evidence = source_candidates(image)
    assert len(evidence) <= MAX_CANDIDATES
    assert any(np.array_equal(row, [62, 41, 4, 10, 2]) for row in evidence)
    geometry = AdjustmentState().shared.geometry
    geometry.rotation = 90
    geometry.crop.x = .1
    geometry.crop.width = .8
    mapped = positioned_candidates(evidence, image.shape, geometry)
    found = next(row for row in mapped["samples"] if row[2:] == [4, 10, 2])
    assert found[:2] == [84, 62]


@pytest.mark.parametrize("error, warns", [(0.009, False), (.011, True), (-.23, True)])
def test_warnings_use_approved_one_percent_in_both_directions(error, warns):
    warnings = measurement_warnings({"hdr": {"peak": 1+error}}, {"hdr": {"peak": 1}})
    assert bool(warnings) == warns


def test_exact_export_measurement_does_not_change_pixels_or_ceiling():
    source = np.full((24, 32, 3), .2, np.float32)
    source[10, 11] = 12
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_compression_target_nits = 1000
    adjustments.hdr.highlight_compression_mode = "peak_fit"
    adjustments.hdr.highlight_section_enabled = True
    session = SimpleNamespace(image=source, sdr_reference_image=None, color_context=RenderColorContext(), local_adjustments=[])
    settings = ExportSettings()
    before = _render_export_branch(session, settings, PreviewKind.HDR, adjustments)
    settings.editing_measurements = {"hdr": {"peak": .1, "anchor": .1}}
    after = _render_export_branch(session, settings, PreviewKind.HDR, adjustments)
    np.testing.assert_array_equal(before, after)
    assert settings._exact_measurements["hdr"]["anchor"] > 1
    assert len(measurement_warnings(settings.editing_measurements, settings._exact_measurements)) == 2
    from hdr_finisher.color import acescg_to_linear_bt2020
    assert np.max(acescg_to_linear_bt2020(after)) / .18 * 203 <= 1000.001
