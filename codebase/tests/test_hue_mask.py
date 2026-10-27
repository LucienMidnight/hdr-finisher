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
