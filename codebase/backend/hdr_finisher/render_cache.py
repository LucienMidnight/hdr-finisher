from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field, replace
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
from threading import Event, RLock, get_ident
import time
from typing import Any, Callable
import zlib

import numpy as np

from .adjustments import apply_adjustments, render_matched_sdr_base
from .color_context import DEFAULT_HDR_REFERENCE_WHITE_NITS, RenderColorContext
from .config import APP_DATA_DIR
from .cpu_strips import (
    DEFAULT_STRIP_BUDGET_BYTES,
    StripCancelled,
    StripExecutionRefused,
    StripReport,
    render_in_strips,
    strip_execution_refusals,
)
from .finishing import (
    apply_geometry,
    apply_geometry_region,
    geometry_coordinate_map,
    geometry_output_dimensions,
    geometry_resample_stage,
)
from .local_adjustments import (
    compile_geometry_fixed_mask,
    mask_influence_opacity,
    sample_luminance_evs,
    spatial_mask_signature,
)
from .models import AdjustmentState, LocalAdjustment, MaskExpression, MaskPoint, PreviewKind, SdrMatchState
from .preview import downsample_image


class StaleRender(RuntimeError):
    """Raised before expensive work when a newer render superseded this one."""


def adjustment_signature(adjustments: AdjustmentState) -> str:
    payload = adjustments.model_dump(mode="json")
    shared = payload.get("shared", {})
    for key in ("overlay_mode", "false_color_band_anchor", "false_color_ceiling_nits", "overlay_opacity", "overlay_threshold"):
        shared.pop(key, None)
    # The model is already validated. Revalidating this large nested payload on
    # every slider event adds pure scheduling latency and cannot normalize it
    # further; compact JSON preserves the model field order used by cache keys.
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def local_adjustment_signature(local_adjustments: list[LocalAdjustment] | None) -> str:
    if not local_adjustments:
        return "[]"
    return "[" + ",".join(item.model_dump_json() for item in local_adjustments) + "]"


def scope_region_view(
    image: np.ndarray,
    region: tuple[float, float, float, float] | None,
) -> np.ndarray:
    """Return a normalized post-geometry ROI without copying scope pixels."""
    if region is None:
        return image
    height, width = image.shape[:2]
    x, y, region_width, region_height = region
    x0 = min(width - 1, max(0, int(np.floor(x * width))))
    y0 = min(height - 1, max(0, int(np.floor(y * height))))
    x1 = min(width, max(x0 + 1, int(np.ceil((x + region_width) * width))))
    y1 = min(height, max(y0 + 1, int(np.ceil((y + region_height) * height))))
    return image[y0:y1, x0:x1]



class TileUnavailableError(RuntimeError):
    """Raised when a bounded tile cannot reproduce the whole-frame result."""


