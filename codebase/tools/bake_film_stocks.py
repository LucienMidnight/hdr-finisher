"""Bake HDR Finisher film-stock tables from a spektrafilm checkout.

This is an offline tool. It is not imported by the app. It needs a local
clone of spektrafilm (https://github.com/andreavolpato/spektrafilm) and that
project's core runtime dependencies (numpy, scipy, colour-science,
opt-einsum, numba, scikit-image, matplotlib). The optional image-IO
dependencies (OpenImageIO, exiv2, rawpy, lensfunpy, pyfftw) are not needed
and are stubbed out if missing.

Usage:
    python tools/bake_film_stocks.py <path-to-spektrafilm-clone> [--out DIR]

For each stock it builds spektrafilm's default parameters for the stock and
its target print paper, switches off everything spatial or random (grain,
halation, diffusion, blur, unsharp mask, coupler diffusion), turns off auto
exposure, uses the 'mallett2019' RGB-to-film-exposure method (linear in RGB),
and then samples spektrafilm's own functions into the tables described in the
"hdr-finisher-film-stock/1" format:

    input_matrix           linear sRGB -> film layer exposure (3x3)
    film_curves_plain      film density curves, minimum subtracted
    film_curves_corrected  the same curves before DIR-coupler inhibition
    coupler_matrix         DIR-coupler matrix (donor row, receiver column)
    print_table            film density -> print log10 exposure (33^3),
                           including spektrafilm's mid-grey print exposure
                           normalisation and neutral enlarger filters
    preflash_raw           print exposure added per unit of preflash
    print_warmth_log_shift print log exposure change for a full-scale
    print_tint_log_shift   warmth / tint slider (enlarger Y / M filter
                           shift of -print_filter_cc_full_scale CC)
    print_curves           print paper density curves
    scan_table             print density -> linear sRGB (33^3), including the
                           mean of spektrafilm's print glare (a constant
                           0.03 % of the viewing white); no gamut compression,
                           no clipping, no transfer function

The data in the resulting files is derived from spektrafilm's stock profiles,
which are licensed CC BY-SA 4.0 by Andrea Volpato. See
backend/hdr_finisher/film_stocks/CHANGELOG.txt.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import types
from pathlib import Path

import numpy as np

FORMAT = "hdr-finisher-film-stock/1"
ATTRIBUTION = (
    "Derived from spektrafilm by Andrea Volpato, https://github.com/andreavolpato/spektrafilm, "
    "licensed CC BY-SA 4.0. Modified (re-sampled into HDR Finisher tables) by the HDR Finisher project."
)
STOCKS = {
    "kodak_portra_400": "Kodak Portra 400",
    "kodak_portra_160": "Kodak Portra 160",
    "kodak_portra_800": "Kodak Portra 800",
    "kodak_ektar_100": "Kodak Ektar 100",
    "kodak_gold_200": "Kodak Gold 200",
    "fujifilm_pro_400h": "Fujifilm Pro 400H",
}
TABLE_SIZE = 33
CURVE_SAMPLES = 256
FILTER_SHIFT_CC = 20.0  # enlarger filter shift (Kodak CC) at a full-scale warmth / tint slider
OPTIONAL_MODULES = ("exiv2", "rawpy", "lensfunpy", "OpenImageIO", "pyfftw",
                    "pyfftw.interfaces", "pyfftw.interfaces.numpy_fft", "pyfftw.interfaces.scipy_fft")

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "backend" / "hdr_finisher" / "film_stocks"


def setup_spektrafilm(clone: Path) -> None:
    """Make spektrafilm importable from a clone, stubbing unused optional modules."""
    # colour-science probes OpenImageIO itself; import it first so it uses its
    # own fallback instead of the stub below.
    import colour  # noqa: F401
    import colour.io  # noqa: F401

    for name in OPTIONAL_MODULES:
        try:
            if importlib.util.find_spec(name.split(".")[0]) is not None:
                continue
        except (ImportError, ValueError):
            pass
        stub = types.ModuleType(name)
        stub.__path__ = []

        def _missing(attr, _name=name):
            raise ImportError(f"{_name}.{attr} is not installed (not needed for baking)")

        stub.__getattr__ = _missing
        sys.modules[name] = stub
    src = str(Path(clone).resolve() / "src")
    if src not in sys.path:
        sys.path.insert(0, src)


def build_params(film_profile: str, *, rgb_to_raw_method: str = "mallett2019",
                 preflash: float = 0.0, y_filter_shift: float = 0.0, m_filter_shift: float = 0.0,
                 output_gamut_compress: bool = False):
    """spektrafilm default params for the stock + its target print, deterministic and non-spatial."""
    from spektrafilm.profiles.io import load_profile
    from spektrafilm.runtime.params_builder import init_params
    from spektrafilm.utils.gamut_compression import OutputGamutCompressSpec

    print_profile = load_profile(film_profile).info.target_print
    params = init_params(film_profile=film_profile, print_profile=print_profile)
    params.camera.auto_exposure = False
    params.camera.exposure_compensation_ev = 0.0
    params.film_render.grain.active = False
    params.film_render.halation.active = False
    params.debug.deactivate_spatial_effects = True
    params.io.input_color_space = "sRGB"
    params.io.input_cctf_decoding = False
    params.io.output_color_space = "sRGB"
    params.io.output_cctf_encoding = False
    if not output_gamut_compress:
        params.io.output_gamut_compress = OutputGamutCompressSpec(algorithm="off")
    params.settings.rgb_to_raw_method = rgb_to_raw_method
    params.settings.use_enlarger_lut = False
    params.settings.use_scanner_lut = False
    params.enlarger.preflash_exposure = preflash
    params.enlarger.y_filter_shift = y_filter_shift
    params.enlarger.m_filter_shift = m_filter_shift
    return params


def build_pipeline(params):
    from spektrafilm.runtime.params_builder import digest_params
    from spektrafilm.runtime.pipeline import SimulationPipeline

    return SimulationPipeline(digest_params(params))


def _grid(lo, hi, n):
    axes = [np.linspace(lo[k], hi[k], n) for k in range(3)]
    g0, g1, g2 = np.meshgrid(*axes, indexing="ij")
    return np.stack([g0, g1, g2], axis=-1).reshape(1, -1, 3)


def _r(values) -> list:
    """Round to 7 significant digits as plain floats (nested lists kept)."""
    arr = np.asarray(values, dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        raise ValueError("non-finite value in baked table")
    flat = [float(f"{v:.7g}") for v in arr.ravel()]
    return np.array(flat).reshape(arr.shape).tolist()


def bake_stock(stock_id: str) -> dict:
    from spektrafilm.model.couplers import compute_density_curves_before_dir_couplers, compute_dir_couplers_matrix
    from spektrafilm.model.illuminants import standard_illuminant
    from spektrafilm.utils.morph_curves import apply_print_curves_morph

    pipe = build_pipeline(build_params(stock_id))
    film, prt = pipe.film, pipe.print
    if film.info.type != "negative" or prt.info.type != "negative":
        raise ValueError(f"{stock_id}: only negative film on negative paper is supported by format 1")
    fstage, pstage, sstage = pipe._filming_stage, pipe._printing_stage, pipe._scanning_stage
    cref = pipe._color_reference_service

    # 1. Linear sRGB -> film raw exposure. mallett2019 is linear in RGB, so
    #    probing the three unit vectors gives the exact matrix.
    raw_cols = fstage._rgb_to_film_raw(np.eye(3)[None, :, :], color_space="sRGB", apply_cctf_decoding=False)[0]
    input_matrix = raw_cols.T * (2.0 ** pipe.camera.exposure_compensation_ev)
    input_matrix = input_matrix * cref.black_white_filming_exposure_correction()

    # 2. Film density curves (develop() normalises by the per-channel minimum)
    #    and the coupler-corrected curves used for the second pass.
    log_exposure = np.asarray(film.data.log_exposure, dtype=np.float64)
    if log_exposure.size != CURVE_SAMPLES or np.ptp(np.diff(log_exposure)) > 1e-9:
        raise ValueError(f"{stock_id}: film log exposure axis is not uniform with {CURVE_SAMPLES} samples")
    if pipe.film_render.density_curve_gamma != 1.0:
        raise ValueError("density_curve_gamma != 1 is not supported")
    curves = np.asarray(film.data.density_curves, dtype=np.float64)
    curves_plain = curves - np.nanmin(curves, axis=0)
    dirc = pipe.film_render.dir_couplers
    coupler_matrix = compute_dir_couplers_matrix(dirc) * dirc.amount if dirc.active else np.zeros((3, 3))
    curves_corrected = (compute_density_curves_before_dir_couplers(curves_plain, log_exposure, coupler_matrix, positive=False)
                        if dirc.active else curves_plain.copy())

    # 3. Film density -> print log raw (spectral enlarger, neutral filters,
    #    mid-grey normalisation). Preflash is kept out of the table.
    d_min = np.zeros(3)
    d_max = np.nanmax(curves_plain, axis=0)
    saved_preflash = pipe.enlarger.preflash_exposure
    pipe.enlarger.preflash_exposure = 0.0
    log_raw = pstage._film_cmy_to_print_log_raw(_grid(d_min, d_max, TABLE_SIZE))
    pipe.enlarger.preflash_exposure = 1.0
    sens = np.nan_to_num(10 ** np.asarray(prt.data.log_sensitivity))
    preflash_raw = np.asarray(pstage._compute_raw_preflash(standard_illuminant(pipe.enlarger.illuminant), sens)).reshape(3)
    pipe.enlarger.preflash_exposure = saved_preflash
    print_gain = pipe.enlarger.print_exposure * cref.black_white_printing_exposure_correction()
    print_values = log_raw[0] + np.log10(print_gain)
    preflash_raw = preflash_raw * print_gain

    # 3b. Enlarger filter shifts. spektrafilm's Y/M filter shift changes the
    #     filtered enlarger light and re-normalises the mid-grey exposure; at a
    #     given filter shift the result is very close to a constant shift of
    #     the three print log exposures, independent of the film density.
    #     Measured at the film density of mid-grey (0.184) for a full-scale
    #     slider (100 % = FILTER_SHIFT_CC): warmth = less Y filter, tint =
    #     less M filter (more magenta).
    grey_density = pipe.process(np.full((1, 1, 3), 0.184), collect="cmy_film")
    base_log_raw = pstage._film_cmy_to_print_log_raw(grey_density)[0, 0]
    filter_shifts = {}
    for key, kwargs in (("warmth", {"y_filter_shift": -FILTER_SHIFT_CC}),
                        ("tint", {"m_filter_shift": -FILTER_SHIFT_CC})):
        shifted = build_pipeline(build_params(stock_id, **kwargs))
        shifted.enlarger.preflash_exposure = 0.0
        filter_shifts[key] = shifted._printing_stage._film_cmy_to_print_log_raw(grey_density)[0, 0] - base_log_raw

    # 4. Print paper density curves (fitted model, morph off = spektrafilm default).
    p_log_exposure = np.asarray(prt.data.log_exposure, dtype=np.float64)
    if p_log_exposure.size != CURVE_SAMPLES or np.ptp(np.diff(p_log_exposure)) > 1e-9:
        raise ValueError(f"{stock_id}: print log exposure axis is not uniform with {CURVE_SAMPLES} samples")
    print_curves = apply_print_curves_morph(p_log_exposure, prt.data.density_curves_model,
                                            pipe.print_render.density_curves_morph, profile_type=prt.info.type)

    # 5. Print density -> linear sRGB, with the mean of the print glare added.
    pd_min = np.min(print_curves, axis=0)
    pd_max = np.max(print_curves, axis=0)
    scan_values = scan_density_to_rgb(pipe, _grid(pd_min, pd_max, TABLE_SIZE))[0]

    return {
        "format": FORMAT,
        "id": stock_id,
        "name": STOCKS[stock_id],
        "film_profile": stock_id,
        "print_profile": prt.info.stock,
        "attribution": ATTRIBUTION,
        "input_matrix": _r(input_matrix),
        "film_log_exposure_range": _r([log_exposure[0], log_exposure[-1]]),
        "film_curves_plain": _r(curves_plain),
        "film_curves_corrected": _r(curves_corrected),
        "coupler_matrix": _r(coupler_matrix),
        "coupler_high_exposure_shift": 0.0,
        "print_table": {"size": TABLE_SIZE, "domain_min": _r(d_min), "domain_max": _r(d_max),
                        "values": _r(print_values.ravel())},
        "preflash_raw": _r(preflash_raw),
        "print_filter_cc_full_scale": FILTER_SHIFT_CC,
        "print_warmth_log_shift": _r(filter_shifts["warmth"]),
        "print_tint_log_shift": _r(filter_shifts["tint"]),
        "print_log_exposure_range": _r([p_log_exposure[0], p_log_exposure[-1]]),
        "print_curves": _r(print_curves),
        "scan_table": {"size": TABLE_SIZE, "domain_min": _r(pd_min), "domain_max": _r(pd_max),
                       "values": _r(scan_values.ravel())},
    }


def mean_glare(xyz, illuminant_xyz, glare):
    """Deterministic stand-in for spektrafilm's add_glare: its mean value."""
    if glare is not None and glare.active and glare.percent > 0:
        return xyz + (glare.percent / 100.0) * np.asarray(illuminant_xyz)[None, None, :]
    return xyz


