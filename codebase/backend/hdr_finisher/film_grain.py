"""Film grain as a field of developed grains.

Grains are scattered over the frame as a Poisson process: every lattice cell
holds a random number of them (mean ``POISSON_MEAN``) at random positions,
each with its own radius and sensitivity. A grain develops where the picture's
exposure passes its sensitivity, so shadows carry a few distinct grains and
highlights a dense, merged layer. A slow mottle shifts development locally to
clump grains together. Developed grains overlap as a union: the coverage at a
pixel is one minus the product of what each grain lets through.

Colour negative stacks three dye layers of different grain sizes, each
developed by its own channel; black-and-white film has one layer of sharper,
denser silver grains developed by luminance.

The coverage is compared with its expected value at that exposure, which has a
closed form for a Poisson field, and divided by its spread, so Amount means the
same strength whatever the grain size or exposure. The WebGPU shader computes
the same field by gathering the grains around each pixel; this module splats
each grain onto the pixels it covers, which is much cheaper in NumPy. Every
pixel sums its grains in the same order however the frame is cut into strips,
so a strip render matches the whole-frame render exactly.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Many faint grains per cell rather than a few opaque ones: what shows at a
# pixel is a clump of tiny grains, which builds up as a soft cloud. A few
# opaque discs read as spots, and as a cracked network where they pack.
POISSON_MEAN = 6.0
MAX_GRAINS_PER_CELL = 16
# Poisson(6) cumulative probabilities for 0..15 grains; a cell draws its count
# by counting how many of these its uniform sample exceeds (more than 16 has
# probability 0.0002). Mirrored in the shader as literals.
POISSON_CDF = np.array(
    [0.00247875229, 0.017351266, 0.0619688034, 0.151203886,
     0.285056502, 0.445679635, 0.606302798, 0.743979752,
     0.847237468, 0.916076005, 0.957379103, 0.979908049,
     0.991172493, 0.996371508, 0.998599648, 0.999490917],
    dtype=np.float32,  # the shader's literals are f32; draws are exact 24-bit values
).astype(np.float64)
RADIUS_MIN = 0.3
RADIUS_SPAN = 0.4
RADIUS_MAX = RADIUS_MIN + RADIUS_SPAN
MEAN_RADIUS_SQUARED = (RADIUS_MAX**3 - RADIUS_MIN**3) / (3.0 * RADIUS_SPAN)
FOG = 0.06
DENSITY_MAX = 0.94
DEVELOP_RAMP = 0.04
MOTTLE_CELLS = 5.0
# The first grain field's RMS: keeps Amount at the strength it always had.
UNIT_RMS = 0.37
BAND_PIXEL_ROWS = 64
CHROMA_SPREAD = 0.6

COUNT_KEY = 999
MOTTLE_SALT = 101
GOLDEN = 0x9E3779B9
RAND_STEP = 0x85EBCA6B
MASK32 = 0xFFFFFFFF


@dataclass(frozen=True)
class GrainLayer:
    channel: int | None  # None: developed by luminance
    size: float
    salt: int


@dataclass(frozen=True)
class FilmType:
    layers: tuple[GrainLayer, ...]
    opacity: float
    clumping: float
    edge_hard: float  # how much of a grain's radius is solid at zero softness


FILM_TYPES: dict[str, FilmType] = {
    # Dye clouds: bell-shaped, three layers, the blue-sensitive one coarsest.
    "color_negative": FilmType(
        layers=(GrainLayer(0, 0.9, 211), GrainLayer(1, 1.0, 223), GrainLayer(2, 1.3, 227)),
        opacity=0.45,
        clumping=0.12,
        edge_hard=0.25,
    ),
    # Silver: one layer of firmer, denser grains, stronger clumping.
    "black_and_white": FilmType(
        layers=(GrainLayer(None, 1.0, 239),),
        opacity=0.55,
        clumping=0.20,
        edge_hard=0.45,
    ),
}


def film_type(name: str) -> FilmType:
    return FILM_TYPES.get(name, FILM_TYPES["color_negative"])


def edge_start(kind: FilmType, softness: float) -> float:
    """Fraction of a grain's radius that is solid before its edge falls off."""
    return kind.edge_hard * (1.0 - softness)


# --- hashing: 32-bit integer mixing, identical to the shader's u32 arithmetic.

