"""Small scene thumbnails, with an allowance independent of full-size pictures."""
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
        self.root = Path(root) / "library-raw-thumbnails"
        self.limit = 2 * 1024**3
        self.lock = RLock()

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
                return None

    def store(self, meta, body):
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
            self.root.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=self.root, suffix=".tmp", delete=False) as handle:
                temp = Path(handle.name)
                np.savez_compressed(handle, pixels=pixels, metadata=np.asarray(json.dumps(facts)))
            try:
                os.replace(temp, self.file(key))
            finally:
                temp.unlink(missing_ok=True)
            entries = [(p.stat().st_mtime_ns, p.stat().st_size, p) for p in self.root.glob("*.npz")]
            total = sum(size for _, size, _ in entries)
            if total > self.limit:
                for _, size, entry in sorted(entries):
                    if total <= self.limit * .9:
                        break
                    entry.unlink(missing_ok=True)
                    total -= size

    def pixels(self, key):
        with self.lock, np.load(self.file(key), allow_pickle=False) as stored:
            pixels = stored["pixels"].astype(np.float32)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        return body, pixels.shape[1], pixels.shape[0], stride
