"""Library disk input. Optional unbuffered Windows reads for matched M10 timing."""
import os


def open_raw(path):
    if os.name == "nt" and os.environ.get("HDR_FINISHER_LIBRARY_COLD_READS") == "1":
        return WindowsColdReader(path)
    return open(path, "rb", buffering=0)


class WindowsColdReader:
    def __init__(self, path):
        import ctypes as C
        self.C = C
        self.kernel = k = C.WinDLL("kernel32", use_last_error=True)
        k.CreateFileW.argtypes = [C.c_wchar_p, C.c_uint32, C.c_uint32, C.c_void_p, C.c_uint32, C.c_uint32, C.c_void_p]
        k.CreateFileW.restype = C.c_void_p
        k.VirtualAlloc.argtypes = [C.c_void_p, C.c_size_t, C.c_uint32, C.c_uint32]
        k.VirtualAlloc.restype = C.c_void_p
        k.ReadFile.argtypes = [C.c_void_p, C.c_void_p, C.c_uint32, C.POINTER(C.c_uint32), C.c_void_p]
        k.CloseHandle.argtypes = [C.c_void_p]
        k.VirtualFree.argtypes = [C.c_void_p, C.c_size_t, C.c_uint32]
        self.handle = k.CreateFileW(str(path), 0x80000000, 7, None, 3, 0x20000000 | 0x08000000, None)
        self.buffer = None
        if self.handle == C.c_void_p(-1).value:
            self.handle = None
            raise C.WinError(C.get_last_error())
        self.buffer = k.VirtualAlloc(None, 1024**2, 0x3000, 4)
        if not self.buffer:
            self.close()
            raise C.WinError(C.get_last_error())

    def readinto(self, view):
        got = self.C.c_uint32()
        if not self.kernel.ReadFile(self.handle, self.buffer, 1024**2, self.C.byref(got), None):
            raise self.C.WinError(self.C.get_last_error())
        if got.value > len(view):
            raise ValueError("RAW size changed while reading.")
        if got.value:
            target = self.C.c_char.from_buffer(view)
            self.C.memmove(self.C.addressof(target), self.buffer, got.value)
            del target
        return got.value

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
        if self.buffer:
            self.kernel.VirtualFree(self.buffer, 0, 0x8000)
            self.buffer = None
