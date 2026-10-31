"""Header-only pixel counts and Steve's October 30 bytes-per-pixel table."""
from pathlib import Path
from .library_scheduler import MINIMUM
from . import app_memory

RATES = {".jpg":23, ".jpeg":23, ".hdr":23, ".png":28, ".tif":28,
         ".tiff":28, ".dng":28, ".exr":38, ".pfm":38, ".avif":38,
         ".heic":52, ".heif":52, ".jxl":52}


def dimensions(path):
    """Never unpack a RAW or load pixels to decide whether decoding can start."""
    path = Path(path)
    if path.suffix.lower() == ".jxl":
        from .jpegxl import _probe_basic_info
        with path.open("rb") as handle:
            info = _probe_basic_info(handle.read(1024*1024))
        return info["width"], info["height"]
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
        with OpenEXR.InputFile(str(path)) as source:
            box = source.header()["dataWindow"]
            return box.max.x-box.min.x+1, box.max.y-box.min.y+1
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


def estimate_pixels(suffix, width, height, kind="source"):
    suffix = suffix.lower()
    if kind == "quick" and suffix in {".jpg", ".jpeg"}:
        return MINIMUM
    rate = 25 if kind == "cpu" else 23 if kind == "quick" else RATES.get(suffix, 7)
    return max(MINIMUM, rate*int(width)*int(height))


def estimate_details(path, kind="source", ceiling=None):
    ceiling = app_memory.CEILING if ceiling is None else ceiling
    try:
        width, height = dimensions(path)
        if width <= 0 or height <= 0:
            raise ValueError("Missing source dimensions")
        # Embedded JPEGs use the approved DCT-scaled quick route. Other
        # embedded formats keep a conservative full-source preview estimate.
        if kind == "quick" and (Path(path).suffix.lower() not in RATES or Path(path).suffix.lower()==".dng"):
            import exifread
            with Path(path).open("rb") as handle:
                tags = exifread.process_file(handle, details=False, extract_thumbnail=True)
            if tags.get("JPEGThumbnail"):
                return MINIMUM, ""
        if kind != "cpu" and kind != "quick" and Path(path).suffix.lower()==".dng":
            import tifffile
            with tifffile.TiffFile(path) as source:
                pages=list(source.pages)
                for page in list(pages):
                    if page.pages is not None:pages.extend(page.pages)
                main=max(pages,key=lambda p:p.imagewidth*p.imagelength)
                if int(main.photometric)==32803: # CFA camera DNG, not LinearRaw.
                    return max(MINIMUM,7*width*height), ""
        return estimate_pixels(Path(path).suffix, width, height, kind), ""
    except Exception:
        # Steve, October 31: no invented per-type maximum. Decode errors are
        # reported only if decoding subsequently fails, never by admission.
        return ceiling, "unknown size"


def estimate(path, kind="source", ceiling=None):
    return estimate_details(path, kind, ceiling)[0]
