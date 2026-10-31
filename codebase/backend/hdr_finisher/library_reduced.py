"""Library sample reduction. Native decoders consume scanlines; no retained cache."""
from io import BytesIO
from pathlib import Path
import numpy as np

# Keep extra samples for nonlinear source colour and local finishing. The normal
# Library pipeline makes its unchanged 640/2560 products from this image.
SAMPLE_EDGE = 5120


def sample_size(width, height, edge=SAMPLE_EDGE):
    if max(width, height) <= edge:
        return width, height
    # Two samples per final Library pixel keep very wide pictures' rounded
    # output dimensions identical to the full-resolution route.
    unit = edge // 2560 if edge >= SAMPLE_EDGE else 1
    scale = (edge / unit) / max(width, height)
    return max(1, round(width*scale))*unit, max(1, round(height*scale))*unit


def read(path, *, page=0, crop=None, edge=SAMPLE_EDGE):
    direct = _uncompressed_tiff(path, page, edge) if crop is None else None
    if direct is not None:
        return direct
    import pyvips
    # Operation caching would retain decoder graphs and introduce another RAM
    # cache. All results here are request-owned, accounted by the scheduler.
    pyvips.cache_set_max(0)
    options = dict(access="sequential", fail_on="error")
    if Path(path).suffix.lower() in {".tif", ".tiff", ".dng"}:
        options["page"] = page
    source = pyvips.Image.new_from_file(str(path), **options)
    original = (source.width, source.height)
    if crop is not None:
        source = source.crop(*crop)
    width, height = sample_size(source.width, source.height, edge)
    reduced = source.resize(width/source.width, vscale=height/source.height, kernel="lanczos3") if (width, height) != (source.width, source.height) else source
    dtype = {"uchar":"u1", "char":"i1", "ushort":"u2", "short":"i2",
             "uint":"u4", "int":"i4", "float":"f4", "double":"f8"}[reduced.format]
    pixels = np.frombuffer(reduced.write_to_memory(), dtype=dtype).reshape(reduced.height, reduced.width, reduced.bands).copy()
    return pixels, original


def png(path):
    from PIL import Image
    from . import loader
    pixels, original = read(path)
    # Pillow's current PNG RGB boundary is 8-bit, including 16-bit RGB PNG.
    if pixels.dtype == np.uint16:
        pixels = (pixels >> 8).astype(np.uint8)
    if pixels.shape[2] == 1:
        pixels = pixels[..., 0]
    reduced = Image.fromarray(pixels)
    # Metadata is header-only; the original Pillow bomb guard is untouched.
    import pyvips
    header = pyvips.Image.new_from_file(str(path), access="sequential")
    info = {}
    if header.get_typeof("icc-profile-data"):
        info["icc_profile"] = header.get("icc-profile-data")
    if header.get_typeof("exif-data"):
        info["exif"] = header.get("exif-data")
    body = BytesIO()
    reduced.save(body, format="PNG", **info)
    body.seek(0)
    array, metadata = loader._load_with_pillow(body, encoded_samples=True)
    exif = Image.Exif()
    if info.get("exif"):
        exif.load(info["exif"])
    if exif.get(274) in {5, 6, 7, 8}:
        original = original[::-1]
    metadata.update(source_width=original[0], source_height=original[1], library_reduced=True)
    return array, metadata


def jpeg_open(path):
    """Opt in for this JPEG only, after both application/physical checks.

    Instantiate the JPEG plugin for this decode, never mutate Pillow globals.
    Header-only opens elsewhere still do not allocate any source pixels.
    """
    from PIL import Image, JpegImagePlugin
    from . import app_memory
    from .library_estimates import estimate_details
    from .resource_preflight import detect_memory_resources
    image = JpegImagePlugin.JpegImageFile(path)
    if image.width * image.height > Image.MAX_IMAGE_PIXELS:
        estimate, reason = estimate_details(path, ceiling=app_memory.CEILING)
        resources = detect_memory_resources()
        reserve = max(2_000_000_000, resources.total_ram_bytes // 10)
        if reason or estimate > app_memory.CEILING or estimate > resources.available_ram_bytes - reserve:
            image.close()
            raise ValueError(f"Needs about {estimate / 1e9:.1f} GB. Raise Memory the app may use in Settings.")
    return image


def _uncompressed_tiff(path, page_index, edge):
    """Read bounded row bands, even when a TIFF stores one enormous strip.

    A mapped single strip charges every touched source page until it closes.
    Explicit reads avoid retaining the entire original in resident memory.
    """
    if Path(path).suffix.lower() not in {".tif", ".tiff", ".dng"}:
        return None
    import math
    import tifffile
    from PIL import Image
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[page_index]
        if not (page.is_memmappable and page.is_contiguous and int(page.planarconfig) == 1 and len(page.shape) == 3):
            return None
        ih, iw, bands = page.shape
        if max(iw, ih) <= edge:
            return None
        tw, th = sample_size(iw, ih, edge)
        dtype = np.dtype(tif.byteorder + page.dtype.str[1:])
        offset = page.dataoffsets[0]
    result = np.empty((th, tw, bands), dtype=dtype)
    ratio = ih / th
    radius = 3 * max(1., ratio)
    # Bound each source band to about 32 MB, plus the Lanczos overlap.
    block = max(1, min(32, int(32_000_000 / (iw * bands * dtype.itemsize * ratio))))
    with open(path, "rb") as source:
        for row in range(0, th, block):
            count = min(block, th-row)
            top, bottom = row*ratio, (row+count)*ratio
            y0, y1 = max(0, math.floor(top-radius)), min(ih, math.ceil(bottom+radius))
            source.seek(offset + y0*iw*bands*dtype.itemsize)
            body = source.read((y1-y0)*iw*bands*dtype.itemsize)
            samples = np.frombuffer(body, dtype=dtype).reshape(y1-y0, iw, bands)
            for band in range(bands):
                resized = np.asarray(Image.fromarray(samples[...,band].astype(np.float32)).resize(
                    (tw, count), Image.Resampling.LANCZOS, box=(0, top-y0, iw, bottom-y0)))
                if dtype.kind in {"u", "i"}:
                    resized = np.clip(np.rint(resized), np.iinfo(dtype).min, np.iinfo(dtype).max)
                result[row:row+count,:,band] = resized
    return result, (iw, ih)


def jpeg_draft(image, edge):
    # Pillow's square draft request can leave a square 100 MP file untouched.
    # Retain the qualified ordinary-photo sampling; large files get at least
    # a half-size DCT decode, with their aspect ratio in the request.
    if max(image.size) >= 10000:
        import math
        factor = max(2, 2**math.floor(math.log2(max(image.size)/edge)))
        image.draft("RGB", (image.width//factor, image.height//factor))
    else:
        image.draft("RGB", (edge, edge))
