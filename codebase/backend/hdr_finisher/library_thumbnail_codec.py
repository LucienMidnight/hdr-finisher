"""Library-only Ultra HDR JPEG writer. Export and Proof use their own encoders."""
from io import BytesIO
import struct
import numpy as np
from PIL import Image
from .color import acescg_to_linear_srgb

VERSION = "thumbnail-jpeg-v1"
XMP = b"http://ns.adobe.com/xap/1.0/\0"


def _segment(marker, payload):
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload


def _jpeg(pixels):
    out = BytesIO()
    Image.fromarray(pixels).save(out, format="JPEG", quality=100, subsampling=0)
    return out.getvalue()


def _xmp(attributes):
    return _segment(0xe1, XMP + ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description '
        'xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" ' + attributes +
        '/></rdf:RDF></x:xmpmeta>').encode())


def _mpf(primary_size, gain_size, gain_offset):
    # TIFF offsets start at the endian marker, four bytes after MPF\0.
    tags = struct.pack(">H", 3)
    tags += struct.pack(">HHI4s", 0xb000, 7, 4, b"0100")
    tags += struct.pack(">HHII", 0xb001, 4, 1, 2)
    tags += struct.pack(">HHII", 0xb002, 7, 32, 50)
    tags += struct.pack(">I", 0)
    entries = struct.pack(">IIIHH", 0x20030000, primary_size, 0, 0, 0)
    entries += struct.pack(">IIIHH", 0, gain_size, gain_offset, 0, 0)
    return _segment(0xe2, b"MPF\0MM\0*\0\0\0\x08" + tags + entries)


def encode(hdr, sdr, reference_white=203):
    """Return one SDR-base JPEG with a full-size RGB gain map, in process.

    HDR input is ACEScg scene-linear (.18 = project white); SDR is linear sRGB.
    Ratios are measured against the *decoded* base to account for JPEG error.
    """
    hdr = np.maximum(acescg_to_linear_srgb(hdr[..., :3]), 0) * (reference_white / (203 * .18))
    sdr = np.clip(sdr[..., :3], 0, 1)
    encoded = np.where(sdr <= .0031308, sdr * 12.92, 1.055 * np.power(sdr, 1 / 2.4) - .055)
    primary = _jpeg(np.round(np.clip(encoded, 0, 1) * 255).astype(np.uint8))
    with Image.open(BytesIO(primary)) as im:
        base = np.asarray(im.convert("RGB"), dtype=np.float32) / 255
    base = np.where(base <= .04045, base / 12.92, ((base + .055) / 1.055) ** 2.4)
    offset = 1 / 64
    log_gain = np.log2((hdr + offset) / (base + offset))
    low, high = float(np.min(log_gain)), float(np.max(log_gain))
    high = max(low + .001, high)
    values = np.round(np.clip((log_gain - low) / (high - low), 0, 1) * 255).astype(np.uint8)
    capacity = max(.001, float(np.log2(max(1, float(hdr.max())))))
    # DCT ringing in the gain JPEG can otherwise invent brighter highlights.
    # Compensate only overshoot, against the actual decoded base and gain map.
    peak = float(hdr.max())
    for attempt in range(8):
        gain = _jpeg(values)
        with Image.open(BytesIO(gain)) as im:
            actual = np.asarray(im.convert('RGB'), dtype=np.float32) / 255
        reconstructed = (base + offset) * np.exp2(low + actual * (high-low)) - offset
        overshoot = reconstructed > peak * 1.008
        if not np.any(overshoot):
            break
        correction = np.ceil(np.maximum(0, np.log2((reconstructed+offset)/(peak*.999+offset))) / (high-low) * 255)
        correction = np.where(overshoot, correction+1, 0)
        height, width = correction.shape[:2]
        padded = np.pad(correction, ((0,(-height)%8),(0,(-width)%8),(0,0)))
        blocks = padded.reshape(padded.shape[0]//8,8,padded.shape[1]//8,8,3).max(axis=(1,3,4))
        correction = np.repeat(np.repeat(blocks,8,axis=0),8,axis=1)[:height,:width,None]
        values = np.clip(values.astype(np.float32) - correction, 0, 255).astype(np.uint8)
    gain = _jpeg(values)
    gain_xmp = _xmp(f'hdrgm:Version="1.0" hdrgm:BaseRenditionIsHDR="False" '
        f'hdrgm:GainMapMin="{low:.9g}" hdrgm:GainMapMax="{high:.9g}" hdrgm:Gamma="1" '
        f'hdrgm:OffsetSDR="{offset}" hdrgm:OffsetHDR="{offset}" '
        f'hdrgm:HDRCapacityMin="0" hdrgm:HDRCapacityMax="{capacity:.9g}"')
    gain = gain[:2] + gain_xmp + gain[2:]
    main_xmp = _xmp('hdrgm:Version="1.0"')
    mpf = _mpf(0, len(gain), 0)
    primary_size = len(primary) + len(main_xmp) + len(mpf)
    # SOI + XMP + APP2 marker and size + MPF signature.
    tiff_start = 2 + len(main_xmp) + 8
    mpf = _mpf(primary_size, len(gain), primary_size - tiff_start)
    return primary[:2] + main_xmp + mpf + primary[2:] + gain
