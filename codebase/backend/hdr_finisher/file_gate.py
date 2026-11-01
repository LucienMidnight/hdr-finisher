"""Which files the Library lists and reads (Steve, October 30, 2026: be restrictive).

One rule set for folder scans, the index walk, the add-folder browser and file
checks. See docs/technical/archive/briefs/library-resource-scheduler-design-2026-10-30.md,
section 6.9, and docs/user-guide/library.md for the user-facing list.
"""
from __future__ import annotations

import os
import stat as stat_module
import time
from pathlib import Path

SOURCE_EXTENSIONS = {
    ".exr", ".tif", ".tiff", ".hdr", ".pfm", ".heic", ".heif",
    ".avif", ".jxl", ".png", ".jpg", ".jpeg", ".dng", ".arw", ".cr2",
    ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw",
}

# Folders that operating systems, sync tools and NAS boxes create beside
# photos: trash, snapshots, metadata and thumbnail copies. Never photos.
# Compared without case. Any folder starting with "." or "~" is also skipped.
SKIPPED_FOLDERS = {
    "$recycle.bin", "system volume information", "#recycle", "@recycle",
    "@eadir", "#snapshot", "__macosx",
}
# Real photos are larger than this; smaller files are empty or placeholders.
MIN_PHOTO_BYTES = 1024
# A file modified this recently may still be being copied.
SETTLE_SECONDS = 2.0

_HIDDEN, _SYSTEM = 0x2, 0x4
_OFFLINE, _RECALL_ON_OPEN, _RECALL_ON_DATA_ACCESS = 0x1000, 0x40000, 0x400000
_UF_HIDDEN = getattr(stat_module, "UF_HIDDEN", 0x8000)
_SF_DATALESS = 0x40000000  # macOS: iCloud/File Provider file not on disk


def _hidden_prefix(name: str) -> bool:
    # "." covers macOS "._" AppleDouble companions and dot-files; "~" covers
    # editor and Office temporary names. "_" stays allowed (Sony "_DSC").
    return name.startswith((".", "~"))


def is_photo_name(name) -> bool:
    name = str(name)
    return not _hidden_prefix(name) and Path(name).suffix.lower() in SOURCE_EXTENSIONS


def is_skipped_folder_name(name) -> bool:
    name = str(name)
    return _hidden_prefix(name) or name.casefold() in SKIPPED_FOLDERS


def hidden_or_system(info) -> bool:
    attributes = getattr(info, "st_file_attributes", 0)
    return bool(attributes & (_HIDDEN | _SYSTEM) or getattr(info, "st_flags", 0) & _UF_HIDDEN)


def is_cloud_placeholder(info) -> bool:
    """An online-only sync file (OneDrive, Dropbox, iCloud, Google Drive).

    Reading its contents downloads it, so the Library reads it only when the
    user opens that photo. Checking its details (stat) never downloads.
    """
    attributes = getattr(info, "st_file_attributes", 0)
    return bool(attributes & (_OFFLINE | _RECALL_ON_OPEN | _RECALL_ON_DATA_ACCESS)
                or getattr(info, "st_flags", 0) & _SF_DATALESS)


def is_link(entry) -> bool:
    """Symbolic links and Windows junctions are not followed (no loops)."""
    try:
        return entry.is_symlink() or bool(getattr(entry, "is_junction", lambda: False)())
    except OSError:
        return True


def skip_folder(entry) -> bool:
    """For an os.DirEntry that is a directory."""
    if is_skipped_folder_name(entry.name) or is_link(entry):
        return True
    try:
        return hidden_or_system(entry.stat(follow_symlinks=False))
    except OSError:
        return True


def listed_photo(name, info) -> bool:
    """A file the Library lists, from its name and its stat (no read)."""
    return (is_photo_name(name) and stat_module.S_ISREG(info.st_mode)
            and info.st_size >= MIN_PHOTO_BYTES and not hidden_or_system(info))


