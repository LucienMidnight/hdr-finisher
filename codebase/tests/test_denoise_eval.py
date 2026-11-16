"""Result-based checks for the CPU quality harness; no private corpus needed."""
import math
import numpy as np
import pytest
import cv2
from tools.denoise_eval import metrics
from tools.denoise_eval.inputs import fit_noise, add_noise, bayer_bin2, develop, remosaic
from tools.denoise_eval.adapters import Off, DenoiseV2, tiled
from hdr_finisher.color import linear_srgb_to_acescg


def from_display(gray):
    rgb=np.repeat(gray[...,None],3,-1) if gray.ndim==2 else gray
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    return linear_srgb_to_acescg(linear.astype('float32'))


def test_psnr_known_error_and_ssim_identity():
    a=np.full((24,24,3),.5); b=a+.1
    assert metrics.psnr(a,b)==pytest.approx(20,abs=1e-10)
    assert metrics.psnr(a,a) is None
    assert metrics.ssim(a,a)==pytest.approx(1,abs=1e-12)
    assert metrics.ssim(a,b)<1


def test_noise_fit_recovers_poisson_gaussian_within_five_percent():
    rng=np.random.default_rng(42)
    means=np.linspace(.005,.8,80)
    a,b=.002, .000025
    variances=[]
    for mean in means:
        sample=rng.poisson(mean/a,20000)*a+rng.normal(0,np.sqrt(b),20000)
        variances.append(np.var(sample,ddof=1))
    fit=fit_noise(means,variances)
    assert fit['a']==pytest.approx(a,rel=.05)
    assert fit['b']==pytest.approx(b,rel=.05)
    assert fit['r2']>.99


