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

ALGORITHM = "hdrf-patchmatch-cpu-v2"
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
    tone_aligned: bool = False

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


def _patch_mean(image, radius):
    padded = np.pad(image, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    integral = np.pad(padded, ((1, 0), (1, 0), (0, 0))).cumsum(0).cumsum(1)
    k = 2 * radius + 1
    return (integral[k:, k:] - integral[:-k, k:] - integral[k:, :-k] + integral[:-k, :-k]) / (k * k)


def _tone_guide(image, defect, excluded, radius):
    """Quadratic continuation from a local known ring, never dirty pixels.

    A degree-two surface can continue local highlight curvature and gradients;
    fitting it to the whole search region would flatten that curvature. This
    guide carries tone only; patch search still supplies detail and edges.
    """
    h, w = excluded.shape
    yy, xx = np.mgrid[:h, :w]
    ring = (_box_sum(defect, 2 * radius + 2) > 0) & ~excluded
    if np.count_nonzero(ring) < 6:
        raise ValueError("Not enough clean context for tone continuation")
    ys, xs = np.nonzero(defect)
    u = (xx - xs.mean()) / max(float(np.ptp(xs)), 1)
    v = (yy - ys.mean()) / max(float(np.ptp(ys)), 1)
    design = np.stack((np.ones_like(u), u, v, u * u, u * v, v * v), axis=-1)
    # Very narrow image borders may not constrain all quadratic terms. Least
    # squares uses a minimum-norm solution; no inverse or random fallback.
    fit = np.linalg.lstsq(design[ring], image[ring].astype(np.float64), rcond=None)[0]
    # A large isolated known-pixel jump indicates a structural edge, where a
    # smooth tone continuation would invent a ramp across it. Disable DC
    # alignment for that solve. Compare RGB gradient norms, not luminance, so
    # an isoluminant colour boundary is protected as well.
    gradients = []
    for axis in (0, 1):
        adjacent = np.take(ring, range(ring.shape[axis] - 1), axis=axis) & np.take(
            ring, range(1, ring.shape[axis]), axis=axis)
        delta = np.diff(image.astype(np.float64), axis=axis)
        gradients.extend(np.linalg.norm(delta[adjacent], axis=-1))
    gradients = np.asarray(gradients)
    median = float(np.median(gradients)) if len(gradients) else 0.0
    peak = float(gradients.max()) if len(gradients) else 0.0
    residual_rms = float(np.sqrt(np.mean((design[ring] @ fit - image[ring]) ** 2)))
    signal_rms = float(np.sqrt(np.mean(image[ring].astype(np.float64) ** 2)))
    align_tone = (peak <= max(12 * median, float(np.max(np.abs(image[ring]))) * 1e-6)
                  and residual_rms <= max(.1 * signal_rms, 1e-30))
    guide = image.astype(np.float64)
    if align_tone:
        guide[excluded] = (design[excluded] @ fit)
    else:
        fit = np.linalg.lstsq(design[~excluded, :3], image[~excluded].astype(np.float64), rcond=None)[0]
        guide[excluded] = design[excluded, :3] @ fit
    return guide, align_tone


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
        known = ~excluded
        work, align_tone = _tone_guide(image, defect, excluded, r)
        guide_mean = _patch_mean(work, r)[targets[:, 0], targets[:, 1]]
        # Common scalar avoids overflow without changing RGB SSD ordering.
        scale = max(float(np.max(np.abs(image[known]))), 1e-12)
        # Zero excluded values before integral means: even an extreme dirty
        # value must not cause cancellation error in a distant clean patch.
        source = np.where(excluded[..., None], 0, image).astype(np.float64) / scale
        source_mean = _patch_mean(source, r)
        confidence = np.where(excluded[ty, tx], 0.0, 1.0)
        confidence[defect[ty, tx]] = 0.25

        def score(candidate, target):
            sy = candidate[:, 0, None] + offsets[:, 0]
            sx = candidate[:, 1, None] + offsets[:, 1]
            donor_mean = source_mean[candidate[:, 0], candidate[:, 1]]
            diff = source[sy, sx] - target
            if align_tone:
                diff -= donor_mean[:, None, :]
            return np.sum(diff * diff * confidence[..., None], axis=(1, 2))

        for iteration in range(settings.iterations):
            checkpoint()
            target_samples = work[ty, tx] / scale
            target = target_samples - target_samples.mean(axis=1, keepdims=True) if align_tone else target_samples
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
                values = image[field[inside, 0] + oy, field[inside, 1] + ox].astype(np.float64)
                if align_tone:
                    values += (guide_mean[inside] - source_mean[field[inside, 0], field[inside, 1]] * scale)
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
                           result, field, targets, align_tone)
