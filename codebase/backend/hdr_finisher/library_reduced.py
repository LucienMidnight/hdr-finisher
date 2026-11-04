"""Library sample reduction. Native decoders consume scanlines; no retained cache."""
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


class Cancelled(RuntimeError):
    """The photo is no longer wanted; reading stopped early."""


def _stop_if(cancelled):
    if cancelled():
        raise Cancelled("Library preparation cancelled")


def read(path, *, page=0, crop=None, edge=SAMPLE_EDGE, cancelled=None):
    """Reduce a source while reading it.

    ``cancelled`` is checked between row bands, so a photo the user has moved
    past stops within a fraction of a second instead of holding CPU and memory.
    """
    cancelled = cancelled or (lambda: False)
    _stop_if(cancelled)
    direct = None
    if crop is None:
        direct = _uncompressed_tiff(path, page, edge, cancelled)
        if direct is None:
            direct = _compressed_strip_tiff(path, page, edge, cancelled)
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
    # libvips reports progress while it evaluates; stop it there when asked.
    reduced.set_progress(True)
    reduced.signal_connect("eval", lambda image, progress: image.set_kill(True) if cancelled() else None)
    try:
        body = reduced.write_to_memory()
    except pyvips.Error:
        _stop_if(cancelled)
        raise
    _stop_if(cancelled)
    pixels = np.frombuffer(body, dtype=dtype).reshape(reduced.height, reduced.width, reduced.bands).copy()
    return pixels, original


