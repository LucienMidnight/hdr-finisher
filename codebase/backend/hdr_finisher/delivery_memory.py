"""Job-owned shared pixel arrays across delivery worker processes.

Only opaque job records contain the OS names. The renderer sees job IDs,
never names or paths. Windows releases a mapping when its last process
closes it, including when a worker crashes; no pixel spool is created.
"""
from multiprocessing.shared_memory import SharedMemory

import numpy as np


class DeliveryMemory:
    def __init__(self):
        self.handles = []
        self.owned = []

    def allocate(self, shape, pixels=None):
        shape = tuple(int(v) for v in shape)
        size = int(np.prod(shape)) * 4
        handle = SharedMemory(create=True, size=size)
        self.handles.append(handle)
        self.owned.append(handle)
        value = np.ndarray(shape, dtype="<f4", buffer=handle.buf)
        if pixels is not None:
            np.copyto(value, pixels)
        return {"name": handle.name, "shape": shape, "bytes": size}, value

    def attach(self, description):
        shape = tuple(int(v) for v in description["shape"])
        size = int(np.prod(shape)) * 4
        if size <= 0 or size != description["bytes"]:
            raise ValueError("Invalid delivery memory size.")
        handle = SharedMemory(name=description["name"])
        if handle.size < size:
            handle.close()
            raise ValueError("Incomplete delivery memory.")
        self.handles.append(handle)
        return np.ndarray(shape, dtype="<f4", buffer=handle.buf)

    def close(self):
        for handle in self.owned:
            try:
                handle.unlink()
            except FileNotFoundError:
                pass
        self.owned.clear()
        for handle in self.handles:
            handle.close()
        self.handles.clear()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def __del__(self):
        self.close()
