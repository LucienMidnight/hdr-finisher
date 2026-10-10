"""Lightweight capture dates using the app's existing EXIF reader; no pixel decode."""
from concurrent.futures import CancelledError
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from .desktop_security import SOURCE_EXTENSIONS


@lru_cache(maxsize=8192)
def _capture_time(path, size, modified):
    import exifread
    try:
        with Path(path).open("rb") as handle:
            tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
        value = tags.get("EXIF DateTimeOriginal") or tags.get("EXIF DateTimeDigitized")
        if value is None:
            return None
        return datetime.strptime(str(value).strip(), "%Y:%m:%d %H:%M:%S").isoformat()
    except (OSError, ValueError, TypeError):
        return None
    except Exception:
        # Malformed/missing EXIF never makes an otherwise readable picture disappear.
        return None


def read_metadata(paths, cancelled=lambda: False):
    photos = []
    for value in paths:
        if cancelled():
            raise CancelledError()
        path = Path(value).expanduser().resolve()
        record = {"path": str(path), "capture_time": None}
        try:
            if path.suffix.lower() in SOURCE_EXTENSIONS and path.is_file():
                stat = path.stat()
                record["capture_time"] = _capture_time(str(path), stat.st_size, stat.st_mtime_ns)
        except OSError:
            pass
        photos.append(record)
    return {"photos": photos}
