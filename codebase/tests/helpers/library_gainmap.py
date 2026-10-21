"""Test decoder for the visible CPU fallback JPEG gain map."""
from pathlib import Path
import numpy as np
from PIL import Image

def jpeg_renditions(path, hdr=False):
    """Reconstruct our writer's SDR-first scalar gain map without a CLI.

    File reconstruction only; source, export and Proof decoders are unchanged.
    """
    from io import BytesIO
    import re
    from xml.etree import ElementTree
    from hdr_finisher.exporters import _split_ultrahdr_jpegs
    from hdr_finisher.gainmap_decoders import _srgb_eotf
    from hdr_finisher.color import linear_srgb_to_acescg
    primary, gain = _split_ultrahdr_jpegs(Path(path).read_bytes())
    with Image.open(BytesIO(primary)) as im:
        base = _srgb_eotf(np.asarray(im.convert("RGB"), dtype=np.float32) / 255)
    if not hdr: return base
    xmp = re.findall(rb'<x:xmpmeta.*?</x:xmpmeta>', gain, re.S)
    namespace = "{http://ns.adobe.com/hdr-gain-map/1.0/}"
    fields = next((element.attrib for packet in xmp for element in ElementTree.fromstring(packet).iter()
                   if namespace + "GainMapMax" in element.attrib), None)
    if fields is None: raise ValueError("The kept picture's gain map could not be read.")
    def scalar(name, default): return float(fields.get(namespace + name, default))
    with Image.open(BytesIO(gain)) as im:
        values = np.asarray(im.convert("RGB").resize((base.shape[1], base.shape[0]), Image.Resampling.BILINEAR), dtype=np.float32) / 255
    boost = scalar("GainMapMin", 0) + values ** (1 / scalar("Gamma", 1)) * (scalar("GainMapMax", 0) - scalar("GainMapMin", 0))
    reconstructed = (base + scalar("OffsetSDR", 1 / 64)) * np.exp2(boost) - scalar("OffsetHDR", 1 / 64)
    return linear_srgb_to_acescg(np.maximum(reconstructed, 0) * .18)
