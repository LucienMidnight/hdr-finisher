"""Fixed, inspectable quality measurements. No candidate-specific tuning."""
from __future__ import annotations
import math
import cv2
import colour
import numpy as np
from hdr_finisher.color import acescg_to_linear_srgb, acescg_to_linear_bt2020

LUMA = np.array([.2126, .7152, .0722])
BANDS = (0.5, 1., 2., 4.)


def pq(nits):
    x = np.maximum(np.asarray(nits, dtype=np.float64), 0) / 10000
    p = x ** (2610 / 16384)
    return ((3424 / 4096 + 2413 / 128 * p) / (1 + 2392 / 128 * p)) ** (2523 / 32)


def display(rgb, lane='sdr'):
    """SDR: clip linear sRGB, sRGB OETF. HDR: 203 nit white, 1000 nit hard cap, PQ."""
    if lane == 'hdr':
        linear = np.clip(acescg_to_linear_bt2020(rgb[..., :3]) * 203, 0, 1000)
        return pq(linear)
    linear = np.clip(acescg_to_linear_srgb(rgb[..., :3]), 0, 1)
    return np.where(linear <= .0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)


def psnr(a, b):
    mse = float(np.mean((np.asarray(a, dtype=np.float64) - b) ** 2))
    return None if mse == 0 else -10 * math.log10(mse)  # None means +infinity in strict JSON


def blur(x, sigma):
    return cv2.GaussianBlur(np.asarray(x, dtype=np.float64), (0, 0), sigma, borderType=cv2.BORDER_REFLECT)


