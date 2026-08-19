from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path
from threading import BoundedSemaphore, RLock
from tempfile import NamedTemporaryFile
from typing import Any

import numpy as np

from .color import acescg_to_linear_srgb
from .config import APP_DATA_DIR, EXPORTS_DIR
from .desktop_security import SOURCE_EXTENSIONS
from .jpegxl import decode_jpegxl
from .raw_import import RAW_EXTENSIONS


class MediaBrowserError(ValueError):
    pass


class MediaBrowserStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or APP_DATA_DIR).resolve()
        self.path = self.root / "favorite-folders.json"
        self.thumbnail_root = self.root / "thumbnails"
        self._lock = RLock()
        self._decode_slots = BoundedSemaphore(2)

    def list_directory(self, path: str | None, mode: str) -> dict[str, Any]:
        if mode not in {"source", "export_directory"}:
            raise MediaBrowserError("Browser mode must be source or export_directory.")
        requested = Path(path).expanduser() if path else self._default_directory(mode)
        try:
            current = requested.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise MediaBrowserError(f"Folder is not available: {requested}") from exc
        if not current.is_dir():
            raise MediaBrowserError(f"Not a folder: {current}")
        try:
            entries = [self._entry(child) for child in current.iterdir()]
        except OSError as exc:
            raise MediaBrowserError(f"Could not read folder: {current}") from exc
        entries.sort(key=lambda item: (item["kind"] != "directory", str(item["name"]).casefold()))
        return {
            "mode": mode,
            "current": str(current),
            "parent": None if current.parent == current else str(current.parent),
            "places": self.places(),
            "favorites": self.favorites(),
            "entries": entries,
        }

    def places(self) -> list[dict[str, Any]]:
        home = Path.home()
        candidates = [
            ("Home", home),
            ("Pictures", home / "Pictures"),
            ("Documents", home / "Documents"),
            ("Desktop", home / "Desktop"),
            ("Exports", EXPORTS_DIR),
        ]
        seen: set[str] = set()
        places: list[dict[str, Any]] = []
        for name, path in candidates:
            resolved = str(path.expanduser().resolve(strict=False))
            if resolved in seen:
                continue
            seen.add(resolved)
            places.append({"name": name, "path": resolved, "available": path.is_dir()})
        return places

    def favorites(self) -> list[dict[str, Any]]:
        with self._lock:
            values = self._read_favorites()
        return [
            {"name": Path(value).name or value, "path": value, "available": Path(value).is_dir()}
            for value in values
        ]

    def add_favorite(self, value: str) -> list[dict[str, Any]]:
        resolved = Path(value).expanduser().resolve(strict=False)
        if not resolved.is_dir():
            raise MediaBrowserError(f"Favorite folder is not available: {resolved}")
        normalized = str(resolved)
        with self._lock:
            values = self._read_favorites()
            if normalized not in values:
                values.append(normalized)
                self._write_favorites(values)
        return self.favorites()

    def remove_favorite(self, value: str) -> list[dict[str, Any]]:
        normalized = str(Path(value).expanduser().resolve(strict=False))
        with self._lock:
            values = [item for item in self._read_favorites() if item != normalized]
            self._write_favorites(values)
        return self.favorites()

    def thumbnail(self, value: str, size: int = 256) -> Path:
        path = Path(value).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
            raise MediaBrowserError("Select a supported image file for a thumbnail.")
        edge = max(64, min(int(size), 512))
        stat = path.stat()
        key = hashlib.sha256(f"{path}\0{stat.st_size}\0{stat.st_mtime_ns}\0{edge}".encode()).hexdigest()
        self.thumbnail_root.mkdir(parents=True, exist_ok=True)
        output = self.thumbnail_root / f"{key}.jpg"
        if output.is_file():
            return output
        with self.decode_slot():
            if output.is_file():
                return output
            image = _read_thumbnail_source(path)
            _write_thumbnail(output, image, edge)
            self._prune_thumbnails(512)
        return output

    @contextmanager
    def decode_slot(self):
        """Share the two expensive decode slots with staged full imports."""
        with self._decode_slots:
            yield

    def _default_directory(self, mode: str) -> Path:
        if mode == "export_directory":
            EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
            return EXPORTS_DIR
        pictures = Path.home() / "Pictures"
        return pictures if pictures.is_dir() else Path.home()

    @staticmethod
    def _entry(path: Path) -> dict[str, Any]:
        try:
            stat = path.stat()
        except OSError:
            stat = None
        kind = "directory" if path.is_dir() else "file"
        suffix = path.suffix.lower() if kind == "file" else ""
        return {
            "name": path.name,
            "path": str(path.resolve(strict=False)),
            "kind": kind,
            "supported": kind == "directory" or suffix in SOURCE_EXTENSIONS,
            "format": suffix.removeprefix(".") or None,
            "size": int(stat.st_size) if stat is not None and kind == "file" else None,
            "modified_ns": int(stat.st_mtime_ns) if stat is not None else None,
            "thumbnail_key": (
                hashlib.sha256(f"{path.resolve(strict=False)}\0{stat.st_size}\0{stat.st_mtime_ns}".encode()).hexdigest()
                if stat is not None and kind == "file" and suffix in SOURCE_EXTENSIONS
                else None
            ),
        }

    def _read_favorites(self) -> list[str]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(item for item in value if isinstance(item, str) and item))

    def _write_favorites(self, values: list[str]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.path)

    def _prune_thumbnails(self, maximum: int) -> None:
        files = sorted(self.thumbnail_root.glob("*.jpg"), key=lambda item: item.stat().st_mtime_ns, reverse=True)
        for stale in files[maximum:]:
            try:
                stale.unlink()
            except OSError:
                pass


