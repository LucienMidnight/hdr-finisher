"""Behaviour of the inactive shared colour-selection CPU reference."""
import numpy as np
from hdr_finisher.hsl import HSLRange, from_lab
from hdr_finisher.hsl_selection import prepare, select, select_hue
from hdr_finisher.models import MaskLeaf

def test_hue_controls_are_only_an_adapter():
    rng=np.random.default_rng(12)
    lab=np.zeros((37,65,3),np.float32)
    lab[...,0]=.6
    lab[...,1:]=rng.normal(0,.08,(37,65,2))
    fields=prepare(from_lab(lab))
    leaf=MaskLeaf(type="hue_range",hue_center=109,hue_width=24,
                  hue_smoothness=41,saturation_floor=.04)
    global_weight,_=select(fields,[HSLRange(center=109,width=24,feather=41)],.04)
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
    weight,_=select(fields,[include,include.model_copy(update={"subtract":True})])
    assert not weight.any()

def test_signed_hdr_fields_remain_finite_and_do_not_modify_rgb():
    rgb=np.random.default_rng(8).uniform(-.1,12,(19,33,3)).astype(np.float32)
    original=rgb.copy()
    fields=prepare(rgb)
    weight,target=select(fields,[HSLRange(center=350,width=60,feather=20)])
    assert np.isfinite(weight).all() and np.isfinite(target).all()
    assert ((weight>=0)&(weight<=1)).all()
    np.testing.assert_array_equal(rgb,original)
