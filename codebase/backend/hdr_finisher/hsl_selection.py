"""CPU reference for the experimental native pre-HSL GPU colour selection.

Not called by shipping preview or export. RGB is never modified here.
"""
from dataclasses import dataclass
import cv2
import numpy as np
from .hsl import to_lab, _smooth, _delta

@dataclass(frozen=True)
class PreparedSelection:
    chroma: np.ndarray
    guide: np.ndarray
    original_ab: np.ndarray

def prepare(rgb):
    lab = to_lab(np.asarray(rgb)[..., :3]).astype(np.float32)
    light = np.maximum(np.abs(lab[..., 0]), 1e-6)
    ab = lab[..., 1:3] / light[..., None]
    height, width = light.shape
    coarse = cv2.resize(ab, (max(1, width//4), max(1, height//4)),
                        interpolation=cv2.INTER_AREA)
    coarse = cv2.GaussianBlur(coarse, (9, 9), 1, borderType=cv2.BORDER_REFLECT)
    return PreparedSelection(coarse, np.log2(np.maximum(light, 1e-4)), ab)

def select(prepared, ranges, floor=.02):
    coarse, guide, ab = prepared.chroma, prepared.guide, prepared.original_ab
    height, width = guide.shape
    hue = np.degrees(np.arctan2(coarse[..., 1], coarse[..., 0]))
    inc = np.zeros_like(hue)
    exc = np.zeros_like(hue)
    sx = np.zeros_like(hue)
    sy = np.zeros_like(hue)
    for r in ranges:
        w = 1-_smooth(r.width, r.width+r.feather, np.abs(_delta(hue,r.center)))
        if r.subtract:
            exc = np.maximum(exc,w)
        else:
            inc = np.maximum(inc,w)
            sx += w*np.cos(np.radians(r.center))
            sy += w*np.sin(np.radians(r.center))
    low = inc*(1-exc)*_smooth(floor,floor+.04,np.linalg.norm(coarse,axis=-1))
    resize = lambda v: cv2.resize(v,(width,height),interpolation=cv2.INTER_LINEAR)
    p = resize(low)
    box = lambda v: cv2.boxFilter(v,-1,(9,9),borderType=cv2.BORDER_REFLECT)
    mi,mp=box(guide),box(p)
    a=(box(guide*p)-mi*mp)/np.maximum(box(guide*guide)-mi*mi+.03,.03)
    p=box(a)*guide+box(mp-a*mi)
    surround=cv2.boxFilter(guide,-1,(5,5),borderType=cv2.BORDER_REFLECT)
    avg=resize(coarse)
    bright=_smooth(.07,.30,guide-surround)
    mismatch=_smooth(.04,.16,np.linalg.norm(ab-avg,axis=-1))
    protection=(1-bright)*(1-mismatch*_smooth(.025,.12,np.abs(guide-surround)))
    # Circular interpolation keeps targets continuous across the red wrap.
    tx,ty=resize(sx),resize(sy)
    target=np.where(np.hypot(tx,ty)>1e-5,np.degrees(np.arctan2(ty,tx)),
                    np.degrees(np.arctan2(avg[...,1],avg[...,0])))
    return np.clip(p*protection,0,1).astype(np.float32),target.astype(np.float32)

def select_hue(prepared, leaf):
    """Adapt Local hue controls; combine/invert/opacity belongs to the owner."""
    from .hsl import HSLRange
    if leaf.hue_center is None:
        return np.zeros(prepared.guide.shape, np.float32)
    return select(prepared, [HSLRange(center=leaf.hue_center,
                  width=leaf.hue_width, feather=leaf.hue_smoothness)],
                  leaf.saturation_floor)[0]
