"""Film stock colour and tone from baked manufacturer data.

A stock file (``film_stocks/<id>.json``, baked offline by
``tools/bake_film_stocks.py``) holds the curves and tables of one negative
stock and its print paper. ``render_film_stock`` runs the chain F described in
the Film Stock spec: linear sRGB -> film layer exposure -> film density (two
passes for the DIR couplers) -> print exposure -> print density -> linear
sRGB. Everything is per pixel, so strips and tiles render it exactly.

The WebGPU film pass runs the same chain. Keep the two in step: every lookup
here is a plain clamped linear (1D) or trilinear (3D) interpolation on a
uniform axis, written out in index math so the shader can mirror it.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np


FILM_STOCK_FORMAT = "hdr-finisher-film-stock/1"
FILM_STOCK_DIR = Path(__file__).resolve().with_name("film_stocks")
FILM_STOCK_IDS = (
    "kodak_portra_400",
    "kodak_portra_160",
    "kodak_portra_800",
    "kodak_ektar_100",
    "kodak_gold_200",
    "fujifilm_pro_400h",
)
CURVE_SAMPLES = 256
LOG_EPSILON = np.float32(1e-10)

# Slider -> physical scale factor (spec "Runtime recipe"). Print warmth and
# tint use each stock's own baked filter shift: 100% is a 20 CC enlarger shift.
PREFLASH_SCALE = 0.1


@dataclass(frozen=True)
class StockTable:
    """A uniform 3D table, values flattened as ``[(i0 * N + i1) * N + i2]``."""

    size: int
    domain_min: np.ndarray
    scale: np.ndarray
    values: np.ndarray


@dataclass(frozen=True)
class FilmStock:
    id: str
    name: str
    attribution: str
    input_matrix: np.ndarray
    film_range: tuple[np.float32, np.float32]
    film_curves_plain: np.ndarray
    film_curves_corrected: np.ndarray
    coupler_matrix: np.ndarray
    coupler_high_exposure_shift: np.float32
    print_table: StockTable
    preflash_raw: np.ndarray
    print_warmth_log_shift: np.ndarray
    print_tint_log_shift: np.ndarray
    print_range: tuple[np.float32, np.float32]
    print_curves: np.ndarray
    scan_table: StockTable


@dataclass(frozen=True)
class StockParameters:
    """Physical stage parameters derived from the Film stock sliders."""

    exposure_gain: np.float32
    separation_gain: np.float32
    warmth: np.float32  # Print warmth slider / 100
    tint: np.float32  # Print tint slider / 100
    preflash: np.float32


class FilmStockError(ValueError):
    pass


_cache: dict[tuple[str, str], FilmStock] = {}
_cache_lock = Lock()


def film_stock_path(stock_id: str) -> Path | None:
    """Return the data file for a known stock id, or None when there is none."""
    if stock_id not in FILM_STOCK_IDS:
        return None
    path = FILM_STOCK_DIR / f"{stock_id}.json"
    return path if path.is_file() else None


def load_film_stock(stock_id: str) -> FilmStock | None:
    """Load and cache a stock. Unknown ids and missing files return None."""
    path = film_stock_path(stock_id)
    if path is None:
        return None
    key = (str(path), stock_id)
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    stock = parse_film_stock(payload, stock_id)
    with _cache_lock:
        _cache[key] = stock
    return stock


def available_film_stocks() -> list[dict[str, str]]:
    """``[{id, name, attribution}]`` for every stock whose data file is present."""
    entries: list[dict[str, str]] = []
    for stock_id in FILM_STOCK_IDS:
        stock = load_film_stock(stock_id)
        if stock is not None:
            entries.append({"id": stock.id, "name": stock.name, "attribution": stock.attribution})
    return entries


def clear_film_stock_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _array(payload: dict[str, Any], key: str, shape: tuple[int, ...]) -> np.ndarray:
    try:
        value = np.asarray(payload[key], dtype=np.float64)
    except (KeyError, TypeError, ValueError) as exc:
        raise FilmStockError(f"Film stock field '{key}' is missing or not numeric.") from exc
    if value.shape != shape:
        raise FilmStockError(f"Film stock field '{key}' has shape {value.shape}, expected {shape}.")
    if not np.all(np.isfinite(value)):
        raise FilmStockError(f"Film stock field '{key}' holds a non-finite value.")
    return value.astype(np.float32)


def _range(payload: dict[str, Any], key: str) -> tuple[np.float32, np.float32]:
    low, high = _array(payload, key, (2,))
    if not high > low:
        raise FilmStockError(f"Film stock field '{key}' must increase.")
    return np.float32(low), np.float32(high)


def _table(payload: dict[str, Any], key: str) -> StockTable:
    raw = payload.get(key)
    if not isinstance(raw, dict):
        raise FilmStockError(f"Film stock field '{key}' is missing.")
    size = raw.get("size")
    if not isinstance(size, int) or size < 2:
        raise FilmStockError(f"Film stock table '{key}' has an invalid size.")
    domain_min = _array(raw, "domain_min", (3,))
    domain_max = _array(raw, "domain_max", (3,))
    values = _array(raw, "values", (size * size * size * 3,)).reshape(size * size * size, 3)
    span = domain_max.astype(np.float64) - domain_min.astype(np.float64)
    # A flat axis samples index 0 everywhere rather than dividing by zero.
    scale = np.where(span > 0.0, (size - 1) / np.where(span > 0.0, span, 1.0), 0.0)
    return StockTable(
        size=size,
        domain_min=domain_min,
        scale=scale.astype(np.float32),
        values=np.ascontiguousarray(values),
    )


def _shift(payload: dict[str, Any]) -> np.float32:
    try:
        value = float(payload.get("coupler_high_exposure_shift", 0.0))
    except (TypeError, ValueError) as exc:
        raise FilmStockError("Film stock field 'coupler_high_exposure_shift' is not numeric.") from exc
    if not math.isfinite(value):
        raise FilmStockError("Film stock field 'coupler_high_exposure_shift' is not finite.")
    return np.float32(value)


def parse_film_stock(payload: dict[str, Any], stock_id: str | None = None) -> FilmStock:
    if not isinstance(payload, dict) or payload.get("format") != FILM_STOCK_FORMAT:
        raise FilmStockError(f"Film stock data is not in the '{FILM_STOCK_FORMAT}' format.")
    identifier = str(payload.get("id", ""))
    if stock_id is not None and identifier != stock_id:
        raise FilmStockError(f"Film stock file for '{stock_id}' names '{identifier}'.")
    curve_shape = (CURVE_SAMPLES, 3)
    return FilmStock(
        id=identifier,
        name=str(payload.get("name", identifier)),
        attribution=str(payload.get("attribution", "")),
        input_matrix=_array(payload, "input_matrix", (3, 3)),
        film_range=_range(payload, "film_log_exposure_range"),
        film_curves_plain=np.ascontiguousarray(_array(payload, "film_curves_plain", curve_shape)),
        film_curves_corrected=np.ascontiguousarray(_array(payload, "film_curves_corrected", curve_shape)),
        coupler_matrix=_array(payload, "coupler_matrix", (3, 3)),
        coupler_high_exposure_shift=_shift(payload),
        print_table=_table(payload, "print_table"),
        preflash_raw=_array(payload, "preflash_raw", (3,)),
        print_warmth_log_shift=_array(payload, "print_warmth_log_shift", (3,)),
        print_tint_log_shift=_array(payload, "print_tint_log_shift", (3,)),
        print_range=_range(payload, "print_log_exposure_range"),
        print_curves=np.ascontiguousarray(_array(payload, "print_curves", curve_shape)),
        scan_table=_table(payload, "scan_table"),
    )


def stock_parameters(look: object) -> StockParameters:
    return StockParameters(
        exposure_gain=np.float32(2.0 ** float(look.stock_exposure)),
        separation_gain=np.float32(2.0 ** (float(look.stock_separation) / 100.0)),
        warmth=np.float32(float(look.stock_print_warmth) / 100.0),
        tint=np.float32(float(look.stock_print_tint) / 100.0),
        preflash=np.float32(float(look.stock_preflash) / 100.0 * PREFLASH_SCALE),
    )


_CHANNELS = np.arange(3, dtype=np.intp)


def _lerp(a: np.ndarray, b: np.ndarray, t: np.ndarray) -> np.ndarray:
    return a + (b - a) * t


def _curve(value: np.ndarray, curve: np.ndarray, value_range: tuple[np.float32, np.float32]) -> np.ndarray:
    """Per-channel linear interpolation on a uniform 256-sample axis, clamped."""
    low, high = value_range
    position = (value - low) * np.float32((CURVE_SAMPLES - 1) / (float(high) - float(low)))
    np.clip(position, np.float32(0.0), np.float32(CURVE_SAMPLES - 1), out=position)
    index = np.minimum(position.astype(np.intp), CURVE_SAMPLES - 2)
    fraction = position - index.astype(np.float32)
    flat = curve.reshape(-1)
    lower = index * 3 + _CHANNELS
    return _lerp(np.take(flat, lower), np.take(flat, lower + 3), fraction)


def _lookup_table(value: np.ndarray, table: StockTable) -> np.ndarray:
    """Trilinear lookup, inputs clamped to the table's domain."""
    size = table.size
    position = (value - table.domain_min) * table.scale
    np.clip(position, np.float32(0.0), np.float32(size - 1), out=position)
    index = np.minimum(position.astype(np.intp), size - 2)
    fraction = position - index.astype(np.float32)
    f0 = fraction[:, 0:1]
    f1 = fraction[:, 1:2]
    f2 = fraction[:, 2:3]
    base = (index[:, 0] * size + index[:, 1]) * size + index[:, 2]
    stride0 = size * size
    stride1 = size
    values = table.values

    def corner(offset: int) -> np.ndarray:
        return np.take(values, base + offset, axis=0)

    near = _lerp(_lerp(corner(0), corner(1), f2), _lerp(corner(stride1), corner(stride1 + 1), f2), f1)
    far = _lerp(
        _lerp(corner(stride0), corner(stride0 + 1), f2),
        _lerp(corner(stride0 + stride1), corner(stride0 + stride1 + 1), f2),
        f1,
    )
    return _lerp(near, far, f0)


