"""Small RAW scene thumbnails under the Library thumbnail allowance."""
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock

import numpy as np

from .library_raw import identity
from .render_cache import encode_rgba_proxy_rows


class RawThumbnails:
    def __init__(self, root):
        from .library_cache import LibraryCache
        self.managed = LibraryCache(root)
        self.lock = RLock()

    @property
    def root(self):
        return self.managed.directory("library-raw-thumbnails")

    def file(self, key):
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("Invalid RAW thumbnail key.")
        return self.root / (key + ".npz")

    def cached(self, path):
        key, path, _ = identity(path)
        file = self.file(key)
        with self.lock:
            try:
                with np.load(file, allow_pickle=False) as stored:
                    meta = json.loads(str(stored["metadata"]))
                os.utime(file, None)
                return meta | {"key": key, "route": "camera-raw-scene", "cache_hit": True,
                    "stored_bytes": file.stat().st_size}
            except FileNotFoundError:
                return None
            except (OSError, ValueError, EOFError):
                file.unlink(missing_ok=True)
                self.managed.record(file)
                return None

    def store(self, meta, body):
        if not self.managed.preferences()["enabled"]:
            return
        key, path, _ = identity(meta["path"])
        if key != meta["transport_key"]:
            raise ValueError("Photo changed before its thumbnail was saved.")
        w, h = meta["width"], meta["height"]
        stride = (w * 8 + 255) // 256 * 256
        if not 0 < max(w, h) <= 512 or len(body) != stride * h:
            raise ValueError("Invalid RAW thumbnail size.")
        rgba = np.frombuffer(body, np.float16).reshape(h, stride // 2)[:, :w * 4].reshape(h, w, 4)
        pixels = rgba[:, :, :3].copy()
        if not np.isfinite(pixels).all():
            raise ValueError("Invalid RAW thumbnail pixels.")
        facts = {name: meta[name] for name in ("path", "width", "height", "edge", "adjustments", "white", "has_reference", "source_width", "source_height")}
        with self.lock:
            self.managed.prepare()
            self.root.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=self.root, suffix=".tmp", delete=False) as handle:
                temp = Path(handle.name)
                np.savez_compressed(handle, pixels=pixels, metadata=np.asarray(json.dumps(facts)))
            try:
                os.replace(temp, self.file(key))
                self.managed.record(self.file(key))
            finally:
                temp.unlink(missing_ok=True)
            self.managed.trim_soon()

    def pixels(self, key):
        with self.lock, np.load(self.file(key), allow_pickle=False) as stored:
            pixels = stored["pixels"].astype(np.float32)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        return body, pixels.shape[1], pixels.shape[0], stride
