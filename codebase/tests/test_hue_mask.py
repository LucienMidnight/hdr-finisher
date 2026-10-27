"""Local hue-mask leaves on the shared colour selection (selected before HSL)."""
import numpy as np
from hdr_finisher.models import MaskLeaf, MaskPoint, MaskExpression
from hdr_finisher.local_adjustments import hue_range_mask, sample_hue_range, evaluate_mask
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.hsl import from_lab


def noisy_patch():
    rng = np.random.default_rng(9)
    lab = np.zeros((96, 192, 3), np.float32)
    lab[..., 0] = .6
    angle = np.radians(109 + rng.normal(0, 12, (96, 96)))
    lab[:, :96, 1] = .065 * np.cos(angle)
    lab[:, :96, 2] = .065 * np.sin(angle)
    # One bright coloured fringe on the neutral side, with scene HDR headroom.
    lab[:, 97, 0] = 1.5
    lab[:, 97, 1] = .14 * np.cos(np.radians(109))
    lab[:, 97, 2] = .14 * np.sin(np.radians(109))
    return linear_srgb_to_acescg(from_lab(lab).astype(np.float32))


def test_sampled_hue_selects_its_colour_and_not_neutral():
    hue = np.radians(np.linspace(-60, 60, 241))
    lab = np.stack([np.full(241, .6), .12 * np.cos(hue), .12 * np.sin(hue)], axis=-1)
    source = linear_srgb_to_acescg(np.repeat(from_lab(lab)[None], 24, axis=0).astype(np.float32))
    assert not hue_range_mask(MaskLeaf(type="hue_range"), source).any()
    sample = sample_hue_range(source, [MaskPoint(x=.5, y=.5)])
    leaf = MaskLeaf(type="hue_range", hue_center=sample['center'], hue_width=16, hue_smoothness=12)
    mask = hue_range_mask(leaf, source)
    assert mask[12, 120] > .95 and mask[12, :20].max() < .01 and mask[12, -20:].max() < .01
    np.testing.assert_allclose(mask, hue_range_mask(leaf, source * 32), atol=2e-3)
    assert not hue_range_mask(leaf, np.ones((32, 32, 3), np.float32)).any()


def test_noisy_patch_is_smooth_and_does_not_select_neutral():
    image = noisy_patch()
    leaf = MaskLeaf(type='hue_range', hue_center=109, hue_width=12, hue_smoothness=20)
    mask = hue_range_mask(leaf, image)
    assert mask[8:-8, 8:84].mean() > .9
    assert mask[8:-8, 8:84].std() < .05
    assert mask[:, 112:].max() < .01
    # Exposure invariance includes highlights above reference white.
    np.testing.assert_allclose(mask, hue_range_mask(leaf, image * 16), atol=.005)


def test_small_bright_spots_follow_their_selected_surroundings():
    # Sunlit specks in foliage: brighter and a different hue than the patch,
    # yet selected with it, so a Luminance edit never leaves them behind.
    image = noisy_patch()
    rng = np.random.default_rng(3)
    ys, xs = rng.integers(12, 84, 40), rng.integers(12, 72, 40)
    lab = np.zeros((1, 1, 3), np.float32); lab[..., 0] = 1.2
    lab[..., 1], lab[..., 2] = .08 * np.cos(np.radians(10)), .08 * np.sin(np.radians(10))
    image[ys, xs] = linear_srgb_to_acescg(from_lab(lab).astype(np.float32))[0, 0]
    leaf = MaskLeaf(type='hue_range', hue_center=109, hue_width=12, hue_smoothness=20)
    mask = hue_range_mask(leaf, image)
    assert mask[ys, xs].min() > .8
    assert np.abs(mask[ys, xs] - mask[ys, xs + 3]).max() < .15


def test_the_leaf_reads_the_frames_stage_input_when_a_render_provides_it():
    from hdr_finisher.hue_mask import prepare_stage_input, stage
    from hdr_finisher.hsl_selection import select_hue
    image = noisy_patch()
    leaf = MaskLeaf(type='hue_range', hue_center=200, hue_width=20, hue_smoothness=20)
    assert hue_range_mask(leaf, image).max() < .01
    # The stage input is the same picture after a colour edit that moved it to hue 200.
    lab = np.zeros((96, 192, 3), np.float32); lab[..., 0] = .6
    lab[..., 1], lab[..., 2] = .065 * np.cos(np.radians(200)), .065 * np.sin(np.radians(200))
    prepared = prepare_stage_input(from_lab(lab).astype(np.float32), "sdr")
    with stage(prepared):
        np.testing.assert_array_equal(hue_range_mask(leaf, image), select_hue(prepared, leaf))
        assert hue_range_mask(leaf, image).mean() > .9


