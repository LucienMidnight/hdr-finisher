"""Native no-replace primitives and durable command records."""
import ctypes
import hashlib
import json
import os
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from contextlib import contextmanager
from contextvars import ContextVar

_removals = ContextVar('library_file_removals', default=None)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def signature(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Links are left untouched.')
    s = path.stat()
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns]


def same(path, stamp, checksum=None):
    try:
        return signature(path) == stamp and (checksum is None or digest(path) == checksum)
    except OSError:
        return False


def stable_ids(path):
    if sys.platform=='darwin':
        from . import library_macos
        return library_macos.stable_ids(path)
    if os.name!='nt': return True
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    get=kernel.GetVolumeInformationW
    get.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_wchar_p,ctypes.c_uint]
    get.restype=ctypes.c_int
    name=ctypes.create_unicode_buffer(32)
    if not get(Path(path).anchor,None,0,None,None,None,name,len(name)): return False
    # FAT IDs identify a directory entry and change when that entry is renamed.
    return name.value.upper() not in {'FAT','FAT32','EXFAT'}


def relocated(path,stamp,checksum):
    """Recognize checked contents after an app rename on a FAT filesystem."""
    try:
        actual=signature(path)
        matches=actual==stamp or not stable_ids(path) and actual[0]==stamp[0] and actual[2:]==stamp[2:]
        return matches and digest(path)==checksum
    except OSError: return False


def matches_handle(path,actual,stamp):
    return actual==stamp or not stable_ids(path) and actual[0]==stamp[0] and actual[2:]==stamp[2:]


def check_streams(path):
    """A byte-copy/JSON rewrite must not silently discard another data stream."""
    if os.name!='nt': return
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    class Stream(ctypes.Structure):
        _fields_=[('size',ctypes.c_int64),('name',ctypes.c_wchar*296)]
    first=kernel.FindFirstStreamW;first.argtypes=[ctypes.c_wchar_p,ctypes.c_int,ctypes.POINTER(Stream),ctypes.c_uint];first.restype=ctypes.c_void_p
    nxt=kernel.FindNextStreamW;nxt.argtypes=[ctypes.c_void_p,ctypes.POINTER(Stream)];nxt.restype=ctypes.c_int
    close=kernel.FindClose;close.argtypes=[ctypes.c_void_p];close.restype=ctypes.c_int
    data=Stream();handle=first(str(path),0,ctypes.byref(data),0)
    if handle==ctypes.c_void_p(-1).value:
        error=ctypes.get_last_error()
        if error==38: return
        # FAT has no named data streams. An unknown filesystem is conservatively
        # refused if Windows cannot enumerate streams, rather than copy blindly.
        fs=ctypes.create_unicode_buffer(32);get=kernel.GetVolumeInformationW
        get.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_wchar_p,ctypes.c_uint];get.restype=ctypes.c_int
        if get(Path(path).anchor,None,0,None,None,None,fs,len(fs)) and fs.value.upper() in {'FAT','FAT32','EXFAT'}: return
        raise ValueError('Additional file data could not be checked. This item was left alone.')
    try:
        while True:
            if data.name!='::$DATA': raise ValueError('This file has additional data streams. It was left alone so none can be lost.')
            if not nxt(handle,ctypes.byref(data)):
                if ctypes.get_last_error()!=38: raise ctypes.WinError(ctypes.get_last_error())
                return
    finally: close(handle)


def rename(source, target, replace=False):
    """Publish without replacement, including races after the name check."""
    if os.name == 'nt':
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        move = kernel.MoveFileExW
        move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
        move.restype = ctypes.c_int
        if not move(str(source), str(target), 8 | (1 if replace else 0)):
            raise ctypes.WinError(ctypes.get_last_error())
    elif replace:
        os.replace(source, target)
    elif sys.platform == 'darwin':
        library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        move = library.renamex_np
        move.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        move.restype = ctypes.c_int
        if move(os.fsencode(source), os.fsencode(target), 4):
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), str(target))
    elif Path(source).is_file():
        os.link(source, target)
        Path(source).unlink()
    else:
        # The app runs on Windows; do not use POSIX rename's replace semantics.
        raise ValueError('Folder commands require Windows no-replace rename.')
    if sys.platform == 'darwin':
        for folder in {Path(source).parent, Path(target).parent}:
            sync_directory(folder)


def durable(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, delete=False, suffix='.tmp') as f:
        temporary = Path(f.name)
        f.write(json.dumps(value, ensure_ascii=False).encode('utf-8'))
        f.flush(); os.fsync(f.fileno())
    try:
        rename(temporary, path, replace=True)
    finally:
        temporary.unlink(missing_ok=True)


