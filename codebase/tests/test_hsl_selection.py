"""Behaviour of the shared colour selection CPU reference and its use by HSL."""
import numpy as np
from hdr_finisher.hsl import HSLRange, HSLRecipe, apply_recipes, apply_stage, from_lab, selection
from hdr_finisher.hsl_selection import geometry, prepare, select, select_hue
from hdr_finisher.models import MaskLeaf


def _noisy_yellow(h=64, w=96, seed=12):
    rng = np.random.default_rng(seed)
    lab = np.zeros((h, w, 3), np.float32)
    lab[..., 0] = .6
    angle = np.radians(109 + rng.normal(0, 18, (h, w)))
    lab[..., 1] = .12 * np.cos(angle)
    lab[..., 2] = .12 * np.sin(angle)
    return from_lab(lab).astype(np.float32)


def test_hue_controls_are_only_an_adapter():
    rng=np.random.default_rng(12)
    lab=np.zeros((37,65,3),np.float32)
    lab[...,0]=.6
    lab[...,1:]=rng.normal(0,.08,(37,65,2))
    fields=prepare(from_lab(lab))
    leaf=MaskLeaf(type="hue_range",hue_center=109,hue_width=24,
                  hue_smoothness=41,saturation_floor=.04)
    global_weight=select(fields,[HSLRange(center=109,width=24,feather=41)],.04)
    np.testing.assert_array_equal(select_hue(fields,leaf),global_weight)


def test_unsampled_hue_is_empty_without_changing_preparation():
    fields=prepare(np.ones((17,19,3),np.float32))
    before=fields.chroma.copy()
    leaf=MaskLeaf(type="hue_range",hue_center=None)
    assert not select_hue(fields,leaf).any()
    np.testing.assert_array_equal(fields.chroma,before)


def test_subtraction_excludes_the_included_range():
    lab=np.empty((29,31,3),np.float32)
    lab[...,:]=[.6,-.04,.12]
    fields=prepare(from_lab(lab))
    include=HSLRange(center=109,width=24,feather=41)
    weight=select(fields,[include,include.model_copy(update={"subtract":True})])
    assert not weight.any()


def test_signed_hdr_fields_remain_finite_and_do_not_modify_rgb():
    rgb=np.random.default_rng(8).uniform(-.1,12,(19,33,3)).astype(np.float32)
    original=rgb.copy()
    weight=select(prepare(rgb),[HSLRange(center=350,width=60,feather=20)])
    assert np.isfinite(weight).all()
    assert ((weight>=0)&(weight<=1)).all()
    np.testing.assert_array_equal(rgb,original)


def test_a_tile_with_the_declared_halo_matches_the_whole_frame():
    rgb = _noisy_yellow(90, 140)
    ranges = [HSLRange(center=109, width=15, feather=21)]
    for scale in (1, .5, .3):
        whole = select(prepare(rgb, scale), ranges)
        reach = geometry(scale).reach
        x, y, w, h = 47, 31, 40, 25
        x0, y0 = x - reach, max(0, y - reach)
        tile = select(prepare(rgb[y0:y + h + reach, x0:x + w + reach], scale, (x0, y0)), ranges)
        np.testing.assert_allclose(tile[y - y0:y - y0 + h, x - x0:x - x0 + w], whole[y:y + h, x:x + w], atol=1e-6)


def test_shared_selection_removes_speckle_that_pointwise_selection_shows():
    rgb = _noisy_yellow()
    ranges = [HSLRange(center=109, width=15, feather=21)]
    pointwise = selection(rgb, ranges)[0][8:-8, 8:-8]
    shared = select(prepare(rgb), ranges)[8:-8, 8:-8]
    assert pointwise.std() > .2 and shared.std() < .02 and shared.mean() > .9


def test_global_hsl_lift_is_even_and_neutral_hsl_is_untouched():
    rgb = _noisy_yellow()
    lift = HSLRecipe(ranges=[HSLRange(center=109, width=15, feather=21)], luminance=.8)
    assert apply_stage(rgb, [HSLRecipe(ranges=lift.ranges)], "sdr", shared_selection=1.0) is rgb
    out = apply_recipes(rgb, [lift], shared_selection=1.0)
    ratio = (out[..., :3].sum(-1) / rgb.sum(-1))[8:-8, 8:-8]
    assert ratio.std() < .02 and ratio.mean() > 1.3


def test_edge_defaults_are_exactly_the_original_guided_filter():
    from hdr_finisher.hsl_selection import _box, _interpolate, _qualify
    prepared=prepare(_noisy_yellow())
    ranges=[HSLRange(center=109,width=15,feather=21)]
    g=prepared.guide; radius=prepared.geometry.guide
    low=_interpolate(_qualify(prepared.chroma,ranges,.02),g.shape,prepared.origin,prepared.geometry.cell)
    mi=_box(g,radius);mp=_box(low,radius)
    var=_box(g*g,radius)-mi*mi
    a=(_box(g*low,radius)-mi*mp)/np.maximum(var+.03,.03)
    expected=np.clip(_box(a,radius)*g+_box(mp-a*mi,radius),0,1).astype(np.float32)
    np.testing.assert_array_equal(select(prepared,ranges),expected)
    np.testing.assert_array_equal(select(prepared,ranges,edge=0,edge_feather=0,edge_detail=50),expected)


def test_edge_grows_and_shrinks_and_feather_smooths_without_filling_exclusions():
    from hdr_finisher.hsl_selection import prepare_fields
    ab=np.zeros((64,128,2),np.float32)
    ab[:]=[.2,0];ab[:,40:88]=[0,.2]
    prepared=prepare_fields(ab,np.zeros((64,128),np.float32))
    ranges=[HSLRange(center=90,width=15,feather=10)]
    base=select(prepared,ranges)
    grow=select(prepared,ranges,edge=3)
    shrink=select(prepared,ranges,edge=-3)
    assert grow.sum()>base.sum()>shrink.sum()
    feather=select(prepared,ranges,edge_feather=6)
    assert np.abs(np.diff(feather,axis=1)).max()<np.abs(np.diff(base,axis=1)).max()
    # The excluded red region must stay empty, even with maximal grow/feather.
    excluded=ranges+[HSLRange(center=0,width=25,feather=10,subtract=True)]
    shaped=select(prepared,excluded,edge=8,edge_feather=16)
    assert not shaped[:,:20].any()
    assert not shaped[:,108:].any()


def test_edge_settings_save_and_local_uses_the_same_selection():
    leaf=MaskLeaf(type='hue_range',hue_center=109,hue_width=15,hue_smoothness=21,
                  saturation_floor=.02,edge=-3,edge_feather=6,edge_detail=75)
    restored=MaskLeaf.model_validate_json(leaf.model_dump_json())
    prepared=prepare(_noisy_yellow())
    recipe=HSLRecipe(ranges=[HSLRange(center=109,width=15,feather=21)],edge=-3,edge_feather=6,edge_detail=75)
    saved=HSLRecipe.model_validate_json(recipe.model_dump_json())
    np.testing.assert_array_equal(select_hue(prepared,restored),select(prepared,saved.ranges,edge=saved.edge,
                                  edge_feather=saved.edge_feather,edge_detail=saved.edge_detail))
