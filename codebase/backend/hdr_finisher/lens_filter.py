"""Energy-conserving spektrafilm lens PSFs (GPL-3.0, revision 3bb2c2d).

All 27 Gaussian components of the upstream exponential surrogate are retained.
Each component is cropped at the existing spatial reach, then normalized. This
keeps its share of scattered light; the omitted tail is reported separately.
"""
from __future__ import annotations

from functools import lru_cache
import math
import numpy as np

# core/halo/bloom wavelengths (um), bloom exponent, group shares, warmth, gain.
FAMILIES = {
    "glimmerglass": (10., 50., 260., 3.2, (.60, .30, .10), 0., .65),
    "black_pro_mist": (16., 95., 380., 3.5, (.40, .47, .13), .65, .75),
    "pro_mist": (14., 150., 650., 2.9, (.28, .42, .30), .40, 1.05),
    "cinebloom": (20., 200., 1000., 2.5, (.22, .30, .48), .85, 1.),
}
GAUSSIAN_FIT = ((.1633, .5360), (.6496, 1.5236), (.1870, 2.7684))


def scatter_fraction(family: str, strength: float) -> float:
    if family == "none":
        return 0.
    base = np.interp(math.log2(max(strength, 1e-6)), [-3,-2,-1,0,1], [.10,.20,.35,.55,.75])
    return float(np.clip(base * FAMILIES[family][-1], 0., .99))


@lru_cache(maxsize=4)
def components(family: str) -> tuple:
    cfg = FAMILIES[family]
    result = []
    fit_total = sum(a for a, _ in GAUSSIAN_FIT)  # upstream rounded amplitudes sum .9999
    for group, (spread, count) in enumerate(((1.5,2),(2.,3),(2.5,4))):
        wavelengths = np.geomspace(cfg[group]/spread, cfg[group]*spread, count)
        weights = wavelengths ** (2-cfg[3]) if group == 2 else np.ones(count)
        weights /= weights.sum()
        rgb_weights = np.tile(weights, (3,1))
        if group == 1:
            gradient = np.linspace(-1., 1., count)
            gradient -= np.average(gradient, weights=weights)
            rgb_weights = np.maximum(weights * (1 + cfg[5]*np.array([1.30,.15,-1.45])[:,None]*gradient), 0)
            rgb_weights /= rgb_weights.sum(axis=1)[:,None]
        for j, wavelength in enumerate(wavelengths):
            for amplitude, ratio in GAUSSIAN_FIT:
                result.append((float(wavelength*ratio), tuple(float(v) for v in rgb_weights[:,j]*cfg[4][group]*amplitude/fit_total)))
    return tuple(result)


def bounded_axis(sigma: float, cap: int) -> np.ndarray:
    radius = min(cap, max(0, int(math.floor(3*sigma+.5))))
    offsets = np.arange(-radius, radius+1, dtype=np.float64)
    weights = np.exp(-.5*(offsets/max(sigma,1e-6))**2)
    return weights / weights.sum()


@lru_cache(maxsize=32)
def psf(family: str, pixels_per_mm: float, size: float, cap: int) -> np.ndarray:
    parts = [(um*pixels_per_mm*size/1000., np.asarray(weight)) for um,weight in components(family)]
    radius = max(min(cap, int(math.floor(3*sigma+.5))) for sigma,_ in parts)
    kernel = np.zeros((2*radius+1,2*radius+1,3), np.float64)
    for sigma, weight in parts:
        axis = bounded_axis(sigma, cap)
        r = len(axis)//2
        kernel[radius-r:radius+r+1,radius-r:radius+r+1] += np.outer(axis,axis)[...,None]*weight
    kernel.setflags(write=False)
    return kernel


def omitted_tail(family: str, pixels_per_mm: float, size: float, cap: int) -> tuple[float,float,float]:
    """Continuous Gaussian energy outside the capped square, before renormalizing.

    Relative to the upstream 3-sigma surrogate, not an infinite exact exponential.
    """
    lost = np.zeros(3)
    full = math.erf(3/math.sqrt(2))**2
    for um, weight in components(family):
        sigma = um*pixels_per_mm*size/1000.
        reach = min(3., cap/max(sigma,1e-12))
        lost += np.asarray(weight)*max(0., 1-math.erf(reach/math.sqrt(2))**2/full)
    return tuple(float(v) for v in lost)


def convolve(image: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Clamped-edge convolution in bounded FFT blocks, without SciPy.

    Work tiles bound temporary memory independently of export dimensions.
    No circular wrap reaches the kept central tile.
    """
    radius = kernel.shape[0]//2
    if radius == 0:
        return image.astype(np.float32, copy=True)
    block = 512
    # Circular overlap is confined to the discarded first 2*radius samples.
    fft_size = 1 << (block+2*radius-1).bit_length()
    spectrum = [np.fft.rfft2(kernel[...,c], s=(fft_size,fft_size)) for c in range(3)]
    output = np.empty_like(image, dtype=np.float32)
    height,width = image.shape[:2]
    for y in range(0,height,block):
        for x in range(0,width,block):
            bh,bw = min(block,height-y),min(block,width-x)
            yy = np.clip(np.arange(y-radius,y+bh+radius),0,height-1)
            xx = np.clip(np.arange(x-radius,x+bw+radius),0,width-1)
            patch = image[yy[:,None],xx[None,:]]
            for c in range(3):
                filtered = np.fft.irfft2(np.fft.rfft2(patch[...,c],s=(fft_size,fft_size))*spectrum[c],s=(fft_size,fft_size))
                output[y:y+bh,x:x+bw,c] = filtered[2*radius:2*radius+bh,2*radius:2*radius+bw]
    return output


def apply_filter(image: np.ndarray, family: str, strength: float, size: float,
                 pixels_per_mm: float, source_pixel_scale: float = 1.) -> np.ndarray:
    if family == "none":
        return image
    amount = np.float32(scatter_fraction(family,strength))
    cap = max(0, int(math.floor(256*min(1.,max(.05,source_pixel_scale)))))
    blurred = convolve(image, psf(family,pixels_per_mm,size,cap))
    return ((np.float32(1)-amount)*image+amount*blurred).astype(np.float32)