def scan_density_to_rgb(pipe, density):
    """spektrafilm's ScanningStage._density_to_rgb with the glare replaced by its mean."""
    import spektrafilm.runtime.stages.scanning as scanning

    original = scanning.add_glare
    scanning.add_glare = mean_glare
    try:
        return pipe._scanning_stage._density_to_rgb(density, use_lut=False)
    finally:
        scanning.add_glare = original


def write_stock(data: dict, out_dir: Path) -> Path:
    path = out_dir / f"{data['id']}.json"
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=True)
    path.write_bytes((text + "\n").encode("utf-8"))
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Bake HDR Finisher film-stock tables from a spektrafilm clone.")
    parser.add_argument("spektrafilm", type=Path, help="path to the spektrafilm clone (folder with src/)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default: backend/hdr_finisher/film_stocks)")
    parser.add_argument("--stock", action="append", choices=sorted(STOCKS), help="bake only this stock (repeatable)")
    args = parser.parse_args()

    setup_spektrafilm(args.spektrafilm)
    args.out.mkdir(parents=True, exist_ok=True)
    for stock_id in args.stock or list(STOCKS):
        path = write_stock(bake_stock(stock_id), args.out)
        print(f"wrote {path}")
    license_src = Path(args.spektrafilm) / "SPEKTRAFILM_LICENSE.txt"
    shutil.copyfile(license_src, args.out / "SPEKTRAFILM_LICENSE.txt")
    print(f"copied {license_src.name}")


if __name__ == "__main__":
    main()
