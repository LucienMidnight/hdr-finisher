"""Lightweight capture facts using the app's existing EXIF reader; no pixel decode."""
from concurrent.futures import CancelledError, ProcessPoolExecutor, TimeoutError
from threading import Lock
import os
import multiprocessing
import atexit
from .cpu_budget import logical_cpus
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from .desktop_security import SOURCE_EXTENSIONS
from .library_diagnostics import audited, problem

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
    except Exception as error:
        problem("metadata_read_failed", path, error, "facts unavailable; photo stays visible")
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


def _read_one(value):
    return read_metadata([value])["photos"][0]


def _reader_init():
    from .library_worker import _lower_priority
    _lower_priority()


_pool = None
_pool_lock = Lock()


def close_readers():
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=True, cancel_futures=True)
        _pool = None


atexit.register(close_readers)


@audited("read_metadata")
def read_metadata(paths, cancelled=lambda: False, *, parallel=False):
    if parallel and len(paths) > 1:
        global _pool
        with _pool_lock:
            if _pool is None:
                # Windows multiprocessing is limited to 61 child wait handles; native work can use the remaining CPUs.
                _pool = ProcessPoolExecutor(max_workers=min(logical_cpus(), 61) if os.name == "nt" else logical_cpus(),
                    mp_context=multiprocessing.get_context("spawn"), initializer=_reader_init)
        # Only one wave in flight: pause/foreground checks precede every refill.
        photos = []
        try:
            for start in range(0, len(paths), logical_cpus()):
                if cancelled():
                    raise CancelledError()
                pending = [_pool.submit(_read_one, p) for p in paths[start:start+logical_cpus()]]
                for future in pending:
                    while True:
                        if cancelled():
                            raise CancelledError()
                        try:
                            photos.append(future.result(timeout=.05))
                            break
                        except TimeoutError:
                            pass
            return {"photos": photos}
        finally:
            for future in locals().get("pending", []):
                future.cancel()
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
        except OSError as error:
            problem("metadata_stat_failed", path, error, "facts unavailable; photo stays visible")
        photos.append(record)
    return {"photos": photos}
