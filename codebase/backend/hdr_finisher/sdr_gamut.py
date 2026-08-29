"""Perceptual clipping of linear-sRGB colors to the display gamut.

The analytic cusp and gamut-intersection equations are adapted from Bjorn
Ottosson's MIT-licensed reference implementation:
https://bottosson.github.io/posts/gamutclipping/
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

import numpy as np


# These values are deliberately shared with the WGSL implementation.  They are
# sized for float32 arithmetic rather than inherited from a float64 prototype.
CHROMA_EPS = np.float32(1e-5)
MATH_EPS = np.float32(1e-6)
GAMUT_EPS = np.float32(2e-5)
NEUTRAL_RGB_EPS = np.float32(1e-3)

# Selected by the HDR Finisher corpus sweep.  The qualification harness may
# override this argument while evaluating the predeclared candidates.
SDR_GAMUT_ALPHA = np.float32(5.0)
# Fixed alpha 5 retains useful color around the cusp, but a photographic
# exposure push should not leave extreme upper highlights pinned to a saturated
# gamut edge.  Fade only that upper branch toward the lightness-preserving
# projection as OKLab L approaches diffuse white.  The start was selected by
# the same corpus gate: 0.80 missed IMG_0790 arm retention while 0.85 passed.
SDR_GAMUT_HIGHLIGHT_START = np.float32(0.85)
SDR_GAMUT_HIGHLIGHT_ALPHA = np.float32(0.05)
# Near-white low-saturation colors are commonly produced where one or more RAW
# channels have already clipped.  Starting their path-to-white sooner avoids a
# pastel/cyan boundary ring, while saturated skin, flame, and emissive colors
# retain the later corpus-selected start above.
SDR_GAMUT_LOW_SAT_HIGHLIGHT_START = np.float32(0.70)
SDR_GAMUT_SATURATION_LOW = np.float32(0.08)
SDR_GAMUT_SATURATION_HIGH = np.float32(0.20)
_GAMUT_WORKERS = min(8, max(1, (os.cpu_count() or 1) // 2))
_GAMUT_EXECUTOR = ThreadPoolExecutor(max_workers=_GAMUT_WORKERS, thread_name_prefix="sdr-gamut")


def linear_srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """Convert unclamped linear sRGB to OKLab using float32 signed cube roots."""
    value = np.asarray(rgb, dtype=np.float32)
    red, green, blue = np.moveaxis(value, -1, 0)
    ell = np.float32(0.4122214708) * red + np.float32(0.5363325363) * green + np.float32(0.0514459929) * blue
    em = np.float32(0.2119034982) * red + np.float32(0.6806995451) * green + np.float32(0.1073969566) * blue
    ess = np.float32(0.0883024619) * red + np.float32(0.2817188376) * green + np.float32(0.6299787005) * blue
    ell_ = np.cbrt(ell).astype(np.float32)
    em_ = np.cbrt(em).astype(np.float32)
    ess_ = np.cbrt(ess).astype(np.float32)
    return np.stack(
        (
            np.float32(0.2104542553) * ell_ + np.float32(0.7936177850) * em_ - np.float32(0.0040720468) * ess_,
            np.float32(1.9779984951) * ell_ - np.float32(2.4285922050) * em_ + np.float32(0.4505937099) * ess_,
            np.float32(0.0259040371) * ell_ + np.float32(0.7827717662) * em_ - np.float32(0.8086757660) * ess_,
        ),
        axis=-1,
    ).astype(np.float32, copy=False)


def oklab_to_linear_srgb(lab: np.ndarray) -> np.ndarray:
    """Convert OKLab to unclamped linear sRGB using float32 arithmetic."""
    value = np.asarray(lab, dtype=np.float32)
    lightness, aa, bb = np.moveaxis(value, -1, 0)
    ell_ = lightness + np.float32(0.3963377774) * aa + np.float32(0.2158037573) * bb
    em_ = lightness - np.float32(0.1055613458) * aa - np.float32(0.0638541728) * bb
    ess_ = lightness - np.float32(0.0894841775) * aa - np.float32(1.2914855480) * bb
    ell = ell_ * ell_ * ell_
    em = em_ * em_ * em_
    ess = ess_ * ess_ * ess_
    return np.stack(
        (
            np.float32(4.0767416621) * ell - np.float32(3.3077115913) * em + np.float32(0.2309699292) * ess,
            -np.float32(1.2684380046) * ell + np.float32(2.6097574011) * em - np.float32(0.3413193965) * ess,
            -np.float32(0.0041960863) * ell - np.float32(0.7034186147) * em + np.float32(1.7076147010) * ess,
        ),
        axis=-1,
    ).astype(np.float32, copy=False)


def _compute_max_saturation(aa: np.ndarray, bb: np.ndarray) -> np.ndarray:
    red_sector = -np.float32(1.88170328) * aa - np.float32(0.80936493) * bb > np.float32(1.0)
    green_sector = (~red_sector) & (
        np.float32(1.81444104) * aa - np.float32(1.19445276) * bb > np.float32(1.0)
    )

    k0 = np.where(red_sector, np.float32(1.19086277), np.where(green_sector, np.float32(0.73956515), np.float32(1.35733652)))
    k1 = np.where(red_sector, np.float32(1.76576728), np.where(green_sector, np.float32(-0.45954404), np.float32(-0.00915799)))
    k2 = np.where(red_sector, np.float32(0.59662641), np.where(green_sector, np.float32(0.08285427), np.float32(-1.15130210)))
    k3 = np.where(red_sector, np.float32(0.75515197), np.where(green_sector, np.float32(0.12541070), np.float32(-0.50559606)))
    k4 = np.where(red_sector, np.float32(0.56771245), np.where(green_sector, np.float32(0.14503204), np.float32(0.00692167)))
    wl = np.where(red_sector, np.float32(4.0767416621), np.where(green_sector, np.float32(-1.2684380046), np.float32(-0.0041960863)))
    wm = np.where(red_sector, np.float32(-3.3077115913), np.where(green_sector, np.float32(2.6097574011), np.float32(-0.7034186147)))
    ws = np.where(red_sector, np.float32(0.2309699292), np.where(green_sector, np.float32(-0.3413193965), np.float32(1.7076147010)))

    saturation = (k0 + k1 * aa + k2 * bb + k3 * aa * aa + k4 * aa * bb).astype(np.float32)
    k_ell = np.float32(0.3963377774) * aa + np.float32(0.2158037573) * bb
    k_em = -np.float32(0.1055613458) * aa - np.float32(0.0638541728) * bb
    k_ess = -np.float32(0.0894841775) * aa - np.float32(1.2914855480) * bb

    for _ in range(2):
        ell_ = np.float32(1.0) + saturation * k_ell
        em_ = np.float32(1.0) + saturation * k_em
        ess_ = np.float32(1.0) + saturation * k_ess
        ell = ell_ * ell_ * ell_
        em = em_ * em_ * em_
        ess = ess_ * ess_ * ess_
        ell_d = np.float32(3.0) * k_ell * ell_ * ell_
        em_d = np.float32(3.0) * k_em * em_ * em_
        ess_d = np.float32(3.0) * k_ess * ess_ * ess_
        ell_d2 = np.float32(6.0) * k_ell * k_ell * ell_
        em_d2 = np.float32(6.0) * k_em * k_em * em_
        ess_d2 = np.float32(6.0) * k_ess * k_ess * ess_
        function = wl * ell + wm * em + ws * ess
        derivative = wl * ell_d + wm * em_d + ws * ess_d
        second = wl * ell_d2 + wm * em_d2 + ws * ess_d2
        denominator = derivative * derivative - np.float32(0.5) * function * second
        safe = np.abs(denominator) > MATH_EPS
        candidate = saturation - np.divide(
            function * derivative,
            denominator,
            out=np.zeros_like(saturation),
            where=safe,
        )
        valid = safe & np.isfinite(candidate) & (candidate > MATH_EPS)
        saturation = np.where(valid, candidate, saturation).astype(np.float32)
    return saturation


def _find_cusp(aa: np.ndarray, bb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    saturation = _compute_max_saturation(aa, bb)
    unit_lab = np.stack((np.ones_like(aa), saturation * aa, saturation * bb), axis=-1)
    at_max = oklab_to_linear_srgb(unit_lab)
    maximum = np.maximum(np.max(at_max, axis=-1), MATH_EPS)
    lightness = np.cbrt(np.float32(1.0) / maximum).astype(np.float32)
    return lightness, (lightness * saturation).astype(np.float32)


def _halley_delta(function: np.ndarray, derivative: np.ndarray, second: np.ndarray) -> np.ndarray:
    denominator = derivative * derivative - np.float32(0.5) * function * second
    safe = np.abs(denominator) > MATH_EPS
    reciprocal = np.divide(derivative, denominator, out=np.zeros_like(derivative), where=safe)
    delta = -function * reciprocal
    valid = safe & np.isfinite(reciprocal) & np.isfinite(delta) & (reciprocal >= np.float32(0.0))
    return np.where(valid, delta, np.float32(np.inf)).astype(np.float32)


def _find_gamut_intersection(
    aa: np.ndarray,
    bb: np.ndarray,
    lightness: np.ndarray,
    chroma: np.ndarray,
    focus_lightness: np.ndarray,
    cusp_lightness: np.ndarray,
    cusp_chroma: np.ndarray,
) -> np.ndarray:
    lower = (
        (lightness - focus_lightness) * cusp_chroma
        - (cusp_lightness - focus_lightness) * chroma
    ) <= np.float32(0.0)
    lower_denominator = chroma * cusp_lightness + cusp_chroma * (focus_lightness - lightness)
    upper_denominator = chroma * (cusp_lightness - np.float32(1.0)) + cusp_chroma * (focus_lightness - lightness)
    lower_t = np.divide(
        cusp_chroma * focus_lightness,
        lower_denominator,
        out=np.zeros_like(chroma),
        where=np.abs(lower_denominator) > MATH_EPS,
    )
    upper_t = np.divide(
        cusp_chroma * (focus_lightness - np.float32(1.0)),
        upper_denominator,
        out=np.zeros_like(chroma),
        where=np.abs(upper_denominator) > MATH_EPS,
    )
    parameter = np.clip(np.where(lower, lower_t, upper_t), np.float32(0.0), np.float32(1.0)).astype(np.float32)

    upper = ~lower
    delta_lightness = lightness - focus_lightness
    delta_chroma = chroma
    k_ell = np.float32(0.3963377774) * aa + np.float32(0.2158037573) * bb
    k_em = -np.float32(0.1055613458) * aa - np.float32(0.0638541728) * bb
    k_ess = -np.float32(0.0894841775) * aa - np.float32(1.2914855480) * bb
    ell_dt = delta_lightness + delta_chroma * k_ell
    em_dt = delta_lightness + delta_chroma * k_em
    ess_dt = delta_lightness + delta_chroma * k_ess

    for _ in range(2):
        current_lightness = focus_lightness * (np.float32(1.0) - parameter) + parameter * lightness
        current_chroma = parameter * chroma
        ell_ = current_lightness + current_chroma * k_ell
        em_ = current_lightness + current_chroma * k_em
        ess_ = current_lightness + current_chroma * k_ess
        ell = ell_ * ell_ * ell_
        em = em_ * em_ * em_
        ess = ess_ * ess_ * ess_
        ell_d = np.float32(3.0) * ell_dt * ell_ * ell_
        em_d = np.float32(3.0) * em_dt * em_ * em_
        ess_d = np.float32(3.0) * ess_dt * ess_ * ess_
        ell_d2 = np.float32(6.0) * ell_dt * ell_dt * ell_
        em_d2 = np.float32(6.0) * em_dt * em_dt * em_
        ess_d2 = np.float32(6.0) * ess_dt * ess_dt * ess_

        red = np.float32(4.0767416621) * ell - np.float32(3.3077115913) * em + np.float32(0.2309699292) * ess - np.float32(1.0)
        red_d = np.float32(4.0767416621) * ell_d - np.float32(3.3077115913) * em_d + np.float32(0.2309699292) * ess_d
        red_d2 = np.float32(4.0767416621) * ell_d2 - np.float32(3.3077115913) * em_d2 + np.float32(0.2309699292) * ess_d2
        green = -np.float32(1.2684380046) * ell + np.float32(2.6097574011) * em - np.float32(0.3413193965) * ess - np.float32(1.0)
        green_d = -np.float32(1.2684380046) * ell_d + np.float32(2.6097574011) * em_d - np.float32(0.3413193965) * ess_d
        green_d2 = -np.float32(1.2684380046) * ell_d2 + np.float32(2.6097574011) * em_d2 - np.float32(0.3413193965) * ess_d2
        blue = -np.float32(0.0041960863) * ell - np.float32(0.7034186147) * em + np.float32(1.7076147010) * ess - np.float32(1.0)
        blue_d = -np.float32(0.0041960863) * ell_d - np.float32(0.7034186147) * em_d + np.float32(1.7076147010) * ess_d
        blue_d2 = -np.float32(0.0041960863) * ell_d2 - np.float32(0.7034186147) * em_d2 + np.float32(1.7076147010) * ess_d2

        step = np.minimum(
            _halley_delta(red, red_d, red_d2),
            np.minimum(_halley_delta(green, green_d, green_d2), _halley_delta(blue, blue_d, blue_d2)),
        )
        candidate = parameter + step
        valid = upper & np.isfinite(candidate) & (candidate >= np.float32(0.0)) & (candidate <= np.float32(1.0))
        parameter = np.where(valid, candidate, parameter).astype(np.float32)
    return parameter


def _map_oog_pixels(source: np.ndarray, alpha: float | np.ndarray) -> np.ndarray:
    """Map a compact N-by-3 array known to require perceptual clipping."""
    lab = linear_srgb_to_oklab(source)
    lightness = lab[:, 0]
    chroma = np.hypot(lab[:, 1], lab[:, 2]).astype(np.float32)
    powerless = chroma < CHROMA_EPS
    mapped = np.clip(source, np.float32(0.0), np.float32(1.0))

    if np.any(~powerless):
        indices = ~powerless
        mapped_lightness = lightness[indices]
        mapped_chroma = chroma[indices]
        aa = (lab[indices, 1] / mapped_chroma).astype(np.float32)
        bb = (lab[indices, 2] / mapped_chroma).astype(np.float32)
        cusp_lightness, cusp_chroma = _find_cusp(aa, bb)
        lightness_delta = mapped_lightness - cusp_lightness
        k = np.float32(2.0) * np.where(
            lightness_delta > np.float32(0.0),
            np.float32(1.0) - cusp_lightness,
            cusp_lightness,
        )
        k = np.maximum(k, MATH_EPS)
        base_strength = np.broadcast_to(np.asarray(alpha, dtype=np.float32), mapped_lightness.shape)
        perceptual_saturation = mapped_chroma / np.maximum(np.abs(mapped_lightness), MATH_EPS)
        saturation_t = np.clip(
            (perceptual_saturation - SDR_GAMUT_SATURATION_LOW)
            / (SDR_GAMUT_SATURATION_HIGH - SDR_GAMUT_SATURATION_LOW),
            np.float32(0.0),
            np.float32(1.0),
        )
        saturation_weight = saturation_t * saturation_t * (np.float32(3.0) - np.float32(2.0) * saturation_t)
        highlight_start = (
            SDR_GAMUT_LOW_SAT_HIGHLIGHT_START
            + saturation_weight * (SDR_GAMUT_HIGHLIGHT_START - SDR_GAMUT_LOW_SAT_HIGHLIGHT_START)
        ).astype(np.float32)
        highlight_t = np.clip(
            (mapped_lightness - highlight_start)
            / (np.float32(1.0) - highlight_start),
            np.float32(0.0),
            np.float32(1.0),
        )
        highlight_weight = highlight_t * highlight_t * (np.float32(3.0) - np.float32(2.0) * highlight_t)
        highlight_weight = np.where(
            lightness_delta > np.float32(0.0),
            highlight_weight,
            np.float32(0.0),
        ).astype(np.float32)
        strength = (
            base_strength
            + highlight_weight * (SDR_GAMUT_HIGHLIGHT_ALPHA - base_strength)
        ).astype(np.float32)
        e1 = (
            np.float32(0.5) * k
            + np.abs(lightness_delta)
            + strength * mapped_chroma / k
        )
        discriminant = np.maximum(
            e1 * e1 - np.float32(2.0) * k * np.abs(lightness_delta),
            np.float32(0.0),
        )
        focus_lightness = cusp_lightness + np.float32(0.5) * np.sign(lightness_delta) * (
            e1 - np.sqrt(discriminant).astype(np.float32)
        )
        # Low-saturation upper highlights are already close to the neutral
        # axis.  Following the adaptive focus alone can trade away lightness
        # while leaving a conspicuous pastel boundary around clipped RAW
        # highlights.  Blend the projection focus toward the source
        # lightness in exactly that region.  The gamut intersection remains
        # analytic and hue preserving, but its limiting path reaches white
        # instead of riding the upper cusp.  Saturated skin/fire keeps the
        # corpus-selected cusp-adaptive projection.
        neutral_axis_weight = (
            highlight_weight * (np.float32(1.0) - saturation_weight)
        ).astype(np.float32)
        focus_lightness = (
            focus_lightness
            + neutral_axis_weight * (mapped_lightness - focus_lightness)
        ).astype(np.float32)
        parameter = _find_gamut_intersection(
            aa,
            bb,
            mapped_lightness,
            mapped_chroma,
            focus_lightness,
            cusp_lightness,
            cusp_chroma,
        )
        clipped_lightness = focus_lightness * (np.float32(1.0) - parameter) + parameter * mapped_lightness
        clipped_chroma = parameter * mapped_chroma
        clipped_lab = np.stack((clipped_lightness, clipped_chroma * aa, clipped_chroma * bb), axis=-1)
        mapped[indices] = oklab_to_linear_srgb(clipped_lab)

    # Analytic intersection may leave only float32-scale residue outside the
    # cube. Qualification tests detect anything larger than GAMUT_EPS.
    return np.clip(mapped, np.float32(0.0), np.float32(1.0)).astype(np.float32, copy=False)


def compress_to_srgb_gamut(image: np.ndarray, *, alpha: float = float(SDR_GAMUT_ALPHA)) -> np.ndarray:
    """Clip linear sRGB to its cube along hue-preserving adaptive OKLCh rays."""
    rgb = np.asarray(image, dtype=np.float32)
    if rgb.shape[-1] != 3:
        raise ValueError("linear-sRGB input must have three channels")
    output = rgb.copy()
    finite = np.all(np.isfinite(rgb), axis=-1)
    in_gamut = finite & np.all((rgb >= np.float32(0.0)) & (rgb <= np.float32(1.0)), axis=-1)
    needs_mapping = ~in_gamut
    if not np.any(needs_mapping):
        return output

    # Values no farther outside the cube than float32 residue do not need a
    # perceptual projection. Snapping only those channels avoids injecting
    # solver noise where an upstream matrix lands a boundary neutral a few
    # ULPs above one.
    residue = finite & np.all(
        (rgb >= -(GAMUT_EPS + MATH_EPS))
        & (rgb <= np.float32(1.0) + GAMUT_EPS + MATH_EPS),
        axis=-1,
    )
    residue &= needs_mapping
    output[residue] = np.clip(rgb[residue], np.float32(0.0), np.float32(1.0))
    needs_mapping &= ~residue
    near_neutral = finite & (
        np.max(rgb, axis=-1) - np.min(rgb, axis=-1) < NEUTRAL_RGB_EPS
    )
    near_neutral &= needs_mapping
    output[near_neutral] = np.clip(rgb[near_neutral], np.float32(0.0), np.float32(1.0))
    needs_mapping &= ~near_neutral
    if not np.any(needs_mapping):
        return output

    source = np.nan_to_num(
        rgb[needs_mapping], nan=np.float32(0.0), posinf=np.float32(1.0), neginf=np.float32(0.0)
    ).astype(np.float32, copy=False)
    if source.shape[0] >= 262_144 and _GAMUT_WORKERS > 1:
        chunks = [chunk for chunk in np.array_split(source, _GAMUT_WORKERS) if chunk.size]
        mapped = np.concatenate(
            list(_GAMUT_EXECUTOR.map(lambda chunk: _map_oog_pixels(chunk, alpha), chunks)),
            axis=0,
        )
    else:
        mapped = _map_oog_pixels(source, alpha)
    output[needs_mapping] = mapped
    return output.astype(np.float32, copy=False)