def test_cpu_render_selects_from_the_lane_picture_after_white_balance():
    from hdr_finisher.adjustments import apply_adjustments
    from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
    image = noisy_patch()
    # A narrow range: 2500 K moves this patch's hue by about 12 degrees.
    local = LocalAdjustment(mask=MaskExpression(operator='leaf', leaf=MaskLeaf(
        type='hue_range', hue_center=109, hue_width=4, hue_smoothness=4, saturation_floor=.04)))
    local.hdr_grade.exposure = 1
    lift = []
    for kelvin in (6500, 2500):
        state = AdjustmentState()
        state.hdr.white_balance_kelvin = kelvin
        on = apply_adjustments(image, state, PreviewKind.HDR, local_adjustments=[local], include_grain=False)
        off = apply_adjustments(image, state, PreviewKind.HDR, include_grain=False)
        lift.append(float(np.log2(on[16:80, 16:80].mean() / off[16:80, 16:80].mean())))
    # Neutral white balance keeps the yellow-green patch selected; a strong
    # change moves its hue before HSL, so the mask follows the edited picture.
    assert lift[0] > .8 and lift[1] < lift[0] - .3


def test_unsampled_hue_remains_empty_when_inverted():
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.models import GeometryAdjustments
    expression = MaskExpression(operator='leaf', inverted=True, leaf=MaskLeaf(type='hue_range'))
    assert not compile_geometry_fixed_mask(noisy_patch(), expression, GeometryAdjustments()).any()


def test_exclude_neutrals_maximum_still_allows_confident_signed_colour():
    lab = np.empty((24, 24, 3), np.float32)
    lab[:] = [.6, 1.2 * np.cos(np.radians(20)), 1.2 * np.sin(np.radians(20))]
    source = linear_srgb_to_acescg(from_lab(lab).astype(np.float32))
    leaf = MaskLeaf(type='hue_range', hue_center=20, saturation_floor=1)
    assert hue_range_mask(leaf, source).mean() > .9


def test_hue_combines_with_feathered_luma_after_invert_and_opacity():
    from hdr_finisher.local_adjustments import compile_preview_mask, source_coordinate_grid
    from hdr_finisher.models import GeometryAdjustments
    image = noisy_patch(); h, w = image.shape[:2]; geometry = GeometryAdjustments()
    x, y = source_coordinate_grid(w, h, 0, 0, w, h, geometry)
    hue = MaskExpression(operator='leaf', inverted=True, leaf=MaskLeaf(type='hue_range',
        hue_center=109, hue_width=24, hue_smoothness=41, mask_opacity=.6))
    luma = MaskExpression(operator='leaf', leaf=MaskLeaf(type='luminance_range',
        fade_in_start_ev=-1, full_start_ev=0, full_end_ev=1, fade_out_end_ev=2, mask_feather=.04))
    a = evaluate_mask(hue, image, x, y, w / h); b = evaluate_mask(luma, image, x, y, w / h)
    for operator, expected in [('intersect', a * b), ('union', np.maximum(a, b)), ('subtract', a * (1 - b))]:
        expression = MaskExpression(operator=operator, children=[hue, luma])
        np.testing.assert_array_equal(compile_preview_mask(image, expression, geometry), np.rint(expected * 255).astype(np.uint8))


def test_mask_endpoint_uses_the_stage_input_of_the_requested_lane():
    from hdr_finisher.render_cache import SessionRenderCache
    from hdr_finisher.models import AdjustmentState, LocalAdjustment, PreviewKind
    image = np.tile(noisy_patch(), (3, 3, 1))
    local = LocalAdjustment(mask=MaskExpression(operator='leaf', leaf=MaskLeaf(
        type='hue_range', hue_center=109, hue_width=4, hue_smoothness=4)))
    state = AdjustmentState()
    cache = SessionRenderCache(image, None)
    neutral = cache.compiled_local_mask(state, local, 288, spatial_only=True)
    assert neutral.shape == (144, 288) and neutral[10:134, 6:40].mean() > 200
    state.hdr.white_balance_kelvin = 2500
    moved = cache.compiled_local_mask(state, local, 288, spatial_only=True, lane=PreviewKind.HDR)
    assert moved[10:134, 6:40].mean() < 50
