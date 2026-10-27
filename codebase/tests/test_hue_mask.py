import numpy as np
import pytest
from hdr_finisher.models import MaskLeaf, MaskPoint, MaskExpression
from hdr_finisher.local_adjustments import hue_range_mask, sample_hue_range, evaluate_mask
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.hsl import from_lab

def test_sampled_hue_chart_smooth_neutral_and_hdr():
    hue=np.linspace(-60,60,241)*np.pi/180
    rgb=from_lab(np.stack([np.full(241,.6),.12*np.cos(hue),.12*np.sin(hue)],axis=-1))[None].astype(np.float32)
    source=linear_srgb_to_acescg(rgb)
    empty=MaskLeaf(type="hue_range")
    assert not hue_range_mask(empty,source).any()
    sample=sample_hue_range(source,[MaskPoint(x=.5,y=.5)])
    leaf=MaskLeaf(type="hue_range",hue_center=sample['center'],hue_width=16,hue_smoothness=12)
    mask=hue_range_mask(leaf,source)
    assert mask[0,120]>.99 and mask[0,0]==0 and mask[0,-1]==0
    assert np.max(np.abs(np.diff(mask)))<.07
    np.testing.assert_allclose(mask,hue_range_mask(leaf,source*32),atol=2e-5)
    assert not hue_range_mask(leaf,np.ones((8,8,3),np.float32)).any()
    restored=MaskLeaf.model_validate_json(leaf.model_dump_json())
    np.testing.assert_array_equal(mask,hue_range_mask(restored,source))


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


def test_noisy_patch_is_smooth_and_does_not_select_neutral_or_bright_fringe():
    image = noisy_patch()
    leaf = MaskLeaf(type='hue_range', hue_center=109, hue_width=12, hue_smoothness=20)
    mask = hue_range_mask(leaf, image)
    assert mask[8:-8, 8:88].mean() > .9
    assert mask[8:-8, 8:88].std() < .05
    assert mask[:, 104:].max() == 0
    assert mask[:, 97].mean() < .08
    # Exposure invariance includes highlights above reference white.
    np.testing.assert_allclose(mask, hue_range_mask(leaf, image * 16), atol=.005)


def test_hue_region_and_export_tiles_have_identical_native_selection():
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask, compile_geometry_fixed_mask_region
    from hdr_finisher.models import GeometryAdjustments
    image = noisy_patch()
    expression = MaskExpression(operator='leaf', leaf=MaskLeaf(type='hue_range', hue_center=109,
                                hue_width=24, hue_smoothness=41, saturation_floor=.04))
    for geometry in [GeometryAdjustments(), GeometryAdjustments(rotation=90, flip_horizontal=True)]:
        whole = compile_geometry_fixed_mask(image, expression, geometry)
        region, size = compile_geometry_fixed_mask_region(image, expression, geometry, (13, 17, 70, 80))
        np.testing.assert_array_equal(region, whole[17:80, 13:70])
        assert size == (whole.shape[1], whole.shape[0])


def test_hue_preview_reduces_native_selection_instead_of_selecting_mip_colours():
    from hdr_finisher.render_cache import SessionRenderCache
    from hdr_finisher.models import AdjustmentState, LocalAdjustment
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.preview import downsample_image
    # Larger than the minimum proxy size, with repeating fine colour variation.
    image = np.tile(noisy_patch(), (4, 4, 1))
    local = LocalAdjustment(mask=MaskExpression(operator='leaf',leaf=MaskLeaf(
        type='hue_range',hue_center=109,hue_width=24,hue_smoothness=41)))
    state = AdjustmentState()
    cache = SessionRenderCache(image, None)
    actual = cache.compiled_local_mask(state, local, 256, spatial_only=True)
    expected = downsample_image(compile_geometry_fixed_mask(image,local.mask,state.shared.geometry),256)
    np.testing.assert_array_equal(actual,np.rint(expected).astype(np.uint8))
    local.mask.leaf.mask_opacity = .4
    expected = downsample_image(compile_geometry_fixed_mask(image,local.mask,state.shared.geometry),256)
    np.testing.assert_array_equal(cache.compiled_local_mask(state,local,256),np.rint(expected).astype(np.uint8))


def test_unsampled_hue_remains_empty_when_inverted():
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.models import GeometryAdjustments
    expression=MaskExpression(operator='leaf',inverted=True,leaf=MaskLeaf(type='hue_range'))
    assert not compile_geometry_fixed_mask(noisy_patch(),expression,GeometryAdjustments()).any()


def test_exclude_neutrals_maximum_still_allows_confident_signed_colour():
    lab=np.empty((8,8,3),np.float32)
    lab[:]=[.6,1.2*np.cos(np.radians(20)),1.2*np.sin(np.radians(20))]
    source=linear_srgb_to_acescg(from_lab(lab).astype(np.float32))
    leaf=MaskLeaf(type='hue_range',hue_center=20,saturation_floor=1)
    assert hue_range_mask(leaf,source).mean()>.9


def test_hue_combines_with_feathered_luma_after_invert_and_opacity():
    from hdr_finisher.local_adjustments import compile_preview_mask, source_coordinate_grid
    from hdr_finisher.models import GeometryAdjustments
    image=noisy_patch();h,w=image.shape[:2];geometry=GeometryAdjustments()
    x,y=source_coordinate_grid(w,h,0,0,w,h,geometry)
    hue=MaskExpression(operator='leaf',inverted=True,leaf=MaskLeaf(type='hue_range',
        hue_center=109,hue_width=24,hue_smoothness=41,mask_opacity=.6))
    luma=MaskExpression(operator='leaf',leaf=MaskLeaf(type='luminance_range',
        fade_in_start_ev=-1,full_start_ev=0,full_end_ev=1,fade_out_end_ev=2,mask_feather=.04))
    a=evaluate_mask(hue,image,x,y,w/h);b=evaluate_mask(luma,image,x,y,w/h)
    for operator,expected in [('intersect',a*b),('union',np.maximum(a,b)),('subtract',a*(1-b))]:
        expression=MaskExpression(operator=operator,children=[hue,luma])
        np.testing.assert_array_equal(compile_preview_mask(image,expression,geometry),np.rint(expected*255).astype(np.uint8))