def _mix(value: np.ndarray) -> np.ndarray:
    x = value & np.uint64(MASK32)
    x ^= x >> np.uint64(16)
    x = (x * np.uint64(0x7FEB352D)) & np.uint64(MASK32)
    x ^= x >> np.uint64(15)
    x = (x * np.uint64(0x846CA68B)) & np.uint64(MASK32)
    x ^= x >> np.uint64(16)
    return x


def seed_hash(seed: int, salt: int) -> np.uint64:
    return _mix(np.uint64((int(seed) + salt * GOLDEN) & MASK32))


def cell_hash(cx: np.ndarray, cy: np.ndarray, seeded: np.uint64) -> np.ndarray:
    as_u32 = lambda v: (np.asarray(v, dtype=np.int64) & MASK32).astype(np.uint64)  # noqa: E731
    return _mix(_mix(seeded ^ as_u32(cx)) ^ as_u32(cy))


def uniform(hashed: np.ndarray, key: int) -> np.ndarray:
    """A uniform [0, 1) draw keyed off a cell hash, 24 bits like the shader."""
    mixed = _mix(hashed + np.uint64((key * RAND_STEP) & MASK32))
    return (mixed >> np.uint64(8)).astype(np.float64) * (1.0 / 16777216.0)


def _value_noise(x: np.ndarray, y: np.ndarray, seeded: np.uint64) -> np.ndarray:
    """Smooth lattice noise over the grid of columns ``x`` and rows ``y``.

    The lattice is far coarser than the pixels, so its values are hashed once
    per lattice point and gathered, rather than hashed at every pixel.
    """
    x0 = np.floor(x)
    y0 = np.floor(y)
    tx = x - x0
    ty = y - y0
    tx = (tx * tx * (3.0 - 2.0 * tx))[None, :]
    ty = (ty * ty * (3.0 - 2.0 * ty))[:, None]
    xi = x0.astype(np.int64)
    yi = y0.astype(np.int64)
    lx = np.arange(xi.min(), xi.max() + 2, dtype=np.int64)
    ly = np.arange(yi.min(), yi.max() + 2, dtype=np.int64)
    grid_y, grid_x = np.meshgrid(ly, lx, indexing="ij")
    lattice = uniform(cell_hash(grid_x, grid_y, seeded), 0) * 2.0 - 1.0
    cols = (xi - lx[0])[None, :]
    rows = (yi - ly[0])[:, None]
    top = lattice[rows, cols] + (lattice[rows, cols + 1] - lattice[rows, cols]) * tx
    bottom = lattice[rows + 1, cols] + (lattice[rows + 1, cols + 1] - lattice[rows + 1, cols]) * tx
    return top + (bottom - top) * ty


# --- expected coverage of a Poisson grain field (Campbell's theorem).

def _profile_integrals(edge: float) -> tuple[float, float]:
    """Area integrals of a unit-radius grain's profile and its square."""
    run = 1.0 - edge
    first = 2.0 * np.pi * (edge * edge / 2.0 + run * (edge / 2.0 + 0.15 * run))
    second = 2.0 * np.pi * (edge * edge / 2.0 + run * (edge * 13.0 / 35.0 + run * 3.0 / 35.0))
    return first, second


def coverage_statistics(develop: np.ndarray, kind: FilmType, edge: float) -> tuple[np.ndarray, np.ndarray]:
    """Mean and standard deviation of coverage for a flat exposure."""
    first, second = _profile_integrals(edge)
    opacity = kind.opacity
    developed = develop
    developed_squared = develop - DEVELOP_RAMP / 6.0
    single = POISSON_MEAN * MEAN_RADIUS_SQUARED * opacity * developed * first
    double = POISSON_MEAN * MEAN_RADIUS_SQUARED * (
        2.0 * opacity * developed * first - opacity * opacity * developed_squared * second
    )
    transmit = np.exp(-single)
    transmit_squared = np.exp(-double)
    variance = np.maximum(transmit_squared - transmit * transmit, 0.0)
    return 1.0 - transmit, np.sqrt(variance)


def develop_level(signal: np.ndarray) -> np.ndarray:
    return FOG + (DENSITY_MAX - FOG) * np.clip(signal, 0.0, 1.0)


# --- the field itself.

