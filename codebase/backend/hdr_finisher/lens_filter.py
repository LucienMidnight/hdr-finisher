"""Energy-conserving spektrafilm lens PSFs (GPL-3.0, revision 3bb2c2d).

Eight calibrated Gaussian lobes approximate the original 27-part profile. Each
lobe is cropped at the existing spatial reach and normalized so the filter has
unit energy in each channel.
"""
from __future__ import annotations

from functools import lru_cache
import math
import numpy as np


# Fixed RGB point-spread fit, shared with frontend/lens-filters.js.
# Reproduce the data with f2-fit-mist.py in the Film speed research.
FAMILIES = {'glimmerglass': 0.65, 'black_pro_mist': 0.75, 'pro_mist': 1.05, 'cinebloom': 1.0}

_LOBES = {
    "glimmerglass": (
        (2.8586666666667, (0.032853209790959, 0.032853209790959, 0.032853209790959)),
        (8.6295556574403, (0.21895009393541, 0.21895009393541, 0.21895009393541)),
        (18.024852179783, (0.23508133661919, 0.23508133661919, 0.23508133661919)),
        (31.317289720818, (0.16727832028909, 0.16727832028909, 0.16727832028909)),
        (53.6, (0.10919797623409, 0.10919797623409, 0.10919797623409)),
        (113.65273884201, (0.12463324114035, 0.12463324114035, 0.12463324114035)),
        (237.39041716342, (0.092273750210269, 0.092273750210269, 0.092273750210269)),
        (716.61863950142, (0.019732071780643, 0.019732071780643, 0.019732071780643)),
    ),
    "black_pro_mist": (
        (5.7173333333333, (0.03650113687862, 0.03542504637576, 0.033927826668998)),
        (16.301114179397, (0.17331618727424, 0.18173927414435, 0.19345874534141)),
        (36.5664, (0.1701290440933, 0.18714983719562, 0.21083173643159)),
        (72.371, (0.10366795987063, 0.1647930777317, 0.24983957781376)),
        (144.00895512152, (0.14108692443496, 0.15664110952495, 0.1782824420871)),
        (262.998, (0.21902214507617, 0.15852337156924, 0.074348336394401)),
        (428.03137499537, (0.13467379343994, 0.095698436409339, 0.041470030462787)),
        (1060.9966803013, (0.021602808932134, 0.020029847049044, 0.017841304799958)),
    ),
    "pro_mist": (
        (4.8916683035179, (0.022952312550568, 0.023137847401982, 0.023395963352748)),
        (14.220266666667, (0.13159699610287, 0.13075421971789, 0.12958174982215)),
        (36.400845613549, (0.13300392502319, 0.14328199401118, 0.15758083613526)),
        (99.297590155987, (0.057141537673895, 0.07841598751587, 0.10801298671122)),
        (148.34386948445, (0.096585368539011, 0.12261301205631, 0.15882265084651)),
        (331.07881497737, (0.27834348429207, 0.25141740617217, 0.21395786581424)),
        (719.784, (0.22231353287121, 0.19043946329284, 0.14609628080535)),
        (2015.6745713309, (0.058062842947178, 0.059940069831763, 0.062551666512533)),
    ),
    "cinebloom": (
        (7.0029096448282, (0.017774515198305, 0.017768118857427, 0.017703834322488)),
        (19.306500956665, (0.090891522179807, 0.090758780084809, 0.090821854818971)),
        (45.708, (0.099897577622578, 0.1088662305873, 0.12051405052487)),
        (107.2, (0.023794705912834, 0.053230673283036, 0.093881143708257)),
        (214.4, (0.096575167696022, 0.13705728569749, 0.18757643785759)),
        (553.68, (0.33230701653993, 0.27306520769651, 0.19340597973477)),
        (1340, (0.24886284024421, 0.2255017315743, 0.19810727304613)),
        (4613.1633180764, (0.089896654606316, 0.093751972219122, 0.097989425986919)),
    ),
}


def scatter_fraction(family: str, strength: float) -> float:
    if family == "none":
        return 0.
    base = np.interp(math.log2(max(strength, 1e-6)), [-3,-2,-1,0,1], [.10,.20,.35,.55,.75])
    return float(np.clip(base * FAMILIES[family], 0., .99))


def components(family: str) -> tuple:
    return _LOBES[family]


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
    output = np.empty_like(image, dtype=np.float32)
    for region, filtered in _convolved_tiles(image, kernel):
        output[region] = filtered
    return output


def _convolved_tiles(image, kernel):
    radius = kernel.shape[0] // 2
    block = 512
    height, width = image.shape[:2]
    if radius == 0:
        for top in range(0, height, block):
            region = np.s_[top:top + block, :]
            yield region, image[region].astype(np.float32, copy=False)
        return
    # Circular overlap is confined to the discarded first 2*radius samples.
    fft_size = 1 << (block+2*radius-1).bit_length()
    spectrum = [np.fft.rfft2(kernel[...,c], s=(fft_size,fft_size)) for c in range(3)]
    for y in range(0,height,block):
        for x in range(0,width,block):
            bh,bw = min(block,height-y),min(block,width-x)
            yy = np.clip(np.arange(y-radius,y+bh+radius),0,height-1)
            xx = np.clip(np.arange(x-radius,x+bw+radius),0,width-1)
            patch = image[yy[:,None],xx[None,:]]
            output = np.empty((bh, bw, 3), dtype=np.float32)
            for c in range(3):
                filtered = np.fft.irfft2(np.fft.rfft2(patch[...,c],s=(fft_size,fft_size))*spectrum[c],s=(fft_size,fft_size))
                output[..., c] = filtered[2*radius:2*radius+bh,2*radius:2*radius+bw]
            yield np.s_[y:y+bh, x:x+bw], output


def apply_filter(image: np.ndarray, family: str, strength: float, size: float,
                 pixels_per_mm: float, source_pixel_scale: float = 1.) -> np.ndarray:
    if family == "none":
        return image
    amount = np.float32(scatter_fraction(family,strength))
    cap = max(0, int(math.floor(256*min(1.,max(.05,source_pixel_scale)))))
    blurred = convolve(image, psf(family,pixels_per_mm,size,cap))
    return ((np.float32(1)-amount)*image+amount*blurred).astype(np.float32)


def apply_filter_to_frame(src_frame, dst_frame, family, strength, size, pixels_per_mm, source_pixel_scale=1.):
    from .export_timing import tick

    if family == "none":
        dst_frame.write(src_frame.bands(128))
        return dst_frame
    amount = np.float32(scatter_fraction(family, strength))
    cap = max(0, int(math.floor(256 * min(1., max(.05, source_pixel_scale)))))
    kernel = psf(family, pixels_per_mm, size, cap)
    height, width = src_frame.shape[:2]
    done = 0
    with src_frame.map("r") as source, dst_frame.map("w+") as output:
        for region, filtered in _convolved_tiles(source, kernel):
            output[region] = (np.float32(1) - amount) * source[region] + amount * filtered
            done += filtered.shape[0] * filtered.shape[1]
            tick(done, height * width)
    return dst_frame
