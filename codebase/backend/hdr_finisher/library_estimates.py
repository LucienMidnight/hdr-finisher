"""Header-only pixel counts and Steve's October 30 bytes-per-pixel table."""
from pathlib import Path
from .library_scheduler import MINIMUM

RATES = {".jpg":23, ".jpeg":23, ".hdr":23, ".png":28, ".tif":28,
         ".tiff":28, ".dng":28, ".exr":38, ".pfm":38, ".avif":38,
         ".heic":52, ".heif":52, ".jxl":52}


def dimensions(path):
    """Never unpack a RAW or load pixels to decide whether decoding can start."""
    path = Path(path)
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
        with Image.open(path) as source:
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
        raise ValueError("Source dimensions could not be read from its header")


def estimate_pixels(suffix, width, height, kind="source"):
    suffix = suffix.lower()
    if kind == "quick" and suffix in {".jpg", ".jpeg"}:
        return MINIMUM
    rate = 25 if kind == "cpu" else 23 if kind == "quick" else RATES.get(suffix, 7)
    return max(MINIMUM, rate*int(width)*int(height))


def estimate(path, kind="source"):
    # Unreadable-header fallback amounts await Steve. This helper is not yet
    # connected to admission; do not turn a missing estimate into a photo failure.
    width, height = dimensions(path)
    return estimate_pixels(Path(path).suffix, width, height, kind)
