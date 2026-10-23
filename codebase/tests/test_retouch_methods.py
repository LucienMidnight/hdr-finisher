"""Behavioral tests for the explicitly selectable native repair prototypes."""
import numpy as np
import pytest
from hdr_finisher.retouch import CpuInpaint, RepairInput, RepairPatch
from hdr_finisher.retouch_recipe import InpaintRecipe, prepare_repair, stroke_mask
from hdr_finisher.retouch_methods import finish_repair


def recipe(edge=80, **updates):
    return InpaintRecipe(source_size=(edge,edge), search_rect=(0,0,edge,edge),
        points=[dict(x=.5,y=.5)], radius_px=edge/5,
        **(dict(method="edge-feather", edge_feather=.25,
                 settings=dict(seed=42,iterations=2,patch_radius=3)) | updates))


def test_edge_feather_changes_transition_without_growing_brush_or_weakening_core():
    hard = recipe(edge_feather=0)
    soft = recipe(edge_feather=.75)
    a,b = stroke_mask(hard),stroke_mask(soft)
    assert a[40,40] == b[40,40] == 1
    assert a[40,50] == 1 and 0 < b[40,50] < 1
    assert not a[:,57:].any() and not b[:,57:].any()
    source=np.ones((80,80,3),np.float32)
    request=prepare_repair(soft,lambda *args:source)
    assert set(np.unique(request.mask)) == {0,1}, "solve interior must be independent of blend opacity"


@pytest.mark.parametrize("updates", [dict(method="other"),dict(edge_feather=-.1),
    dict(edge_feather=1.1),dict(texture_amount=float("nan")),dict(texture_amount=1.1)])
def test_invalid_prototype_settings_rejected(updates):
    with pytest.raises(ValueError): recipe(**updates)


def test_original_and_donor_detail_recover_distinct_known_microtexture():
    # A two-pixel checker has a known 5x5 high-pass residual of 24/25.
    yy,xx=np.mgrid[:40,:40]
    texture=np.where((yy+xx)%2, .125,-.125).astype(np.float32)
    image=np.repeat((2+texture)[...,None],3,axis=-1)
    mask=np.zeros((40,40),np.float32);mask[15:25,15:25]=1
    request=RepairInput(image,mask).owned()
    targets=np.argwhere(mask>0)
    sources=targets.copy();sources[:,1]-=11 # known clean donor, opposite checker phase
    pixels=np.full((10,10,3),2,np.float32);pixels.setflags(write=False)
    patch=RepairPatch((15,15),pixels,sources,targets)
    r=recipe(edge=40,edge_feather=0)
    edge=finish_repair(r,request,patch,mask)
    original=finish_repair(r.model_copy(update={"method":"original-detail"}),request,patch,mask)
    donor=finish_repair(r.model_copy(update={"method":"donor-detail"}),request,patch,mask)
    expected=np.repeat((2+texture[15:25,15:25]*np.float32(24/25))[...,None],3,axis=-1)
    np.testing.assert_array_equal(original.pixels,expected)
    np.testing.assert_array_equal(donor.pixels,np.repeat((2-texture[15:25,15:25]*np.float32(24/25))[...,None],3,axis=-1))
    np.testing.assert_array_equal(edge.pixels,pixels)
    assert not original.pixels.flags.writeable
    np.testing.assert_array_equal(patch.pixels,pixels) # finishing never poisons cached tone


@pytest.mark.parametrize("edge", [80,320,1024])
def test_native_prototypes_are_deterministic_finite_hdr_and_zero_amount_matches_feather(edge):
    rng=np.random.default_rng(4)
    clean=np.full((edge,edge,3),[-.25,2,9],np.float32)+rng.normal(0,.01,(edge,edge,1)).astype(np.float32)
    dirty=clean.copy();mid=edge//2;dirty[mid-4:mid+4,mid-4:mid+4]=-.5
    r=recipe(edge)
    request=prepare_repair(r,lambda *args:dirty)
    cached=CpuInpaint().solve(request,r.settings)
    baseline=cached.pixels.copy()
    alpha=stroke_mask(r)
    feather=finish_repair(r,request,cached,alpha)
    for method in ("original-detail","donor-detail"):
        test=r.model_copy(update={"method":method})
        result=finish_repair(test,request,cached,alpha)
        again=finish_repair(InpaintRecipe.model_validate_json(test.model_dump_json()),request,cached,alpha)
        np.testing.assert_array_equal(result.pixels,again.pixels)
        assert np.isfinite(result.pixels).all()
        assert result.pixels[...,0].min()<0 and result.pixels[...,2].max()>1
        zero=finish_repair(test.model_copy(update={"texture_amount":0}),request,cached,alpha)
        np.testing.assert_array_equal(zero.pixels,feather.pixels)
    np.testing.assert_array_equal(cached.pixels,baseline)


def test_prototype_finishing_honors_cancellation():
    from concurrent.futures import CancelledError
    r=recipe();source=np.ones((80,80,3),np.float32)
    request=prepare_repair(r,lambda *args:source)
    patch=CpuInpaint().solve(request,r.settings)
    def stop(): raise CancelledError()
    with pytest.raises(CancelledError):finish_repair(r,request,patch,stroke_mask(r),stop)