def occupied(path, except_path=None):
    path = Path(path)
    for item in path.parent.iterdir():
        if item.name.casefold() == path.name.casefold():
            if except_path is None or str(item) != str(except_path):
                return True
    return False


def remove_owned(path, stamp, checksum):
    """Capture the checked original before removal; never unlink its replaceable name."""
    if sys.platform == 'darwin':
        folder = removal_folder(path, stamp)
        folder.mkdir(mode=0o700, exist_ok=True)
        if folder.is_symlink() or folder.stat().st_uid != os.getuid() or folder.stat().st_mode & 0o077:
            raise ValueError(f'The removal staging folder changed. Files were left alone: {folder}')
        staged = folder / 'item'
        if not staged.exists() and not staged.is_symlink():
            if not Path(path).exists():
                folder.rmdir()
                return
            rename(path, staged)
        try:
            checked = relocated(staged, stamp, checksum)
        except ValueError:
            checked = False
        if not checked:
            try:
                rename(staged, path)
                folder.rmdir()
            except OSError:
                pass
            raise ValueError(f'The file changed. It was kept at {path} or {staged}.')
        removals = _removals.get()
        if removals is not None:
            removals.append((Path(path), stamp, checksum))
        else:
            staged.unlink()
            folder.rmdir()
        return
    if os.name != 'nt':
        raise ValueError('Removing originals requires the Windows ownership guard.')
    import msvcrt
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    create=kernel.CreateFileW
    create.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p]
    create.restype=ctypes.c_void_p
    handle=create(str(path),0x80010000,1,None,3,0,None)
    if handle==ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
    fd=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    with os.fdopen(fd,'rb') as stream:
        s=os.fstat(stream.fileno())
        if not matches_handle(path,[s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns],stamp) or hashlib.file_digest(stream,'sha256').hexdigest()!=checksum:
            raise ValueError('The file changed. It was left untouched.')
        remove=kernel.SetFileInformationByHandle
        remove.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint];remove.restype=ctypes.c_int
        flag=ctypes.c_ubyte(1)
        if not remove(handle,4,ctypes.byref(flag),ctypes.sizeof(flag)): raise ctypes.WinError(ctypes.get_last_error())


@contextmanager
def read_guard(path, stamp, checksum):
    """Verify destinations and retain captured Mac originals until the guard exits."""
    if sys.platform == 'darwin':
        import fcntl
        with open(path, 'rb') as stream:
            fcntl.flock(stream, fcntl.LOCK_SH | fcntl.LOCK_NB)
            if not same(path, stamp, checksum):
                raise ValueError('The checked copy changed. The original was kept.')
            removals = []
            token = _removals.set(removals)
            try:
                yield
                if not same(path, stamp, checksum):
                    raise ValueError('The checked copy changed during the command. The original was retained.')
                for original, original_stamp, original_checksum in removals:
                    staged = removal_folder(original, original_stamp) / 'item'
                    if not relocated(staged, original_stamp, original_checksum):
                        raise ValueError(f'The captured original changed. It was kept at {staged}.')
                for original, original_stamp, original_checksum in removals:
                    folder = removal_folder(original, original_stamp)
                    (folder / 'item').unlink()
                    folder.rmdir()
            except BaseException:
                for original, original_stamp, original_checksum in removals:
                    folder = removal_folder(original, original_stamp)
                    try:
                        rename(folder / 'item', original)
                        folder.rmdir()
                    except OSError:
                        pass
                raise
            finally:
                _removals.reset(token)
        return
    if os.name != 'nt': raise ValueError('Original-file removal requires Windows or macOS.')
    import msvcrt
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    create=kernel.CreateFileW;create.argtypes=[ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p,ctypes.c_uint,ctypes.c_uint,ctypes.c_void_p];create.restype=ctypes.c_void_p
    handle=create(str(path),0x80000000,1,None,3,0,None)
    if handle==ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
    fd=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    with os.fdopen(fd,'rb') as stream:
        s=os.fstat(stream.fileno())
        if not matches_handle(path,[s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns],stamp) or hashlib.file_digest(stream,'sha256').hexdigest()!=checksum:
            raise ValueError('The checked copy changed. The original was kept.')
        yield


def removal_folder(path, stamp):
    key = hashlib.sha256((str(path) + json.dumps(stamp)).encode()).hexdigest()
    return Path(path).parent / ('.hdr-removing-' + key)


def removal_pending(path, stamp):
    return sys.platform == 'darwin' and removal_folder(path, stamp).exists()


def sync_directory(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    except PermissionError:
        from . import library_macos
        with library_macos.pool():
            if Path(path) == Path(library_macos.trash_directory(path)):
                return
        raise
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
