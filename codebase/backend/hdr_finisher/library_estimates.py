"""Header-only pixel counts and Steve's approved per-format estimates."""
from pathlib import Path
from .library_scheduler import MINIMUM
from . import app_memory

RATES = {".jpg":23, ".jpeg":23, ".hdr":23, ".png":28, ".tif":28,
         ".tiff":28, ".dng":28, ".exr":38, ".pfm":38, ".avif":56,
         ".heic":52, ".heif":52, ".jxl":52}


def _jpegxl_size(header):
    """Read only SizeHeader; colour/precision still use structured libjxl.

    Admission and the deadline watchdog call this repeatedly. Launching the
    metadata process here stalls those control paths and can time out a
    healthy Library decoder.
    """
    if not header.startswith(b"\xff\x0a"):
        raise ValueError("Invalid JPEG XL codestream")
    offset = 16

    def read(count):
        nonlocal offset
        if offset + count > len(header) * 8:
            raise ValueError("Truncated JPEG XL size header")
        value = (int.from_bytes(header, "little") >> offset) & ((1 << count) - 1)
        offset += count
        return value

    small = read(1)

    def dimension():
        return (read(5) + 1) * 8 if small else 1 + read((9, 13, 18, 30)[read(2)])

    height = dimension()
    ratio = read(3)
    ratios = ((0, 1), (1, 1), (12, 10), (4, 3), (3, 2), (16, 9), (5, 4), (2, 1))
    numerator, denominator = ratios[ratio]
    width = height * numerator // denominator if ratio else dimension()
    return width, height


def dimensions(path):
    """Never unpack a RAW or load pixels to decide whether decoding can start."""
    path = Path(path)
    if path.suffix.lower() == ".jxl":
        import struct
        with path.open("rb") as handle:
            prefix = handle.read(12)
            if prefix.startswith(b"\xff\x0a"):
                handle.seek(0)
            else:
                # Large container boxes exceed the bounded prefix read. Seek
                # past metadata, then probe only the codestream's small header.
                while True:
                    header = handle.read(8)
                    if len(header) != 8:
                        raise ValueError("Missing JPEG XL codestream")
                    size, kind = struct.unpack(">I4s", header)
                    count = 8
                    if size == 1:
                        size = struct.unpack(">Q", handle.read(8))[0]
                        count = 16
                    if kind in {b"jxlc", b"jxlp"}:
                        if kind == b"jxlp":
                            handle.read(4)
                        break
                    if size < count:
                        raise ValueError("Invalid JPEG XL box")
                    handle.seek(size-count, 1)
            return _jpegxl_size(handle.read(16))
    if path.suffix.lower() in {".hdr", ".pfm"}:
        import re
        with path.open("rb") as handle:
            header = handle.read(65536)
        if path.suffix.lower() == ".hdr":
            match = re.search(rb"[+-]Y\s+(\d+)\s+[+-]X\s+(\d+)",header)
            if match: return int(match[2]),int(match[1])
        else:
            lines=[line for line in header.splitlines()[:20] if line and not line.startswith(b"#")]
            if lines[0] in {b"PF",b"Pf"}:
                width,height=map(int,lines[1].split());return width,height
        raise ValueError("Missing HDR/PFM dimensions")
    if path.suffix.lower() in {".tif", ".tiff", ".dng"}:
        import tifffile
        with tifffile.TiffFile(path) as tif:
            pages = list(tif.pages)
            # DNG's first page may be a tiny camera preview. SubIFDs carry
            # the full source; choose the largest header without decoding it.
            for page in list(pages):
                if page.pages is not None:
                    pages.extend(page.pages)
            return max(((p.imagewidth, p.imagelength) for p in pages), key=lambda wh:wh[0]*wh[1])
    if path.suffix.lower() == ".exr":
        import OpenEXR
        source = OpenEXR.InputFile(str(path))
        try:
            box = source.header()["dataWindow"]
            return box.max.x-box.min.x+1, box.max.y-box.min.y+1
        finally:
            source.close()
    if path.suffix.lower() in {".heic", ".heif"}:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    try:
        from PIL import Image
        from PIL import JpegImagePlugin, PngImagePlugin
        opener = JpegImagePlugin.JpegImageFile if path.suffix.lower() in {".jpg", ".jpeg"} else PngImagePlugin.PngImageFile if path.suffix.lower() == ".png" else Image.open
        with opener(path) as source:
            return source.size
    except (OSError, ValueError):
        import exifread
        from .library_metadata import _number
        with path.open("rb") as handle:
            tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
        width = _number(tags, "EXIF ExifImageWidth", "Image ImageWidth")
        height = _number(tags, "EXIF ExifImageLength", "Image ImageLength")
        if width and height:
            return int(width), int(height)
        import rawpy
        with rawpy.RawPy() as raw:
            raw.open_file(str(path))
            return raw.sizes.raw_width, raw.sizes.raw_height


# Steve, November 2: complete decode peaks plus 25%, rounded up. Confirmed
# gain-map AVIF only; plain AVIF and primary-only quick previews stay unchanged.
AVIF_GAIN_MAP_RATE = 50


