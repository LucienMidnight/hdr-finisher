"""Synthetic straight-response Neutral stock; no measured stock is impersonated.

The negative is logarithmic density, the ideal paper is a three-layer CDF,
and the ideal scanner inverts that SAME sampled paper curve. Thus the default
chain is straight; development and paper controls act at their physical stages.
Alternate papers and their scanner tables remain the measured baked data.
"""
from functools import lru_cache
from types import SimpleNamespace
import numpy as np
from .film_print_morph import PrintCurvesMorphParams, apply_print_curves_morph


@lru_cache(maxsize=8)
def neutral_payload(paper=None, contrast=0, shadows=0, highlights=0, lab_levels=False):
    from .film_stock import (film_stock_path, read_film_stock_payload, controlled_film_stock,
                             CURVE_SAMPLES)
    if paper not in (None, "kodak_portra_endura", "kodak_2383", "fujifilm_crystal_archive_typeii"):
        return None
    # This container only supplies the common array layout and measured optional
    # paper/filter/scan data. None of Portra's film curves, matrix or couplers run.
    payload = read_film_stock_payload(film_stock_path("kodak_portra_400", paper))
    axis = np.linspace(-6, 6, CURVE_SAMPLES)
    model = SimpleNamespace(centers=np.tile([-2.,0.,2.], (3,1)),
        amplitudes=np.full((3,3), 2.), sigmas=np.ones((3,3)), n_layers=3)
    baseline = apply_print_curves_morph(axis, model, PrintCurvesMorphParams(), profile_type="negative")
    real_paper = paper not in (None, "kodak_portra_endura")
    if real_paper:
        controlled = controlled_film_stock("kodak_portra_400", paper, contrast, shadows, highlights, lab_levels)
        payload["print_curves"] = controlled.print_curves.tolist()
        payload["scan_table"]["values"] = controlled.scan_table.values.ravel().tolist()
    else:
        params = PrintCurvesMorphParams(gamma_factor=2**(contrast/100),
            gamma_factor_fast=2**(highlights/100), gamma_factor_slow=2**(shadows/100),
            developer_exhaustion=max(0,-highlights/100))
        payload["print_curves"] = apply_print_curves_morph(axis, model, params, profile_type="negative").tolist()
        payload["print_log_exposure_range"] = [-6,6]
    # Scanner levels use upstream's 1%/98% encoded-sRGB targets, applied to Y.
    def linear(v):
        return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4
    black, white = linear(.01), linear(.98)
    payload.update(id="none", name="Neutral", type="neutral_paper" if real_paper else "neutral",
        film_profile="synthetic_neutral", input_matrix=np.eye(3).tolist(),
        film_log_exposure_range=[-6,6], film_curves_plain=baseline.tolist(),
        film_curves_corrected=baseline.tolist(), coupler_matrix=np.zeros((3,3)).tolist(),
        coupler_high_exposure_shift=0, film_density_max=[white-black,black,1] if lab_levels else [1,0,0],
        preflash_raw=[1,1,1])
    return payload