def path_listed(path) -> bool:
    """Name rules for every part of a path (used where only a path is known)."""
    parts = Path(str(path)).parts
    return bool(parts) and is_photo_name(parts[-1]) and not any(
        is_skipped_folder_name(part) for part in parts[1:-1])


def still_copying(info, now=None) -> bool:
    age = (time.time() if now is None else now) - info.st_mtime
    return 0 <= age < SETTLE_SECONDS


# First bytes of each supported format. The extension says what a file
# claims to be; these say what it is.
def detect_format(header: bytes) -> str | None:
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        return "tiff"  # also DNG and TIFF-based camera RAWs
    if header[:4] in (b"IIRO", b"IIRS", b"MMOR"):
        return "orf"
    if header[:4] == b"IIU\x00":
        return "rw2"
    if header.startswith(b"FUJIFILMCCD-RAW"):
        return "raf"
    if header[4:8] == b"ftyp":
        return "cr3" if header[8:11] == b"crx" else "isobmff"  # HEIC, HEIF, AVIF
    if header.startswith(b"\xff\x0a") or header.startswith(b"\x00\x00\x00\x0cJXL \r\n\x87\n"):
        return "jxl"
    if header.startswith(b"v/1\x01"):
        return "exr"
    if header.startswith(b"#?"):
        return "hdr"
    if header[:2] in (b"PF", b"Pf") and header[2:3] in (b"\n", b"\r", b" "):
        return "pfm"
    return None


_EXPECTED = {
    ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".tif": "tiff", ".tiff": "tiff",
    ".dng": "tiff", ".arw": "tiff", ".cr2": "tiff", ".nef": "tiff", ".nrw": "tiff",
    ".pef": "tiff", ".srw": "tiff", ".orf": "orf", ".ori": "orf", ".rw2": "rw2",
    ".raf": "raf", ".cr3": "cr3", ".heic": "isobmff", ".heif": "isobmff",
    ".avif": "isobmff", ".jxl": "jxl", ".exr": "exr", ".hdr": "hdr", ".pfm": "pfm",
}


def expected_format(path) -> str | None:
    return _EXPECTED.get(Path(str(path)).suffix.lower())


_RGB_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr", ".hdr", ".pfm", ".heic", ".heif", ".avif", ".jxl"}
_CANONICAL = {"jpeg": ".jpg", "png": ".png", "tiff": ".tif", "jxl": ".jxl", "exr": ".exr", "hdr": ".hdr", "pfm": ".pfm"}


def decode_suffix(path) -> str:
    """The extension to decode a non-RAW file as: its own, unless its contents
    are a different supported format. iPhone edited copies (IMG_E….HEIC) are
    often JPEGs; measured on October 30, about 0.4% of Steve's HEIC files.
    Camera RAW and DNG files keep their own route."""
    suffix = Path(str(path)).suffix.lower()
    if suffix not in _RGB_SUFFIXES:
        return suffix
    try:
        with open(path, "rb") as handle:
            header = handle.read(32)
    except OSError:
        return suffix
    found = detect_format(header)
    if found is None or found == _EXPECTED.get(suffix):
        return suffix
    if found == "isobmff":
        return ".avif" if header[8:12] in (b"avif", b"avis") else ".heic"
    return _CANONICAL.get(found, suffix)


class NotAPhoto(ValueError):
    """The contents are not any supported image (remembered once per file version)."""


def check_contents(path) -> str:
    """Read the first bytes; raise NotAPhoto unless they are a supported image.

    Returns the detected format. A different supported format than the
    extension claims (a HEIC saved as .jpg) is allowed: the decoders open
    files by content.
    """
    with open(path, "rb") as handle:
        header = handle.read(32)
    found = detect_format(header)
    if found is None:
        raise NotAPhoto("Not a valid photo: the file's contents are not a supported image format.")
    return found
