"""HSL recipes and the prototype's Oklab operation in D65 linear sRGB.

Selection is reusable by a future hue-mask leaf. No clipping or output
encoding belongs here; the owning render pipeline retains its ceiling.
"""
from __future__ import annotations

import math
from typing import Literal
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_RANGES = 32
MAX_CUSTOM_CHANNELS = 4
MAX_CHANNELS = 13


class HSLRange(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    center: float = Field(ge=0, le=360)
    width: float = Field(default=16, ge=1, le=180)
    feather: float = Field(default=12, ge=1, le=90)
    subtract: bool = False


class HSLRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    version: int = Field(default=1, ge=1, le=1)
    ranges: list[HSLRange] = Field(default_factory=list, max_length=MAX_RANGES)
    hue: float = Field(default=0, ge=-180, le=180)
    saturation: float = Field(default=0, ge=-100, le=100)
    luminance: float = Field(default=0, ge=-2, le=2)
    uniformity: float = Field(default=0, ge=0, le=100)
    opacity: float = Field(default=1, ge=0, le=1)


BANDS = (
    ("red", "#ff2a2a"), ("orange", "#ff8a1f"),
    ("yellow", "#f2e330"), ("green", "#2fbf4a"),
    ("aqua", "#22c6cf"), ("blue", "#2f6bff"),
    ("purple", "#8a4dff"), ("magenta", "#ff3dc4"),
)


def to_lab(rgb):
    rgb = np.asarray(rgb)
    lms = rgb @ np.array([
        [.4122214708, .5363325363, .0514459929],
        [.2119034982, .6806995451, .1073969566],
        [.0883024619, .2817188376, .6299787005],
    ]).T
    return np.cbrt(lms) @ np.array([
        [.2104542553, .793617785, -.0040720468],
        [1.9779984951, -2.428592205, .4505937099],
        [.0259040371, .7827717662, -.808675766],
    ]).T


def from_lab(lab):
    lms = np.asarray(lab) @ np.array([
        [1, .3963377774, .2158037573],
        [1, -.1055613458, -.0638541728],
        [1, -.0894841775, -1.291485548],
    ]).T
    return (lms ** 3) @ np.array([
        [4.0767416621, -3.3077115913, .2309699292],
        [-1.2684380046, 2.6097574011, -.3413193965],
        [-.0041960863, -.7034186147, 1.707614701],
    ]).T


def _smooth(lo, hi, value):
    t = np.clip((value - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def _delta(hue, center):
    return (hue - center + 180) % 360 - 180


def default_band_ranges():
    centers = []
    for _, hex_color in BANDS:
        encoded = np.array([int(hex_color[k:k + 2], 16) / 255 for k in (1, 3, 5)])
        linear = np.where(encoded <= .04045, encoded / 12.92, ((encoded + .055) / 1.055) ** 2.4)
        lab = to_lab(linear)
        centers.append(float(np.degrees(np.arctan2(lab[2], lab[1])) % 360))
    result = []
    for i, center in enumerate(centers):
        gap = min(abs(_delta(center, centers[(i - 1) % 8])), abs(_delta(centers[(i + 1) % 8], center)))
        # Match JavaScript Math.round, including a half-degree tie.
        result.append(HSLRange(center=center, width=max(1, math.floor(gap * .35 + .5)),
                               feather=max(1, math.floor(gap * .5 + .5))))
    return result


class HSLChannel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["all", "band", "custom"]
    recipe: HSLRecipe = Field(default_factory=HSLRecipe)


def default_channels():
    channels = [HSLChannel(id="all", name="All", kind="all", recipe=HSLRecipe(
        ranges=[HSLRange(center=0, width=180, feather=1)]))]
    channels.extend(HSLChannel(id=band[0], name=band[0].title(), kind="band",
                               recipe=HSLRecipe(ranges=[r]))
                    for band, r in zip(BANDS, default_band_ranges()))
    return channels


class HSLSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    channels: list[HSLChannel] = Field(default_factory=default_channels, min_length=9, max_length=MAX_CHANNELS)

    @model_validator(mode="after")
    def validate_channels(self):
        fixed = [("all", "all"), *((band[0], "band") for band in BANDS)]
        if [(c.id, c.kind) for c in self.channels[:9]] != fixed:
            raise ValueError("HSL requires All followed by the eight fixed bands")
        if any(c.kind != "custom" for c in self.channels[9:]):
            raise ValueError("Only Custom HSL channels may follow the fixed bands")
        if len({c.id for c in self.channels}) != len(self.channels):
            raise ValueError("HSL channel ids must be unique")
        if any(not any(not r.subtract for r in c.recipe.ranges) for c in self.channels[1:9]):
            raise ValueError("Each HSL band must retain an included range")
        all_ranges = self.channels[0].recipe.ranges
        if len(all_ranges) != 1 or all_ranges[0] != HSLRange(center=0, width=180, feather=1):
            raise ValueError("The All HSL channel must cover every hue")
        return self


def selection(rgb, ranges):
    """Return weight and circular target, measured only from stage input."""
    lab = to_lab(rgb)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    inc = np.zeros_like(hue)
    exc = np.zeros_like(hue)
    sx = np.zeros_like(hue)
    sy = np.zeros_like(hue)
    for r in ranges:
        w = 1 - _smooth(r.width, r.width + r.feather, np.abs(_delta(hue, r.center)))
        if r.subtract:
            exc = np.maximum(exc, w)
        else:
            inc = np.maximum(inc, w)
            sx += w * math.cos(math.radians(r.center))
            sy += w * math.sin(math.radians(r.center))
    target = np.where(np.hypot(sx, sy) > 1e-5, np.degrees(np.arctan2(sy, sx)), hue)
    weight = inc * (1 - exc) * _smooth(.02, .06, chroma / np.maximum(np.abs(lab[..., 0]), 1e-6))
    return weight, target, lab, hue, chroma


def recipe_active(recipe):
    return bool(recipe.opacity and recipe.ranges and (
        recipe.hue or recipe.saturation or recipe.luminance or recipe.uniformity))


def apply_recipes(image, recipes, mask=None):
    """Add channel deltas from one input; neutral returns the original array."""
    active = [r for r in recipes if recipe_active(r)]
    if not active:
        return image
    original = np.asarray(image)[..., :3].astype(np.float64)
    if mask is not None and np.shape(mask) != original.shape[:-1]:
        raise ValueError("HSL mask dimensions must match the image")
    result = original.copy()
    for r in active:
        weight, target, lab, hue, chroma = selection(original, r.ranges)
        weight *= r.opacity
        if mask is not None:
            weight *= np.clip(mask, 0, 1)
        angle = np.radians(hue + _delta(target, hue) * r.uniformity / 100 + r.hue)
        gain = 2 ** (r.luminance / 3)
        c = chroma * (1 + r.saturation / 100) * gain
        changed = from_lab(np.stack((lab[..., 0] * gain, c * np.cos(angle), c * np.sin(angle)), axis=-1))
        result += weight[..., None] * (changed - original)
    output = np.array(image, copy=True)
    output[..., :3] = result
    return output


def apply_stage(image, recipes, kind):
    """Apply in the engine's D65 space, retaining exact neutral passthrough."""
    if not any(recipe_active(r) for r in recipes):
        return image
    from .color import acescg_to_linear_srgb, linear_srgb_to_acescg
    if str(getattr(kind, "value", kind)) == "hdr":
        return linear_srgb_to_acescg(apply_recipes(acescg_to_linear_srgb(image), recipes))
    return apply_recipes(image, recipes)


def sample_neighborhood(image, x, y, radius=2):
    """Alpha-weighted linear-light average, clipped at the image boundary."""
    height, width = image.shape[:2]
    x, y = int(x), int(y)
    patch = image[max(0, y - radius):min(height, y + radius + 1),
                  max(0, x - radius):min(width, x + radius + 1)]
    if not patch.size:
        return np.zeros(3)
    alpha = np.maximum(patch[..., 3], 0) if patch.shape[-1] == 4 else np.ones(patch.shape[:2])
    count = np.sum(alpha)
    return np.sum(patch[..., :3] * alpha[..., None], axis=(0, 1)) / count if count else np.zeros(3)


def add_sample(recipe, rgb, mode="pick", width=16, feather=12):
    if mode not in ("pick", "add", "subtract"):
        raise ValueError("Unknown HSL picker mode")
    lab = to_lab(rgb)
    if abs(lab[0]) < 1e-5 or np.hypot(lab[1], lab[2]) / max(abs(lab[0]), 1e-6) < .02:
        return False
    center = float(np.degrees(np.arctan2(lab[2], lab[1])) % 360)
    r = HSLRange(center=center, width=width, feather=feather, subtract=mode == "subtract")
    if mode == "pick":
        recipe.ranges = [r]
    else:
        if any(old.subtract == r.subtract and abs(_delta(old.center, r.center)) < 3 for old in recipe.ranges):
            return False
        if len(recipe.ranges) >= MAX_RANGES:
            raise ValueError(f"Selection is limited to {MAX_RANGES} ranges; remove or widen a range")
        recipe.ranges.append(r)
    return True
