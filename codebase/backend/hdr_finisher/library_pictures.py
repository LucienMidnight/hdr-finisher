"""Disposable Library pictures; RAW thumbnails share Grade's source decode."""
from __future__ import annotations

from collections import OrderedDict
import base64
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
from .import_defaults import calibrate_camera_raw, starting_adjustments
from .library_diagnostics import audited, problem, log
from .analysis import classify_hdr
from .color import display_referred_sdr, map_negative_acescg, normalize_to_acescg, sdr_file_renditions
from .desktop_security import SOURCE_EXTENSIONS
from .models import AdjustmentState
from .render_cache import encode_rgba_proxy_rows

SIDECAR_SUFFIX = ".hdrf"
PICTURE_VERSION = "library-scene-gpu-document-v6"
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


def default_document_key(path):
    # One per photo version, whatever thumbnail size developed it.
    return picture_key(path, 0, "default-document")


class LibraryPictureCache:
    def __init__(self, root):
        from .library_cache import LibraryCache
        self.managed = LibraryCache(root)
        self.transient = OrderedDict()
        self.transient_lock = RLock()
        self._native_lock = RLock()
        self._native_source = None
        self._native_paused = False

    def accept_transient(self, result):
        body = result.pop('_transient', None)
        if body:
            with self.transient_lock:
                self.transient[result['key']] = base64.b64decode(body)
                self.transient.move_to_end(result['key'])
                while sum(map(len, self.transient.values())) > 256 * 1024**2:
                    self.transient.popitem(last=False)
        return result

    def transient_result(self, key, arrays, metadata):
        stream = BytesIO()
        np.savez(stream, **arrays)
        result = metadata | {'key': key, 'cache_hit': False, 'stored_bytes': 0,
            '_transient': base64.b64encode(stream.getvalue()).decode()}
        # Also retain it in this helper for repeat requests; transport stays in RAM.
        self.accept_transient(dict(result))
        return result

    def open(self, key, file=None):
        with self.transient_lock:
            body = self.transient.get(key)
            if body is not None:
                self.transient.move_to_end(key)
                return BytesIO(body)
        return file or self.file(key)

    @property
    def root(self):
        return self.managed.directory("library-pictures")

    @property
    def full_root(self):
        return self.managed.directory("library-full-pictures")

    def file(self, key):
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("Invalid library picture key.")
        large = self.full_root / (key + ".npz")
        return large if large.is_file() else self.root / (key + ".npz")

    def default_document(self, path):
        """Grade's starting document kept by a thumbnail development, if the photo is unchanged."""
        try:
            return json.loads((self.root / (default_document_key(path) + ".json")).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def keep_default_document(self, path, document):
        if not self.managed.preferences()['enabled']:
            return
        self.managed.prepare()
        destination = self.root / (default_document_key(path) + ".json")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent, suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(document, handle)
            os.replace(temporary, destination)
            self.managed.record(destination)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

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
            self.managed.record(destination)
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
            default_document = metadata.pop("default_document", None)
            if default_document is not None:
                self.keep_default_document(path, default_document)
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
            if not self.managed.preferences()['enabled']:
                return self.transient_result(key, arrays, metadata)
            self.managed.prepare()
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
                self.managed.record(destination)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            result = metadata | {"key": key, "cache_hit": False, "stored_bytes": destination.stat().st_size}
            with _TRIM_LOCK:
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
                starting_look = metadata.pop("starting_look", None)
                grade = AdjustmentState.model_validate(starting_look) if starting_look else default_look(
                    pixels, reference, metadata.pop("raw_input", False), path.suffix.lower())
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
        with np.load(self.open(key, path), allow_pickle=False) as stored:
            reference = lane == "sdr" and "reference" in stored
            pixels = stored["reference" if reference else "pixels"].astype(np.float32)
        if path.exists(): os.utime(path, None)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        return body, pixels.shape[1], pixels.shape[0], stride, "linear-srgb" if reference else "acescg"

    @audited("cache_trim")
    def trim(self):
        self.managed.trim_soon()


def default_look(pixels, reference, raw_input, suffix):
    sample = pixels[::max(1, int(np.ceil(max(pixels.shape[:2]) / 256)))].copy()
    analysis = classify_hdr(sample, {}, suffix)
    grade = starting_adjustments(analysis, reference)
    if not raw_input and reference is None:
        # Preserve existing non-camera starts; camera RAW has no Library lift.
        grade.hdr.exposure += .25
        grade.sdr.exposure += .25
    return grade


def check_cancelled(cancelled):
    if cancelled and cancelled():
        raise CancelledError("Library picture was cancelled.")


def camera_preview(path, edge):
    """Extract the camera JPEG without unpacking or demosaicing the RAW."""
    import base64
    import rawpy
    started = perf_counter()
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        thumb = raw.extract_thumb()
        image = Image.open(BytesIO(thumb.data)) if thumb.format == rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((edge, edge))
        output = BytesIO()
        image.save(output, format="JPEG", quality=90)
    log("camera_preview_ready", path=str(path), duration_ms=(perf_counter()-started)*1000)
    return {"route": "camera-preview-placeholder", "url": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode(),
        "width": image.width, "height": image.height, "edge": edge, "kept": False}


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
        if quality == "grade-thumbnail":
            # Grade's own import, so the starting document paste needs is kept too.
            from .sessions import SessionStore
            session = SessionStore().prepare_session(Path(path), owns_source_path=False)
            pixels, reference = session.image, session.sdr_reference_image
            return reduce_picture(pixels, edge), reduce_picture(reference, edge) if reference is not None else None, {
                "route": "grade-raw-thumbnail", "raw_input": True,
                "starting_look": session.starting_adjustments().model_dump(mode="json"),
                "default_document": session.edit_document().model_dump(mode="json"),
                "raw_start_brightness": session.metadata.get("raw_start_brightness"),
                "source_width": pixels.shape[1], "source_height": pixels.shape[0]}
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
            if suffix == ".dng":
                pixels *= np.float32(2.0 ** float(inspection.metadata.get("baseline_exposure", 0.0)))
            brightness = calibrate_camera_raw(pixels, path)
            log("picture_source_reduced", path=str(path), duration_ms=(perf_counter()-reduce_started)*1000)
            return pixels, None, {"route": "native-raw" if quality == "native" else "quick-half-raw", "raw_input": True, "raw_start_brightness": brightness,
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
    elif space is not None and display_referred_sdr(space, transfer, suffix):
        # The same start as Grade's import: the file is the SDR rendition.
        pixels, reference = sdr_file_renditions(pixels)
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
    grade = default_look(working, None, False, ".dng")
    exposure = loader._linear_dng_library_exposure_ev(working[::max(1, int(np.ceil(max(working.shape[:2]) / 256)))].copy())
    grade.hdr.exposure += exposure
    grade.sdr.exposure += exposure
    return working, None, {"route": "quick-linear-dng", "starting_look": grade.model_dump(mode="json"), "source_width": source_width, "source_height": source_height}