def _read_thumbnail_source(path: Path) -> np.ndarray:
    suffix = path.suffix.lower()
    if suffix in RAW_EXTENSIONS:
        try:
            import rawpy

            with rawpy.imread(str(path)) as raw:
                thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                from io import BytesIO
                from PIL import Image

                with Image.open(BytesIO(thumb.data)) as image:
                    return np.asarray(image.convert("RGB"))
            return np.asarray(thumb.data)
        except Exception:
            pass
    if suffix == ".jxl":
        image, _metadata = decode_jpegxl(path)
        return _acescg_thumbnail(image)
    if suffix == ".avif":
        try:
            import imagecodecs

            return np.asarray(imagecodecs.avif_decode(path.read_bytes()))
        except Exception:
            pass
    try:
        from PIL import Image, ImageOps

        with Image.open(path) as source:
            return np.asarray(ImageOps.exif_transpose(source).convert("RGB"))
    except Exception:
        from .loader import load_image

        image, *_rest = load_image(path)
        return _acescg_thumbnail(image)


def _acescg_thumbnail(image: np.ndarray) -> np.ndarray:
    linear = np.clip(acescg_to_linear_srgb(image[..., :3]), 0.0, None)
    display = linear / (1.0 + linear)
    srgb = np.where(display <= 0.0031308, display * 12.92, 1.055 * np.power(display, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 255.0), 0, 255).astype(np.uint8)


def _write_thumbnail(path: Path, image: np.ndarray, edge: int) -> None:
    from PIL import Image, ImageOps

    array = np.asarray(image)
    if array.dtype != np.uint8:
        if np.issubdtype(array.dtype, np.integer):
            array = np.clip(np.round(array.astype(np.float32) / np.iinfo(array.dtype).max * 255.0), 0, 255).astype(np.uint8)
        else:
            array = np.clip(np.round(array.astype(np.float32) * 255.0), 0, 255).astype(np.uint8)
    source = Image.fromarray(array[..., :3]).convert("RGB")
    source.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (edge, edge), (24, 27, 28))
    fitted = ImageOps.contain(source, (edge, edge), Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((edge - fitted.width) // 2, (edge - fitted.height) // 2))
    temporary: Path | None = None
    try:
        with NamedTemporaryFile(prefix=f".{path.stem}.", suffix=".tmp.jpg", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
        canvas.save(temporary, format="JPEG", quality=82, optimize=True)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass
