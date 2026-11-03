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
from threading import RLock, Timer
from time import perf_counter

import numpy as np
from PIL import Image, ImageCms, ImageOps

from . import loader, raw_import, app_memory
from .import_defaults import calibrate_camera_raw, starting_adjustments
from .library_diagnostics import audited, problem, log
from .analysis import classify_hdr
from .color import display_referred_sdr, map_negative_acescg, normalize_to_acescg, sdr_file_renditions
from .file_gate import SOURCE_EXTENSIONS, is_photo_name
from .models import AdjustmentState
from .projects import validate_saved
from .render_cache import encode_rgba_proxy_rows

SIDECAR_SUFFIX = ".hdrf"
PICTURE_VERSION = "library-scene-demand-v11"
CACHE_LIMIT_BYTES = 2 * 1024**3
_CACHE_LOCKS = [RLock() for _ in range(64)]
_TRIM_LOCK = RLock()


def reduce_picture(image, edge):
    h, w = image.shape[:2]
    if max(h, w) <= edge:
        return np.asarray(image, dtype=np.float32)
    scale = edge / max(h, w)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    def channel(index):
        return np.asarray(Image.fromarray(image[:, :, index].astype(np.float32)).resize(
            size, Image.Resampling.BILINEAR))
    # Each channel resizes independently to the same pixels; only their order
    # in time changes when a Library decode has the cores (cpu_budget).
    from .cpu_budget import parallel_bands
    return np.stack(list(parallel_bands(channel, range(image.shape[2]))), axis=2)


def picture_key(path, edge, quality):
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    return sha256(f"{PICTURE_VERSION}:{path}:{stat.st_mtime_ns}:{stat.st_size}:{edge}:{quality}".encode()).hexdigest()


def indexed_picture_key(path, edge, quality, stamp):
    """Same scene identity using facts already committed to the local index."""
    size, modified = stamp
    return sha256(f"{PICTURE_VERSION}:{path}:{modified}:{size}:{edge}:{quality}".encode()).hexdigest()


def default_document_key(path):
    # One per photo version, whatever thumbnail size developed it.
    return picture_key(path, 0, "default-document")


