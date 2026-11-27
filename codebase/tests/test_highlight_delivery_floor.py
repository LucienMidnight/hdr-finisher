import numpy as np
import pytest

from hdr_finisher.color_context import minimum_hdr_peak_nits
from hdr_finisher.models import AdjustmentState, HDRAdjustments


@pytest.mark.parametrize("reference", [100, 203])
def test_floor_respects_project_and_gainmap_white(reference):
    minimum = minimum_hdr_peak_nits(reference)
    assert minimum == 225
    assert minimum > max(reference, 203) * 1.02
    assert minimum % 25 == 0


@pytest.mark.parametrize("target", [2, 100, 200, 203, 224.99])
def test_saved_or_pasted_grade_clamps_peak_and_start(target):
    state = AdjustmentState.model_validate({"hdr": {"highlight_compression_target_nits": target}})
    assert state.hdr.highlight_compression_target_nits == 225
    assert state.hdr.highlight_compression_start_nits == 224


def test_floor_leaves_valid_recipe_untouched():
    hdr = HDRAdjustments(highlight_compression_target_nits=600, highlight_compression_start_nits=400)
    assert hdr.highlight_compression_target_nits == 600
    assert hdr.highlight_compression_start_nits == 400


@pytest.mark.slow
@pytest.mark.needs_native_helper
@pytest.mark.parametrize("reference", [100, 203])
@pytest.mark.parametrize("mode", ["peak_fit", "soft_ceiling", "clip", "fixed_cap"])
@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
def test_clamped_minimum_encodes_all_hdr_formats(tmp_path, reference, mode, format_name):
    from pathlib import Path
    from types import SimpleNamespace
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    from hdr_finisher.hdr_ceiling import decoded_channel_nits, ENCODING_ALLOWANCE
    from hdr_finisher.models import ExportSettings

    backend = build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    adjustments = AdjustmentState.model_validate({"hdr": {"highlight_section_enabled": True,
        "highlight_compression_mode": mode, "highlight_compression_target_nits": reference,
        "highlight_compression_start_nits": reference * .4, "highlight_compression_softness": 60}})
    target = adjustments.hdr.highlight_compression_target_nits
    image = np.broadcast_to(np.linspace(.01, target * .18 / reference * 4, 64,
        dtype=np.float32)[None, :, None], (16, 64, 3)).copy()
    session = SimpleNamespace(session_id="floor", image=image, adjustments=adjustments,
        hdr_reference_white_nits=reference, sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format=format_name, quality=95,
        jpeg_gain_map_scale="full", dithering="off", output_path=str(tmp_path / "floor")))
    assert result.accepted, result.message
    assert float(decoded_channel_nits(Path(result.output_path), format_name).max()) <= target * (1 + ENCODING_ALLOWANCE)
