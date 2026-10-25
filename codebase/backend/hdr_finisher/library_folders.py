"""On-demand folder commands, run in the low-priority library helper."""
from __future__ import annotations

from concurrent.futures import CancelledError
import os
from pathlib import Path

from .desktop_security import SOURCE_EXTENSIONS
from .library_diagnostics import audited, problem
from .library_pictures import SIDECAR_SUFFIX


def checked_folder(value):
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("The library location must be a folder.")
    return path


@audited("folder_tree")
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


def check_kept(paths, cancelled=lambda: False):
    photos = []
    for value in paths:
        if cancelled(): raise CancelledError()
        path = Path(value)
        item = {"path": value}
        try:
            info = path.stat()
            item.update(bytes=info.st_size, mtime_ns=info.st_mtime_ns)
            try:
                settings = Path(value + SIDECAR_SUFFIX).lstat()
                item["settings"] = [settings.st_size, settings.st_mtime_ns]
            except FileNotFoundError:
                item["settings"] = None
        except FileNotFoundError:
            item["missing" if path.parent.is_dir() else "offline"] = True
        except OSError:
            item["unreadable"] = True
        photos.append(item)
    return {"photos": photos}


@audited("scan_folder")
def scan_folder(value, cancelled=lambda: False, fingerprints=False):
    root = checked_folder(value)
    photos = []
    unreadable_folders = []
    folders, settings = [], {}
    def inaccessible(error):
        problem("scan_folder_failed", error.filename, error, "folder skipped; remaining folders read")
        unreadable_folders.append(str(error.filename))
    for parent, directories, files in os.walk(root, followlinks=False, onerror=inaccessible):
        if cancelled():
            raise CancelledError()
        directories[:] = [name for name in directories if not Path(parent, name).is_symlink()]
        folders.append(parent)
        names = set(files)
        if fingerprints:
            for name in files:
                if cancelled(): raise CancelledError()
                if ".hdrf" in name.casefold() and not name.endswith(".tmp"):
                    candidate = Path(parent, name)
                    try:
                        info = candidate.lstat()
                        settings[str(candidate)] = (info.st_size, info.st_mtime_ns)
                    except OSError as error:
                        inaccessible(error)
        for position, name in enumerate(files):
            if position % 32 == 0 and cancelled():
                raise CancelledError()
            path = Path(parent, name)
            if path.suffix.lower() not in SOURCE_EXTENSIONS or path.is_symlink():
                continue
            try:
                stat = path.stat()
            except OSError as error:
                problem("scan_photo_failed", path, error, "photo skipped; remaining photos read")
                continue
            photos.append({"path": str(path), "name": name, "type": path.suffix[1:].upper(),
                "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns,
                "sidecar": name + SIDECAR_SUFFIX in names})
    photos.sort(key=lambda item: (item["name"].casefold(), item["path"].casefold()))
    result = {"path": str(root), "photos": photos, "unreadable_folders": unreadable_folders}
    if fingerprints:
        result.update(folders=folders, settings=settings)
    return result
