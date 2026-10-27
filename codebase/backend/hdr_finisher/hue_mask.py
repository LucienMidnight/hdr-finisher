"""Native colour-confidence preparation, independent of hue-mask controls.

One immutable source may retain at most 192 MiB of packed fields. Source
replacement drops the weak identity; mutable and bounded-window callers never
reuse stale fields. This cache supplements the existing compiled-mask LRU.
"""
import weakref
from threading import RLock
import cv2
import numpy as np
from .mask_work import checkpoint

PREPARED_BUDGET = 192 * 1024 * 1024
_FIELDS = np.dtype([('hue', '<u2'), ('chroma', 'u1'), ('protection', 'u1')])
_lock = RLock()
_cached = None


def _prepare(image):
    from .color import acescg_to_linear_srgb
    from .hsl import to_lab, _smooth
    from .local_adjustments import ACESCG_LUMA
    h, w = image.shape[:2]
    fields = np.empty((h, w), dtype=_FIELDS)
    for top in range(0, h, 128):
        checkpoint()
        lo, hi = max(0, top - 3), min(h, top + 131)
        source = image[lo:hi, :, :3]
        lab = to_lab(acescg_to_linear_srgb(source)).astype(np.float32)
        light = np.maximum(np.abs(lab[..., 0]), 1e-6)
        ab = lab[..., 1:3] / light[..., None]
        ev = np.log2(np.maximum(np.einsum('...c,c->...', source, ACESCG_LUMA), 1e-8))
        guide = np.concatenate((ab, (ev * .10)[..., None]), axis=-1)
        guide = cv2.bilateralFilter(guide, 7, .10, 1.5, borderType=cv2.BORDER_REPLICATE)
        hue = np.degrees(np.arctan2(guide[..., 1], guide[..., 0])) % 360
        chroma = np.hypot(guide[..., 0], guide[..., 1])
        surround = cv2.boxFilter(ev, -1, (5, 5), borderType=cv2.BORDER_REPLICATE)
        bright = _smooth(.20, .90, ev - surround)
        mismatch = _smooth(.025, .10, np.linalg.norm(ab - guide[..., :2], axis=-1))
        protect = (1-bright)*(1-mismatch*_smooth(.08,.35,np.abs(ev-surround)))
        # Neutral pixels stay neutral even immediately beside a coloured edge.
        protect *= _smooth(.005, .02, np.hypot(ab[..., 0], ab[..., 1]))
        start, count = top-lo, min(128,h-top)
        block = fields[top:top+count]
        cut = slice(start,start+count)
        block['hue'] = np.rint(hue[cut] * (65535/360)).astype(np.uint16)
        block['chroma'] = np.rint(np.sqrt(np.clip(chroma[cut]/1.1,0,1))*255).astype(np.uint8)
        block['protection'] = np.rint(np.clip(protect[cut],0,1)*255).astype(np.uint8)
    fields.setflags(write=False)
    return fields


def _forget_source(reference):
    global _cached
    with _lock:
        if _cached is not None and _cached[0] is reference:
            _cached = None


def prepared_fields(image):
    global _cached
    cacheable = not image.flags.writeable and 4_000_000 <= image.shape[0]*image.shape[1] <= PREPARED_BUDGET//4
    if not cacheable:
        return _prepare(image)
    with _lock:
        if _cached is not None and _cached[0]() is image:
            return _cached[1]
        _cached = None
        fields = _prepare(image)
        _cached = (weakref.ref(image, _forget_source), fields)
        return fields


def select_hue(leaf, image):
    from .hsl import _smooth, _delta
    if leaf.hue_center is None:
        return np.zeros(image.shape[:2],np.float32)
    fields = prepared_fields(image)
    # Parameter drags evaluate small lookup tables, not colour conversions.
    angles = np.arange(65536,dtype=np.float32)*(360/65535)
    angular = (1-_smooth(leaf.hue_width,leaf.hue_width+leaf.hue_smoothness,
                        np.abs(_delta(angles,leaf.hue_center)))).astype(np.float32)
    confidence = _smooth(leaf.saturation_floor,leaf.saturation_floor+.04,
                         (np.arange(256,dtype=np.float32)/255)**2*1.1).astype(np.float32)
    result = np.empty(image.shape[:2],np.float32)
    for top in range(0,image.shape[0],256):
        checkpoint()
        lo,hi=max(0,top-2),min(image.shape[0],top+258)
        f=fields[lo:hi]
        coverage=angular[f['hue']]*confidence[f['chroma']]
        # A conservative coverage blur cannot add selection across a colour
        # boundary: the unblurred colour confidence caps its influence.
        smooth=cv2.GaussianBlur(coverage,(5,5),.85,borderType=cv2.BORDER_REPLICATE)
        coverage=np.minimum(coverage,smooth)
        coverage*=f['protection'].astype(np.float32)/255
        start,count=top-lo,min(256,image.shape[0]-top)
        result[top:top+count]=coverage[start:start+count]
    return result
