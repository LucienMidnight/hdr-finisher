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


# At most eight active page walks; abandoned browser requests expire quickly.
# scandir iterators retain directory handles, never a whole tree of rows.
_paged_walks = {}
from threading import RLock
_walk_lock = RLock()

def _walk_photos(root, warnings, cancellation):
    stack=[]
    try:
        def directory(path):
            # Windows DirEntry has stat data from enumeration. Missing sidecars
            # must not cost one failing lstat (and antivirus probe) per photo.
            settings={}
            with os.scandir(path) as entries:
                for entry in entries:
                    if cancellation[0](): raise CancelledError()
                    if entry.name.casefold().endswith(SIDECAR_SUFFIX):
                        info=entry.stat(follow_symlinks=False)
                        settings[os.path.normcase(entry.name)]=[info.st_size,info.st_mtime_ns]
            return os.scandir(path),settings
        stack.append(directory(checked_folder(root)))
        entries=0
        while stack:
            if cancellation[0](): raise CancelledError()
            entries+=1
            if entries%512==0: yield None  # Yield even through empty/unsupported trees.
            try: entry=next(stack[-1][0])
            except StopIteration:
                stack.pop()[0].close(); continue
            try:
                if entry.is_symlink(): continue
                if entry.is_dir(follow_symlinks=False):
                    stack.append(directory(entry.path)); continue
                path=Path(entry.path)
                if path.suffix.lower() not in SOURCE_EXTENSIONS: continue
                stat=entry.stat(follow_symlinks=False)
                settings=stack[-1][1].get(os.path.normcase(entry.name+SIDECAR_SUFFIX))
                yield dict(path=entry.path,name=entry.name,type=path.suffix[1:].upper(),
                    bytes=stat.st_size,mtime_ns=stat.st_mtime_ns,sidecar=settings is not None,settings=settings)
            except OSError as error:
                warnings.append(str(error.filename or entry.path))
    finally:
        for handle,_ in stack: handle.close()


def scan_page(token, root, cancelled=lambda:False, *, close=False, restart=False):
    with _walk_lock:
        return _scan_page(token,root,cancelled,close=close,restart=restart)


def _scan_page(token, root, cancelled=lambda:False, *, close=False, restart=False):
    import time
    now=time.monotonic()
    for key,(walk,warnings,touched,cancellation) in list(_paged_walks.items()):
        if key==token and (close or restart):
            walk.close(); _paged_walks.pop(key,None)
    if close: return dict(photos=[],done=True,unreadable_folders=[])
    if token not in _paged_walks:
        if len(_paged_walks)>=8:
            raise RuntimeError("Too many folder reads; close another Library window.")
        warnings=[]
        cancellation=[cancelled]
        _paged_walks[token]=(_walk_photos(root,warnings,cancellation),warnings,now,cancellation)
    walk,warnings,_,cancellation=_paged_walks[token]
    cancellation[0]=cancelled
    photos=[];done=False
    try:
        for _ in range(256):
            if cancelled(): raise CancelledError()
            try: photo=next(walk)
            except StopIteration: done=True;break
            if photo is None: break
            photos.append(photo)
    except BaseException:
        walk.close();_paged_walks.pop(token,None);raise
    result=dict(photos=photos,done=done,unreadable_folders=list(warnings))
    warnings.clear()
    if done: _paged_walks.pop(token,None)
    else: _paged_walks[token]=(walk,warnings,now,cancellation)
    return result
