"""Physical lens-filter results; no source-text contracts."""
import numpy as np
import pytest
from hdr_finisher.lens_filter import FAMILIES, components, psf, convolve, apply_filter, scatter_fraction, omitted_tail


@pytest.mark.parametrize("family,gain", [("glimmerglass",.65),("black_pro_mist",.75),("pro_mist",1.05),("cinebloom",1.)])
def test_commercial_strength_interpolates_in_stops(family,gain):
    for strength,base in [(.125,.10),(.25,.20),(.5,.35),(1,.55),(2,.75),(2**-.5,.45)]:
        assert scatter_fraction(family,strength) == pytest.approx(base*gain,abs=2e-9)


@pytest.mark.parametrize("family", FAMILIES)
def test_full_component_mixture_has_unit_energy_per_channel(family):
    parts=components(family)
    assert len(parts)==27
    np.testing.assert_allclose(np.sum([w for _,w in parts],axis=0),1,atol=2e-9,rtol=0)
    for size in [.25,1,4]:
        kernel=psf(family,100,size,32)
        np.testing.assert_allclose(kernel.sum(axis=(0,1)),1,atol=2e-9,rtol=0)
        np.testing.assert_allclose(kernel,kernel[::-1,::-1],atol=2e-9,rtol=0)
        assert kernel.min()>=0
        assert kernel.shape[0]<=65


@pytest.mark.parametrize("family", FAMILIES)
def test_constant_field_is_preserved_and_none_is_exact_bypass(family):
    image=np.full((9,13,3),[.18,1.,16.],np.float32)
    result=apply_filter(image,family,2,4,100,source_pixel_scale=.05)
    np.testing.assert_allclose(result,image,atol=1e-6,rtol=0)
    assert apply_filter(image,"none",2,4,100) is image


def test_fft_blocks_match_direct_clamped_convolution():
    rng=np.random.default_rng(318)
    image=rng.random((5,270,3),dtype=np.float32)
    kernel=psf("black_pro_mist",1,.25,2)
    actual=convolve(image,kernel)
    r=kernel.shape[0]//2
    padded=np.pad(image,((r,r),(r,r),(0,0)),mode="edge")
    expected=np.zeros_like(image,dtype=np.float64)
    for y in range(2*r+1):
        for x in range(2*r+1):
            expected+=padded[y:y+5,x:x+270]*kernel[y,x]
    np.testing.assert_allclose(actual,expected,atol=1e-6,rtol=0)


@pytest.mark.parametrize("family", FAMILIES)
def test_caps_omit_more_tail_when_size_increases(family):
    small=np.array(omitted_tail(family,100,.25,64))
    large=np.array(omitted_tail(family,100,4,64))
    assert np.all(large>=small)
    assert np.all(large<1)
    assert large.max()>0


def test_halo_colour_moves_between_radii_without_channel_energy_change():
    kernel=psf("cinebloom",100,1,64)
    assert not np.allclose(kernel[...,0],kernel[...,2])
    np.testing.assert_allclose(kernel.sum(axis=(0,1)),1,atol=2e-9,rtol=0)


def test_pinned_upstream_coefficients():
    import json
    from pathlib import Path
    golden=json.loads((Path(__file__).parent/"fixtures/lens-filter-upstream.json").read_text())
    for family,expected in golden.items():
        actual=[[sigma,*weights] for sigma,weights in components(family)]
        np.testing.assert_allclose(actual,expected,atol=2e-9,rtol=0)