def test_bayer_noise_has_expected_channel_variance_and_is_reproducible():
    a,b=.002,.00003
    clean=np.full((512,512),.3,dtype='float32')
    parameters=[dict(a=a*(c+1),b=b*(c+1)) for c in range(4)]
    noisy=add_noise(clean,parameters,7)
    assert np.array_equal(noisy,add_noise(clean,parameters,7))
    for c,p in enumerate(parameters):
        assert np.var(noisy[c//2::2,c%2::2]-clean[c//2::2,c%2::2])==pytest.approx(p['a']*.3+p['b'],rel=.03)


def test_binning_preserves_cfa_colours_and_halves_noise_sigma():
    rng=np.random.default_rng(42)
    m=rng.normal(0,1,(512,512)).astype('float32')
    for c in range(4):
        m[c//2::2,c%2::2]+=c*10
    b=bayer_bin2(m)
    assert b.shape==(256,256)
    for c in range(4):
        assert np.mean(b[c//2::2,c%2::2])==pytest.approx(c*10,abs=.02)
        assert np.std(b[c//2::2,c%2::2])==pytest.approx(.5,rel=.03)


def test_slanted_edge_mtf_matches_gaussian_optics():
    y,x=np.indices((256,256))
    d=x-127.5-np.tan(np.deg2rad(5))*(y-127.5)
    # Analytic Gaussian edge in finished display coordinates.
    sigma=1.4
    erf=np.vectorize(math.erf)
    gray=.1+.7*(1+erf(d/(math.sqrt(2)*sigma)))/2
    measured=metrics.mtf50(from_display(gray))
    expected=math.sqrt(2*math.log(2))/(2*math.pi*sigma)
    assert measured==pytest.approx(expected,rel=.04)


def test_blurred_edge_loses_mtf_and_halo_detects_overshoot():
    y,x=np.indices((128,128)); d=x-63.5-np.tan(np.deg2rad(5))*(y-63.5)
    clean=from_display(.1+.7*(1+np.vectorize(math.erf)(d/2))/2)
    soft=from_display(cv2.GaussianBlur(metrics.display(clean),(0,0),2))
    assert metrics.mtf50(soft)<metrics.mtf50(clean)*.8
    assert metrics.halo(clean,clean)==0
    ring=metrics.display(clean).copy(); ring[(d>5)&(d<8)]=.9
    assert metrics.halo(from_display(ring),clean)>.05


def test_fixed_encodings_colour_and_hdr_ceiling():
    white=np.ones((16,16,3),'float32')
    assert metrics.pq(np.array(10000))==pytest.approx(1)
    assert metrics.pq(np.array(100))==pytest.approx(.508078,abs=1e-6)
    assert metrics.display(white).mean()==pytest.approx(1,abs=1e-3)
    for lane in ('sdr','hdr'):
        assert metrics.colour_error(white,white,lane).max()==0
        assert metrics.colour_error(white,white*.5,lane).mean()>1
    assert np.max(metrics.display(white*100,'hdr'))<=metrics.pq(1000)
    # Published Sharma CIEDE2000 example 1, using the same colour implementation.
    import colour
    assert colour.delta_E([50,2.6772,-79.7751],[50,0,-82.7485],method='CIE 2000')==pytest.approx(2.0425,abs=.0001)


def test_flat_residual_texture_and_colour_bleed_known_cases():
    rng=np.random.default_rng(2)
    clean=np.full((64,64,3),.2,dtype='float32')
    noisy=clean+rng.normal(0,.01,clean.shape).astype('float32')
    mask=np.ones((64,64),bool)
    identity=metrics.flat_residual(noisy,noisy,clean,mask)
    perfect=metrics.flat_residual(clean,noisy,clean,mask)
    assert identity['luma_ratio']==pytest.approx(1)
    assert identity['chroma_ratio']==pytest.approx(1)
    assert perfect['luma_ratio']==0
    assert perfect['chroma_ratio']==0
    y,x=np.indices((64,64)); fabric=from_display(.4+.1*np.sin(x*1.2)+.05*np.sin(y*.4))
    assert metrics.texture(fabric,fabric,mask)['energy_ratio']==pytest.approx([1]*4)
    assert metrics.texture(fabric,fabric,mask)['invented_residual_energy_ratio']==pytest.approx([0]*4)
    coloured=np.empty((64,64,3),'float32');coloured[:,:32]=[.6,.05,.02];coloured[:,32:]=[.02,.05,.6]
    assert metrics.colour_bleed(coloured,coloured)['mean']==0
    smeared=cv2.GaussianBlur(coloured,(0,0),2)
    assert metrics.colour_bleed(smeared,coloured)['mean']>.01
    assert metrics.method_noise(noisy,noisy)==0


def test_small_dng_reuses_ahd_and_camera_colour_bridge():
    metadata=dict(cfa=[[0,1],[1,2]],white_balance=[2,1,1.5],camera_to_acescg=np.eye(3).tolist())
    camera=np.empty((64,64,3),'float32');camera[:]=[.1,.2,.3]
    rgb=develop(remosaic(camera,metadata['cfa']),metadata)
    assert rgb.shape==camera.shape
    assert rgb[8:-8,8:-8].mean((0,1))==pytest.approx([.2,.2,.45],abs=5e-5)


def test_adapters_exact_bypass_alpha_and_shifted_grid():
    rng=np.random.default_rng(8)
    image=rng.normal(.3,.02,(96,160,4)).astype('float32')
    image[...,3]=rng.random(image.shape[:2])
    for adapter in (Off(),DenoiseV2({'amount':0})):
        state=adapter.prepare(image,{})
        assert np.array_equal(image,adapter.process(image,{},state))
    adapter=DenoiseV2();state=adapter.prepare(image,{})
    output=adapter.process(image,{},state)
    assert np.array_equal(output[...,3],image[...,3])
    assert np.array_equal(adapter.process(image,{},state,bypass=True),image)
    a=tiled(adapter,image,{},state,tile=64)
    b=tiled(adapter,image,{},state,tile=64,shift=32)
    assert np.max(np.abs(a-b))<2e-6
    assert np.std(output[...,:3])<np.std(image[...,:3])


def test_optional_pairs_keep_linear_values_and_reject_misalignment(tmp_path):
    import json
    from tools.denoise_eval.inputs import paired_samples
    clean=np.full((32,32,3),2.,dtype='float32');clean[...,0]=-.1
    np.save(tmp_path/'clean.npy',clean)
    np.save(tmp_path/'noisy.npy',clean+.01)
    manifest=[dict(name='local',noisy='noisy.npy',clean='clean.npy')]
    (tmp_path/'pairs.json').write_text(json.dumps(manifest))
    sample=next(paired_samples(tmp_path))
    assert np.array_equal(sample.clean,clean)
    assert sample.bayer is None
    assert sample.rgb[0,0,0]<0 and sample.rgb[0,0,1]>1
    np.save(tmp_path/'noisy.npy',np.zeros((33,32,3),'float32'))
    with pytest.raises(ValueError,match='shapes differ'):
        next(paired_samples(tmp_path))
    np.save(tmp_path/'noisy.npy',np.zeros((32,32,3),'uint8'))
    with pytest.raises(ValueError,match='floating linear'):
        next(paired_samples(tmp_path))
