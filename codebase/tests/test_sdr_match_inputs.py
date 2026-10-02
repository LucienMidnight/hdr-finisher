from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

from hdr_finisher import sdr_match_inputs as cache
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind


def fixture():
    source = np.random.default_rng(7).uniform(0.001, 0.8, (45, 61, 3)).astype(np.float32)
    adjustments = AdjustmentState()
    local = LocalAdjustment()
    local.sdr_grade.exposure = 0.3
    local.mask.leaf.mask_feather = 0.02
    return source, adjustments, [local]


def test_candidates_reuse_masks_and_geometry_but_preserve_exact_pixels(monkeypatch):
    source, adjustments, locals_ = fixture()
    counts = {"mask": 0, "geometry": 0}
    original_mask, original_geometry = cache.compile_geometry_fixed_mask, cache.apply_geometry

    def mask(*args, **kwargs):
        counts["mask"] += 1
        return original_mask(*args, **kwargs)

    def geometry(*args, **kwargs):
        counts["geometry"] += 1
        return original_geometry(*args, **kwargs)

    monkeypatch.setattr(cache, "compile_geometry_fixed_mask", mask)
    monkeypatch.setattr(cache, "apply_geometry", geometry)

    @cache.reuse_match_render_inputs
    def candidates(source):
        for exposure in (-0.2, 0.0, 0.4):
            adjustments.sdr.exposure = exposure
            actual = cache.render_match_candidate(source, adjustments, locals_, 0.6)
            expected = apply_adjustments(source, adjustments, PreviewKind.SDR, include_grain=False,
                                         local_adjustments=locals_, source_pixel_scale=0.6)
            np.testing.assert_array_equal(actual, expected)
    before = source.copy()
    candidates(source)
    assert counts == {"mask": 1, "geometry": 1}
    np.testing.assert_array_equal(source, before)


def test_geometry_and_mask_changes_do_not_reuse_stale_inputs():
    source, adjustments, locals_ = fixture()

    @cache.reuse_match_render_inputs
    def candidates(source):
        for changed in (False, True):
            adjustments.shared.geometry.flip_horizontal = changed
            locals_[0].mask.leaf.mask_feather = 0.04 if changed else 0.02
            np.testing.assert_array_equal(
                cache.render_match_candidate(source, adjustments, locals_, 1),
                apply_adjustments(source, adjustments, PreviewKind.SDR, include_grain=False, local_adjustments=locals_),
            )
    candidates(source)


def test_spatial_mask_can_be_reused_across_translation_and_candidate_render(monkeypatch):
    source, adjustments, locals_ = fixture()
    calls = []
    original = cache.compile_geometry_fixed_mask
    monkeypatch.setattr(cache, "compile_geometry_fixed_mask", lambda *a, **k: (calls.append(1), original(*a, **k))[1])

    @cache.reuse_match_render_inputs
    def candidate(source):
        mask = cache.match_spatial_mask(source, locals_[0].mask, adjustments.shared.geometry)
        assert not mask.flags.writeable
        cache.render_match_candidate(source, adjustments, locals_, 1)
    candidate(source)
    assert len(calls) == 1


@pytest.mark.parametrize("reference_white", [100, 203])
def test_hdr_target_translation_and_sdr_certification_share_exact_inputs(monkeypatch, reference_white):
    source, adjustments, locals_ = fixture()
    adjustments.shared.geometry.straighten_angle = 2.0
    adjustments.shared.geometry.flip_horizontal = True
    adjustments.hdr.exposure = 0.4
    context = RenderColorContext(reference_white)
    original = cache.compile_geometry_fixed_mask
    calls = []
    monkeypatch.setattr(cache, "compile_geometry_fixed_mask",
                        lambda *a, **k: (calls.append(1), original(*a, **k))[1])

    @cache.reuse_match_render_inputs
    def fit(source):
        target = cache.render_match_target(source, adjustments, locals_, 0.6, context)
        np.testing.assert_array_equal(target, apply_adjustments(
            source, adjustments, PreviewKind.HDR, include_grain=False,
            local_adjustments=locals_, source_pixel_scale=0.6, color_context=context,
        ))
        cache.match_spatial_mask(source, locals_[0].mask, adjustments.shared.geometry)
        candidate = cache.render_match_candidate(source, adjustments, locals_, 0.6)
        np.testing.assert_array_equal(candidate, apply_adjustments(
            source, adjustments, PreviewKind.SDR, include_grain=False,
            local_adjustments=locals_, source_pixel_scale=0.6,
        ))

    fit(source)
    assert len(calls) == 1
    assert cache._INPUTS.get() is None


def test_match_scope_releases_inputs_on_failure_and_isolates_concurrent_calls():
    source, adjustments, locals_ = fixture()

    @cache.reuse_match_render_inputs
    def fail(source):
        cache.render_match_candidate(source, adjustments, locals_, 1)
        raise ValueError("fit failed")
    with pytest.raises(ValueError, match="fit failed"):
        fail(source)
    assert cache._INPUTS.get() is None

    @cache.reuse_match_render_inputs
    def candidate(source):
        assert cache._INPUTS.get().source is source
        return cache.render_match_candidate(source, adjustments, locals_, 1)
    sources = [source, source * np.float32(0.5)]
    with ThreadPoolExecutor(2) as pool:
        outputs = list(pool.map(candidate, sources))
    for input_, output in zip(sources, outputs):
        np.testing.assert_array_equal(output, apply_adjustments(input_, adjustments, PreviewKind.SDR,
                                      include_grain=False, local_adjustments=locals_))
    assert cache._INPUTS.get() is None
