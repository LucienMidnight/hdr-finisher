"""Bounded experimental CPU repair engine; deliberately not in the render path.

SPDX-FileCopyrightText: 2017 Eugene Ingerman
SPDX-License-Identifier: GPL-3.0-only
PatchMatch search adapted from Krita kis_inpaint.cpp (Eugene Ingerman, 2017,
GPL-2.0-or-later). See THIRD_PARTY_NOTICES.md for revision and provenance.
No Qt, paint-device, colour-space or pyramid code is imported.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

import numpy as np

ALGORITHM = "hdrf-patchmatch-cpu-v1"
MAX_REGION_EDGE = 256
MAX_DEFECT_PIXELS = 4096
MAX_TARGET_PATCHES = 8192


@dataclass(frozen=True)
class InpaintSettings:
    patch_radius: int = 3
    iterations: int = 6
    seed: int = 20261021
    algorithm: str = ALGORITHM

    def __post_init__(self):
        if self.algorithm != ALGORITHM:
            raise ValueError("Unsupported repair algorithm version")
        for value, low, high in ((self.patch_radius, 1, 5), (self.iterations, 1, 12),
                                 (self.seed, 0, 2**32 - 1)):
            if type(value) is not int or not low <= value <= high:
                raise ValueError("Invalid inpaint settings")


@dataclass(frozen=True)
class RepairInput:
    """One full-resolution source ROI, never a display tier or output tile.

    mask is both the blend alpha and defect exclusion (every nonzero pixel).
    excluded additionally marks other defects that must not be sampled.
    origin is the ROI's (x,y) in the uncropped source. The caller must fetch
    the entire search ROI, including context outside the viewport/crop.
    """
    pixels: np.ndarray
    mask: np.ndarray
    origin: tuple[int, int] = (0, 0)
    excluded: np.ndarray | None = None

    def owned(self) -> "RepairInput":
        p, m = self.pixels, self.mask
        if p.dtype != np.float32 or p.ndim != 3 or p.shape[2] != 3:
            raise ValueError("Repair requires float32 working RGB")
        h, w = p.shape[:2]
        if not 3 <= min(h, w) or max(h, w) > MAX_REGION_EDGE:
            raise ValueError("Repair ROI must be 3..256 pixels on each axis")
        if m.shape != (h, w) or not np.isfinite(m).all() or np.any((m < 0) | (m > 1)):
            raise ValueError("Repair mask must be finite alpha in [0,1]")
        if not np.isfinite(p).all():
            raise ValueError("Repair pixels must be finite")
        if not 1 <= np.count_nonzero(m) <= MAX_DEFECT_PIXELS:
            raise ValueError("Repair must cover 1..4096 pixels")
        if len(self.origin) != 2 or any(type(v) is not int or v < 0 for v in self.origin):
            raise ValueError("Invalid source origin")
        e = m > 0
        if self.excluded is not None:
            if self.excluded.shape != m.shape or self.excluded.dtype != np.bool_:
                raise ValueError("Additional exclusion must be a boolean ROI mask")
            e = e | self.excluded
        return RepairInput(p.copy(), m.astype(np.float32, copy=True), self.origin, e.copy())


@dataclass(frozen=True)
class RepairPatch:
    """Completed replacement rectangle, already blended; no full-frame owner."""
    origin: tuple[int, int]
    pixels: np.ndarray
    # Final nearest source centres, ROI-relative (y,x), for inspection.
    source_centres: np.ndarray
    target_centres: np.ndarray

    @property
    def nbytes(self):
        return self.pixels.nbytes + self.source_centres.nbytes + self.target_centres.nbytes


class RepairEngine(Protocol):
    """Future Heal/Clone/GPU engines can implement the same ROI/job boundary."""
    def solve(self, request: RepairInput, settings: InpaintSettings,
              checkpoint: Callable[[], None]) -> RepairPatch: ...


def _box_sum(mask, radius):
    padded = np.pad(mask.astype(np.int32), radius)
    integral = np.pad(padded, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    k = 2 * radius + 1
    return integral[k:, k:] - integral[:-k, k:] - integral[k:, :-k] + integral[:-k, :-k]


class CpuInpaint:
    """Single-scale PatchMatch plus overlapping patch voting for small dust.

    Alternating propagation and shrinking random search follow Krita's NNF;
    NumPy executes patch scoring/gathers in compiled loops. Jacobi propagation
    batches all target centres, unlike Krita's scanline updates. No SDR clamp,
    integer distance quantisation or independent per-tier pyramid is used.
    """
    def solve(self, request, settings=InpaintSettings(), checkpoint=lambda: None):
        checkpoint()
        request = request.owned()
        image, alpha, excluded = request.pixels, request.mask, request.excluded
        h, w = alpha.shape
        r = settings.patch_radius
        if min(h, w) < 2 * r + 1:
            raise ValueError("ROI too small for patch radius")
        valid = _box_sum(excluded, r) == 0
        valid[:r] = valid[-r:] = False
        valid[:, :r] = valid[:, -r:] = False
        sources = np.argwhere(valid)
        if not len(sources):
            raise ValueError("No complete defect-free source patch in search ROI")
        defect = alpha > 0
        targets = np.argwhere(_box_sum(defect, r) > 0)
        if len(targets) > MAX_TARGET_PATCHES:
            raise ValueError("Repair has too many target patches; use smaller spots")
        dy, dx = np.mgrid[-r:r + 1, -r:r + 1]
        offsets = np.stack((dy.ravel(), dx.ravel()), axis=1)
        ty = np.clip(targets[:, 0, None] + offsets[:, 0], 0, h - 1)
        tx = np.clip(targets[:, 1, None] + offsets[:, 1], 0, w - 1)
        lookup = np.full((h, w), -1, dtype=np.int32)
        lookup[targets[:, 0], targets[:, 1]] = np.arange(len(targets))
        rng = np.random.Generator(np.random.PCG64(settings.seed))
        field = sources[rng.integers(len(sources), size=len(targets))]
        # Fit a plane to known context solely to initialise missing target data.
        # Reconstruction still votes original, unmodified source pixels.
        yy, xx = np.mgrid[:h, :w]
        design = np.stack((np.ones_like(xx), xx / w, yy / h), axis=-1)
        known = ~excluded
        fit = np.linalg.lstsq(design[known], image[known].astype(np.float64), rcond=None)[0]
        work = image.astype(np.float64)
        work[defect] = (design @ fit)[defect]
        # Common scalar avoids overflow without changing RGB SSD ordering.
        scale = max(float(np.max(np.abs(image[known]))), 1e-12)
        source = image.astype(np.float64) / scale
        confidence = np.where(excluded[ty, tx], 0.0, 1.0)
        confidence[defect[ty, tx]] = 0.25

        def score(candidate, target):
            sy = candidate[:, 0, None] + offsets[:, 0]
            sx = candidate[:, 1, None] + offsets[:, 1]
            diff = source[sy, sx] - target
            return np.sum(diff * diff * confidence[..., None], axis=(1, 2))

        for iteration in range(settings.iterations):
            checkpoint()
            target = work[ty, tx] / scale
            distance = score(field, target)

            def consider(candidate):
                nonlocal field, distance
                in_bounds = ((candidate[:, 0] >= r) & (candidate[:, 0] < h - r)
                             & (candidate[:, 1] >= r) & (candidate[:, 1] < w - r))
                safe = np.clip(candidate, (r, r), (h - r - 1, w - r - 1))
                allowed = in_bounds & valid[safe[:, 0], safe[:, 1]]
                trial = score(safe, target)
                better = allowed & (trial < distance)
                field[better] = safe[better]
                distance[better] = trial[better]

            direction = 1 if iteration % 2 == 0 else -1
            for shift in ((direction, 0), (0, direction)):
                neighbour = targets - shift
                inside = ((neighbour[:, 0] >= 0) & (neighbour[:, 0] < h)
                          & (neighbour[:, 1] >= 0) & (neighbour[:, 1] < w))
                ni = lookup[np.clip(neighbour[:, 0], 0, h - 1), np.clip(neighbour[:, 1], 0, w - 1)]
                candidate = field[np.maximum(ni, 0)] + shift
                candidate[~inside | (ni < 0)] = -1
                consider(candidate)
            # One global proposal prevents a poor initial neighbourhood trapping
            # a link; subsequent searches halve their radius around the best.
            consider(sources[rng.integers(len(sources), size=len(targets))])
            radius = max(h, w)
            while radius >= 1:
                checkpoint()
                consider(field + rng.integers(-radius, radius + 1, size=field.shape))
                radius //= 2
            # Overlapping patches reconstruct only the defect. Rejecting full
            # source patches above means no vote can contain any marked defect.
            votes = np.zeros_like(work)
            weights = np.zeros((h, w), dtype=np.float64)
            for oy, ox in offsets:
                vy, vx = targets[:, 0] + oy, targets[:, 1] + ox
                inside = (vy >= 0) & (vy < h) & (vx >= 0) & (vx < w)
                vy, vx = vy[inside], vx[inside]
                values = image[field[inside, 0] + oy, field[inside, 1] + ox]
                # Equal voting is stable at zero SSD and does not amplify HDR.
                np.add.at(votes, (vy, vx), values)
                np.add.at(weights, (vy, vx), 1)
            work[defect] = votes[defect] / weights[defect, None]
        checkpoint()
        ys, xs = np.nonzero(defect)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        result = image[y0:y1, x0:x1].copy()
        local = defect[y0:y1, x0:x1]
        a = alpha[y0:y1, x0:x1][local, None].astype(np.float64)
        result[local] = (work[y0:y1, x0:x1][local] * a + result[local] * (1 - a)).astype(np.float32)
        if not np.isfinite(result).all():
            raise ValueError("Repair produced non-finite pixels")
        for array in (result, field, targets):
            array.flags.writeable = False
        return RepairPatch((request.origin[0] + int(x0), request.origin[1] + int(y0)),
                           result, field, targets)
