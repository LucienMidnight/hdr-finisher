from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from threading import Event, RLock
from typing import Any, Callable

import numpy as np

from .adjustments import apply_adjustments
from .finishing import apply_geometry, geometry_coordinate_map
from .local_adjustments import (
    compile_geometry_fixed_mask,
    mask_influence_opacity,
    sample_luminance_evs,
    spatial_mask_signature,
)
from .models import AdjustmentState, LocalAdjustment, MaskExpression, MaskPoint, PreviewKind
from .preview import downsample_image


class StaleRender(RuntimeError):
    """Raised before expensive work when a newer render superseded this one."""


def adjustment_signature(adjustments: AdjustmentState) -> str:
    payload = adjustments.model_dump(mode="json")
    shared = payload.get("shared", {})
    for key in ("overlay_mode", "overlay_preset", "overlay_opacity", "overlay_threshold"):
        shared.pop(key, None)
    return AdjustmentState.model_validate(payload).model_dump_json()


def local_adjustment_signature(local_adjustments: list[LocalAdjustment] | None) -> str:
    if not local_adjustments:
        return "[]"
    return "[" + ",".join(item.model_dump_json() for item in local_adjustments) + "]"


@dataclass
class SessionRenderCache:
    image: np.ndarray
    sdr_reference_image: np.ndarray | None
    max_frames: int = 6
    max_cache_bytes: int = 192 * 1024 * 1024
    max_proxy_levels: int = 2
    _lock: RLock = field(default_factory=RLock, init=False, repr=False)
    _source_proxies: OrderedDict[int, np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    _sdr_proxies: OrderedDict[int, np.ndarray | None] = field(default_factory=OrderedDict, init=False, repr=False)
    _frames: OrderedDict[tuple[str, int, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    _scopes: OrderedDict[tuple[str, int, str, str, int, int, int], Any] = field(default_factory=OrderedDict, init=False, repr=False)
    _masks: OrderedDict[tuple[int, str, str, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)
    _geometry_maps: OrderedDict[tuple[int, str], tuple[tuple[float, ...], tuple[float, ...], int, int]] = field(default_factory=OrderedDict, init=False, repr=False)
    _inflight: dict[tuple[object, ...], Event] = field(default_factory=dict, init=False, repr=False)
    _hits: int = field(default=0, init=False, repr=False)
    _misses: int = field(default=0, init=False, repr=False)
    _evictions: int = field(default=0, init=False, repr=False)
    _singleflight_waits: int = field(default=0, init=False, repr=False)
    _stale_cancellations: int = field(default=0, init=False, repr=False)

    def replace_source(self, image: np.ndarray, sdr_reference_image: np.ndarray | None) -> None:
        with self._lock:
            self.image = image
            self.sdr_reference_image = sdr_reference_image
            self._source_proxies.clear()
            self._sdr_proxies.clear()
            self._frames.clear()
            self._scopes.clear()
            self._masks.clear()
            self._geometry_maps.clear()
            self._cancel_inflight_locked()

    def clear_adjusted(self, *, clear_masks: bool = False) -> None:
        with self._lock:
            self._frames.clear()
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
    ) -> tuple[np.ndarray, str, str]:
        """Return the authoritative geometry-fixed source for a GPU grade proxy."""
        proxy, working_space = self.source_proxy(kind, long_edge)
        geometry = adjustments.shared.geometry
        signature = geometry.model_dump_json()
        return apply_geometry(proxy, geometry), working_space, signature

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
        source, _sdr_reference = self._proxies(edge)
        # The overlay remains inspectable while the adjustment is bypassed.
        # Rendering filters disabled/zero-opacity locals, so compile an enabled
        # view of this one mask without changing the persisted adjustment.
        mask_source = local_adjustment.model_copy(update={"enabled": True, "opacity": 1.0})
        masks = self._compiled_masks(source, adjustments, [mask_source], edge)
        assert masks is not None
        mask = masks[local_adjustment.id]
        if spatial_only or mask_influence_opacity(local_adjustment.mask) >= 1.0:
            return mask
        # The compatibility/influence endpoint remains byte-identical to the
        # authoritative evaluator. Interactive GPU clients request spatial_only
        # and keep the reusable base texture resident instead.
        return compile_geometry_fixed_mask(source, local_adjustment.mask, adjustments.shared.geometry)

    def compiled_mask_draft(
        self,
        adjustments: AdjustmentState,
        expression: MaskExpression,
        long_edge: int,
    ) -> np.ndarray:
        """Compile an uncommitted mask with the exact settled-render pipeline."""
        edge = max(256, int(long_edge))
        source, _sdr_reference = self._proxies(edge)
        return compile_geometry_fixed_mask(source, expression, adjustments.shared.geometry)

    def sample_luminance(
        self,
        adjustments: AdjustmentState,
        points: list[MaskPoint],
        long_edge: int,
    ) -> tuple[float, float, float, int]:
        """Sample the same fixed ACEScg source used by content masks."""
        edge = max(256, int(long_edge))
        source, _sdr_reference = self._proxies(edge)
        fixed_source = apply_geometry(source, adjustments.shared.geometry)
        return sample_luminance_evs(fixed_source, points)

    def adjusted_frame(
        self,
        adjustments: AdjustmentState,
        kind: PreviewKind,
        long_edge: int,
        is_current: Callable[[], bool] | None = None,
        local_adjustments: list[LocalAdjustment] | None = None,
    ) -> np.ndarray:
        edge = max(256, int(long_edge))
        signature = adjustment_signature(adjustments) + local_adjustment_signature(local_adjustments)
        key = (kind.value, edge, signature)
        flight_key = ("frame", *key)
        while True:
            with self._lock:
                cached = self._frames.get(key)
                if cached is not None:
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
                    self._misses += 1
                    source, sdr_reference = self._proxies_locked(edge)
                    break
                self._singleflight_waits += 1
            flight.wait()

        try:
            compiled_masks = self._compiled_masks(source, adjustments, local_adjustments, edge)
            processed = apply_adjustments(
                source,
                adjustments,
                kind,
                sdr_reference_image=sdr_reference,
                local_adjustments=local_adjustments,
                compiled_local_masks=compiled_masks,
            )
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
                completed = self._inflight.pop(flight_key, None)
                if completed is not None:
                    completed.set()
        return processed

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
    ) -> Any:
        """Return a cached, single-flight scope payload for the adjusted proxy."""
        edge = max(256, int(long_edge))
        signature = adjustment_signature(adjustments) + local_adjustment_signature(local_adjustments)
        key = (kind.value, edge, signature, mode, int(bins), int(columns), int(max_nits))
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
            )
            result = build_scope_from_processed(
                processed,
                kind,
                mode=ScopeMode(mode),
                bins=bins,
                waveform_columns=columns,
                max_nits=max_nits,
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
                completed = self._inflight.pop(flight_key, None)
                if completed is not None:
                    completed.set()
        return result

    def diagnostics(self) -> dict[str, int]:
        with self._lock:
            source_bytes = int(self.image.nbytes) + int(self.sdr_reference_image.nbytes if self.sdr_reference_image is not None else 0)
            proxy_bytes = self._proxy_bytes_locked()
            frame_bytes = sum(int(frame.nbytes) for frame in self._frames.values())
            scope_bytes = sum(len(scope.model_dump_json().encode("utf-8")) for scope in self._scopes.values())
            mask_bytes = sum(int(mask.nbytes) for mask in self._masks.values())
            return {
                "source_bytes": source_bytes,
                "proxy_bytes": proxy_bytes,
                "frame_bytes": frame_bytes,
                "scope_bytes": scope_bytes,
                "local_mask_bytes": mask_bytes,
                "local_mask_entries": len(self._masks),
                "local_mask_budget_bytes": 160 * 1024 * 1024 if any(key[0] > 1600 for key in self._masks) else 96 * 1024 * 1024,
                "managed_bytes": source_bytes + proxy_bytes + frame_bytes + scope_bytes + mask_bytes,
                "entries": len(self._source_proxies) + len(self._frames) + len(self._scopes) + len(self._masks),
                "hits": self._hits,
                "misses": self._misses,
                "evictions": self._evictions,
                "in_flight": len(self._inflight),
                "singleflight_waits": self._singleflight_waits,
                "stale_cancellations": self._stale_cancellations,
            }

    def _proxies(self, long_edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        edge = max(256, int(long_edge))
        with self._lock:
            return self._proxies_locked(edge)

    def _proxies_locked(self, edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        if edge not in self._source_proxies:
            source = np.ascontiguousarray(downsample_image(self.image, edge), dtype=np.float32)
            source.setflags(write=False)
            self._source_proxies[edge] = source
        if edge not in self._sdr_proxies:
            if self.sdr_reference_image is None:
                self._sdr_proxies[edge] = None
            else:
                reference = np.ascontiguousarray(downsample_image(self.sdr_reference_image, edge), dtype=np.float32)
                reference.setflags(write=False)
                self._sdr_proxies[edge] = reference
        self._source_proxies.move_to_end(edge)
        self._sdr_proxies.move_to_end(edge)
        while len(self._source_proxies) > self.max_proxy_levels:
            old_edge, _ = self._source_proxies.popitem(last=False)
            self._sdr_proxies.pop(old_edge, None)
            self._evictions += 1
        return self._source_proxies[edge], self._sdr_proxies[edge]

    def _proxy_bytes_locked(self) -> int:
        source = sum(int(proxy.nbytes) for proxy in self._source_proxies.values())
        sdr = sum(int(proxy.nbytes) for proxy in self._sdr_proxies.values() if proxy is not None)
        return source + sdr

    def _compiled_masks(
        self,
        source: np.ndarray,
        adjustments: AdjustmentState,
        local_adjustments: list[LocalAdjustment] | None,
        edge: int,
    ) -> dict[str, np.ndarray] | None:
        active = [item for item in (local_adjustments or []) if item.enabled and item.opacity > 0.0]
        if not active:
            return None
        geometry = adjustments.shared.geometry
        geometry_signature = geometry.model_dump_json()
        compiled: dict[str, np.ndarray] = {}
        for local in active:
            mask_signature = spatial_mask_signature(local.mask)
            key = (edge, geometry_signature, local.id, mask_signature)
            with self._lock:
                mask = self._masks.get(key)
                if mask is not None:
                    self._hits += 1
                    self._masks.move_to_end(key)
            if mask is None:
                mask = compile_geometry_fixed_mask(source, local.mask, geometry, spatial_only=True)
                mask.setflags(write=False)
                with self._lock:
                    existing = self._masks.get(key)
                    if existing is None:
                        self._masks[key] = mask
                        self._misses += 1
                        self._evict_masks_locked(160 * 1024 * 1024 if edge > 1600 else 96 * 1024 * 1024)
                    else:
                        mask = existing
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
            return self._proxy_bytes_locked() + sum(int(frame.nbytes) for frame in self._frames.values())

        while self._frames and (len(self._frames) > self.max_frames or cached_bytes() > self.max_cache_bytes):
            self._frames.popitem(last=False)
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
    packed = np.zeros((height, row_floats), dtype="<f4")
    rgba = packed[:, : width * 4].reshape(height, width, 4)
    rgba[..., :3] = image[..., :3]
    rgba[..., 3] = 1.0
    return packed.tobytes(), padded_row_bytes


def encode_rgba_proxy(image: np.ndarray, prefer_half: bool = True) -> tuple[bytes, int, str]:
    """Pack an aligned float proxy, using half float when its finite range is safe."""
    source = image.astype(np.float32, copy=False)
    finite = bool(np.all(np.isfinite(source)))
    safe_half = finite and (source.size == 0 or float(np.max(np.abs(source))) <= float(np.finfo(np.float16).max))
    if not prefer_half or not safe_half:
        body, bytes_per_row = encode_rgba32f_proxy(source)
        return body, bytes_per_row, "rgba32float"

    height, width = source.shape[:2]
    row_bytes = width * 4 * np.dtype(np.float16).itemsize
    padded_row_bytes = ((row_bytes + 255) // 256) * 256
    row_values = padded_row_bytes // np.dtype(np.float16).itemsize
    packed = np.zeros((height, row_values), dtype="<f2")
    rgba = packed[:, : width * 4].reshape(height, width, 4)
    rgba[..., :3] = source[..., :3]
    rgba[..., 3] = np.float16(1.0)
    return packed.tobytes(), padded_row_bytes, "rgba16float"