def _compressed_strip_tiff(path, page_index, edge, cancelled):
    """Decode a compressed strip TIFF band by band on all cores.

    Each band decodes only the strips it covers (plus the Lanczos overlap) and
    is reduced straight away, so the full-size picture is never held. Bands use
    the same Pillow Lanczos reduction as uncompressed TIFFs. Returns None for
    layouts this route does not handle; libvips reads those.
    """
    if Path(path).suffix.lower() not in {".tif", ".tiff"}:
        return None
    import math
    import tifffile
    from PIL import Image
    from concurrent.futures import ThreadPoolExecutor
    from collections import deque
    from .cpu_budget import logical_cpus
    from time import perf_counter
    from .library_diagnostics import log
    tif = tifffile.TiffFile(path)
    try:
        page = tif.pages[page_index]
        if (int(page.compression) == 1 or page.is_tiled or int(page.planarconfig) != 1
                or len(page.shape) != 3 or not page.rowsperstrip or page.shape[0] != page.imagelength):
            return None
        ih, iw, bands = page.shape
        if max(iw, ih) <= edge:
            return None
        rows_per_strip = min(int(page.rowsperstrip), ih)
        offsets, counts = page.dataoffsets, page.databytecounts
        if len(offsets) != math.ceil(ih / rows_per_strip):
            return None

        def strips(handle, first, last):
            pieces = []
            for index in range(first, last + 1):
                handle.seek(offsets[index])
                segment, _, _ = page.decode(handle.read(counts[index]), index)
                pieces.append(np.asarray(segment).reshape(-1, iw, bands))
            return pieces[0] if len(pieces) == 1 else np.concatenate(pieces)

        # Probe one strip: unsupported codecs or predictors use libvips instead.
        try:
            with open(path, "rb") as handle:
                probe = strips(handle, 0, 0)
        except Exception:
            return None
        if probe.shape[0] < min(rows_per_strip, ih) or probe.dtype.kind not in {"u", "i", "f"}:
            return None
        dtype = probe.dtype
        del probe
        tw, th = sample_size(iw, ih, edge)
        result = np.empty((th, tw, bands), dtype=dtype)
        ratio = ih / th
        radius = 3 * max(1., ratio)
        row_bytes = iw * bands * max(4, dtype.itemsize)
        # About 16 MB of decoded input per band, plus the Lanczos overlap.
        block = max(1, min(64, int(16_000_000 / (row_bytes * ratio))))
        band_bytes = (math.ceil(block * ratio + 2 * radius) + 2 * rows_per_strip) * row_bytes
        # Bound decoded input in flight to about 128 MB; a memory bound, not a CPU cap.
        in_flight = max(2, min(logical_cpus(), 128_000_000 // max(1, band_bytes)))
        started = perf_counter()

        def reduce_band(row):
            if cancelled():
                return
            count = min(block, th - row)
            top, bottom = row * ratio, (row + count) * ratio
            y0, y1 = max(0, math.floor(top - radius)), min(ih, math.ceil(bottom + radius))
            first, last = y0 // rows_per_strip, (y1 - 1) // rows_per_strip
            with open(path, "rb") as handle:
                samples = strips(handle, first, last)[y0 - first * rows_per_strip:y1 - first * rows_per_strip]
            for band in range(bands):
                resized = np.asarray(Image.fromarray(np.ascontiguousarray(samples[..., band], dtype=np.float32)).resize(
                    (tw, count), Image.Resampling.LANCZOS, box=(0, top - y0, iw, bottom - y0)))
                if dtype.kind in {"u", "i"}:
                    resized = np.clip(np.rint(resized), np.iinfo(dtype).min, np.iinfo(dtype).max)
                result[row:row + count, :, band] = resized

        pending = deque()
        with ThreadPoolExecutor(max_workers=logical_cpus()) as pool:
            try:
                for row in range(0, th, block):
                    _stop_if(cancelled)
                    if len(pending) >= in_flight:
                        pending.popleft().result()
                    pending.append(pool.submit(reduce_band, row))
                while pending:
                    pending.popleft().result()
            finally:
                for task in pending:
                    task.cancel()
        _stop_if(cancelled)
        log('picture_tiff_reduction', path=str(path), route="compressed-strips",
            duration_ms=round((perf_counter() - started) * 1000, 2), workers=logical_cpus(),
            in_flight=in_flight, width=tw, height=th)
        return result, (iw, ih)
    finally:
        tif.close()


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
    # Match the EXIF envelope Pillow adds when opening a PNG.
    if info.get("exif") and not info["exif"].startswith(b"Exif\x00\x00"):
        info["exif"] = b"Exif\x00\x00" + info["exif"]
    reduced.info.update(info)
    array, metadata = loader._load_with_pillow(
        path, encoded_samples=True, image_factory=lambda _: reduced)
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


def _uncompressed_tiff(path, page_index, edge, cancelled=lambda: False):
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
    from concurrent.futures import ThreadPoolExecutor
    from collections import deque
    from .cpu_budget import logical_cpus
    from time import perf_counter
    from .library_diagnostics import log
    started = perf_counter()
    read_ms = 0.0
    def resize_band(row, count, y0, body):
        samples = np.frombuffer(body, dtype=dtype).reshape(-1, iw, bands)
        top, bottom = row*ratio, (row+count)*ratio
        for band in range(bands):
            resized = np.asarray(Image.fromarray(samples[...,band].astype(np.float32)).resize(
                (tw, count), Image.Resampling.LANCZOS, box=(0, top-y0, iw, bottom-y0)))
            if dtype.kind in {"u", "i"}:
                resized = np.clip(np.rint(resized), np.iinfo(dtype).min, np.iinfo(dtype).max)
            result[row:row+count,:,band] = resized
    # One sequential reader (including overlapping Lanczos support), while
    # independent Pillow bands release the GIL. Bound queued input AND float
    # scratch to the previous 32 MB band allowance; this is a memory bound,
    # not a CPU cap. Submitted tasks never keep a second full source.
    band_bytes = (math.ceil(block*ratio+2*radius)+2)*iw*bands*dtype.itemsize
    pending_limit = max(1, min(logical_cpus(), 32_000_000 // max(1, band_bytes*4)))
    pending = deque()
    with ThreadPoolExecutor(max_workers=logical_cpus()) as pool, open(path, "rb") as source:
        for row in range(0, th, block):
            _stop_if(cancelled)
            if len(pending) >= pending_limit:
                pending.popleft().result()
            count = min(block, th-row)
            top, bottom = row*ratio, (row+count)*ratio
            y0, y1 = max(0, math.floor(top-radius)), min(ih, math.ceil(bottom+radius))
            reading = perf_counter()
            source.seek(offset + y0*iw*bands*dtype.itemsize)
            body = source.read((y1-y0)*iw*bands*dtype.itemsize)
            read_ms += (perf_counter()-reading)*1000
            pending.append(pool.submit(resize_band, row, count, y0, body))
        for task in pending:
            task.result()
    log('picture_tiff_reduction', path=str(path), read_ms=round(read_ms, 2),
        duration_ms=round((perf_counter()-started)*1000, 2), workers=logical_cpus(),
        in_flight=pending_limit, width=tw, height=th)
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