def _clamp_output_rect(rect: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    left = min(max(int(rect[0]), 0), max(0, width - 1))
    top = min(max(int(rect[1]), 0), max(0, height - 1))
    right = min(max(int(rect[2]), left + 1), width)
    bottom = min(max(int(rect[3]), top + 1), height)
    return left, top, right, bottom


SOURCE_MIP_FORMAT_VERSION = 1
SOURCE_MIP_MAGIC = b"HDRMIP01"
_SOURCE_MIP_HEADER = struct.Struct("<8sIIIIIIQI")
_SOURCE_MIP_DTYPE_FLOAT32 = 1
DEFAULT_SOURCE_MIP_MEMORY_BYTES = 256 * 1024 * 1024
DEFAULT_SOURCE_MIP_DISK_BYTES = 1024 * 1024 * 1024


def downsample_target_dimensions(width: int, height: int, long_edge: int) -> tuple[int, int]:
    """The dimensions ``downsample_image`` would produce for this long edge."""
    long_side = max(int(width), int(height))
    if long_side <= int(long_edge):
        return int(width), int(height)
    scale = int(long_edge) / long_side
    return max(1, int(round(width * scale))), max(1, int(round(height * scale)))


@dataclass(frozen=True)
class SourceMipIdentity:
    """Everything a persisted source level depends on, and nothing else.

    The levels hold pre-adjustment canonical scene-linear pixels, so moving a
    slider, changing an overlay, or retargeting the presentation must never
    invalidate them (PRD 5.3). What does invalidate them is anything that
    changes the decoded pixels: the source content itself, the decoder, the
    color transform, the reference white used at decode, a user color
    interpretation override, the RAW recipe, and the orientation the loader
    normalized away. ``lane`` separates the HDR source from an authored SDR
    base decoded from the same file.
    """

    content_key: str
    byte_size: int
    width: int
    height: int
    decoder_version: str
    color_transform_version: str
    orientation: int = 1
    lane: str = "hdr"
    reference_white_nits: int = DEFAULT_HDR_REFERENCE_WHITE_NITS
    interpretation: str = ""
    format_version: int = SOURCE_MIP_FORMAT_VERSION

    def payload(self) -> dict[str, Any]:
        return {
            "content": self.content_key,
            "bytes": int(self.byte_size),
            "width": int(self.width),
            "height": int(self.height),
            "decoder": self.decoder_version,
            "color_transform": self.color_transform_version,
            "orientation": int(self.orientation),
            "lane": self.lane,
            "reference_white_nits": int(self.reference_white_nits),
            "interpretation": self.interpretation,
            "format": int(self.format_version),
        }

    def digest(self) -> str:
        serialized = json.dumps(self.payload(), sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(serialized).hexdigest()

    @property
    def native_long_edge(self) -> int:
        return max(int(self.width), int(self.height))


class SourceMipStore:
    """Persistent, byte-bounded multi-resolution source cache (PRD 5.3).

    Levels are keyed by a ``SourceMipIdentity`` digest and a long edge, and
    hold correctly filtered scene-linear data produced by the same
    ``downsample_image`` the session has always used, so a warm level is
    pixel-identical to a cold one. Memory and disk are separate byte-bounded
    LRUs; a level is built from the decoded source only on a miss, written to
    disk atomically (temp file plus replace), and a level that fails
    validation on read is discarded and rebuilt rather than served. Disk
    entries under stale format versions are removed when the store first
    runs, and interrupted temp files are swept.
    """

    def __init__(
        self,
        root: str | Path,
        *,
        memory_budget_bytes: int = DEFAULT_SOURCE_MIP_MEMORY_BYTES,
        disk_budget_bytes: int = DEFAULT_SOURCE_MIP_DISK_BYTES,
    ) -> None:
        self.root = Path(root)
        self.memory_budget_bytes = max(0, int(memory_budget_bytes))
        self.disk_budget_bytes = max(0, int(disk_budget_bytes))
        self._lock = RLock()
        self._memory: OrderedDict[tuple[str, int], np.ndarray] = OrderedDict()
        self._inflight: dict[tuple[str, int], Event] = {}
        self._memory_bytes = 0
        self._cleaned = False
        self._counters: dict[str, float] = {
            "memory_hits": 0,
            "disk_hits": 0,
            "cold_builds": 0,
            "native_passes": 0,
            "bytes_read": 0,
            "bytes_generated": 0,
            "build_ms_total": 0.0,
            "build_count": 0,
            "memory_evictions": 0,
            "disk_evictions": 0,
            "corrupt_discards": 0,
            "stale_removed": 0,
            "write_failures": 0,
            "singleflight_waits": 0,
        }

    def level(
        self,
        identity: SourceMipIdentity,
        long_edge: int,
        image: np.ndarray,
        *,
        is_current: Callable[[], bool] | None = None,
    ) -> tuple[np.ndarray, str]:
        """Return the level for ``long_edge`` and how it was answered.

        States are ``native`` (no downscale was needed; the decoded image is
        returned unchanged), ``memory``, ``disk`` and ``built``. Building is
        single-flight per identity and level. A cancelled build raises
        ``StaleRender`` and never populates either cache.
        """
        edge = max(256, int(long_edge))
        if edge >= identity.native_long_edge:
            with self._lock:
                self._counters["native_passes"] += 1
            return image, "native"
        key = (identity.digest(), edge)
        while True:
            with self._lock:
                cached = self._memory.get(key)
                if cached is not None:
                    self._memory.move_to_end(key)
                    self._counters["memory_hits"] += 1
                    return cached, "memory"
                flight = self._inflight.get(key)
                if flight is None:
                    flight = Event()
                    self._inflight[key] = flight
                    break
                self._counters["singleflight_waits"] += 1
            flight.wait()
        try:
            self._ensure_cleaned()
            array, state = self._load_or_build(identity, edge, image, is_current)
            with self._lock:
                self._insert_memory_locked(key, array)
            return array, state
        finally:
            with self._lock:
                if self._inflight.get(key) is flight:
                    self._inflight.pop(key, None)
            flight.set()

    def discard_memory(self, identity: SourceMipIdentity) -> None:
        """Drop this identity's in-memory levels; disk entries stay reusable."""
        digest = identity.digest()
        with self._lock:
            for key in [item for item in self._memory if item[0] == digest]:
                self._memory_bytes -= int(self._memory.pop(key).nbytes)

    def clear_memory(self) -> None:
        with self._lock:
            self._memory.clear()
            self._memory_bytes = 0

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            counters = dict(self._counters)
            memory_entries = len(self._memory)
            memory_bytes = self._memory_bytes
        disk_bytes, disk_entries = self._disk_usage()
        payload: dict[str, Any] = dict(counters)
        payload.update(
            {
                "warm_hits": int(counters["memory_hits"] + counters["disk_hits"]),
                "build_ms_mean": (counters["build_ms_total"] / counters["build_count"]) if counters["build_count"] else 0.0,
                "memory_entries": memory_entries,
                "memory_bytes": memory_bytes,
                "memory_budget_bytes": self.memory_budget_bytes,
                "disk_entries": disk_entries,
                "disk_bytes": disk_bytes,
                "disk_budget_bytes": self.disk_budget_bytes,
                "root": str(self.root),
            }
        )
        return payload

    # -- internals ----------------------------------------------------------

    def _load_or_build(
        self,
        identity: SourceMipIdentity,
        edge: int,
        image: np.ndarray,
        is_current: Callable[[], bool] | None,
    ) -> tuple[np.ndarray, str]:
        if self.disk_budget_bytes > 0:
            loaded = self._read_disk_level(identity, edge)
            if loaded is not None:
                with self._lock:
                    self._counters["disk_hits"] += 1
                    self._counters["bytes_read"] += int(loaded.nbytes)
                return loaded, "disk"
        if is_current is not None and not is_current():
            raise StaleRender("A newer source replaced this mip build.")
        started = time.perf_counter()
        array = np.ascontiguousarray(downsample_image(image, edge), dtype=np.float32)
        array.setflags(write=False)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        with self._lock:
            self._counters["cold_builds"] += 1
            self._counters["build_count"] += 1
            self._counters["build_ms_total"] += elapsed_ms
            self._counters["bytes_generated"] += int(array.nbytes)
        if is_current is not None and not is_current():
            raise StaleRender("A newer source replaced this mip build.")
        if self.disk_budget_bytes > 0:
            self._write_disk_level(identity, edge, array)
            self._prune_disk()
        return array, "built"

    def _identity_dir(self, identity: SourceMipIdentity) -> Path:
        return self.root / f"v{int(identity.format_version)}" / identity.digest()

    def _level_path(self, identity: SourceMipIdentity, edge: int) -> Path:
        return self._identity_dir(identity) / f"{int(edge)}.f32"

    def _read_disk_level(self, identity: SourceMipIdentity, edge: int) -> np.ndarray | None:
        path = self._level_path(identity, edge)
        try:
            data = path.read_bytes()
        except OSError:
            return None
        expected_width, expected_height = downsample_target_dimensions(identity.width, identity.height, edge)
        header_size = _SOURCE_MIP_HEADER.size
        if len(data) < header_size:
            self._discard_corrupt(path)
            return None
        magic, version, width, height, channels, dtype, _reserved, data_bytes, crc = _SOURCE_MIP_HEADER.unpack_from(data, 0)
        valid = (
            magic == SOURCE_MIP_MAGIC
            and version == int(identity.format_version)
            and dtype == _SOURCE_MIP_DTYPE_FLOAT32
            and channels == 3
            and width == expected_width
            and height == expected_height
            and data_bytes == len(data) - header_size
            and (zlib.crc32(data[header_size:]) & 0xFFFFFFFF) == crc
        )
        if not valid:
            self._discard_corrupt(path)
            return None
        array = np.frombuffer(
            data,
            dtype="<f4",
            count=int(width) * int(height) * 3,
            offset=header_size,
        ).reshape(int(height), int(width), 3)
        try:
            os.utime(path, None)
        except OSError:
            pass
        return array

    def _write_disk_level(self, identity: SourceMipIdentity, edge: int, array: np.ndarray) -> None:
        path = self._level_path(identity, edge)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = np.ascontiguousarray(array).tobytes()
            crc = zlib.crc32(payload) & 0xFFFFFFFF
            header = _SOURCE_MIP_HEADER.pack(
                SOURCE_MIP_MAGIC,
                int(identity.format_version),
                int(array.shape[1]),
                int(array.shape[0]),
                3,
                _SOURCE_MIP_DTYPE_FLOAT32,
                0,
                len(payload),
                crc,
            )
            temp = path.with_name(f".{path.name}.{os.getpid()}.{get_ident()}.tmp")
            temp.write_bytes(header + payload)
            os.replace(temp, path)
        except OSError:
            with self._lock:
                self._counters["write_failures"] += 1

    def _discard_corrupt(self, path: Path) -> None:
        try:
            path.unlink()
        except OSError:
            return
        with self._lock:
            self._counters["corrupt_discards"] += 1

    def _insert_memory_locked(self, key: tuple[str, int], array: np.ndarray) -> None:
        if self.memory_budget_bytes <= 0 or int(array.nbytes) > self.memory_budget_bytes:
            return
        existing = self._memory.pop(key, None)
        if existing is not None:
            self._memory_bytes -= int(existing.nbytes)
        self._memory[key] = array
        self._memory_bytes += int(array.nbytes)
        while self._memory_bytes > self.memory_budget_bytes and self._memory:
            _evicted_key, evicted = self._memory.popitem(last=False)
            self._memory_bytes -= int(evicted.nbytes)
            self._counters["memory_evictions"] += 1

    def _ensure_cleaned(self) -> None:
        with self._lock:
            if self._cleaned:
                return
            self._cleaned = True
        current = f"v{SOURCE_MIP_FORMAT_VERSION}"
        removed = 0
        try:
            children = list(self.root.iterdir())
        except OSError:
            children = []
        for child in children:
            try:
                if child.is_dir() and child.name.startswith("v"):
                    suffix = child.name[1:]
                    if suffix.isdigit() and int(suffix) != SOURCE_MIP_FORMAT_VERSION:
                        shutil.rmtree(child, ignore_errors=True)
                        removed += 1
            except OSError:
                continue
        try:
            for path in self.root.rglob("*.tmp"):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    continue
        except OSError:
            pass
        with self._lock:
            self._counters["stale_removed"] += removed

    def _prune_disk(self) -> None:
        if self.disk_budget_bytes <= 0:
            return
        entries: list[tuple[float, int, Path]] = []
        total = 0
        try:
            for path in self.root.rglob("*.f32"):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                entries.append((stat.st_mtime, stat.st_size, path))
                total += stat.st_size
        except OSError:
            return
        if total <= self.disk_budget_bytes:
            return
        entries.sort(key=lambda item: item[0])
        removed = 0
        for _mtime, size, path in entries:
            if total <= self.disk_budget_bytes:
                break
            try:
                path.unlink()
            except OSError:
                continue
            total -= size
            removed += 1
        if removed:
            with self._lock:
                self._counters["disk_evictions"] += removed

    def _disk_usage(self) -> tuple[int, int]:
        total = 0
        count = 0
        try:
            for path in self.root.rglob("*.f32"):
                try:
                    total += path.stat().st_size
                except OSError:
                    continue
                count += 1
        except OSError:
            return 0, 0
        return total, count


def _env_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return fallback
    try:
        return max(0, int(raw))
    except ValueError:
        return fallback


_default_source_mip_store: SourceMipStore | None = None
_default_source_mip_store_resolved = False


def default_source_mip_store() -> SourceMipStore | None:
    """The process-wide persistent source cache, or ``None`` when disabled.

    ``HDR_FINISHER_SOURCE_CACHE_DIR`` relocates the store (the test suite
    points it at a temporary directory); ``HDR_FINISHER_SOURCE_CACHE_DISABLE``
    turns persistence off entirely. Budgets are bytes and are read once.
    """
    global _default_source_mip_store, _default_source_mip_store_resolved
    if _default_source_mip_store_resolved:
        return _default_source_mip_store
    _default_source_mip_store_resolved = True
    if os.environ.get("HDR_FINISHER_SOURCE_CACHE_DISABLE"):
        return None
    configured = os.environ.get("HDR_FINISHER_SOURCE_CACHE_DIR")
    root = Path(configured) if configured else APP_DATA_DIR / "source-mips"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    _default_source_mip_store = SourceMipStore(
        root,
        memory_budget_bytes=_env_int("HDR_FINISHER_SOURCE_MIP_MEMORY_BYTES", DEFAULT_SOURCE_MIP_MEMORY_BYTES),
        disk_budget_bytes=_env_int("HDR_FINISHER_SOURCE_MIP_DISK_BYTES", DEFAULT_SOURCE_MIP_DISK_BYTES),
    )
    return _default_source_mip_store


def reset_default_source_mip_store() -> None:
    """Test hook: forget the resolved default so a new environment applies."""
    global _default_source_mip_store, _default_source_mip_store_resolved
    _default_source_mip_store = None
    _default_source_mip_store_resolved = False


@dataclass
class SessionRenderCache:
    image: np.ndarray
    sdr_reference_image: np.ndarray | None
    color_context: RenderColorContext = field(default_factory=RenderColorContext)
    max_frames: int = 6
    max_cache_bytes: int = 192 * 1024 * 1024
    max_proxy_levels: int = 2
    source_identity: SourceMipIdentity | None = None
    sdr_identity: SourceMipIdentity | None = None
    mip_store: SourceMipStore | None = field(default=None, repr=False)
    _lock: RLock = field(default_factory=RLock, init=False, repr=False)
    _source_proxies: OrderedDict[int, np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    # The rolled frame the straighten path has to materialize, held across
    # the row chunks of one streamed proxy instead of being rebuilt for each
    # of them. Single entry by contract; see apply_geometry_region.
    _roll_frame: dict = field(default_factory=dict, init=False, repr=False)
    _sdr_proxies: OrderedDict[int, np.ndarray | None] = field(default_factory=OrderedDict, init=False, repr=False)
    _frames: OrderedDict[tuple[int, str, int, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    # The exact scope peak of a cached frame, keyed alongside it. Only the
    # bounded strip path measures one, and only while it renders; without this
    # a second request for the same grade is served from `_frames` and answers
    # with no peak at all, which is the one thing an exact presentation has to
    # be able to state about itself.
    _frame_scope_peaks: OrderedDict[tuple[int, str, int, str], float] = field(default_factory=OrderedDict, init=False, repr=False)
    _matched_sdr_bases: OrderedDict[tuple[int, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    _scopes: OrderedDict[tuple[object, ...], Any] = field(default_factory=OrderedDict, init=False, repr=False)
    _masks: OrderedDict[tuple[int, int, str, str, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    _geometry_maps: OrderedDict[tuple[int, str], tuple[tuple[float, ...], tuple[float, ...], int, int]] = field(default_factory=OrderedDict, init=False, repr=False)
    _inflight: dict[tuple[object, ...], Event] = field(default_factory=dict, init=False, repr=False)
    _hits: int = field(default=0, init=False, repr=False)
    _misses: int = field(default=0, init=False, repr=False)
    _evictions: int = field(default=0, init=False, repr=False)
    _singleflight_waits: int = field(default=0, init=False, repr=False)
    _stale_cancellations: int = field(default=0, init=False, repr=False)
    _source_epoch: int = field(default=0, init=False, repr=False)
    # The last answer each source edge received, for the transport headers:
    # ``native`` (the decoded frame itself), ``memory``/``disk`` (warm mip),
    # ``built`` (cold mip build) or ``session`` (no persistent store).
    _source_level_states: dict[int, str] = field(default_factory=dict, init=False, repr=False)

    def set_color_context(self, context: RenderColorContext) -> None:
        with self._lock:
            if context == self.color_context:
                return
            self.color_context = context
            self._source_epoch += 1
            self._frames.clear()
            self._frame_scope_peaks.clear()
            self._matched_sdr_bases.clear()
            self._scopes.clear()
            self._cancel_inflight_locked()

    def replace_source(
        self,
        image: np.ndarray,
        sdr_reference_image: np.ndarray | None,
        *,
        identity: SourceMipIdentity | None = None,
        sdr_identity: SourceMipIdentity | None = None,
    ) -> None:
        with self._lock:
            if self.mip_store is not None:
                if self.source_identity is not None:
                    self.mip_store.discard_memory(self.source_identity)
                if self.sdr_identity is not None:
                    self.mip_store.discard_memory(self.sdr_identity)
            self.image = image
            self.sdr_reference_image = sdr_reference_image
            self.source_identity = identity
            self.sdr_identity = sdr_identity
            self._source_epoch += 1
            self._source_proxies.clear()
            self._sdr_proxies.clear()
            self._roll_frame.clear()
            self._frames.clear()
            self._frame_scope_peaks.clear()
            self._matched_sdr_bases.clear()
            self._scopes.clear()
            self._masks.clear()
            self._geometry_maps.clear()
            self._cancel_inflight_locked()

    def clear_adjusted(self, *, clear_masks: bool = False) -> None:
        with self._lock:
            self._frames.clear()
            self._frame_scope_peaks.clear()
            self._scopes.clear()
            if clear_masks:
                self._masks.clear()
            self._cancel_inflight_locked()

    def source_proxy(self, kind: PreviewKind, long_edge: int) -> tuple[np.ndarray, str]:
        source, sdr_reference = self._proxies(long_edge)
        if kind == PreviewKind.SDR and sdr_reference is not None:
            return sdr_reference, "linear-srgb"
        return source, "acescg"

    def geometry_source_proxy(
        self,
        kind: PreviewKind,
        long_edge: int,
        adjustments: AdjustmentState,
        sdr_match: SdrMatchState | None = None,
    ) -> tuple[np.ndarray, str, str]:
        """Return the authoritative geometry-fixed source for a GPU grade proxy."""
        edge = max(256, int(long_edge))
        geometry = adjustments.shared.geometry
        signature = geometry.model_dump_json()
        if kind == PreviewKind.SDR and sdr_match is not None and sdr_match.active:
            source, _sdr_reference = self._proxies(edge)
            matched = self.matched_sdr_base(source, adjustments, sdr_match, edge)
            return downsample_image(matched, edge), "linear-srgb", signature
        source, sdr_reference = self._proxies(edge)
        use_authored_sdr = (
            kind == PreviewKind.SDR
            and sdr_reference is not None
            and adjustments.sdr.use_authored_base
        )
        proxy = sdr_reference if use_authored_sdr else source
        working_space = "linear-srgb" if use_authored_sdr else "acescg"
        fixed = apply_geometry(proxy, geometry)
        return downsample_image(fixed, edge), working_space, signature

    def geometry_source_tile(
        self,
        kind: PreviewKind,
        long_edge: int,
        adjustments: AdjustmentState,
        sdr_match: SdrMatchState | None,
        rect: tuple[int, int, int, int],
        halo: int = 0,
    ) -> tuple[np.ndarray, str, str, dict[str, Any]]:
        """Return one bounded post-geometry source tile and its placement.

        The tile contract of PRD 5.4: the caller names a core output rectangle
        and a halo, and receives back the pixels plus the identity they belong
        to -- source epoch, tier, geometry signature, the full output size, and
        the rectangle actually delivered after clamping.

        The tile is produced by ``apply_geometry_region``, which does not build
        the complete transformed frame for the index or perspective routes.
        """
        edge = max(256, int(long_edge))
        geometry = adjustments.shared.geometry
        signature = geometry.model_dump_json()
        halo = max(0, int(halo))

        if kind == PreviewKind.SDR and sdr_match is not None and sdr_match.active:
            source, _sdr_reference = self._proxies(edge)
            base = self.matched_sdr_base(source, adjustments, sdr_match, edge)
            working_space = "linear-srgb"
        else:
            source, sdr_reference = self._proxies(edge)
            use_authored_sdr = (
                kind == PreviewKind.SDR
                and sdr_reference is not None
                and adjustments.sdr.use_authored_base
            )
            base = sdr_reference if use_authored_sdr else source
            working_space = "linear-srgb" if use_authored_sdr else "acescg"

        with self._lock:
            source_epoch = self._source_epoch

        output_width, output_height = geometry_output_dimensions(base.shape[1], base.shape[0], geometry)
        if max(output_width, output_height) > edge:
            # The whole-frame path would downsample here, and a per-tile
            # downsample does not reproduce a whole-frame one at the edges.
            # Refuse rather than deliver a tile that fails parity.
            raise TileUnavailableError(
                "This geometry needs a post-geometry downsample, which the tile path does not reproduce."
            )

        core = _clamp_output_rect(rect, output_width, output_height)
        haloed = (
            max(0, core[0] - halo),
            max(0, core[1] - halo),
            min(output_width, core[2] + halo),
            min(output_height, core[3] + halo),
        )
        tile = apply_geometry_region(
            base,
            geometry,
            haloed,
            roll_cache=self._roll_frame,
            # Everything the rolled frame depends on, and nothing else. The
            # crop is applied by slicing afterwards, so a crop drag over a
            # straightened image reuses the frame rather than rebuilding it.
            roll_cache_key=(
                source_epoch,
                edge,
                working_space,
                int(geometry.rotation),
                bool(geometry.flip_horizontal),
                bool(geometry.flip_vertical),
                round(float(geometry.straighten_angle + geometry.perspective_rotate), 9),
                round(float(geometry.perspective_horizontal), 9),
                round(float(geometry.perspective_vertical), 9),
            ),
        )
        placement = {
            "source_epoch": source_epoch,
            "geometry_signature": signature,
            "resample_stage": geometry_resample_stage(geometry),
            "working_space": working_space,
            "output_width": output_width,
            "output_height": output_height,
            "core": core,
            "delivered": haloed,
            "halo": halo,
            "long_edge": edge,
        }
        return tile, working_space, signature, placement

    def matched_sdr_base(
        self,
        source: np.ndarray,
        adjustments: AdjustmentState,
        sdr_match: SdrMatchState,
        long_edge: int,
    ) -> np.ndarray:
        """Return the cached HDR snapshot and shoulder used as the SDR grading source."""
        edge = max(256, int(long_edge))
        base_signature = json.dumps(
            {
                "hdr": sdr_match.captured_hdr_adjustments.model_dump(mode="json") if sdr_match.captured_hdr_adjustments else None,
                "shared": sdr_match.captured_shared_adjustments.model_dump(mode="json") if sdr_match.captured_shared_adjustments else None,
                "locals": [item.model_dump(mode="json") for item in sdr_match.captured_locals],
                "reference": sdr_match.captured_reference_white_nits,
                "automatic_boundary": sdr_match.automatic_highlight_boundary_ratio,
                "manual_boundary": sdr_match.manual_highlight_boundary_ratio,
                "geometry": adjustments.shared.geometry.model_dump(mode="json"),
            },
            separators=(",", ":"),
        )
        base_key = (edge, base_signature)
        with self._lock:
            matched = self._matched_sdr_bases.get(base_key)
            if matched is not None:
                self._matched_sdr_bases.move_to_end(base_key)
                return matched
            source_epoch = self._source_epoch
            color_context = self.color_context
            source_long_edge = max(self.image.shape[:2])
        matched = render_matched_sdr_base(
            source,
            adjustments,
            sdr_match,
            color_context=color_context,
            source_pixel_scale=min(1.0, edge / source_long_edge),
        )
        matched.setflags(write=False)
        with self._lock:
            # Source replacement deliberately lets old callers finish, but an
            # obsolete result must never repopulate the new source's cache.
            if source_epoch == self._source_epoch:
                self._matched_sdr_bases[base_key] = matched
                self._matched_sdr_bases.move_to_end(base_key)
                while len(self._matched_sdr_bases) > 2:
                    self._matched_sdr_bases.popitem(last=False)
                    self._evictions += 1
        return matched

    def source_pair(self, long_edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        """Return the matched source and authored-SDR proxy inputs used by exporters."""
        return self._proxies(long_edge)

    def geometry_map(
        self,
        adjustments: AdjustmentState,
        long_edge: int,
    ) -> tuple[tuple[float, ...], tuple[float, ...], int, int]:
        edge = max(256, int(long_edge))
        geometry = adjustments.shared.geometry
        key = (edge, geometry.model_dump_json())
        with self._lock:
            cached = self._geometry_maps.get(key)
            if cached is not None:
                self._geometry_maps.move_to_end(key)
                return cached
        source, _sdr_reference = self._proxies(edge)
        result = geometry_coordinate_map(source.shape[1], source.shape[0], geometry)
        output_to_source, source_to_output, output_width, output_height = result
        if max(output_width, output_height) > edge:
            scale = edge / max(output_width, output_height)
            output_width = max(1, int(round(output_width * scale)))
            output_height = max(1, int(round(output_height * scale)))
            result = output_to_source, source_to_output, output_width, output_height
        with self._lock:
            self._geometry_maps[key] = result
            self._geometry_maps.move_to_end(key)
            while len(self._geometry_maps) > 8:
                self._geometry_maps.popitem(last=False)
        return result

    def compiled_local_mask(
        self,
        adjustments: AdjustmentState,
        local_adjustment: LocalAdjustment,
        long_edge: int,
        *,
        spatial_only: bool = False,
    ) -> np.ndarray:
        edge = max(256, int(long_edge))
        with self._lock:
            source_epoch = self._source_epoch
            source, _sdr_reference = self._proxies_locked(edge)
        # The overlay remains inspectable while the adjustment is bypassed.
        # Rendering filters disabled/zero-opacity locals, so compile an enabled
        # view of this one mask without changing the persisted adjustment.
        mask_source = local_adjustment.model_copy(update={"enabled": True, "opacity": 1.0})
        masks = self._compiled_masks(
            source,
            adjustments,
            [mask_source],
            edge,
            source_epoch=source_epoch,
        )
        assert masks is not None
        mask = masks[local_adjustment.id]
        if spatial_only or mask_influence_opacity(local_adjustment.mask) >= 1.0:
            return downsample_image(mask, edge)
        # The compatibility/influence endpoint remains byte-identical to the
        # authoritative evaluator. Interactive GPU clients request spatial_only
        # and keep the reusable base texture resident instead.
        return downsample_image(
            compile_geometry_fixed_mask(source, local_adjustment.mask, adjustments.shared.geometry),
            edge,
        )

    def compiled_mask_draft(
        self,
        adjustments: AdjustmentState,
        expression: MaskExpression,
        long_edge: int,
    ) -> np.ndarray:
        """Compile an uncommitted mask with the exact settled-render pipeline."""
        edge = max(256, int(long_edge))
        source, _sdr_reference = self._proxies(edge)
        return downsample_image(compile_geometry_fixed_mask(source, expression, adjustments.shared.geometry), edge)

    def sample_luminance(
        self,
        adjustments: AdjustmentState,
        points: list[MaskPoint],
        long_edge: int,
    ) -> tuple[float, float, float, int]:
        """Sample the same fixed ACEScg source used by content masks."""
        edge = max(256, int(long_edge))
        source, _sdr_reference = self._proxies(edge)
        fixed_source = downsample_image(apply_geometry(source, adjustments.shared.geometry), edge)
        return sample_luminance_evs(fixed_source, points)

    def adjusted_frame(
        self,
        adjustments: AdjustmentState,
        kind: PreviewKind,
        long_edge: int,
        is_current: Callable[[], bool] | None = None,
        local_adjustments: list[LocalAdjustment] | None = None,
        _record_diagnostics: bool = True,
        sdr_match: SdrMatchState | None = None,
    ) -> np.ndarray:
        edge = max(256, int(long_edge))
        with self._lock:
            source_epoch = self._source_epoch
        match_signature = sdr_match.model_dump_json() if sdr_match is not None else "inactive"
        signature = adjustment_signature(adjustments) + local_adjustment_signature(local_adjustments) + match_signature + repr(self.color_context.cache_key)
        key = (source_epoch, kind.value, edge, signature)
        flight_key = ("frame", *key)
        while True:
            with self._lock:
                cached = self._frames.get(key)
                if cached is not None:
                    if _record_diagnostics:
                        self._hits += 1
                    self._frames.move_to_end(key)
                    return cached
                if is_current is not None and not is_current():
                    self._stale_cancellations += 1
                    raise StaleRender("A newer adjustment replaced this render.")
                flight = self._inflight.get(flight_key)
                if flight is None:
                    flight = Event()
                    self._inflight[flight_key] = flight
                    if _record_diagnostics:
                        self._misses += 1
                    source, sdr_reference = self._proxies_locked(edge)
                    break
                self._singleflight_waits += 1
            flight.wait()

        try:
            compiled_masks = self._compiled_masks(
                source,
                adjustments,
                local_adjustments,
                edge,
                source_epoch=source_epoch,
            )
            matched_sdr_base = None
            if kind == PreviewKind.SDR and sdr_match is not None and sdr_match.active:
                matched_sdr_base = self.matched_sdr_base(source, adjustments, sdr_match, edge)
            processed = apply_adjustments(
                source,
                adjustments,
                kind,
                sdr_reference_image=sdr_reference,
                local_adjustments=local_adjustments,
                compiled_local_masks=compiled_masks,
                color_context=self.color_context,
                source_pixel_scale=min(1.0, edge / max(self.image.shape[:2])),
                sdr_match=sdr_match,
                matched_sdr_base=matched_sdr_base,
            )
            processed = downsample_image(processed, edge)
            if is_current is not None and not is_current():
                with self._lock:
                    self._stale_cancellations += 1
                raise StaleRender("A newer adjustment replaced this render.")
            processed.setflags(write=False)
            with self._lock:
                self._frames[key] = processed
                self._evict_locked()
        finally:
            with self._lock:
                # Invalidation may have removed this flight and a newer caller
                # may already own the same key. Only detach our own event.
                if self._inflight.get(flight_key) is flight:
                    self._inflight.pop(flight_key, None)
                flight.set()
        return processed

    def adjusted_frame_in_strips(
        self,
        adjustments: AdjustmentState,
        kind: PreviewKind,
        long_edge: int,
        is_current: Callable[[], bool] | None = None,
        local_adjustments: list[LocalAdjustment] | None = None,
        sdr_match: SdrMatchState | None = None,
        denoise_active: bool = False,
        budget_bytes: int = DEFAULT_STRIP_BUDGET_BYTES,
    ) -> tuple[np.ndarray, StripReport]:
        """Produce the same frame ``adjusted_frame`` does, through the bounded path.

        Shares the frame cache with ``adjusted_frame`` under the same key, so
        the two are interchangeable to every consumer: whichever runs first, the
        other finds its result. It raises ``StripExecutionRefused`` for a graph
        the strip path cannot reproduce exactly, and the caller decides whether
        to fall back -- this method never silently renders whole-frame instead.
        """
        edge = max(256, int(long_edge))
        with self._lock:
            source_epoch = self._source_epoch
        match_signature = sdr_match.model_dump_json() if sdr_match is not None else "inactive"
        signature = (
            adjustment_signature(adjustments)
            + local_adjustment_signature(local_adjustments)
            + match_signature
            + repr(self.color_context.cache_key)
        )
        key = (source_epoch, kind.value, edge, signature)

        source, sdr_reference = self._proxies(edge)
        refusals = strip_execution_refusals(
            adjustments,
            kind,
            local_adjustments=local_adjustments,
            sdr_match=sdr_match,
            denoise_active=denoise_active,
            source_width=source.shape[1],
            source_height=source.shape[0],
            long_edge=edge,
        )
        if refusals:
            raise StripExecutionRefused(refusals)

        with self._lock:
            cached = self._frames.get(key)
            if cached is not None:
                self._hits += 1
                self._frames.move_to_end(key)
        if cached is not None:
            from .cpu_strips import plan_strips
            from .scopes import scope_peak_value

            plan = plan_strips(cached.shape[1], cached.shape[0], budget_bytes=budget_bytes)
            with self._lock:
                peak = self._frame_scope_peaks.get(key)
            passes = ("cached",)
            if peak is None:
                # `_frames` is shared with `adjusted_frame`, which never
                # measures a peak, so a hit can land on a frame this path did
                # not render. Measure it now, one strip at a time out of the
                # frame already in hand, rather than return a bounded response
                # that cannot say what it presented.
                peak = 0.0
                for top, bottom in plan.strips:
                    peak = max(peak, scope_peak_value(cached[top:bottom], kind, self.color_context))
                passes = ("cached", "scope-peak")
                with self._lock:
                    if key in self._frames:
                        self._frame_scope_peaks[key] = peak
            return cached, StripReport(plan=plan, passes=passes, scope_peak_value=peak)

        if is_current is not None and not is_current():
            with self._lock:
                self._stale_cancellations += 1
            raise StaleRender("A newer adjustment replaced this render.")

        try:
            processed, report = render_in_strips(
                source,
                adjustments,
                kind,
                sdr_reference_image=sdr_reference,
                color_context=self.color_context,
                source_pixel_scale=min(1.0, edge / max(self.image.shape[:2])),
                long_edge=edge,
                local_adjustments=local_adjustments,
                sdr_match=sdr_match,
                denoise_active=denoise_active,
                budget_bytes=budget_bytes,
                is_current=is_current,
            )
        except StripCancelled as exc:
            with self._lock:
                self._stale_cancellations += 1
            raise StaleRender("A newer adjustment replaced this render.") from exc

        with self._lock:
            self._misses += 1
            self._frames[key] = processed
            if report.scope_peak_value is not None:
                self._frame_scope_peaks[key] = float(report.scope_peak_value)
            self._evict_locked()
        return processed, report

    def scope_result(
        self,
        adjustments: AdjustmentState,
        kind: PreviewKind,
        long_edge: int,
        mode: str,
        bins: int,
        columns: int,
        max_nits: int = 4000,
        is_current: Callable[[], bool] | None = None,
        local_adjustments: list[LocalAdjustment] | None = None,
        channel_names: tuple[str, ...] | None = None,
        scope_region: tuple[float, float, float, float] | None = None,
        sdr_match: SdrMatchState | None = None,
    ) -> Any:
        """Return a cached, single-flight scope payload for the adjusted proxy."""
        edge = max(256, int(long_edge))
        with self._lock:
            source_epoch = self._source_epoch
        match_signature = sdr_match.model_dump_json() if sdr_match is not None else "inactive"
        signature = adjustment_signature(adjustments) + local_adjustment_signature(local_adjustments) + match_signature + repr(self.color_context.cache_key)
        requested_channels = tuple(channel_names or ("R", "G", "B", "Y"))
        region_key = tuple(round(float(value), 6) for value in scope_region) if scope_region is not None else None
        key = (source_epoch, kind.value, edge, signature, mode, int(bins), int(columns), int(max_nits), requested_channels, region_key)
        flight_key = ("scope", *key)
        while True:
            with self._lock:
                cached = self._scopes.get(key)
                if cached is not None:
                    self._hits += 1
                    self._scopes.move_to_end(key)
                    return cached.model_copy(deep=True)
                if is_current is not None and not is_current():
                    self._stale_cancellations += 1
                    raise StaleRender("A newer scope request replaced this one.")
                flight = self._inflight.get(flight_key)
                if flight is None:
                    flight = Event()
                    self._inflight[flight_key] = flight
                    self._misses += 1
                    break
                self._singleflight_waits += 1
            flight.wait()

        try:
            from .models import ScopeMode
            from .scopes import build_scope_from_processed

            processed = self.adjusted_frame(
                adjustments,
                kind,
                edge,
                is_current=is_current,
                local_adjustments=local_adjustments,
                _record_diagnostics=False,
                sdr_match=sdr_match,
            )
            if is_current is not None and not is_current():
                with self._lock:
                    self._stale_cancellations += 1
                raise StaleRender("A newer scope request replaced this one.")
            processed = scope_region_view(processed, region_key)
            result = build_scope_from_processed(
                processed,
                kind,
                mode=ScopeMode(mode),
                bins=bins,
                waveform_columns=columns,
                max_nits=max_nits,
                color_context=self.color_context,
                channel_names=requested_channels,
            )
            if is_current is not None and not is_current():
                with self._lock:
                    self._stale_cancellations += 1
                raise StaleRender("A newer scope request replaced this one.")
            with self._lock:
                self._scopes[key] = result.model_copy(deep=True)
                while len(self._scopes) > 12:
                    self._scopes.popitem(last=False)
                    self._evictions += 1
        finally:
            with self._lock:
                if self._inflight.get(flight_key) is flight:
                    self._inflight.pop(flight_key, None)
                flight.set()
        return result

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            source_bytes = int(self.image.nbytes) + int(self.sdr_reference_image.nbytes if self.sdr_reference_image is not None else 0)
            proxy_bytes = self._proxy_bytes_locked()
            frame_bytes = sum(int(frame.nbytes) for frame in self._frames.values())
            matched_base_bytes = sum(int(frame.nbytes) for frame in self._matched_sdr_bases.values())
            scope_bytes = sum(len(scope.model_dump_json().encode("utf-8")) for scope in self._scopes.values())
            mask_bytes = sum(int(mask.nbytes) for mask in self._masks.values())
            source_mip = self.mip_store.diagnostics() if self.mip_store is not None else None
            source_identity = self.source_identity.digest() if self.source_identity is not None else None
            return {
                "source_bytes": source_bytes,
                "proxy_bytes": proxy_bytes,
                "frame_bytes": frame_bytes,
                "matched_sdr_base_bytes": matched_base_bytes,
                "matched_sdr_base_entries": len(self._matched_sdr_bases),
                "scope_bytes": scope_bytes,
                "local_mask_bytes": mask_bytes,
                "local_mask_entries": len(self._masks),
                "local_mask_budget_bytes": 160 * 1024 * 1024 if any(key[1] > 1600 for key in self._masks) else 96 * 1024 * 1024,
                "managed_bytes": source_bytes + proxy_bytes + frame_bytes + matched_base_bytes + scope_bytes + mask_bytes,
                "entries": len(self._source_proxies) + len(self._frames) + len(self._matched_sdr_bases) + len(self._scopes) + len(self._masks),
                "hits": self._hits,
                "misses": self._misses,
                "evictions": self._evictions,
                "in_flight": len(self._inflight),
                "singleflight_waits": self._singleflight_waits,
                "stale_cancellations": self._stale_cancellations,
                "source_mip": source_mip,
                "source_mip_identity": source_identity,
            }

    def _proxies(self, long_edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        edge = max(256, int(long_edge))
        with self._lock:
            return self._proxies_locked(edge)

    def _proxies_locked(self, edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        self._source_proxies[edge] = self._source_level_locked(edge, PreviewKind.HDR)
        if self.sdr_reference_image is None:
            self._sdr_proxies[edge] = None
        else:
            self._sdr_proxies[edge] = self._source_level_locked(edge, PreviewKind.SDR)
        self._source_proxies.move_to_end(edge)
        self._sdr_proxies.move_to_end(edge)
        while len(self._source_proxies) > self.max_proxy_levels:
            old_edge, _ = self._source_proxies.popitem(last=False)
            self._sdr_proxies.pop(old_edge, None)
            self._evictions += 1
        return self._source_proxies[edge], self._sdr_proxies[edge]

    def _source_level_locked(self, edge: int, kind: PreviewKind) -> np.ndarray:
        """Return one source level, through the persistent mip store when present.

        The store holds pre-adjustment scene-linear levels keyed by source
        identity and edge, so a warm request reads a level rather than
        downsampling the decoded frame again. The store is consulted on every
        request so the level state it reports describes the request that was
        just answered; without a store this is the original path, with the
        session's small LRU in front.
        """
        image = self.image if kind == PreviewKind.HDR else self.sdr_reference_image
        identity = self.source_identity if kind == PreviewKind.HDR else self.sdr_identity
        if identity is not None and self.mip_store is not None and image is not None:
            level, state = self.mip_store.level(identity, edge, image)
        else:
            session_proxies = self._source_proxies if kind == PreviewKind.HDR else self._sdr_proxies
            cached = session_proxies.get(edge)
            if cached is not None:
                self._source_level_states.setdefault(
                    edge, "native" if edge >= max(image.shape[:2]) else "session"
                )
                return cached
            level = downsample_image(image, edge)
            state = "native" if edge >= max(image.shape[:2]) else "session"
        source = np.ascontiguousarray(level, dtype=np.float32)
        source.setflags(write=False)
        self._source_level_states[edge] = state
        return source

    def source_level_state(self, long_edge: int) -> str | None:
        """How the last request for this edge was answered (telemetry)."""
        edge = max(256, int(long_edge))
        with self._lock:
            return self._source_level_states.get(edge)

    def _proxy_bytes_locked(self) -> int:
        source = sum(int(proxy.nbytes) for proxy in self._source_proxies.values())
        sdr = sum(int(proxy.nbytes) for proxy in self._sdr_proxies.values() if proxy is not None)
        roll = sum(int(frame.nbytes) for _base, frame in self._roll_frame.values())
        return source + sdr + roll

    def _compiled_masks(
        self,
        source: np.ndarray,
        adjustments: AdjustmentState,
        local_adjustments: list[LocalAdjustment] | None,
        edge: int,
        *,
        source_epoch: int,
    ) -> dict[str, np.ndarray] | None:
        active = [item for item in (local_adjustments or []) if item.enabled and item.opacity > 0.0]
        if not active:
            return None
        geometry = adjustments.shared.geometry
        geometry_signature = geometry.model_dump_json()
        compiled: dict[str, np.ndarray] = {}
        for local in active:
            mask_signature = spatial_mask_signature(local.mask)
            key = (source_epoch, edge, geometry_signature, local.id, mask_signature)
            flight_key = ("mask", *key)
            while True:
                with self._lock:
                    mask = self._masks.get(key)
                    if mask is not None:
                        self._hits += 1
                        self._masks.move_to_end(key)
                        break
                    # A request that outlived source replacement may finish for
                    # its original caller, but must not join or populate the
                    # current source's cache.
                    if source_epoch != self._source_epoch:
                        flight = None
                        break
                    flight = self._inflight.get(flight_key)
                    if flight is None:
                        flight = Event()
                        self._inflight[flight_key] = flight
                        break
                    self._singleflight_waits += 1
                flight.wait()

            if mask is None:
                owns_flight = flight is not None
                try:
                    mask = compile_geometry_fixed_mask(source, local.mask, geometry, spatial_only=True)
                    mask.setflags(write=False)
                    with self._lock:
                        if source_epoch == self._source_epoch:
                            existing = self._masks.get(key)
                            if existing is None:
                                self._masks[key] = mask
                                self._misses += 1
                                self._evict_masks_locked(160 * 1024 * 1024 if edge > 1600 else 96 * 1024 * 1024)
                            else:
                                mask = existing
                finally:
                    if owns_flight:
                        with self._lock:
                            # Invalidation may already have detached this event.
                            if self._inflight.get(flight_key) is flight:
                                self._inflight.pop(flight_key, None)
                            flight.set()
            compiled[local.id] = mask
        return compiled

    def _evict_masks_locked(self, budget: int) -> None:
        total = sum(int(mask.nbytes) for mask in self._masks.values())
        while self._masks and total > budget:
            _key, removed = self._masks.popitem(last=False)
            total -= int(removed.nbytes)
            self._evictions += 1

    def _evict_locked(self) -> None:
        def cached_bytes() -> int:
            return (
                self._proxy_bytes_locked()
                + sum(int(frame.nbytes) for frame in self._frames.values())
                + sum(int(frame.nbytes) for frame in self._matched_sdr_bases.values())
            )

        while self._frames and (len(self._frames) > self.max_frames or cached_bytes() > self.max_cache_bytes):
            evicted, _ = self._frames.popitem(last=False)
            self._frame_scope_peaks.pop(evicted, None)
            self._evictions += 1

    def _cancel_inflight_locked(self) -> None:
        for event in self._inflight.values():
            event.set()
        self._inflight.clear()


def encode_rgba32f_proxy(image: np.ndarray) -> tuple[bytes, int]:
    """Return WebGPU-ready rows whose byte stride is aligned to 256 bytes."""
    height, width = image.shape[:2]
    row_bytes = width * 4 * np.dtype(np.float32).itemsize
    padded_row_bytes = ((row_bytes + 255) // 256) * 256
    row_floats = padded_row_bytes // np.dtype(np.float32).itemsize
    packed = np.empty((height, row_floats), dtype="<f4")
    if row_floats > width * 4:
        packed[:, width * 4 :] = 0
    rgba = packed[:, : width * 4].reshape(height, width, 4)
    rgba[..., :3] = image[..., :3]
    rgba[..., 3] = 1.0
    return packed.tobytes(), padded_row_bytes


def encode_rgba_proxy(image: np.ndarray, prefer_half: bool = True) -> tuple[bytes, int, str]:
    """Pack an aligned float proxy, using half float when its finite range is safe."""
    source = image.astype(np.float32, copy=False)
    if source.size:
        # Scalar reductions avoid the two full-frame temporary arrays created
        # by isfinite(source) and abs(source) on every new GPU proxy level.
        minimum = float(np.min(source))
        maximum = float(np.max(source))
        half_limit = float(np.finfo(np.float16).max)
        safe_half = bool(np.isfinite(minimum) and np.isfinite(maximum) and minimum >= -half_limit and maximum <= half_limit)
    else:
        safe_half = True
    if not prefer_half or not safe_half:
        body, bytes_per_row = encode_rgba32f_proxy(source)
        return body, bytes_per_row, "rgba32float"

    height, width = source.shape[:2]
    row_bytes = width * 4 * np.dtype(np.float16).itemsize
    padded_row_bytes = ((row_bytes + 255) // 256) * 256
    row_values = padded_row_bytes // np.dtype(np.float16).itemsize
    packed = np.empty((height, row_values), dtype="<f2")
    if row_values > width * 4:
        packed[:, width * 4 :] = 0
    rgba = packed[:, : width * 4].reshape(height, width, 4)
    rgba[..., :3] = source[..., :3]
    rgba[..., 3] = np.float16(1.0)
    return packed.tobytes(), padded_row_bytes, "rgba16float"
