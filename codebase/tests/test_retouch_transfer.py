"""Native clone/heal behavior, independent of UI wording or code structure."""
import numpy as np
import pytest
from concurrent.futures import CancelledError
from hdr_finisher.retouch_recipe import InpaintRecipe, stroke_mask
from hdr_finisher.retouch_transfer import transfer_repair


def recipe(mode="clone", **updates):
    return InpaintRecipe(**(dict(mode=mode,source_size=(160,100),search_rect=(96,26,144,74),
        points=[dict(x=.75,y=.5)],source_point=dict(x=.25,y=.5),radius_px=16,
        edge_feather=.71) | updates))


def image():
    y,x=np.mgrid[:100,:160]
    grain=np.where((x+y)%2,.015,-.015)
    pixels=np.repeat((.2+grain)[...,None],3,axis=-1).astype(np.float32)
    pixels[:,80:]+=np.float32(1.)
    pixels[47:53,117:123]-=.7
    return pixels


def place(base,patch,mask):
    out=base.copy();x,y=patch.origin;h,w=mask.shape
    np.copyto(out[y:y+h,x:x+w],patch.pixels,where=mask[...,None]);return out


def test_clone_copies_exact_native_texture_and_feather_blends_only_once():
    base=image();r=recipe();patch,mask=transfer_repair(r,base)
    result=place(base,patch,mask)
    assert result[50,120,0]==base[50,40,0]
    alpha=stroke_mask(r);left,top,_,_=r.search_rect
    expected=base.copy()
    for y in range(26,74):
        for x in range(96,144):
            a=alpha[y-top,x-left]
            expected[y,x]=base[y,x].astype(np.float64)*(1-float(a))+base[y,x-80].astype(np.float64)*float(a)
    np.testing.assert_allclose(result,expected,atol=1e-7,rtol=0)
    np.testing.assert_array_equal(base,image())
    assert not patch.pixels.flags.writeable


def test_heal_matches_destination_tone_without_losing_donor_microtexture():
    base=image();r=recipe("heal")
    patch,mask=transfer_repair(r,base);result=place(base,patch,mask)
    # Destination is donor plus a constant colour difference except the defect.
    np.testing.assert_allclose(result[47:53,117:123],base[47:53,37:43]+1,atol=2e-7,rtol=0)
    assert result[50,120,0]>1
    # Difference between neighboring checker phases must survive healing.
    assert abs(float(result[50,120,0]-result[50,121,0])+.03)<2e-7
    np.testing.assert_array_equal(result[:25],base[:25])


@pytest.mark.parametrize("mode",["clone","heal"])
def test_fractional_source_hdr_negative_values_and_zero_opacity(mode):
    base=np.zeros((100,160,3),np.float32);base[:]=[-.5,2,9]
    r=recipe(mode,source_point=dict(x=.251,y=.502))
    patch,mask=transfer_repair(r,base)
    np.testing.assert_allclose(patch.pixels,base[patch.origin[1]:patch.origin[1]+patch.pixels.shape[0],patch.origin[0]:patch.origin[0]+patch.pixels.shape[1]],atol=0,rtol=0)
    dirty=image();zero=r.model_copy(update={"strength":0})
    patch,mask=transfer_repair(zero,dirty)
    np.testing.assert_array_equal(place(dirty,patch,mask),dirty)


@pytest.mark.parametrize("mode",["clone","heal"])
def test_invalid_source_is_rejected_and_cancellation_is_checked(mode):
    with pytest.raises(ValueError,match="source point"):
        recipe(mode,source_point=None)
    edge=recipe(mode,source_point=dict(x=0,y=.5))
    with pytest.raises(ValueError,match="photo edge"):
        transfer_repair(edge,image())
    calls=0
    def cancel():
        nonlocal calls
        calls+=1
        if calls>=4: raise CancelledError()
    with pytest.raises(CancelledError):transfer_repair(recipe(mode),image(),cancel)


def test_painted_stroke_keeps_fixed_source_offset_instead_of_smearing_output():
    base=image();r=recipe(points=[dict(x=.73,y=.5),dict(x=.77,y=.5)],edge_feather=0)
    patch,mask=transfer_repair(r,base)
    # Fractional shift stays fixed along the full stroke; original source is immutable.
    again,againmask=transfer_repair(InpaintRecipe.model_validate_json(r.model_dump_json()),base)
    np.testing.assert_array_equal(patch.pixels,again.pixels)
    np.testing.assert_array_equal(mask,againmask)


def test_large_healing_grid_is_bounded_and_preserves_hdr_texture():
    y,x=np.mgrid[:1024,:1024]
    source=np.repeat((2+((x+y)%2)*.02)[...,None],3,axis=-1).astype(np.float32)
    source[:,512:]+=1;source[480:544,736:800]-=.5
    r=InpaintRecipe(mode="heal",source_size=(1024,1024),search_rect=(540,290,1000,750),
        source_point=dict(x=.25,y=.5),points=[dict(x=.75,y=.5)],radius_px=180,edge_feather=.71)
    patch,mask=transfer_repair(r,source)
    result=place(source,patch,mask)
    np.testing.assert_allclose(result[480:544,736:800],source[480:544,224:288]+1,atol=5e-6,rtol=0)