def estimate_pixels(suffix, width, height, kind="source", *, gain_map=False):
    suffix = suffix.lower()
    if kind == "edge-cpu": kind = "cpu"
    if kind == "quick" and suffix in {".jpg", ".jpeg"}:
        return MINIMUM
    if suffix == ".avif" and gain_map and kind != "quick":
        return max(MINIMUM, AVIF_GAIN_MAP_RATE*int(width)*int(height))
    rate = 25 if kind == "cpu" else 23 if kind == "quick" else RATES.get(suffix, 7)
    return max(MINIMUM, rate*int(width)*int(height))


def embedded_jpeg_header(path):
    """Find a rendered JPEG in TIFF RAW headers, including DNG SubIFDs.

    LinearRaw and CFA source pages may themselves be JPEG-compressed; they
    are not camera pictures. A larger bitmap preview keeps the old estimate.
    No strip, JPEG body or source pixels are read here.
    """
    import tifffile
    try:
        with tifffile.TiffFile(path) as source:
            rendered = []
            jpeg_pages = []
            def visit(pages):
                for page in pages:
                    if int(page.photometric) in {1, 2, 6}:
                        jpeg = int(page.compression) in {6, 7}
                        rendered.append((page.imagewidth * page.imagelength, jpeg))
                        if jpeg:
                            jpeg_pages.append(page)
                    if page.pages is not None:
                        visit(page.pages)
            visit(source.pages)
            if rendered:
                largest = max(area for area, _ in rendered)
                if all(jpeg for area, jpeg in rendered if area == largest):
                    # Match Pillow JPEG draft's power-of-two reduction before
                    # transpose/convert, using the existing quick pixel rate.
                    page = max(jpeg_pages, key=lambda page: page.imagewidth * page.imagelength)
                    return page.imagewidth, page.imagelength
            return None
    except (OSError, ValueError, TypeError):
        return None


def exposure_reservation(path, ceiling=None):
    from .library_exposure_admission import sensor_size, RATE
    size = sensor_size(path)
    if size is not None:
        return "exposure", max(MINIMUM, RATE*size[0]*size[1]), ""
    amount, reason = estimate_details(path,"cpu",ceiling)
    return "cpu", amount, reason