def ssim(a, b):
    """Wang SSIM, 11x11 Gaussian sigma=1.5, K1=.01/K2=.03, unit display range."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    filt = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5, borderType=cv2.BORDER_REFLECT)
    u, v = filt(a), filt(b)
    va, vb, cov = filt(a*a)-u*u, filt(b*b)-v*v, filt(a*b)-u*v
    score = ((2*u*v+.01**2)*(2*cov+.03**2))/((u*u+v*v+.01**2)*(va+vb+.03**2))
    return float(np.mean(score[5:-5, 5:-5]))


def summary(values):
    return dict(mean=float(np.mean(values)), p99=float(np.percentile(values, 99)))


def colour_error(a, b, lane='sdr'):
    if lane == 'sdr':
        # colour's sRGB decoding plus D65 XYZ/Lab; both compared on finished pixels.
        lab_a = colour.XYZ_to_Lab(colour.sRGB_to_XYZ(display(a)))
        lab_b = colour.XYZ_to_Lab(colour.sRGB_to_XYZ(display(b)))
        return colour.delta_E(lab_a, lab_b, method='CIE 2000')
    aa = np.clip(acescg_to_linear_bt2020(a[..., :3])*203, 0, 1000)
    bb = np.clip(acescg_to_linear_bt2020(b[..., :3])*203, 0, 1000)
    d = colour.RGB_to_ICtCp(aa, method='ITU-R BT.2100-2 PQ') - colour.RGB_to_ICtCp(bb, method='ITU-R BT.2100-2 PQ')
    d[..., 1] *= .5
    return 720*np.linalg.norm(d, axis=-1)  # BT.2124 Delta E ITP (scaled Delta ICtCp)


def luma_chroma(rgb):
    y = rgb @ LUMA
    return np.stack((y, rgb[..., 0]-y, rgb[..., 2]-y), axis=-1)


def flat_residual(output, noisy, clean=None, mask=None):
    """Truth residual if available; otherwise remove a local plane in selected flats."""
    o, n = luma_chroma(display(output)), luma_chroma(display(noisy))
    if clean is not None:
        c = luma_chroma(display(clean)); o, n = o-c, n-c
    else:
        y, x = np.indices(o.shape[:2]); design = np.stack((np.ones_like(x), x, y), -1)[mask]
        for image in (o, n):
            plane = design @ np.linalg.lstsq(design, image[mask], rcond=None)[0]
            image[mask] -= plane
    if mask is None:
        mask = np.ones(o.shape[:2], bool)
    so, sn = np.std(o[mask], axis=0), np.std(n[mask], axis=0)
    return dict(luma_std=float(so[0]), chroma_std=float(np.sqrt(np.mean(so[1:]**2))),
                luma_ratio=ratio(so[0], sn[0]), chroma_ratio=ratio(np.linalg.norm(so[1:]), np.linalg.norm(sn[1:])))


def ratio(numerator, denominator):
    return float(numerator/denominator) if denominator > 1e-16 else None


def texture(output, clean, mask):
    o, c = display(output) @ LUMA, display(clean) @ LUMA
    ratios, invented = [], []
    for lo, hi in zip(BANDS, (1., 2., 4., 8.)):
        ob, cb = blur(o, lo)-blur(o, hi), blur(c, lo)-blur(c, hi)
        power = np.mean(cb[mask]**2)
        ratios.append(ratio(np.mean(ob[mask]**2), power))
        invented.append(ratio(np.mean((ob[mask]-cb[mask])**2), power))
    return dict(band_sigmas=list(BANDS), energy_ratio=ratios,
                invented_residual_energy_ratio=invented, invented_detail_band_ratio=ratios[0])


def edge_profile(image, slope=math.tan(math.radians(5)), bins=4):
    """ISO 12233-style 4x oversampled ESF, known chart edge angle (no angle fit)."""
    y, x = np.indices(image.shape[:2]); gray = display(image) @ LUMA
    distance = (x-(image.shape[1]-1)/2-slope*(y-(image.shape[0]-1)/2))/math.sqrt(1+slope*slope)
    use = np.abs(distance) < min(24, image.shape[1]/4)
    index = np.floor((distance[use]+32)*bins).astype(int)
    counts = np.bincount(index, minlength=256)
    sums = np.bincount(index, weights=gray[use], minlength=256)
    valid = np.flatnonzero(counts)
    return np.interp(np.arange(valid[0], valid[-1]+1), valid, sums[valid]/counts[valid])


def mtf50(image):
    esf = edge_profile(image)
    lsf = np.diff(esf)  # forward derivative, corrected for its sinc response below
    spectrum = np.abs(np.fft.rfft(lsf*np.hamming(len(lsf))))
    freq = np.fft.rfftfreq(len(lsf), d=.25)
    spectrum /= max(spectrum[0], 1e-20)
    spectrum /= np.maximum(np.sinc(freq*.25), .1)
    valid = freq <= .5
    f, m = freq[valid], spectrum[valid]
    crossing = np.flatnonzero(m <= .5)
    if not len(crossing):
        return None  # above sensor Nyquist; don't manufacture a precise number
    k = int(crossing[0])
    return float(np.interp(.5, m[k-1:k+1][::-1], f[k-1:k+1][::-1])) if k else 0.


def halo(image, clean):
    a, b = edge_profile(image), edge_profile(clean)
    low, high = np.mean(b[:16]), np.mean(b[-16:])
    height = high-low
    extra = max(0., float(np.max(a)-np.max(b)), float(np.min(b)-np.min(a)))
    return ratio(extra, height)


def colour_bleed(output, clean):
    c = display(clean)
    chroma = luma_chroma(c)[..., 1:]
    grad = np.sqrt(sum(cv2.Sobel(chroma, cv2.CV_64F, dx, dy, ksize=3)**2 for dx, dy in ((1,0),(0,1)))).sum(-1)
    edge = grad > max(.1, float(np.percentile(grad, 90)))
    mask = cv2.dilate(edge.astype('uint8'), np.ones((7,7), 'uint8')).astype(bool)
    return summary(np.linalg.norm(luma_chroma(display(output))[..., 1:]-chroma, axis=-1)[mask]) if mask.any() else None


def method_noise(output, noisy):
    n = display(noisy) @ LUMA; residual = n-display(output) @ LUMA
    # Correlate removed magnitude with edge strength measured on a smoothed input.
    base = blur(n, 2)
    edge = np.hypot(cv2.Sobel(base, cv2.CV_64F, 1, 0), cv2.Sobel(base, cv2.CV_64F, 0, 1))
    if np.std(residual) < 1e-12 or np.std(edge) < 1e-12:
        return 0.
    return float(np.corrcoef(np.abs(residual).ravel(), edge.ravel())[0,1])


def evaluate(output, noisy, clean, masks, slanted=False):
    result = {'flat_residual_sdr': flat_residual(output, noisy, clean, masks['flat']),
              'method_noise_edge_correlation': method_noise(output, noisy)}
    if clean is not None:
        for lane in ('sdr', 'hdr'):
            a, b = display(output, lane), display(clean, lane)
            result[lane] = dict(psnr_db=psnr(a,b), ssim=ssim(a,b), colour_difference=summary(colour_error(output,clean,lane)))
        result['texture'] = texture(output, clean, masks['texture']) if masks['texture'].any() else None
        result['colour_bleed'] = colour_bleed(output, clean)
        if slanted:
            a, b = mtf50(output), mtf50(clean)
            result['edge'] = dict(mtf50=a, clean_mtf50=b, mtf50_ratio=ratio(a,b) if a is not None and b is not None else None,
                                  halo_extra_fraction=halo(output, clean))
    return result