def _film_density(stock: FilmStock, exposure: np.ndarray) -> np.ndarray:
    """Film layer exposure (linear, n x 3) -> developed film density."""
    log_exposure = np.log10(exposure + LOG_EPSILON)
    first = _curve(log_exposure, stock.film_curves_plain, stock.film_range)
    shifted = first + stock.coupler_high_exposure_shift * first * first
    corrected = log_exposure - shifted @ stock.coupler_matrix
    return _curve(corrected, stock.film_curves_corrected, stock.film_range)


def _print_and_scan(stock: FilmStock, density: np.ndarray, parameters: StockParameters) -> np.ndarray:
    """Film density -> print -> scanned linear sRGB."""
    print_log = _lookup_table(density, stock.print_table)
    if parameters.warmth != 0.0 or parameters.tint != 0.0:
        # Enlarger filter shift, main exposure only (not the preflash).
        print_log += (
            parameters.warmth * stock.print_warmth_log_shift
            + parameters.tint * stock.print_tint_log_shift
        )
    print_raw = np.power(np.float32(10.0), print_log)
    if parameters.preflash != 0.0:
        print_raw += parameters.preflash * stock.preflash_raw
    print_density = _curve(np.log10(print_raw + LOG_EPSILON), stock.print_curves, stock.print_range)
    return _lookup_table(print_density, stock.scan_table)