def estimate_details(path, kind="source", ceiling=None, edge=2560):
    if kind == "exposure":
        return exposure_reservation(path,ceiling)[1:]
    if kind == "camera":
        # Existing quick working rate on the bounded camera analysis surface.
        return max(MINIMUM, 23*min(int(edge),2560)**2), ""
    if kind == "edge-cpu": kind = "cpu"
    ceiling = app_memory.CEILING if ceiling is None else ceiling
    try:
        if Path(path).suffix.lower() == ".avif" and kind != "quick":
            from .avif_info import inspect_avif
            # Header inspection only; malformed/unknown files retain the gate.
            info = inspect_avif(Path(path))
            width, height = map(int, info["resolution"].split("x"))
            if width <= 0 or height <= 0:
                raise ValueError("Missing AVIF source dimensions")
            return estimate_pixels(".avif", width, height, kind,
                gain_map=info["gain_map_present"]), ""
        width, height = dimensions(path)
        if width <= 0 or height <= 0:
            raise ValueError("Missing source dimensions")
        if kind == "cpu":
            from .library_gpu_raw import xtrans_cpu
            if xtrans_cpu(path):
                # Steve, November 1: measured Grade route peak plus 25%.
                return max(MINIMUM, 45*width*height), ""
        # Embedded JPEGs use the approved DCT-scaled quick route. Other
        # embedded formats keep a conservative full-source preview estimate.
        if kind == "quick" and (Path(path).suffix.lower() not in RATES or Path(path).suffix.lower()==".dng"):
            preview = embedded_jpeg_header(path)
            if preview:
                factor = 1
                while factor < 8 and min(preview) // (factor * 2) >= edge:
                    factor *= 2
                samples = tuple((size + factor - 1) // factor for size in preview)
                return max(MINIMUM, 23 * samples[0] * samples[1]), ""
            import exifread
            with Path(path).open("rb") as handle:
                tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
            # IFD1 JPEG location/length are sufficient; do not read its body
            # merely to decide whether the decoder may run.
            if tags.get("Thumbnail JPEGInterchangeFormat") and tags.get("Thumbnail JPEGInterchangeFormatLength"):
                return MINIMUM, ""
        if kind != "cpu" and kind != "quick" and Path(path).suffix.lower()==".dng":
            import tifffile
            with tifffile.TiffFile(path) as source:
                pages=list(source.pages)
                for page in list(pages):
                    if page.pages is not None:pages.extend(page.pages)
                main=max(pages,key=lambda p:p.imagewidth*p.imagelength)
                if int(main.photometric)==32803: # CFA camera DNG, not LinearRaw.
                    from .linear_dng import inspect_dng
                    from .library_dng import plan
                    from .library_gpu_raw import NotEligible
                    try:
                        plan(inspect_dng(Path(path)))
                    except NotEligible:
                        return max(MINIMUM,7*width*height), ""
                    # Steve, November 1: mandatory RGB corrections retain full
                    # RGB samples, so use the existing DNG rate, not sensor RAW.
                    return estimate_pixels(".dng",width,height,kind), ""
        if kind == "source" and edge <= 2560 and width*height >= 100_000_000:
            rate = reduced_rate(path)
            if rate is not None:
                return max(MINIMUM, rate*width*height), ""
        return estimate_pixels(Path(path).suffix, width, height, kind), ""
    except Exception:
        # Steve, October 31: no invented per-type maximum. Decode errors are
        # reported only if decoding subsequently fails, never by admission.
        return ceiling, "unknown size"


def reduced_rate(path):
    """Header-only qualification; native, CPU and unsupported routes keep their rates."""
    from .file_gate import decode_suffix
    path = Path(path)
    suffix = decode_suffix(path)
    if suffix in {".jpg", ".jpeg"}:
        from .loader import is_ultrahdr_jpeg
        return None if is_ultrahdr_jpeg(path) else 6
    if suffix == ".png":
        return 8
    if suffix in {".tif", ".tiff"}:
        return 6
    if suffix == ".dng":
        from .linear_dng import inspect_dng, DngRoute
        inspection = inspect_dng(Path(path))
        if (inspection.route == DngRoute.LINEAR_DNG and inspection.primary_page_index is not None
                and not (inspection.required_opcodes or inspection.optional_opcodes)
                and inspection.metadata.get("sdr_preview_series_index") is None):
            return 6
    return None


def estimate(path, kind="source", ceiling=None):
    return estimate_details(path, kind, ceiling)[0]


def gpu_metadata(path, document=None, edge=2560):
    """Conservative header descriptor for the existing frontend rawBudget formula.

    No decode or replacement GPU rate. Known unsupported DNG adapters select
    CPU before GPU admission. The decoded descriptor can only shrink this
    reservation. Unknown headers request the whole available GPU budget.
    """
    try:
        from .file_gate import decode_suffix
        from .library_live import recipe
        suffix = decode_suffix(Path(path))
        width, height = dimensions(path)
        flip = 0
        if suffix not in RATES:
            import rawpy
            with rawpy.RawPy() as raw:
                raw.open_file(str(path))
                width, height = raw.sizes.raw_width, raw.sizes.raw_height
                flip = int(raw.sizes.flip)
        inputs = recipe(document)
        meta = dict(width=width, height=height, flip=flip,
                    raw_import_settings=inputs['raw_import_settings'], repairs=inputs.get('repairs'))
        if suffix == '.dng':
            from .linear_dng import inspect_dng, DngRoute
            from .library_dng import geometry, plan
            from .library_gpu_raw import NotEligible
            inspection = inspect_dng(Path(path))
            if inspection.route is DngRoute.UNSUPPORTED_DNG:
                return {'cpu_route':'unsupported-gpu'}
            if inspection.route is DngRoute.LINEAR_DNG and (inspection.required_opcodes or inspection.optional_opcodes
                    or inspection.metadata.get("linearization_table") is not None
                    or (edge == 100000 and inspection.metadata.get('sdr_preview_series_index') is not None)):
                return {'cpu_route':'unsupported-gpu'}
            width, height, *_ = geometry(inspection.metadata, inspection.width, inspection.height)
            if inspection.route is DngRoute.LINEAR_DNG:
                meta['dng_linear'] = True
                if (edge <= 2560 and inspection.primary_page_index is not None
                        and not (inspection.required_opcodes or inspection.optional_opcodes)
                        and inspection.metadata.get('sdr_preview_series_index') is None):
                    from .library_reduced import sample_size
                    width, height = sample_size(width, height, 10240)
            else:
                try:
                    plan(inspection)
                except NotEligible:
                    return {'cpu_route':'unsupported-gpu'}
                meta['dng_warp'] = True
            meta.update(width=width, height=height, rgb=True, colour={'authored_sdr':True})
        elif suffix in RATES:
            # Match the decode boundary: Pillow applies JPEG/PNG EXIF turns;
            # Grade's TIFF route deliberately leaves its tag unapplied.
            if suffix in {'.jpg', '.jpeg', '.png'}:
                from PIL import JpegImagePlugin, PngImagePlugin
                opener = PngImagePlugin.PngImageFile if suffix == '.png' else JpegImagePlugin.JpegImageFile
                with opener(path) as header:
                    if edge <= 2560 and suffix != '.png' and not inputs.get('repairs'):
                        from .loader import is_ultrahdr_jpeg
                        if not is_ultrahdr_jpeg(Path(path)):
                            header.draft("RGB", (5120, 5120))
                            width, height = header.size
                    if int(header.getexif().get(274, 1)) in {5, 6, 7, 8}:
                        width, height = height, width
            if edge <= 2560 and suffix in {'.png','.tif','.tiff'} and not inputs.get('repairs'):
                from .library_reduced import sample_size
                width, height = sample_size(width,height)
            # JPEG's DCT route can retain more samples than SAMPLE_EDGE; the
            # original header is its conservative bound, including orientation.
            meta.update(width=width,height=height,rgb=True,colour={'authored_sdr':True})
        return meta
    except Exception:
        return None