def layer_coverage(
    signal: np.ndarray,
    left: int,
    top: int,
    pitch: float,
    seed: int,
    layer: GrainLayer,
    kind: FilmType,
    edge: float,
) -> np.ndarray:
    """Grain coverage over a region whose first pixel sits at (left, top) in the frame."""
    height, width = signal.shape
    seeded = seed_hash(seed, layer.salt)
    rows = np.arange(top, top + height, dtype=np.float64) / pitch
    cols = np.arange(left, left + width, dtype=np.float64) / pitch
    mottle = _value_noise(cols / MOTTLE_CELLS, rows / MOTTLE_CELLS, seed_hash(seed, layer.salt + MOTTLE_SALT))
    develop = develop_level(signal + np.float32(kind.clumping) * mottle.astype(np.float32)).astype(np.float32)

    first_cx = int(np.floor(left / pitch)) - 1
    last_cx = int(np.floor((left + width - 1) / pitch)) + 1
    first_cy = int(np.floor(top / pitch)) - 1
    last_cy = int(np.floor((top + height - 1) / pitch)) + 1
    cy, cx = np.meshgrid(
        np.arange(first_cy, last_cy + 1, dtype=np.int64),
        np.arange(first_cx, last_cx + 1, dtype=np.int64),
        indexing="ij",
    )
    hashed = cell_hash(cx.ravel(), cy.ravel(), seeded)
    count = np.searchsorted(POISSON_CDF, uniform(hashed, COUNT_KEY), side="left")

    # Grains in (cell row, cell column, slot) order: the same relative order in
    # any region, which keeps every pixel's sum identical across strips.
    slots = np.arange(MAX_GRAINS_PER_CELL, dtype=np.int64)
    present = slots[None, :] < count[:, None]
    cell_index, slot = np.nonzero(present)
    grain_hash = hashed[cell_index]
    base = slot * 8
    gx = cx.ravel()[cell_index] + _uniform_keyed(grain_hash, base + 1)
    gy = cy.ravel()[cell_index] + _uniform_keyed(grain_hash, base + 2)
    radius = RADIUS_MIN + RADIUS_SPAN * _uniform_keyed(grain_hash, base + 3)
    sensitivity = _uniform_keyed(grain_hash, base + 4)

    # Each grain's pixel box, clipped to the region: clipping only drops
    # pixels, never reorders what a kept pixel receives.
    x0 = np.maximum(np.ceil((gx - radius) * pitch).astype(np.int64), left)
    x1 = np.minimum(np.floor((gx + radius) * pitch).astype(np.int64), left + width - 1)
    y0 = np.maximum(np.ceil((gy - radius) * pitch).astype(np.int64), top)
    y1 = np.minimum(np.floor((gy + radius) * pitch).astype(np.int64), top + height - 1)
    keep = (x1 >= x0) & (y1 >= y0)
    grain_cy = cy.ravel()[cell_index][keep]
    # Single precision from here, as in the shader; the grain's box above was
    # placed in double precision so it never depends on rounding.
    gx, gy = gx[keep].astype(np.float32), gy[keep].astype(np.float32)
    radius, sensitivity = radius[keep].astype(np.float32), sensitivity[keep].astype(np.float32)
    x0, x1, y0, y1 = x0[keep], x1[keep], y0[keep], y1[keep]

    log_transmit = np.zeros((height, width), dtype=np.float32)
    develop_flat = develop.ravel()
    # Bands of grain rows fixed in frame coordinates bound the memory, and
    # every pixel adds its bands in the same order in any strip.
    band_rows = max(1, int(BAND_PIXEL_ROWS / pitch))
    band = np.floor_divide(grain_cy, band_rows)
    bounds = np.flatnonzero(np.diff(band)) + 1
    for start, stop in zip(np.r_[0, bounds], np.r_[bounds, band.size]):
        _splat_band(
            log_transmit, develop_flat, left, top, width, pitch, edge, kind.opacity,
            gx[start:stop], gy[start:stop], radius[start:stop], sensitivity[start:stop],
            x0[start:stop], x1[start:stop], y0[start:stop], y1[start:stop],
        )
    return np.float32(1.0) - np.exp(log_transmit)


