"""On-demand folder commands, run in the low-priority library helper."""
from __future__ import annotations

from concurrent.futures import CancelledError
import os
from pathlib import Path

from .desktop_security import SOURCE_EXTENSIONS


def checked_folder(value):
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("The library location must be a folder.")
    return path


def folder_tree(value, cancelled=lambda: False):
    root = checked_folder(value)
    children = []
    with os.scandir(root) as entries:
        for entry in entries:
            if cancelled():
                raise CancelledError()
            if entry.is_dir(follow_symlinks=False):
                children.append({"name": entry.name, "path": entry.path})
    return {"path": str(root), "children": sorted(children, key=lambda item: item["name"].casefold())}


def scan_folder(value, cancelled=lambda: False):
    root = checked_folder(value)
    photos = []
    unreadable_folders = []
    def inaccessible(error):
        unreadable_folders.append(str(error.filename))
    for parent, directories, files in os.walk(root, followlinks=False, onerror=inaccessible):
        if cancelled():
            raise CancelledError()
        directories[:] = [name for name in directories if not Path(parent, name).is_symlink()]
        for name in files:
            path = Path(parent, name)
            if path.suffix.lower() not in SOURCE_EXTENSIONS or path.is_symlink():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            photos.append({"path": str(path), "name": name, "type": path.suffix[1:].upper(),
                "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns})
    photos.sort(key=lambda item: (item["name"].casefold(), item["path"].casefold()))
    return {"path": str(root), "photos": photos, "unreadable_folders": unreadable_folders}
