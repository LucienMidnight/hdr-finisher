"""Estimate a signal-dependent noise model, variance = c*y^2 + a*y + b.

``a`` is shot noise, ``b`` read noise and ``c`` relative noise, which is how
Monte Carlo render noise scales; photographs fit with c = 0.

Immerkaer's 3x3 mask cancels constant and linear structure, so what it
responds to is dominated by noise; pixels on edges are excluded using the
gradient of a smoothed copy, and each brightness bin takes the low end of the
remaining spread. Only the *shape* of the model matters downstream -- the
denoiser re-measures an absolute noise level per band in units of this model --
so a global scale error here cancels. What must be right is how noise grows
with brightness.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .corpus import LUMA

IMMERKAER = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float32)


@dataclass(frozen=True)
class NoiseModel:
    a: float
    b: float
    c: float = 0.0

    def sigma(self, luminance: np.ndarray) -> np.ndarray:
        y = np.maximum(luminance, 0.0)
        return np.sqrt(np.maximum(self.c * y * y + self.a * y + self.b, 1e-20))


def _conv3(values: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    padded = np.pad(values, 1, mode="reflect")
    height, width = values.shape
    return sum(kernel[i, j] * padded[i:i + height, j:j + width] for i in range(3) for j in range(3))


def estimate(image: np.ndarray, bins: int = 12, edge_quantile: float = 0.3, spread_quantile: float = 0.25) -> NoiseModel:
    y = (image @ LUMA).astype(np.float32)
    response = _conv3(y, IMMERKAER)
    smooth = _conv3(y, np.full((3, 3), 1.0 / 9.0, dtype=np.float32))
    gx = _conv3(smooth, np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32))
    gy = _conv3(smooth, np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32))
    gradient = np.hypot(gx, gy)
    m = smooth.ravel()
    r = response.ravel()
    g = gradient.ravel()
    positive = m > 0
    m, r, g = m[positive], r[positive], g[positive]
    edges = np.quantile(m, np.linspace(0.02, 0.98, bins + 1))
    xs, vs, ws = [], [], []
    for low, high in zip(edges[:-1], edges[1:]):
        sel = (m >= low) & (m < high)
        if sel.sum() < 500:
            continue
        flat = sel & (g <= np.quantile(g[sel], edge_quantile))
        values = np.abs(r[flat])
        # For Gaussian noise the q-quantile of |r| is z_q * std; dividing by it
        # turns a low quantile into a standard deviation.
        from statistics import NormalDist

        z = NormalDist().inv_cdf(0.5 + spread_quantile / 2.0)
        std = np.quantile(values, spread_quantile) / z / 6.0
        xs.append(float(np.median(m[flat])))
        vs.append(float(std * std))
        ws.append(float(flat.sum()))
    xs, vs, ws = map(np.asarray, (xs, vs, ws))
    return _fit(xs, vs, ws)


def _fit(xs: np.ndarray, vs: np.ndarray, ws: np.ndarray) -> NoiseModel:
    """Non-negative least squares for (c, a, b), by trying every subset of terms.

    Residuals are relative, so dark and bright bins count equally rather than
    the brightest variance dominating the fit.
    """
    weight = np.sqrt(ws) / np.maximum(vs, 1e-20)
    columns = {"c": xs * xs, "a": xs, "b": np.ones_like(xs)}
    best = None
    for mask in range(1, 8):
        names = [name for bit, name in enumerate("cab") if mask >> bit & 1]
        design = np.stack([columns[name] for name in names], axis=1) * weight[:, None]
        coef, *_ = np.linalg.lstsq(design, vs * weight, rcond=None)
        if np.any(coef < 0):
            continue
        residual = float(np.sum((design @ coef - vs * weight) ** 2))
        if best is None or residual < best[0] - 1e-9:
            best = (residual, dict(zip(names, coef)))
    terms = best[1] if best else {"b": float(np.median(vs))}
    return NoiseModel(a=float(terms.get("a", 0.0)), b=float(max(terms.get("b", 0.0), np.min(vs) * 0.02, 1e-20)),
                      c=float(terms.get("c", 0.0)))


# The B3 a trous bands of white noise, relative to the finest band.
WHITE_RATIOS = np.array([1.0, 0.2253, 0.0961, 0.0464, 0.0230])
# Band 1 relative to band 0 ranges from ~0.17 (sharpened exports) through
# 0.23 (white) to ~0.5 (demosaiced raw); beyond band 1 every measured source
# decays by roughly this factor per band.
COARSE_DECAY = 0.45


def _blocks(values: np.ndarray, block: int = 16) -> np.ndarray:
    bh, bw = values.shape[0] // block, values.shape[1] // block
    return values[:bh * block, :bw * block].reshape(bh, block, bw, block)


def band_sigmas(normalised_bands: list[np.ndarray], quantile: float = 0.10) -> np.ndarray:
    """Per-component, per-band noise in units of the model's sigma.

    Only the two finest bands are measured: coarser ones carry too much
    picture to read noise from, so they are extrapolated. Blocks are chosen by
    how little fine luminance structure they hold, and the low quantile of the
    remaining block spread is calibrated back to a standard deviation.
    """
    levels = len(normalised_bands)
    luma0 = _blocks(normalised_bands[0][..., 0]).std(axis=(1, 3)).ravel()
    flat = luma0 <= np.quantile(luma0, 0.25)
    calibration = _QUANTILE_CALIBRATION[quantile]
    sigmas = np.zeros((3, levels))
    for component in range(3):
        fine = _blocks(normalised_bands[0][..., component]).std(axis=(1, 3)).ravel()[flat]
        next_ = _blocks(normalised_bands[1][..., component]).std(axis=(1, 3)).ravel()[flat]
        s0 = float(np.quantile(fine, quantile) * calibration)
        ratio = float(np.quantile(next_, quantile) * calibration) / max(s0, 1e-12)
        ratio = float(np.clip(ratio, 0.15, 0.6))
        sigmas[component, 0] = s0
        for level in range(1, levels):
            sigmas[component, level] = s0 * ratio * COARSE_DECAY ** (level - 1)
    return sigmas


def _calibrate() -> dict:
    rng = np.random.default_rng(11)
    stds = _blocks(rng.standard_normal((2048, 2048)).astype(np.float32)).std(axis=(1, 3)).ravel()
    return {q: 1.0 / float(np.quantile(stds, q)) for q in (0.05, 0.10, 0.25, 0.5)}


_QUANTILE_CALIBRATION = _calibrate()
