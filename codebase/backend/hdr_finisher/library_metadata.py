"""Lightweight capture facts using the app's existing EXIF reader; no pixel decode."""
from concurrent.futures import CancelledError
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from .desktop_security import SOURCE_EXTENSIONS

# Every fact is None when the file does not record it; nothing is guessed.
FACT_FIELDS = ("capture_time", "camera_make", "camera", "lens_make", "lens", "iso", "shutter", "aperture",
    "focal_length", "focal_length_35", "exposure_bias", "exposure_program", "metering", "flash",
    "width", "height", "latitude", "longitude", "software", "artist", "copyright")


def _text(tags, *names):
    for name in names:
        value = " ".join(str(tags[name]).replace("\x00", " ").split()) if name in tags else ""
        if value:
            return value[:200]
    return None


def _number(tags, *names):
    for name in names:
        try:
            value = float(tags[name].values[0])
        except (KeyError, IndexError, TypeError, ValueError, ZeroDivisionError, AttributeError):
            continue
        if value == value and abs(value) != float("inf"):
            return value
    return None


def _coordinate(tags, name):
    try:
        degrees, minutes, seconds = (float(part) for part in tags[f"GPS {name}"].values[:3])
        reference = str(tags[f"GPS {name}Ref"]).strip().upper()[:1]
    except (KeyError, TypeError, ValueError, ZeroDivisionError, AttributeError):
        return None
    value = degrees + minutes / 60 + seconds / 3600
    if reference not in "NSEW" or not reference or not 0 <= value <= 180 or (degrees, minutes, seconds) == (0, 0, 0):
        return None
    return round(-value if reference in "SW" else value, 6)


def _capture_time(tags):
    value = tags.get("EXIF DateTimeOriginal") or tags.get("EXIF DateTimeDigitized")
    if value is None:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y:%m:%d %H:%M:%S").isoformat()
    except (ValueError, TypeError):
        return None


@lru_cache(maxsize=8192)
def _facts(path, size, modified):
    import exifread
    facts = dict.fromkeys(FACT_FIELDS)
    try:
        with Path(path).open("rb") as handle:
            tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
    except Exception:
        # Malformed/missing EXIF never makes an otherwise readable picture disappear.
        return facts
    positive = lambda value: value if value is not None and value > 0 else None
    whole = lambda value: int(value) if value is not None and value > 0 else None
    facts.update(capture_time=_capture_time(tags), camera_make=_text(tags, "Image Make"), camera=_text(tags, "Image Model"),
        lens_make=_text(tags, "EXIF LensMake"), lens=_text(tags, "EXIF LensModel"),
        iso=whole(_number(tags, "EXIF ISOSpeedRatings", "EXIF PhotographicSensitivity")),
        shutter=positive(_number(tags, "EXIF ExposureTime")), aperture=positive(_number(tags, "EXIF FNumber")),
        focal_length=positive(_number(tags, "EXIF FocalLength")), focal_length_35=whole(_number(tags, "EXIF FocalLengthIn35mmFilm")),
        exposure_bias=_number(tags, "EXIF ExposureBiasValue"), exposure_program=_text(tags, "EXIF ExposureProgram"),
        metering=_text(tags, "EXIF MeteringMode"), flash=_text(tags, "EXIF Flash"),
        width=whole(_number(tags, "EXIF ExifImageWidth")), height=whole(_number(tags, "EXIF ExifImageLength")),
        latitude=_coordinate(tags, "GPSLatitude"), longitude=_coordinate(tags, "GPSLongitude"),
        software=_text(tags, "Image Software"), artist=_text(tags, "Image Artist"), copyright=_text(tags, "Image Copyright"))
    if facts["latitude"] is None or facts["longitude"] is None:
        facts["latitude"] = facts["longitude"] = None
    return facts


def read_metadata(paths, cancelled=lambda: False):
    photos = []
    for value in paths:
        if cancelled():
            raise CancelledError()
        path = Path(value).expanduser().resolve()
        record = {"path": str(path), **dict.fromkeys(FACT_FIELDS)}
        try:
            if path.suffix.lower() in SOURCE_EXTENSIONS and path.is_file():
                stat = path.stat()
                record.update(_facts(str(path), stat.st_size, stat.st_mtime_ns), bytes=stat.st_size, mtime_ns=stat.st_mtime_ns)
        except OSError:
            pass
        photos.append(record)
    return {"photos": photos}
