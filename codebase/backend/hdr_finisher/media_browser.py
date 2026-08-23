from __future__ import annotations

import hashlib
import ctypes
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import BoundedSemaphore, RLock
from tempfile import NamedTemporaryFile
from typing import Any

import numpy as np

from .color import acescg_to_linear_srgb
from .config import APP_DATA_DIR, EXPORTS_DIR
from .desktop_security import SOURCE_EXTENSIONS
from .preview import downsample_image
from .raw_import import RAW_EXTENSIONS


FAST_THUMBNAIL_EXTENSIONS = RAW_EXTENSIONS | {".avif", ".png", ".jpg", ".jpeg", ".bmp"}


class MediaBrowserError(ValueError):
    pass


class MediaBrowserStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or APP_DATA_DIR).resolve()
        self.pinned_path = self.root / "pinned-folders.json"
        self.legacy_favorites_path = self.root / "favorite-folders.json"
        self.recents_path = self.root / "recent-folders.json"
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
            "drives": self.drives(),
            "locations": self.locations(),
            "pinned": self.pinned(),
            "recents": self.recents(),
            "entries": entries,
        }

    def drives(self) -> list[dict[str, Any]]:
        drives = []
        for path in _connected_roots():
            label = path.name or path.drive or str(path)
            try:
                available = path.is_dir()
            except OSError:
                available = False
            drives.append({"name": label, "path": str(path), "available": available})
        return drives

    def locations(self) -> list[dict[str, Any]]:
        home = Path.home()
        candidates = [
            ("Pictures", home / "Pictures"),
            ("Downloads", home / "Downloads"),
            ("Desktop", home / "Desktop"),
            ("Documents", home / "Documents"),
            ("Home", home),
            ("Exports", EXPORTS_DIR),
        ]
        if sys.platform == "darwin":
            candidates[4:4] = [
                ("iCloud Drive", home / "Library" / "Mobile Documents" / "com~apple~CloudDocs"),
                ("Applications", Path("/Applications")),
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

    def pinned(self) -> list[dict[str, Any]]:
        with self._lock:
            values = self._read_paths(self.pinned_path)
            if not values and not self.pinned_path.exists():
                values = self._read_paths(self.legacy_favorites_path)
        return [
            {"name": Path(value).name or value, "path": value, "available": Path(value).is_dir()}
            for value in values
        ]

    def add_pin(self, value: str) -> list[dict[str, Any]]:
        resolved = Path(value).expanduser().resolve(strict=False)
        if not resolved.is_dir():
            raise MediaBrowserError(f"Pinned folder is not available: {resolved}")
        normalized = str(resolved)
        with self._lock:
            values = self._read_paths(self.pinned_path)
            if not values and not self.pinned_path.exists():
                values = self._read_paths(self.legacy_favorites_path)
            if normalized not in values:
                values.append(normalized)
                self._write_paths(self.pinned_path, values)
        return self.pinned()

    def remove_pin(self, value: str) -> list[dict[str, Any]]:
        normalized = str(Path(value).expanduser().resolve(strict=False))
        with self._lock:
            values = [item for item in self._read_paths(self.pinned_path) if item != normalized]
            if not self.pinned_path.exists():
                values = [item for item in self._read_paths(self.legacy_favorites_path) if item != normalized]
            self._write_paths(self.pinned_path, values)
        return self.pinned()

    def recents(self) -> list[dict[str, Any]]:
        with self._lock:
            values = self._read_paths(self.recents_path)[:3]
        return [
            {"name": Path(value).name or value, "path": value, "available": Path(value).is_dir()}
            for value in values
        ]

    def record_import(self, value: str) -> list[dict[str, Any]]:
        try:
            source = Path(value).expanduser().resolve(strict=True)
        except OSError as exc:
            raise MediaBrowserError(f"Imported source is not available: {value}") from exc
        if not source.is_file() or source.suffix.lower() not in SOURCE_EXTENSIONS:
            raise MediaBrowserError(f"Imported source is not a supported image: {source}")
        self._record_recent(source.parent)
        return self.recents()

    # Compatibility aliases preserve existing local clients while the UI and
    # persisted terminology migrate from Favorites to Pinned.
    def favorites(self) -> list[dict[str, Any]]:
        return self.pinned()

    def add_favorite(self, value: str) -> list[dict[str, Any]]:
        return self.add_pin(value)

    def remove_favorite(self, value: str) -> list[dict[str, Any]]:
        return self.remove_pin(value)

    def thumbnail(self, value: str, size: int = 256, *, fast_only: bool = False) -> Path:
        path = Path(value).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
            raise MediaBrowserError("Select a supported image file for a thumbnail.")
        if fast_only and path.suffix.lower() not in FAST_THUMBNAIL_EXTENSIONS:
            raise MediaBrowserError("This format has no cheap staged-preview path.")
        edge = max(64, min(int(size), 512))
        stat = path.stat()
        variant = "fast" if fast_only else "full"
        key = hashlib.sha256(
            f"natural-aspect-v2\0{path}\0{stat.st_size}\0{stat.st_mtime_ns}\0{edge}\0{variant}".encode()
        ).hexdigest()
        self.thumbnail_root.mkdir(parents=True, exist_ok=True)
        output = self.thumbnail_root / f"{key}.jpg"
        if output.is_file():
            return output
        with self.decode_slot():
            if output.is_file():
                return output
            image = _read_thumbnail_source(path, edge, fast_only=fast_only)
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
        birthtime = getattr(stat, "st_birthtime", None) if stat is not None else None
        date_added_ms = (
            int(float(birthtime) * 1000.0)
            if birthtime is not None
            else int(stat.st_ctime_ns // 1_000_000) if stat is not None else None
        )
        return {
            "name": path.name,
            "path": str(path.resolve(strict=False)),
            "kind": kind,
            "supported": kind == "directory" or suffix in SOURCE_EXTENSIONS,
            "format": suffix.removeprefix(".") or None,
            "kind_label": _kind_label(kind, suffix),
            "size": int(stat.st_size) if stat is not None and kind == "file" else None,
            "date_added_ms": date_added_ms,
            "modified_ns": int(stat.st_mtime_ns) if stat is not None else None,
            "thumbnail_key": (
                hashlib.sha256(f"{path.resolve(strict=False)}\0{stat.st_size}\0{stat.st_mtime_ns}".encode()).hexdigest()
                if stat is not None and kind == "file" and suffix in SOURCE_EXTENSIONS
                else None
            ),
        }

    def _record_recent(self, path: Path) -> None:
        normalized = str(path.resolve(strict=False))
        with self._lock:
            values = [item for item in self._read_paths(self.recents_path) if item != normalized]
            self._write_paths(self.recents_path, [normalized, *values][:3])

    @staticmethod
    def _read_paths(path: Path) -> list[str]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(value, list):
            return []
        return list(dict.fromkeys(item for item in value if isinstance(item, str) and item))

    def _write_paths(self, path: Path, values: list[str]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)

    def _prune_thumbnails(self, maximum: int) -> None:
        files = sorted(self.thumbnail_root.glob("*.jpg"), key=lambda item: item.stat().st_mtime_ns, reverse=True)
        for stale in files[maximum:]:
            try:
                stale.unlink()
            except OSError:
                pass


def _connected_roots() -> list[Path]:
    if sys.platform == "darwin":
        volumes = Path("/Volumes")
        roots = [child for child in volumes.iterdir() if child.is_dir()] if volumes.is_dir() else []
        return roots or [Path("/")]
    if os.name != "nt":
        return [Path("/")]
    mask = _logical_drive_mask()
    roots = [
        Path(root)
        for index in range(26)
        if mask & (1 << index)
        and _is_volume_backed_windows_drive(root := f"{chr(ord('A') + index)}:\\")
    ]
    if roots:
        return roots
    anchor = Path.home().anchor
    return [Path(anchor)] if anchor else []


def _logical_drive_mask() -> int:
    try:
        return int(ctypes.windll.kernel32.GetLogicalDrives())
    except (AttributeError, OSError, ValueError):
        return 0


def _is_volume_backed_windows_drive(root: str) -> bool:
    """Keep the Drives rail aligned with Windows' local-volume presentation.

    GetLogicalDrives also reports assigned virtual and mapped drive letters.
    Require a real volume GUID and a local/removable media type so cloud drives,
    network mappings, and Shell namespaces do not masquerade as local volumes.
    """

    try:
        kernel32 = ctypes.windll.kernel32
        get_drive_type = kernel32.GetDriveTypeW
        get_drive_type.argtypes = [ctypes.c_wchar_p]
        get_drive_type.restype = ctypes.c_uint
        drive_type = int(get_drive_type(root))
        if drive_type not in {2, 3, 5, 6}:  # removable, fixed, optical, RAM disk
            return False
        if not _is_local_windows_device_target(drive_type, _windows_drive_device_target(root)):
            return False
        volume_name = ctypes.create_unicode_buffer(1024)
        get_volume_name = kernel32.GetVolumeNameForVolumeMountPointW
        get_volume_name.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
        get_volume_name.restype = ctypes.c_int
        return bool(get_volume_name(root, volume_name, len(volume_name)))
    except (AttributeError, OSError, TypeError, ValueError):
        return False


def _windows_drive_device_target(root: str) -> str:
    """Return the NT device behind a drive letter.

    Cloud filesystem clients can report DRIVE_FIXED and a volume GUID even when
    their drive letter is not backed by local media. QueryDosDevice exposes the
    distinction that the higher-level volume APIs hide.
    """

    kernel32 = ctypes.windll.kernel32
    query_device = kernel32.QueryDosDeviceW
    query_device.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    query_device.restype = ctypes.c_uint
    target = ctypes.create_unicode_buffer(4096)
    drive_name = root.rstrip("\\")
    return target.value if query_device(drive_name, target, len(target)) else ""


def _is_local_windows_device_target(drive_type: int, target: str) -> bool:
    normalized = target.casefold()
    allowed_prefixes = {
        2: (r"\device\harddiskvolume",),
        3: (r"\device\harddiskvolume",),
        5: (r"\device\cdrom",),
        6: (r"\device\ramdisk", r"\device\harddiskvolume"),
    }
    return bool(normalized) and normalized.startswith(allowed_prefixes.get(drive_type, ()))


def _read_thumbnail_source(
    path: Path, edge: int = 256, *, fast_only: bool = False
) -> np.ndarray:
    suffix = path.suffix.lower()
    if suffix in RAW_EXTENSIONS:
        try:
            import rawpy

            with rawpy.imread(str(path)) as raw:
                thumb = raw.extract_thumb()
                raw_flip = int(getattr(getattr(raw, "sizes", None), "flip", 0) or 0)
            if thumb.format == rawpy.ThumbFormat.JPEG:
                from io import BytesIO
                from PIL import Image, ImageOps

                with Image.open(BytesIO(thumb.data)) as image:
                    embedded_orientation = int(image.getexif().get(274, 1) or 1)
                    pixels = np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
                return pixels if embedded_orientation != 1 else _apply_libraw_orientation(pixels, raw_flip)
            return _apply_libraw_orientation(np.asarray(thumb.data), raw_flip)
        except Exception:
            if fast_only:
                return _neutral_thumbnail_placeholder()
    if suffix in {".png", ".jpg", ".jpeg", ".bmp"}:
        return _read_pillow_thumbnail(path, edge)
    if suffix == ".avif":
        from .gainmap_decoders import GainMapDecodeError, decode_avif_preview

        try:
            image = decode_avif_preview(path)
        except GainMapDecodeError:
            return _neutral_thumbnail_placeholder()
        return _acescg_thumbnail(downsample_image(image, max(edge * 2, edge)))
    from .loader import load_image

    image, _descriptor, metadata, analysis, _sdr = load_image(path)
    if metadata.get("needs_color_override") or analysis.needs_color_override:
        return _neutral_thumbnail_placeholder()
    return _acescg_thumbnail(downsample_image(image, max(edge * 2, edge)))


def _read_pillow_thumbnail(path: Path, edge: int) -> np.ndarray:
    from io import BytesIO
    from PIL import Image, ImageCms, ImageOps

    with Image.open(path) as source:
        oriented = ImageOps.exif_transpose(source)
        icc_profile = source.info.get("icc_profile")
        if icc_profile:
            try:
                oriented = ImageCms.profileToProfile(
                    oriented,
                    ImageCms.ImageCmsProfile(BytesIO(icc_profile)),
                    ImageCms.createProfile("sRGB"),
                    outputMode="RGB",
                )
            except Exception:
                return _neutral_thumbnail_placeholder()
        else:
            oriented = oriented.convert("RGB")
        oriented.thumbnail((max(64, edge), max(64, edge)), Image.Resampling.LANCZOS)
        return np.asarray(oriented.convert("RGB"))


def _acescg_thumbnail(image: np.ndarray) -> np.ndarray:
    linear = np.clip(acescg_to_linear_srgb(image[..., :3]), 0.0, None)
    display = linear / (1.0 + linear) if float(np.max(linear, initial=0.0)) > 1.0 else linear
    srgb = np.where(display <= 0.0031308, display * 12.92, 1.055 * np.power(display, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 255.0), 0, 255).astype(np.uint8)


def _neutral_thumbnail_placeholder() -> np.ndarray:
    y, x = np.indices((64, 64))
    checker = np.where(((x // 8) + (y // 8)) % 2 == 0, 50, 64).astype(np.uint8)
    return np.repeat(checker[..., None], 3, axis=2)


def _apply_libraw_orientation(image: np.ndarray, flip: int) -> np.ndarray:
    """Apply LibRaw's documented 0/3/5/6 orientation to an embedded preview."""
    if flip == 3:
        return np.rot90(image, k=2).copy()
    if flip == 5:
        return np.rot90(image, k=1).copy()
    if flip == 6:
        return np.rot90(image, k=3).copy()
    return image


def _kind_label(kind: str, suffix: str) -> str:
    if kind == "directory":
        return "Folder"
    labels = {
        ".arw": "Sony RAW image",
        ".cr2": "Canon RAW image",
        ".cr3": "Canon RAW image",
        ".dng": "Digital Negative",
        ".nef": "Nikon RAW image",
        ".raf": "Fujifilm RAW image",
        ".rw2": "Panasonic RAW image",
        ".orf": "OM System RAW image",
        ".ori": "OM System RAW image",
        ".pef": "Pentax RAW image",
        ".srw": "Samsung RAW image",
        ".exr": "OpenEXR image",
        ".hdr": "Radiance HDR image",
        ".pfm": "Portable float map",
        ".heic": "HEIC image",
        ".heif": "HEIF image",
        ".avif": "AVIF image",
        ".jxl": "JPEG XL image",
        ".jpg": "JPEG image",
        ".jpeg": "JPEG image",
        ".png": "PNG image",
        ".tif": "TIFF image",
        ".tiff": "TIFF image",
        ".xmp": "XMP sidecar",
    }
    return labels.get(suffix, f"{suffix.removeprefix('.').upper()} file" if suffix else "File")


def _write_thumbnail(path: Path, image: np.ndarray, edge: int) -> None:
    from PIL import Image

    array = np.asarray(image)
    if array.dtype != np.uint8:
        if np.issubdtype(array.dtype, np.integer):
            array = np.clip(np.round(array.astype(np.float32) / np.iinfo(array.dtype).max * 255.0), 0, 255).astype(np.uint8)
        else:
            array = np.clip(np.round(array.astype(np.float32) * 255.0), 0, 255).astype(np.uint8)
    source = Image.fromarray(array[..., :3]).convert("RGB")
    source.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    temporary: Path | None = None
    try:
        with NamedTemporaryFile(prefix=f".{path.stem}.", suffix=".tmp.jpg", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
        source.save(temporary, format="JPEG", quality=82, optimize=True)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass
