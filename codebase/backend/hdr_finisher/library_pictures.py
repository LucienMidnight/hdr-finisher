"""Disposable scene-linear library pictures. No Grade import/correction route."""
from __future__ import annotations

from concurrent.futures import CancelledError
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from time import perf_counter

import numpy as np
from PIL import Image, ImageCms, ImageOps

from . import loader, raw_import
from .library_diagnostics import audited, problem, log
from .analysis import classify_hdr
from .color import map_negative_acescg, normalize_to_acescg
from .desktop_security import SOURCE_EXTENSIONS
from .models import AdjustmentState
from .render_cache import encode_rgba_proxy_rows

SIDECAR_SUFFIX = ".hdrf"
PICTURE_VERSION = "library-scene-v2"
CACHE_LIMIT_BYTES = 2 * 1024**3
_CACHE_LOCKS = [RLock() for _ in range(64)]
_TRIM_LOCK = RLock()


def reduce_picture(image, edge):
    h, w = image.shape[:2]
    if max(h, w) <= edge:
        return np.asarray(image, dtype=np.float32)
    scale = edge / max(h, w)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    return np.stack([np.asarray(Image.fromarray(image[:, :, c].astype(np.float32)).resize(
        size, Image.Resampling.BILINEAR)) for c in range(3)], axis=2)


def picture_key(path, edge, quality):
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    return sha256(f"{PICTURE_VERSION}:{path}:{stat.st_mtime_ns}:{stat.st_size}:{edge}:{quality}".encode()).hexdigest()


class LibraryPictureCache:
    def __init__(self, root, limit=CACHE_LIMIT_BYTES):
        self.root = Path(root) / "library-pictures"
        self.full_root = Path(root) / "library-full-pictures"
        self.limit = limit
        self._known_bytes = None
        self._native_lock = RLock()
        self._native_source = None
        self._native_paused = False

    def file(self, key):
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("Invalid library picture key.")
        large = self.full_root / (key + ".npz")
        return large if large.is_file() else self.root / (key + ".npz")

    @audited("cache_cached")
    def cached(self, path, edge, quality):
        # "fast" asks for a stand-in only until the real picture exists. Once it
        # is cached, the stand-in would just show first and then be swapped.
        if quality == "fast":
            real = self.cached(path, edge, "quick")
            if real:
                return real
        key = picture_key(path, edge, quality)
        destination = self.full_root / (key + ".npz") if edge >= 1280 else self.file(key)
        if not destination.is_file():
            return None
        try:
            with np.load(destination, allow_pickle=False) as stored:
                result = json.loads(str(stored["metadata"]))
            os.utime(destination, None)
            return result | {"key": key, "cache_hit": True, "stored_bytes": destination.stat().st_size}
        except (OSError, ValueError, EOFError) as error:
            problem("cache_corrupt", destination, error, "damaged entry removed; picture rebuilt")
            destination.unlink(missing_ok=True)
            return None

    @audited("cache_build")
    def build(self, path, edge, quality="quick", cancelled=None, decoded=None):
        path = Path(path).resolve(strict=True)
        if path.suffix.lower() not in SOURCE_EXTENSIONS:
            raise ValueError("Unsupported library file type.")
        key = picture_key(path, edge, quality)
        browsing = path.suffix.lower() not in raw_import.RAW_EXTENSIONS and quality in {"quick", "fast"}
        lock_key = sha256(str(path).encode()).hexdigest() if browsing else key
        with _CACHE_LOCKS[int(lock_key[:2], 16) % len(_CACHE_LOCKS)]:
            cached = self.cached(path, edge, quality)
            if cached:
                return cached
            started = perf_counter()
            check_cancelled(cancelled)
            # Once a non-RAW browse decode starts, finish and store it even if
            # its original viewer has gone away. Queued work can still cancel.
            if browsing:
                cancelled = None
            decode_started = perf_counter()
            pixels, reference, metadata = decoded if decoded is not None else decode_picture(path, edge, quality)
            log("picture_decoded", path=str(path), key=key, duration_ms=(perf_counter()-decode_started)*1000)
            check_cancelled(cancelled)
            # A file changed during decoding must never publish under the old identity.
            if picture_key(path, edge, quality) != key:
                raise ValueError("Photo changed while its library picture was being read.")
            look_started = perf_counter()
            starting_look = metadata.pop("starting_look", None)
            grade = AdjustmentState.model_validate(starting_look) if starting_look else default_look(
                pixels, reference, metadata.pop("raw_input", False), path.suffix.lower())
            metadata.update(path=str(path), width=pixels.shape[1], height=pixels.shape[0],
                edge=edge, quality=quality, adjustments=grade.model_dump(mode="json"),
                white=203, has_reference=reference is not None,
                decode_ms=(perf_counter() - started) * 1000)
            log("picture_look_prepared", path=str(path), key=key, duration_ms=(perf_counter()-look_started)*1000)
            store_started = perf_counter()
            arrays = {"pixels": np.clip(pixels, 0, 65504).astype(np.float16),
                "metadata": np.asarray(json.dumps(metadata))}
            if reference is not None:
                arrays["reference"] = np.clip(reference, 0, 65504).astype(np.float16)
            destination = self.full_root / (key + ".npz") if edge >= 1280 else self.file(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with NamedTemporaryFile(dir=destination.parent, suffix=".tmp", delete=False) as handle:
                    temporary = Path(handle.name)
                    # Large browsing previews must not wait on deflate compression.
                    save = np.savez if edge >= 1280 else np.savez_compressed
                    save(handle, **arrays)
                check_cancelled(cancelled)
                os.replace(temporary, destination)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            result = metadata | {"key": key, "cache_hit": False, "stored_bytes": destination.stat().st_size}
            with _TRIM_LOCK:
                if self._known_bytes is not None:
                    self._known_bytes += result["stored_bytes"]
                self.trim()
            log("picture_stored", path=str(path), key=key, duration_ms=(perf_counter()-store_started)*1000)
            return result

    @audited("cache_build_native")
    def build_native(self, path, center_x, center_y, width, height, cancelled=None):
        """One retained native source in the helper; only viewport crops reach the GPU."""
        path = Path(path).resolve(strict=True)
        quality = f"native:{center_x:.8f}:{center_y:.8f}:{width}:{height}"
        edge = max(width, height)
        with self._native_lock:
            check_cancelled(cancelled)
            cached = self.cached(path, edge, quality)
            if cached:
                return cached
            identity = picture_key(path, 100000, "native")
            source = self._native_source
            if source is None or source[0] != identity:
                self._native_source = None
                pixels, reference, metadata = decode_picture(path, 100000, "native")
                check_cancelled(cancelled)
                if picture_key(path, 100000, "native") != identity:
                    raise ValueError("Photo changed while its native picture was being read.")
                grade = default_look(pixels, reference, metadata.pop("raw_input", False), path.suffix.lower())
                source = (identity, pixels, reference, metadata, grade.model_dump(mode="json"))
                if not self._native_paused:
                    self._native_source = source
            _, pixels, reference, metadata, grade = source
            source_height, source_width = pixels.shape[:2]
            width, height = min(width, source_width), min(height, source_height)
            x = max(0, min(source_width - width, round(center_x * source_width - width / 2)))
            y = max(0, min(source_height - height, round(center_y * source_height - height / 2)))
            crop = pixels[y:y + height, x:x + width]
            ref = reference[y:y + height, x:x + width] if reference is not None else None
            facts = dict(metadata, route="native-" + metadata["route"], source_width=source_width,
                source_height=source_height, crop_x=x, crop_y=y, starting_look=grade)
            return self.build(path, edge, quality, cancelled, (crop, ref, facts))

    def pause_native(self, paused):
        self._native_paused = bool(paused)
        if paused:
            self._native_source = None

    @audited("cache_pixels")
    def pixels(self, key, lane="hdr"):
        path = self.file(key)
        with np.load(path, allow_pickle=False) as stored:
            reference = lane == "sdr" and "reference" in stored
            pixels = stored["reference" if reference else "pixels"].astype(np.float32)
        os.utime(path, None)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        return body, pixels.shape[1], pixels.shape[0], stride, "linear-srgb" if reference else "acescg"

    @audited("cache_trim")
    def trim(self):
        self._trim_directory(self.full_root)
        # Saved grades cost a render to remake. Disposable grid/full pictures
        # have separate allowances and can never evict their gain-map files.
        self._trim_directory(self.root, {".npz"})
        self._trim_directory(self.root, {".jpg", ".avif", ".json"})

    def _trim_directory(self, directory, extensions=None):
        # One eviction batch only on overflow, keeping a 10% gap below the limit.
        with _TRIM_LOCK:
            entries = []
            from .library_kept import preferences
            if (self.root.parent / "library-picture-preferences.json").exists():
                self.limit = preferences(self.root.parent)["limit_bytes"]
            for path in directory.glob("*"):
                if path.suffix not in (extensions or {".npz", ".jpg", ".avif", ".json"}): continue
                try:
                    stat = path.stat()
                    entries.append((stat.st_mtime_ns, stat.st_size, path))
                except FileNotFoundError as error:
                    problem("cache_trim_missing", path, error, "entry already removed; continue eviction")
                    continue
            total = sum(size for _, size, _ in entries)
            self._known_bytes = total
            if total <= self.limit:
                return
            for _, size, path in sorted(entries, key=lambda entry: (0 if entry[2].name.endswith(".map.npz") else 1 if entry[2].suffix == ".npz" else 2, entry[0])):
                if total <= self.limit * .9:
                    break
                try:
                    path.unlink()
                    total -= size
                    self._known_bytes = total
                except FileNotFoundError as error:
                    problem("cache_trim_missing", path, error, "entry already removed; continue eviction")


def default_look(pixels, reference, raw_input, suffix):
    sample = pixels[::max(1, int(np.ceil(max(pixels.shape[:2]) / 256)))].copy()
    exposure = loader._recommended_raw_exposure_ev(sample) if raw_input else 0.
    analysis = classify_hdr(sample, {}, suffix)
    grade = AdjustmentState()
    grade.hdr.exposure = exposure
    grade.sdr.exposure = exposure
    if reference is not None:
        grade.sdr.highlight_section_enabled = False
    from .sessions import LoadedSession
    from types import SimpleNamespace
    proxy = SimpleNamespace(analysis=analysis, sdr_reference_image=reference,
        hdr_reference_white_nits=203, adjustments=grade)
    LoadedSession._sync_highlight_source_peaks(proxy)
    grade.hdr.exposure += .25
    grade.sdr.exposure += .25
    return grade


def check_cancelled(cancelled):
    if cancelled and cancelled():
        raise CancelledError("Library picture was cancelled.")


def embedded_picture(path, edge):
    import rawpy
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        thumb = raw.extract_thumb()
        image = Image.open(BytesIO(thumb.data)) if thumb.format == rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((edge, edge))
        return np.asarray(image, dtype=np.float32) / 255


def reduced_bitmap(path, edge):
    with Image.open(path) as source:
        profile = source.info.get("icc_profile")
        source.draft("RGB", (edge, edge))
        image = ImageOps.exif_transpose(source)
        image.thumbnail((edge, edge))
        if profile:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB")
        return np.asarray(image.convert("RGB"), dtype=np.float32) / 255


def decode_picture(path, edge, quality):
    suffix = path.suffix.lower()
    if suffix in raw_import.RAW_EXTENSIONS:
        if quality == "fast":
            try:
                pixels = embedded_picture(path, edge)
                return normalize_to_acescg(pixels, "sRGB", "sRGB"), None, {"route": "embedded-placeholder"}
            except Exception as error:
                problem("picture_embedded_fallback", path, error, "generic quick decode used")
                pass  # No embedded picture: the generic quick decode remains available.
        if suffix == ".dng":
            from .linear_dng import inspect_dng, DngRoute
            inspection = inspect_dng(path)
            if inspection.route == DngRoute.LINEAR_DNG:
                return linear_dng_picture(path, inspection, edge)
            if inspection.route != DngRoute.MOSAICED_RAW_DNG:
                raise ValueError("This DNG cannot be read by Grade.")
        import_started = perf_counter()
        import rawpy
        log("picture_decoder_import", path=str(path), duration_ms=(perf_counter()-import_started)*1000)
        raw_started = perf_counter()
        with rawpy.imread(str(path)) as raw:
            try:
                meta = raw_import._camera_linear_metadata_from_libraw(raw)
            except raw_import._CameraLinearUnsupported as error:
                problem("picture_camera_fallback", path, error, "existing sRGB quick decode used")
                meta = None
            transport = raw.postprocess(half_size=quality != "native", demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR,
                use_camera_wb=meta is None, use_auto_wb=False,
                **({"user_wb": [1.] * 4, "no_auto_scale": True} if meta else {}),
                no_auto_bright=True, output_color=rawpy.ColorSpace.raw if meta else rawpy.ColorSpace.sRGB,
                gamma=(1., 1.), output_bps=16, highlight_mode=rawpy.HighlightMode.Clip)
            log("picture_raw_processed", path=str(path), duration_ms=(perf_counter()-raw_started)*1000)
            reduce_started = perf_counter()
            pixels = reduce_picture(transport, edge) * np.float32(1 / 65535)
            if meta:
                matrix = meta.camera_to_acescg * (meta.as_shot_wb * 65535 / (meta.white_level - meta.black_level))[None, :]
                clipped = np.any(pixels >= (meta.white_level - meta.black_level) / 65535 * .999, axis=2)
                pixels = map_negative_acescg(pixels @ matrix.T)
            else:
                clipped = np.any(pixels >= .999, axis=2)
                pixels = normalize_to_acescg(pixels, "sRGB", "LINEAR")
            # Source saturation, before display tone mapping: neutral white, no reconstruction.
            pixels[clipped] = np.max(pixels[clipped], axis=1)[:, None]
            log("picture_source_reduced", path=str(path), duration_ms=(perf_counter()-reduce_started)*1000)
            return pixels, None, {"route": "native-raw" if quality == "native" else "quick-half-raw", "raw_input": True,
                "source_width": transport.shape[1] * (1 if quality == "native" else 2), "source_height": transport.shape[0] * (1 if quality == "native" else 2)}
    if quality == "fast" and suffix in {".heic", ".heif", ".tif", ".tiff"}:
        # Only accept a real decoder-supported picture, never reinterpret arbitrary bytes.
        try:
            pixels = reduced_bitmap(path, edge)
            return normalize_to_acescg(pixels, "sRGB", "sRGB"), None, {"route": "bitmap-placeholder"}
        except Exception as error:
            problem("picture_bitmap_fallback", path, error, "existing full decode used")
    if suffix in {".jpg", ".jpeg"} and loader.is_ultrahdr_jpeg(path):
        image, reference, metadata = loader.decode_ultrahdr_jpeg(path)
        metadata["sdr_reference_image"] = reference
    elif suffix == ".avif":
        image, reference, metadata = loader.decode_avif(path)
        metadata["sdr_reference_image"] = reference
    elif suffix == ".jxl":
        image, metadata = loader.decode_jpegxl(path)
    elif suffix in {".heic", ".heif"}:
        image, metadata = loader._load_heif(path)
    elif suffix in {".tif", ".tiff"}:
        image, metadata = loader._load_tiff(path)
    elif suffix == ".exr":
        image, metadata = loader._load_exr(path)
    elif suffix in {".hdr", ".pfm"}:
        image, metadata = loader._load_hdr_like(path)
    else:
        image = reduced_bitmap(path, edge)
        with Image.open(path) as header:
            width, height = header.size
            if header.getexif().get(274) in {5, 6, 7, 8}:
                width, height = height, width
        metadata = {"color_space": "sRGB", "transfer_function": "sRGB", "source_width": width, "source_height": height}
    pixels = reduce_picture(image, edge)
    space = loader.detect_color_space(metadata, suffix)
    transfer = metadata.get("transfer_function") or loader.detect_transfer_function(metadata, suffix)
    if space is not None:
        pixels = normalize_to_acescg(pixels, space, transfer)
    reference = metadata.get("sdr_reference_image")
    if reference is not None:
        reference = reduce_picture(reference, edge)
    return pixels, reference, {"route": "quick-" + suffix[1:], "color_unconfirmed": space is None,
        "source_width": metadata.get("source_width", image.shape[1]), "source_height": metadata.get("source_height", image.shape[0])}


def linear_dng_picture(path, inspection, edge):
    # Separate plain linear decode. Deliberately no opcode or highlight-recovery call.
    import tifffile
    from .linear_dng import _normalize_layout, crop_and_orient, color_metadata_from_mapping
    from .dng_color import normalize_camera_samples, build_color_transform, transform_normalized_to_acescg_in_place
    with tifffile.TiffFile(path) as tif:
        series = tif.series[inspection.primary_series_index]
        decoded = _normalize_layout(series.asarray(), getattr(series, "axes", None))
    color = color_metadata_from_mapping(inspection.metadata)
    working = normalize_camera_samples(decoded, color)
    working = crop_and_orient(working, inspection.metadata)
    source_height, source_width = working.shape[:2]
    working = reduce_picture(working, edge)
    clipped = np.any(working >= .999, axis=2)
    transform_normalized_to_acescg_in_place(working, build_color_transform(color),
        color.baseline_exposure, highlight_recovery_limit=None)
    working[clipped] = np.max(working[clipped], axis=1)[:, None]
    return working, None, {"route": "quick-linear-dng", "raw_input": True, "source_width": source_width, "source_height": source_height}