def _film_exposure(stock: FilmStock, rgb: np.ndarray, parameters: StockParameters) -> np.ndarray:
    exposure = rgb.astype(np.float32, copy=False) @ stock.input_matrix.T
    np.maximum(exposure, np.float32(0.0), out=exposure)
    exposure *= parameters.exposure_gain
    return exposure


def render_film_stock(stock: FilmStock, rgb: np.ndarray, parameters: StockParameters) -> np.ndarray:
    """The chain F on linear sRGB (n x 3), without colour separation."""
    density = _film_density(stock, _film_exposure(stock, rgb, parameters))
    return _print_and_scan(stock, density, parameters)


def render_film_stock_with_grey(
    stock: FilmStock,
    rgb: np.ndarray | None,
    grey_rgb: np.ndarray,
    parameters: StockParameters,
) -> tuple[np.ndarray | None, np.ndarray]:
    """F of each pixel and of its matching grey, inputs and outputs linear sRGB.

    ``grey_rgb`` is the working-space grey ``(Y, Y, Y)`` converted to linear
    sRGB exactly as the pixel was, so a grey pixel and its grey take the same
    path. Colour separation scales the pixel's film density about the grey's
    density, so greys are untouched. ``rgb`` may be None when only the grey
    chain is needed (Stock colour at zero).
    """
    grey_density = _film_density(stock, _film_exposure(stock, grey_rgb, parameters))
    film = None
    if rgb is not None:
        density = _film_density(stock, _film_exposure(stock, rgb, parameters))
        if parameters.separation_gain != 1.0:
            density = grey_density + (density - grey_density) * parameters.separation_gain
        film = _print_and_scan(stock, density, parameters)
    grey = _print_and_scan(stock, grey_density, parameters)
    return film, grey
