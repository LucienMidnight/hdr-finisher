"""Final-size text on authored delivery lanes; never modifies cached GPU pixels."""
from .config import FRONTEND_DIR

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .config import FRONTEND_DIR

FONT = FRONTEND_DIR / "assets/fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf"


def apply_watermark(image, settings, lane, reference_white_nits=203, ceiling_nits=None):
    if settings.mode == "off" or settings.opacity == 0:
        return image
    text = settings.text.strip()
    test = settings.mode == "rendition_test"
    if not text and not test:
        return image
    labels = [f"{text} {kind}".strip() for kind in ("HDR", "SDR")] if test else [text]
    h, w = image.shape[:2]
    size = max(1, round(min(h, w) * settings.size / 100))
    # Fit both labels identically, including on very small export/proof images.
    while True:
        font = ImageFont.truetype(str(FONT), size)
        boxes = [font.getbbox(label) for label in labels]
        pad = max(1, round(size * .4))
        bw = max(b[2] - b[0] for b in boxes) + 2 * pad
        bh = max(b[3] - b[1] for b in boxes) + 2 * pad
        if (bw <= w * .9 and bh <= h * .9) or size == 1:
            break
        size = max(1, min(size - 1, int(size * min(w * .9 / bw, h * .9 / bh))))
    bw, bh = min(w, bw), min(h, bh)
    margin = max(0, min(round(min(h, w) * .02), (w-bw)//2, (h-bh)//2))
    x = margin if settings.position.endswith("left") else w - bw - margin
    y = margin if settings.position.startswith("top") else h - bh - margin
    label_index = 0 if lane == "hdr" or not test else 1
    box = boxes[label_index]
    mask = Image.new("L", (bw, bh))
    draw = ImageDraw.Draw(mask)
    draw.text((pad-box[0], pad-box[1]), labels[label_index], font=font, fill=255)
    alpha = np.asarray(mask, dtype=np.float32)[..., None] / 255
    # HDR is scene-linear ACEScg (.18 = reference white), SDR is linear sRGB
    # (1 = SDR white). Neutral marks avoid gamut differences. The opaque panel
    # replaces SDR letters in HDR instead of leaving a ghost underneath them.
    white = .18 if lane == "hdr" else 1.
    ink = white * (.8 if lane != "hdr" or not test else 2.)
    if lane == "hdr" and ceiling_nits is not None:
        ink = min(ink, ceiling_nits / reference_white_nits * .18)
    backing = min(white * .2, ink)
    # A 10:1 maximum foreground/panel ratio fits Ultra HDR's chromatic latitude.
    mark = backing + alpha * (ink - backing)
    result = image.copy()
    region = result[y:y+bh, x:x+bw, :3]
    region[:] = region * (1-settings.opacity) + mark * settings.opacity
    return result
