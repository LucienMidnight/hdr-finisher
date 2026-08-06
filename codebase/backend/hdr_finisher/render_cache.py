from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from threading import RLock
from typing import Callable

import numpy as np

from .adjustments import apply_adjustments
from .models import AdjustmentState, PreviewKind
from .preview import downsample_image


class StaleRender(RuntimeError):
    """Raised before expensive work when a newer render superseded this one."""


def adjustment_signature(adjustments: AdjustmentState) -> str:
    payload = adjustments.model_dump(mode="json")
    shared = payload.get("shared", {})
    for key in ("overlay_mode", "overlay_preset", "overlay_opacity", "overlay_threshold"):
        shared.pop(key, None)
    return AdjustmentState.model_validate(payload).model_dump_json()


@dataclass
class SessionRenderCache:
    image: np.ndarray
    sdr_reference_image: np.ndarray | None
    max_frames: int = 6
    _lock: RLock = field(default_factory=RLock, init=False, repr=False)
    _source_proxies: dict[int, np.ndarray] = field(default_factory=dict, init=False, repr=False)
    _sdr_proxies: dict[int, np.ndarray | None] = field(default_factory=dict, init=False, repr=False)
    _frames: OrderedDict[tuple[str, int, str], np.ndarray] = field(default_factory=OrderedDict, init=False, repr=False)

    def replace_source(self, image: np.ndarray, sdr_reference_image: np.ndarray | None) -> None:
        with self._lock:
            self.image = image
            self.sdr_reference_image = sdr_reference_image
            self._source_proxies.clear()
            self._sdr_proxies.clear()
            self._frames.clear()

    def source_proxy(self, kind: PreviewKind, long_edge: int) -> tuple[np.ndarray, str]:
        source, sdr_reference = self._proxies(long_edge)
        if kind == PreviewKind.SDR and sdr_reference is not None:
            return sdr_reference, "linear-srgb"
        return source, "acescg"

    def source_pair(self, long_edge: int) -> tuple[np.ndarray, np.ndarray | None]:
        """Return the matched source and authored-SDR proxy inputs used by exporters."""
        return self._proxies(long_edge)

    def adjusted_frame(
        self,
        adjustments: AdjustmentState,
        kind: PreviewKind,
        long_edge: int,
        is_current: Callable[[], bool] | None = None,
    ) -> np.ndarray:
        edge = max(256, int(long_edge))
        key = (kind.value, edge, adjustment_signature(adjustments))
        with self._lock:
            cached = self._frames.get(key)
            if cached is not None:
                self._frames.move_to_end(key)
                return cached
            if is_current is not None and not is_current():
                raise StaleRender("A newer adjustment replaced this render.")

            source, sdr_reference = self._proxies_locked(edge)
            processed = apply_adjustments(
                source,
                adjustments,
                kind,
                sdr_reference_image=sdr_reference,
            )
            if is_current is not None and not is_current():
                raise StaleRender("A newer adjustment replaced this render.")
            processed.setflags(write=False)
            self._frames[key] = processed
            while len(self._frames) > self.max_frames:
                self._frames.popitem(last=False)
            return processed

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
        return self._source_proxies[edge], self._sdr_proxies[edge]


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