def _splat_band(
    log_transmit: np.ndarray,
    develop_flat: np.ndarray,
    left: int,
    top: int,
    width: int,
    pitch: float,
    edge: float,
    opacity: float,
    gx: np.ndarray,
    gy: np.ndarray,
    radius: np.ndarray,
    sensitivity: np.ndarray,
    x0: np.ndarray,
    x1: np.ndarray,
    y0: np.ndarray,
    y1: np.ndarray,
) -> None:
    """Add one band of grains' log transmittance to the pixels their boxes cover."""
    box_w = x1 - x0 + 1
    box_area = box_w * (y1 - y0 + 1)
    grain = np.repeat(np.arange(gx.size), box_area)
    within = np.arange(grain.size) - np.repeat(np.cumsum(box_area) - box_area, box_area)
    px = x0[grain] + within % box_w[grain]
    py = y0[grain] + within // box_w[grain]
    inverse_pitch = np.float32(1.0 / pitch)
    du = px.astype(np.float32) * inverse_pitch - gx[grain]
    dv = py.astype(np.float32) * inverse_pitch - gy[grain]
    rho = np.sqrt(du * du + dv * dv) / radius[grain]
    inside = rho < np.float32(1.0)
    grain, px, py, rho = grain[inside], px[inside], py[inside], rho[inside]
    t = np.clip((rho - np.float32(edge)) * np.float32(1.0 / (1.0 - edge)), np.float32(0.0), np.float32(1.0))
    profile = np.float32(1.0) - t * t * (np.float32(3.0) - np.float32(2.0) * t)
    flat = (py - top) * width + (px - left)
    developed = np.clip(
        (develop_flat[flat] - sensitivity[grain]) * np.float32(1.0 / DEVELOP_RAMP) + np.float32(0.5),
        np.float32(0.0),
        np.float32(1.0),
    )
    weight = np.log1p(np.float32(-opacity) * developed * profile)
    first_row = int(py.min(initial=top) - top)
    last_row = int(py.max(initial=top) - top) + 1
    window = np.bincount(
        flat - first_row * width, weights=weight, minlength=(last_row - first_row) * width
    )
    log_transmit[first_row:last_row] += window.reshape(last_row - first_row, width).astype(np.float32)


def _uniform_keyed(hashed: np.ndarray, key: np.ndarray) -> np.ndarray:
    offset = ((key.astype(np.uint64) * np.uint64(RAND_STEP)) & np.uint64(MASK32))
    mixed = _mix(hashed + offset)
    return (mixed >> np.uint64(8)).astype(np.float64) * (1.0 / 16777216.0)


def grain_noise(
    signals: np.ndarray,
    luma_signal: np.ndarray,
    luma_weights: tuple[float, float, float],
    left: int,
    top: int,
    physical_pitch: float,
    seed: int,
    film_type_name: str,
    softness: float,
    chroma: np.ndarray,
) -> np.ndarray:
    """Per-channel grain in units of the first grain field, before Amount and response.

    ``signals`` holds each channel's display-encoded exposure (H, W, 3);
    ``luma_signal`` the encoded luminance; ``chroma`` how far each pixel's
    channels may separate (H, W). Returns (H, W, 3).
    """
    kind = film_type(film_type_name)
    edge = edge_start(kind, softness)
    mid_std = np.float32(coverage_statistics(np.float64(develop_level(np.float64(0.5))), kind, edge)[1])
    noises = []
    for layer in kind.layers:
        signal = luma_signal if layer.channel is None else signals[..., layer.channel]
        signal = signal.astype(np.float32, copy=False)
        pitch = max(1.0, physical_pitch * layer.size)
        coverage = layer_coverage(signal, left, top, pitch, seed, layer, kind, edge)
        mean, std = coverage_statistics(develop_level(signal), kind, edge)
        # Halfway between film's own granularity, which peaks at mid density,
        # and a flat response; the Response sliders shape the rest.
        noises.append((coverage - mean) / np.sqrt(np.maximum(std, np.float32(1e-4)) * mid_std))
    if len(noises) == 1:
        mono = noises[0] * np.float32(UNIT_RMS)
        return np.repeat(mono[..., None], 3, axis=-1)
    stacked = np.stack(noises, axis=-1)
    weights = np.asarray(luma_weights, dtype=np.float32)
    mono = (stacked @ weights) / np.float32(np.sqrt(np.sum(weights.astype(np.float64) ** 2)))
    spread = chroma.astype(np.float32, copy=False)[..., None] * np.float32(CHROMA_SPREAD)
    colour = mono[..., None] + spread * (stacked - mono[..., None])
    return colour * np.float32(UNIT_RMS)
