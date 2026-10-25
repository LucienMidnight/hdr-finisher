"""Conservative Windows recursive change signal; an unavailable watcher always scans."""
import os


class FolderChangeSignal:
    def __init__(self, path):
        self.handle = None
        self.api = None
        self.first = True
        if os.name != "nt": return
        import ctypes
        from ctypes import wintypes
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.FindFirstChangeNotificationW.argtypes = (wintypes.LPCWSTR, wintypes.BOOL, wintypes.DWORD)
        api.FindFirstChangeNotificationW.restype = wintypes.HANDLE
        api.FindNextChangeNotification.argtypes = (wintypes.HANDLE,)
        api.FindNextChangeNotification.restype = wintypes.BOOL
        api.FindCloseChangeNotification.argtypes = (wintypes.HANDLE,)
        api.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        api.WaitForSingleObject.restype = wintypes.DWORD
        # Names, directories, attributes, size and last-write: includes source
        # replacement and sidecar edits, not just directory timestamps.
        handle = api.FindFirstChangeNotificationW(str(path), True, 0x1f)
        if handle not in (None, ctypes.c_void_p(-1).value):
            self.api, self.handle = api, handle

    def changed(self):
        if self.handle is None: return True
        if self.first:
            self.first = False
            return True  # A scan establishes the baseline after arming.
        status = self.api.WaitForSingleObject(self.handle, 0)
        if status == 258: return False  # WAIT_TIMEOUT: no changes.
        if status != 0 or not self.api.FindNextChangeNotification(self.handle):
            self.close()  # Disconnect/failure: do not trust the baseline.
        return True

    def close(self):
        if self.handle is not None:
            self.api.FindCloseChangeNotification(self.handle)
            self.handle = None

    def __del__(self):
        self.close()
