"""Small, dependency-free bridge to Foundation's checked Trash operations."""
import ctypes
from contextlib import contextmanager
from pathlib import Path
import os


def send(receiver, selector, result=ctypes.c_void_p, types=(), args=()):
    runtime = ctypes.CDLL('/usr/lib/libobjc.A.dylib')
    runtime.sel_registerName.argtypes = [ctypes.c_char_p]
    runtime.sel_registerName.restype = ctypes.c_void_p
    function = ctypes.CFUNCTYPE(result, ctypes.c_void_p, ctypes.c_void_p, *types)(('objc_msgSend', runtime))
    return function(receiver, runtime.sel_registerName(selector.encode()), *args)


def class_named(name):
    ctypes.CDLL('/System/Library/Frameworks/Foundation.framework/Foundation')
    runtime = ctypes.CDLL('/usr/lib/libobjc.A.dylib')
    runtime.objc_getClass.argtypes = [ctypes.c_char_p]
    runtime.objc_getClass.restype = ctypes.c_void_p
    return runtime.objc_getClass(name.encode())


@contextmanager
def pool():
    value = send(send(class_named('NSAutoreleasePool'), 'alloc'), 'init')
    try:
        yield
    finally:
        send(value, 'drain', result=None)


def string(value):
    return send(class_named('NSString'), 'stringWithUTF8String:', types=(ctypes.c_char_p,), args=(str(value).encode(),))


def text(value):
    return send(value, 'UTF8String', result=ctypes.c_char_p).decode() if value else None


def url(path):
    return send(class_named('NSURL'), 'fileURLWithPath:', types=(ctypes.c_void_p,), args=(string(path),))


def trash_directory(path):
    source = Path(path)
    while not source.exists() and source.parent != source:
        source = source.parent
    error = ctypes.c_void_p()
    directory = send(send(class_named('NSFileManager'), 'defaultManager'),
        'URLForDirectory:inDomain:appropriateForURL:create:error:',
        types=(ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_bool, ctypes.POINTER(ctypes.c_void_p)),
        args=(102, 1, url(source), True, ctypes.byref(error)))
    if not directory:
        raise OSError('Trash is unavailable on this volume. Nothing was permanently deleted.')
    return text(send(directory, 'path'))


def available(path):
    try:
        with pool():
            directory = Path(trash_directory(path))
            return directory.is_dir() and directory.stat().st_dev == Path(path).stat().st_dev and stable_ids(path)
    except OSError:
        return False


def reference(path):
    with pool():
        error = ctypes.c_void_p()
        value = send(url(path), 'bookmarkDataWithOptions:includingResourceValuesForKeys:relativeToURL:error:',
            types=(ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)),
            args=(0, None, None, ctypes.byref(error)))
        if not value:
            raise OSError('A recovery reference could not be recorded. Nothing was deleted.')
        return text(send(value, 'base64EncodedStringWithOptions:', types=(ctypes.c_ulong,), args=(0,)))


def find(path, stamp, checksum, reference_url=None):
    from .library_file_io import relocated
    if not reference_url:
        return None
    with pool():
        data = send(send(class_named('NSData'), 'alloc'), 'initWithBase64EncodedString:options:',
            types=(ctypes.c_void_p, ctypes.c_ulong), args=(string(reference_url), 0))
        if not data:
            return None
        send(data, 'autorelease')
        stale, error = ctypes.c_bool(), ctypes.c_void_p()
        value = send(class_named('NSURL'), 'URLByResolvingBookmarkData:options:relativeToURL:bookmarkDataIsStale:error:',
            types=(ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.POINTER(ctypes.c_bool), ctypes.POINTER(ctypes.c_void_p)),
            args=(data, (1 << 8) | (1 << 9), None, ctypes.byref(stale), ctypes.byref(error)))
        candidate = text(send(value, 'path'))
        if not candidate or Path(candidate).parent != Path(trash_directory(path)):
            return None
        return candidate if relocated(candidate, stamp, checksum) else None


def recycle(path):
    with pool():
        result, error = ctypes.c_void_p(), ctypes.c_void_p()
        success = send(send(class_named('NSFileManager'), 'defaultManager'), 'trashItemAtURL:resultingItemURL:error:',
            result=ctypes.c_bool,
            types=(ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)),
            args=(url(path), ctypes.byref(result), ctypes.byref(error)))
        if not success:
            reason = text(send(error, 'localizedDescription')) if error.value else 'Trash is unavailable.'
            raise OSError(f'{reason} Nothing was permanently deleted.')
        receipt = text(send(result, 'path'))
        if not receipt:
            raise OSError('macOS did not return the Trash location. Check Needs attention; nothing was permanently deleted.')
        return receipt


def copy_metadata(source, target, preserve_times=True):
    stamp = Path(target).stat()
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    copy = library.copyfile
    copy.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_uint32]
    copy.restype = ctypes.c_int
    if copy(os.fsencode(source), os.fsencode(target), None, 7 | (1 << 18) | (1 << 19)):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(target))
    if not preserve_times:
        os.utime(target, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))


def stable_ids(path):
    with pool():
        framework = ctypes.CDLL('/System/Library/Frameworks/Foundation.framework/Foundation')
        key = ctypes.c_void_p.in_dll(framework, 'NSURLVolumeSupportsPersistentIDsKey')
        value, error = ctypes.c_void_p(), ctypes.c_void_p()
        success = send(url(path), 'getResourceValue:forKey:error:', result=ctypes.c_bool,
            types=(ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)),
            args=(ctypes.byref(value), key, ctypes.byref(error)))
        if not success or not value.value:
            raise OSError('The volume could not confirm safe file identities. Files were left alone.')
        return bool(send(value, 'boolValue', result=ctypes.c_bool))
