"""The final ceiling is exact, including float32 matrix/unit roundoff."""
import numpy as np
import pytest

from hdr_finisher.adjustments import (
    apply_hdr_output_highlight_compression, apply_sdr_output_highlight_compression,
)
from hdr_finisher.color import linear_bt2020_to_acescg
from hdr_finisher.color_context import RenderColorContext, nits_to_scene_linear
from hdr_finisher.hdr_ceiling import channel_nits
from hdr_finisher.models import AdjustmentState


@pytest.mark.parametrize('target', [203, 600, 600.00002, 1000, 4000])
@pytest.mark.parametrize('reference', [100, 203])
@pytest.mark.parametrize('mode', ['peak_fit', 'soft_ceiling', 'clip', 'fixed_cap'])
@pytest.mark.parametrize('colour', ['smooth_rolloff', 'preserve_color', 'path_to_white', 'agx_attenuate'])
def test_finished_hdr_never_exceeds_the_authored_target(target, reference, mode, colour):
    rng = np.random.default_rng(43)
    transport = rng.uniform(0, target * 4 * .18 / reference, (8, 128, 3)).astype(np.float32)
    transport[0, :4] = np.float32(target * .18 / reference)
    image = linear_bt2020_to_acescg(transport)
    state = AdjustmentState()
    hdr = state.hdr
    hdr.highlight_section_enabled = True
    hdr.highlight_compression_mode = mode
    hdr.highlight_compression_color_handling = colour
    hdr.highlight_compression_target_nits = target
    hdr.highlight_compression_start_nits = target * .4
    hdr.highlight_compression_softness = 60
    result = apply_hdr_output_highlight_compression(image, state, color_context=RenderColorContext(reference))
    assert np.isfinite(result).all()
    assert float(channel_nits(result, reference).max()) <= target


@pytest.mark.parametrize('mode', ['peak_fit', 'soft_ceiling', 'clip', 'fixed_cap'])
@pytest.mark.parametrize('colour', ['smooth_rolloff', 'preserve_color', 'path_to_white', 'agx_attenuate'])
def test_finished_sdr_never_exceeds_display_white(mode, colour):
    state = AdjustmentState()
    state.sdr.highlight_section_enabled = True
    state.sdr.highlight_compression_mode = mode
    state.sdr.highlight_compression_color_handling = colour
    state.sdr.highlight_compression_softness = 60
    image = np.random.default_rng(51).uniform(-.5, 16, (8, 128, 3)).astype(np.float32)
    result = apply_sdr_output_highlight_compression(image, state)
    assert np.isfinite(result).all()
    assert float(result.max()) <= 1


def test_exact_correction_leaves_already_compliant_results_byte_identical():
    from hdr_finisher.adjustments import _clip_to_output_target, _enforce_exact_hdr_output_target
    from hdr_finisher.color import acescg_to_linear_bt2020
    target = 600
    image = np.random.default_rng(5).uniform(0, .2, (8, 16, 3)).astype(np.float32)
    image[0, 0] = 100
    # The incumbent clamp, including its full-frame branch/matrix rounding.
    transport = acescg_to_linear_bt2020(image)
    previous = np.clip(linear_bt2020_to_acescg(np.clip(transport, 0, np.float32(nits_to_scene_linear(target, 203)))), 0, None)
    result = _enforce_exact_hdr_output_target(_clip_to_output_target(image, target, 203), target, 203)
    compliant = channel_nits(previous) <= target
    np.testing.assert_array_equal(result[compliant], previous[compliant])
    assert channel_nits(result).max() <= target