class LibraryPictureCache:
    def __init__(self, root):
        from .library_cache import LibraryCache
        self.managed = LibraryCache(root)
        self.transient = OrderedDict()
        self.transient_lock = RLock()
        self.memory_key='picture-handoff-'+str(id(self))
        app_memory.register(self.memory_key,'handoff',self.trim_memory)
        self.native_key='native-'+str(id(self))
        app_memory.register(self.native_key,'working',self.trim_native)
        self.pending_stores = {}
        self._native_lock = RLock()
        self._native_source = None
        self._native_upload = None
        self._native_upload_timer = None
        self._native_paused = False

    def _handoff_bytes(self):
        with self.transient_lock:
            return sum(map(len, self.transient.values()))

    def _report_handoff(self):
        app_memory.report(self.memory_key, 'handoff', self._handoff_bytes())

    def _evict_transient(self, key):
        # Readers retain the immutable body until disk publication completes.
        # Never do file/index/owner work under the transport bookkeeping lock.
        with self.transient_lock:
            pending = self.pending_stores.get(key)
            body = self.transient.get(key)
            if pending is None:
                self.transient.pop(key, None)
        if pending and body is not None:
            source, edge, quality, default, owner_check = pending
            if owner_check:
                owner_check()
            if picture_key(source, edge, quality) != key:
                raise ValueError("Photo changed before saving preview data.")
            self.managed.prepare()
            destination = self.full_root / (key + ".npz") if edge >= 1280 else self.file(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with NamedTemporaryFile(dir=destination.parent, suffix=".tmp", delete=False) as handle:
                    temporary = Path(handle.name)
                    handle.write(body)
                if owner_check:
                    owner_check()
                if picture_key(source, edge, quality) != key:
                    raise ValueError("Photo changed before saving preview data.")
                os.replace(temporary, destination)
                self.managed.record(destination)
                if default is not None:
                    self.keep_default_document(source, default)
                self.trim()
                with self.transient_lock:
                    if self.transient.get(key) is body and self.pending_stores.get(key) is pending:
                        self.transient.pop(key, None)
                        self.pending_stores.pop(key, None)
                log("picture_handoff_backed", path=source, key=key, edge=edge, reason="handoff RAM reclaimed before draw")
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
        self._report_handoff()

    def trim_memory(self, target):
        # Disposable/delivered copies go before any preview awaiting storage.
        with self.transient_lock:
            keys = sorted(self.transient, key=lambda key: key in self.pending_stores)
        for key in keys:
            if self._handoff_bytes() <= target:
                break
            self._evict_transient(key)
        self._report_handoff()

    def delivered(self, key):
        with self.transient_lock:
            if key not in self.pending_stores:
                self.transient.pop(key, None)
        self._report_handoff()

    def accept_transient(self, result, pending=None):
        encoded = result.pop('_transient', None)
        if encoded:
            body = base64.b64decode(encoded)
            key = result['key']
            with self.transient_lock:
                if pending is not None:
                    self.pending_stores[key] = pending
                self.transient[key] = body
                self.transient.move_to_end(key)
                keys = sorted(self.transient, key=lambda item: item in self.pending_stores)
            for candidate in keys:
                if app_memory.claim(self.memory_key, 'handoff', self._handoff_bytes()):
                    break
                self._evict_transient(candidate)
            self._report_handoff()
        return result

    def transient_result(self, key, arrays, metadata, validate=None, pending=None):
        stream = BytesIO()
        np.savez(stream, **arrays)
        if validate:
            validate()
        result = metadata | {'key': key, 'cache_hit': False, 'stored_bytes': 0,
            '_transient': base64.b64encode(stream.getvalue()).decode()}
        self.accept_transient(dict(result), pending)
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
        if not destination.parent.is_dir():
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

    @audited("picture_cache_cached")
    def cached(self, path, edge, quality, *, stamp=None):
        # "fast" asks for a stand-in only until the real picture exists. Once it
        # is cached, the stand-in would just show first and then be swapped.
        if quality == "fast":
            real = self.cached(path, edge, "quick")
            if real:
                return real
        key = indexed_picture_key(path, edge, quality, stamp) if stamp is not None else picture_key(path, edge, quality)
        with self.transient_lock:
            body = self.transient.get(key)
        if body is not None:
            with np.load(BytesIO(body), allow_pickle=False) as stored:
                metadata = json.loads(str(stored["metadata"]))
            return metadata | {"key": key, "cache_hit": True, "stored_bytes": 0,
                "_transient": base64.b64encode(body).decode()}
        destination = self.full_root / (key + ".npz") if edge >= 1280 else self.file(key)
        if not destination.is_file() and quality.startswith("live-scene-v2:"):
            from .library_live import equivalent_qualities
            for equivalent in equivalent_qualities(quality):
                candidate_key = indexed_picture_key(path, edge, equivalent, stamp) if stamp is not None else picture_key(path, edge, equivalent)
                candidate = (self.full_root if edge >= 1280 else self.root) / (candidate_key + ".npz")
                if candidate.is_file():
                    key, destination = candidate_key, candidate
                    break
        if not destination.is_file():
            return None
        try:
            with np.load(destination, allow_pickle=False) as stored:
                result = json.loads(str(stored["metadata"]))
            os.utime(destination, None)
            self.managed.record(destination)
            return result | {"key": key, "quality": quality, "cache_hit": True, "stored_bytes": destination.stat().st_size}
        except (OSError, ValueError, EOFError) as error:
            problem("cache_corrupt", destination, error, "damaged entry removed; picture rebuilt")
            destination.unlink(missing_ok=True)
            self.managed.record(destination)
            return None

    @audited("picture_cache_build")
    def build(self, path, edge, quality="quick", cancelled=None, decoded=None, defer_store=False, persist=False, store_validate=None):
        path = Path(path).resolve(strict=True)
        if not is_photo_name(path.name):
            raise ValueError("Unsupported library file type.")
        key = picture_key(path, edge, quality)
        browsing = path.suffix.lower() not in raw_import.RAW_EXTENSIONS and quality in {"quick", "fast"}
        lock_key = sha256(str(path).encode()).hexdigest() if browsing else key
        with _CACHE_LOCKS[int(lock_key[:2], 16) % len(_CACHE_LOCKS)]:
            cached = None if persist else self.cached(path, edge, quality)
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
            log("picture_decoded", path=str(path), key=key, edge=edge, duration_ms=(perf_counter()-decode_started)*1000)
            check_cancelled(cancelled)
            # A file changed during decoding must never publish under the old identity.
            if picture_key(path, edge, quality) != key:
                raise ValueError("Photo changed while its library picture was being read.")
            default_document = metadata.pop("default_document", None)
            if default_document is not None and not defer_store:
                self.keep_default_document(path, default_document)
            look_started = perf_counter()
            starting_look = metadata.pop("starting_look", None)
            grade = validate_saved(AdjustmentState, starting_look) if starting_look else default_look(
                pixels, reference, metadata.pop("raw_input", False), path.suffix.lower())
            metadata.update(path=str(path), width=pixels.shape[1], height=pixels.shape[0],
                edge=edge, quality=quality, adjustments=grade.model_dump(mode="json"),
                white=203, has_reference=reference is not None,
                decode_ms=(perf_counter() - started) * 1000)
            log("picture_look_prepared", path=str(path), key=key, edge=edge, duration_ms=(perf_counter()-look_started)*1000)
            store_started = perf_counter()
            def half(values):
                # Keep the saved values identical without a full float32 clip copy.
                result = np.empty(values.shape, dtype=np.float16)
                for row in range(0, values.shape[0], 128):
                    result[row:row+128] = np.clip(values[row:row+128], 0, 65504).astype(np.float16)
                return result
            arrays = {"pixels": half(pixels),
                "metadata": np.asarray(json.dumps(metadata))}
            if reference is not None:
                arrays["reference"] = half(reference)
            if defer_store:
                # Publish validated half-float data in the existing bounded RAM
                # transport. Encoding to disk starts only after the first draw.
                def validate_memory():
                    check_cancelled(cancelled)
                    if picture_key(path, edge, quality) != key:
                        raise ValueError("Photo changed before publishing preview data.")
                pending = (str(path), edge, quality, default_document, store_validate)
                result = self.transient_result(key, arrays, metadata, validate_memory, pending)
                result.pop('_transient', None)
                return result
            destination = self.full_root / (key + ".npz") if edge >= 1280 else self.file(key)
            if not self.managed.preferences()['enabled']:
                return self.transient_result(key, arrays, metadata)
            self.managed.prepare()
            if not destination.parent.is_dir():
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
            log("picture_stored", path=str(path), key=key, edge=edge, duration_ms=(perf_counter()-store_started)*1000)
            return result

    def persist_pending(self, path, validate):
        with self.transient_lock:
            keys = [key for key, value in self.pending_stores.items() if value[0] == str(path)]
        for key in keys:
            with self.transient_lock:
                pending = self.pending_stores.get(key)
                body = self.transient.get(key)
            if pending is None or body is None:
                continue
            source, edge, quality, default, owner_check = pending
            def checkpoint():
                if owner_check:
                    owner_check()
                validate(quality)
                if picture_key(source, edge, quality) != key:
                    raise ValueError("Photo changed before saving preview data.")
                return False
            try:
                checkpoint()
                with np.load(BytesIO(body), allow_pickle=False) as stored:
                    pixels = stored["pixels"].astype(np.float32)
                    reference = stored["reference"].astype(np.float32) if "reference" in stored else None
                    metadata = json.loads(str(stored["metadata"]))
                metadata["starting_look"] = metadata["adjustments"]
                if default is not None:
                    metadata["default_document"] = default
                self.build(source, edge, quality, checkpoint, (pixels, reference, metadata), persist=True)
            finally:
                with self.transient_lock:
                    if self.pending_stores.get(key) is pending:
                        self.pending_stores.pop(key, None)
                self.delivered(key)

    @audited("picture_cache_build_native")
    def build_native(self, path, center_x, center_y, width, height, cancelled=None):
        """One retained native source in the helper; only viewport crops reach the GPU."""
        path = Path(path).resolve(strict=True)
        edge = max(width, height)
        with self._native_lock:
            kind = "native-gpu" if self.gpu_native_ready(path) else "native"
            quality = f"{kind}:{center_x:.8f}:{center_y:.8f}:{width}:{height}"
            check_cancelled(cancelled)
            cached = self.cached(path, edge, quality)
            if cached:
                return cached
            identity = picture_key(path, 100000, "native")
            source = self._native_source
            if source is None or source[0] != identity:
                self._native_source = None
                app_memory.report(self.native_key,'working',0)
                pixels, reference, metadata = decode_picture(path, 100000, "native")
                check_cancelled(cancelled)
                if picture_key(path, 100000, "native") != identity:
                    raise ValueError("Photo changed while its native picture was being read.")
                starting_look = metadata.pop("starting_look", None)
                grade = validate_saved(AdjustmentState, starting_look) if starting_look else default_look(
                    pixels, reference, metadata.pop("raw_input", False), path.suffix.lower())
                source = (identity, pixels, reference, metadata, grade.model_dump(mode="json"))
                size=pixels.nbytes+(reference.nbytes if reference is not None else 0)
                if not self._native_paused and app_memory.claim(self.native_key,'working',size):
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

    def gpu_native_ready(self, path):
        with self._native_lock:
            return (self._native_source is not None and
                self._native_source[0] == picture_key(path, 100000, "native") and
                self._native_source[3].get("renderer") == "gpu")

    def upload_native(self, token, offset, total, chunk):
        """Receive bounded pieces into the same admitted owner used by detail."""
        with self._native_lock:
            if offset == 0:
                if total <= 0 or total > app_memory.limit('working'):
                    raise ValueError("Not enough memory for full-size detail. Wait for memory and try again.")
                if self._native_upload is not None:
                    return False
                self.trim_native(0)
                if not app_memory.claim(self.native_key,'working',total):
                    return False
                try:
                    self._native_upload = (token, bytearray(total), 0)
                    # Match the upload worker's existing 45-second deadline.
                    # A closed renderer cannot send its final DELETE.
                    self._native_upload_timer = Timer(45, self.finish_native_upload, (token,))
                    self._native_upload_timer.daemon = True
                    self._native_upload_timer.start()
                except BaseException:
                    self.trim_native(0)
                    raise
            upload = self._native_upload
            if upload is None or upload[0] != token or upload[2] != offset or len(upload[1]) != total or offset+len(chunk)>total:
                raise ValueError("Full-size detail upload expired; try again.")
            upload[1][offset:offset+len(chunk)] = chunk
            self._native_upload = (token, upload[1], offset+len(chunk))
            return True

    def native_upload(self, token):
        with self._native_lock:
            upload = self._native_upload
            if upload is None or upload[0] != token or upload[2] != len(upload[1]):
                raise ValueError("Full-size detail upload expired; try again.")
            return upload[1]

    def finish_native_upload(self, token):
        with self._native_lock:
            if self._native_upload is not None and self._native_upload[0] == token:
                self._native_upload = None
                if self._native_upload_timer is not None:
                    self._native_upload_timer.cancel()
                    self._native_upload_timer = None
                app_memory.report(self.native_key,'working', self._native_source[1].nbytes if self._native_source else 0)

    def retain_gpu_native(self, path, pixels, metadata, grade):
        with self._native_lock:
            # Chunk reception admitted this same owner before allocating it.
            # Retaining its planes does not reserve the same bytes again.
            if not app_memory.claim(self.native_key,'working',pixels.nbytes):
                raise ValueError("Not enough memory for full-size detail. Wait for memory and try again.")
            self._native_source = (picture_key(path, 100000, "native"), pixels, None, metadata, grade)

    def trim_native(self,target):
        with self._native_lock:
            # An admitted upload owns its buffer until publication or release.
            # Reclaiming it mid-transfer strands the job on its own memory.
            if self._native_upload is not None:
                return
            self._native_upload=None
            self._native_source=None
            app_memory.claim(self.native_key,'working',0)

    def pause_native(self, paused):
        self._native_paused = bool(paused)
        if paused:
            self.trim_native(0)

    @audited("picture_cache_pixels")
    def pixels(self, key, lane="hdr"):
        path = self.file(key)
        with np.load(self.open(key, path), allow_pickle=False) as stored:
            reference = lane == "sdr" and "reference" in stored
            pixels = stored["reference" if reference else "pixels"].astype(np.float32)
        if path.exists():
            os.utime(path, None)
            self.managed.record(path)
        body, stride = encode_rgba_proxy_rows(pixels, 0, pixels.shape[0], prefer_half=True, pixel_format="rgba16float")
        self.delivered(key)
        return body, pixels.shape[1], pixels.shape[0], stride, "linear-srgb" if reference else "acescg"

    @audited("picture_cache_trim")
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


def original_preview(path, edge):
    """Decode a plain SDR file for display, without developing or saving a grade."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".exr", ".pfm", ".hdr"}:
        return None
    if suffix in {".tif", ".tiff"}:
        from .library_metadata import mezzanine_tiff
        stat = path.stat()
        if mezzanine_tiff(str(path), stat.st_size, stat.st_mtime_ns): return None
    if suffix in {".jpg", ".jpeg"} and loader.is_ultrahdr_jpeg(path): return None
    if suffix == ".avif":
        from .avif_info import inspect_avif
        info = inspect_avif(path)
        if info.get("gain_map_present") or info.get("transfer_char") in {16, 18, "PQ", "HLG"}: return None
    if suffix in {".heic", ".heif"}:
        from pillow_heif import open_heif
        image_file = open_heif(path, convert_hdr_to_8bit=False)
        info = image_file[image_file.primary_index].info
        if info.get("aux") or loader._heif_transfer_from_info(info) in {"PQ", "HLG"}: return None
        from pillow_heif import register_heif_opener
        register_heif_opener()
    if suffix == ".jxl":
        from .jpegxl import decode_jpegxl, _srgb_oetf
        from .color import acescg_to_linear_srgb
        pixels, metadata = decode_jpegxl(path, encoded_samples=True)
        if metadata.get("jpegxl_direct_hdr") or metadata.get("needs_color_override"): return None
        normalized = normalize_to_acescg(pixels, metadata["sample_color_space"], metadata["sample_transfer_function"])
        signal = _srgb_oetf(np.maximum(acescg_to_linear_srgb(normalized), 0))
        image = Image.fromarray(np.clip(signal * 255, 0, 255).astype(np.uint8))
    else:
        with Image.open(path) as source:
            width, height = source.size
            if source.getexif().get(274) in {5, 6, 7, 8}: width, height = height, width
            source.draft("RGB", (edge, edge))
            image = ImageOps.exif_transpose(source).convert("RGB")
            profile = source.info.get("icc_profile")
            if profile:
                image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode="RGB")
    width, height = (width, height) if suffix != ".jxl" else image.size
    image.thumbnail((edge, edge))
    output = BytesIO()
    image.save(output, format="PNG")
    return {"route": "original-file", "url": "data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
        "width": image.width, "height": image.height, "source_width": width, "source_height": height, "edge": edge}


_CAMERA_PREVIEWS = OrderedDict()
_CAMERA_PREVIEW_LOCK = RLock()
_CAMERA_PREVIEW_BYTES = app_memory.limit('camera')


def _trim_camera(target):
    with _CAMERA_PREVIEW_LOCK:
        while _CAMERA_PREVIEWS and sum(len(row['url'].encode('utf-8')) for row in _CAMERA_PREVIEWS.values())>target:
            _CAMERA_PREVIEWS.popitem(last=False)
        app_memory.claim('camera-previews','camera',sum(len(row['url'].encode('utf-8')) for row in _CAMERA_PREVIEWS.values()))


# Module function is deliberately strong; instance callbacks use weak methods.
app_memory.register('camera-previews','camera',_trim_camera)


def cached_camera_preview(path, edge):
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns, edge)
    with _CAMERA_PREVIEW_LOCK:
        cached = _CAMERA_PREVIEWS.get(key)
        if cached is not None:
            _CAMERA_PREVIEWS.move_to_end(key)
            return dict(cached)
    return None


def camera_preview(path, edge):
    # A bounded RAM cache of the camera preview, keyed by the exact file version.
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns, edge)
    started = perf_counter()
    with _CAMERA_PREVIEW_LOCK:
        cached = _CAMERA_PREVIEWS.pop(key, None)
        if cached is not None:
            _CAMERA_PREVIEWS[key] = cached
            log("picture_camera_preview_ready", path=str(path), route="camera-preview-memory",
                cache_hit=True, duration_ms=(perf_counter()-started)*1000)
            return dict(cached)
    # Different visible photos extract independently. The cache lock protects
    # only its bookkeeping, not file reads and JPEG processing for the screen.
    result = _extract_camera_preview(path, edge)
    after = path.stat()
    if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
        raise ValueError("Camera preview source changed")
    result["kept"] = True
    with _CAMERA_PREVIEW_LOCK:
        _CAMERA_PREVIEWS[key] = result
        while _CAMERA_PREVIEWS and not app_memory.claim('camera-previews','camera',sum(len(row['url'].encode('utf-8')) for row in _CAMERA_PREVIEWS.values())):
            _CAMERA_PREVIEWS.popitem(last=False)
        return dict(result)


def _extract_camera_preview(path, edge):
    """Extract the camera JPEG without unpacking or demosaicing the RAW."""
    import base64
    import rawpy
    started = perf_counter()
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        thumb = raw.extract_thumb()
        image = Image.open(BytesIO(thumb.data)) if thumb.format == rawpy.ThumbFormat.JPEG else Image.fromarray(thumb.data)
        camera_width, camera_height = image.size
        source_width, source_height = raw.sizes.width, raw.sizes.height
        if raw.sizes.flip in {5, 6}: source_width, source_height = source_height, source_width
        if thumb.format == rawpy.ThumbFormat.JPEG: image.draft("RGB", (edge, edge))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((edge, edge))
        output = BytesIO()
        image.save(output, format="JPEG", quality=90)
    log("picture_camera_preview_ready", path=str(path), route="camera-preview-extract", cache_hit=False, duration_ms=(perf_counter()-started)*1000)
    return {"route": "camera-preview-placeholder", "url": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode(),
        "width": image.width, "height": image.height, "edge": edge, "kept": False,
        "camera_long_edge": max(camera_width, camera_height),
        "source_width": source_width, "source_height": source_height}


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
    from .library_reduced import jpeg_open, png
    if path.suffix.lower() == ".png":
        pixels, _ = png(path)
        return reduce_picture(pixels, edge)*np.float32(1/255)
    opener = jpeg_open if path.suffix.lower() in {".jpg", ".jpeg"} else Image.open
    with opener(path) as source:
        profile = source.info.get("icc_profile")
        source.draft("RGB", (edge, edge))
        image = ImageOps.exif_transpose(source)
        image.thumbnail((edge, edge))
        if profile:
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB")
        return np.asarray(image.convert("RGB"), dtype=np.float32) / 255


def decode_picture(path, edge, quality):
    # One Library photo decodes with its share of the cores; Grade's own
    # import keeps its separate bands.
    from .cpu_budget import library_bands
    with library_bands():
        return _decode_picture(path, edge, quality)


def _decode_picture(path, edge, quality):
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
                detail = inspection.rejection.message if inspection.rejection else "This DNG cannot be read by Grade."
                raise ValueError(detail)
        if quality in {"grade-thumbnail", "native"}:
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
    if quality == "fast" and suffix in {".heic", ".heif"}:
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
        image, metadata = loader._load_tiff(path, library_edge=5120 if edge <= 2560 else None)
    elif suffix == ".exr":
        image, metadata = loader._load_exr(path)
    elif suffix in {".hdr", ".pfm"}:
        image, metadata = loader._load_hdr_like(path)
    else:
        image = reduced_bitmap(path, edge)
        from PIL import JpegImagePlugin, PngImagePlugin
        opener = PngImagePlugin.PngImageFile if suffix == ".png" else JpegImagePlugin.JpegImageFile
        with opener(path) as header:
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
        from .library_reduced import read
        if edge <= 2560 and inspection.primary_page_index is not None:
            decoded, original = read(path, page=inspection.primary_page_index, edge=10240)
        else:
            decoded = _normalize_layout(series.asarray(), getattr(series, "axes", None))
            original = (inspection.width, inspection.height)
    from copy import deepcopy
    reduced_metadata = deepcopy(inspection.metadata)
    sx,sy=decoded.shape[1]/original[0],decoded.shape[0]/original[1]
    reduced_metadata["active_area"]=np.rint(np.asarray(reduced_metadata["active_area"])*[sy,sx,sy,sx]).astype(int).tolist()
    reduced_metadata["default_crop_origin"]=(np.asarray(reduced_metadata["default_crop_origin"])*[sx,sy]).tolist()
    reduced_metadata["default_crop_size"]=(np.asarray(reduced_metadata["default_crop_size"])*[sx,sy]).tolist()
    color = color_metadata_from_mapping(inspection.metadata)
    working = normalize_camera_samples(decoded, color)
    working = crop_and_orient(working, reduced_metadata)
    from .library_dng import geometry
    source_width, source_height, _, _ = geometry(inspection.metadata, *original)
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
