"""Extract fitted paper layers and scanner references at the pinned profile revision.

Does not rewrite any original stock table. Run with the film-bake environment:
    python tools/bake_film_controls.py <spektrafilm checkout>
Profile-derived data is CC BY-SA 4.0; algorithm is GPL-3.0 (see notices).
"""
from pathlib import Path
import json
import subprocess
import sys
import numpy as np
from bake_film_stocks import SOURCE_REVISION, DEFAULT_OUT, setup_spektrafilm, build_params, build_pipeline


def bake(clone: Path):
    revision = subprocess.check_output(["git", "-c", f"safe.directory={clone.resolve().as_posix()}",
                                       "-C", str(clone), "rev-parse", "HEAD"], text=True).strip()
    if revision != SOURCE_REVISION:
        raise ValueError(f"Expected {SOURCE_REVISION}, found {revision}")
    setup_spektrafilm(clone)
    result = {"source_revision": revision, "papers": {}, "scanner": {}}
    scanner_golden = {}
    for path in sorted(DEFAULT_OUT.glob("*.json")):
        stock = json.loads(path.read_text())
        if stock.get("format") != "hdr-finisher-film-stock/2":
            continue
        params = build_params(stock["id"], paper=stock["print_profile"])
        pipe = build_pipeline(params)
        paper = stock["print_profile"]
        if paper and paper not in result["papers"]:
            model = pipe.print.data.density_curves_model
            result["papers"][paper] = {"type": pipe.print.info.type,
                **{key: np.asarray(getattr(model, key)).tolist() for key in ("centers", "amplitudes", "sigmas")}}
        ref = pipe._color_reference_service
        # Register the same reference densities as upstream PrintingStage.expose.
        # Keep camera and enlarger exposure unchanged: this toggle is scanner-only.
        if stock["type"] != "slide":
            black = np.zeros((1, 1, 3)) - np.array(pipe.film_render.grain.density_min)
            white = np.nanmax(pipe.film.data.density_curves, axis=0)[None, None, :]
            ref.log_raw_print_black = pipe._printing_stage._film_cmy_to_print_log_raw(black)
            ref.log_raw_print_white = pipe._printing_stage._film_cmy_to_print_log_raw(white)
        ref._black_correction = ref._white_correction = True
        ref._update_cmy_black_white_references(in_print=stock["type"] != "slide")
        if ref._y_black is None or ref._y_white is None:
            # Upstream leaves positive cine print references unset. Use its
            # scanner's spectral endpoint densities rather than inventing levels.
            curves = np.asarray(pipe.print.data.density_curves)
            dark = np.nanmax(curves, axis=0)[None, None, :]
            light = np.nanmin(curves, axis=0)[None, None, :]
            ref._y_black = (10 ** ref.cmy_to_log_xyz(dark))[..., 1]
            ref._y_white = (10 ** ref.cmy_to_log_xyz(light))[..., 1]
        # The XYZ correction scales all channels before adding mean glare.
        # Store its small coefficients; runtime transforms the existing table.
        import colour
        from spektrafilm.config import STANDARD_OBSERVER_CMFS
        from spektrafilm.model.illuminants import standard_illuminant
        profile = pipe.film if stock["type"] == "slide" else pipe.print
        illuminant = standard_illuminant(profile.info.viewing_illuminant)
        illuminant_xyz = np.sum(illuminant[:, None] * STANDARD_OBSERVER_CMFS[:], axis=0) / np.sum(illuminant * STANDARD_OBSERVER_CMFS[:, 1])
        matrix = colour.XYZ_to_RGB(np.eye(3), colourspace="sRGB", apply_cctf_encoding=False,
                                  illuminant=colour.XYZ_to_xy(illuminant_xyz))
        y_weights = np.linalg.inv(matrix)[:, 1]
        glare = pipe.print_render.glare if stock["type"] != "slide" else None
        glare_rgb = (illuminant_xyz @ matrix) * (glare.percent / 100 if glare is not None and glare.active else 0)
        y_black, y_white = float(np.ravel(ref._y_black)[0]), float(np.ravel(ref._y_white)[0])
        m = (float(ref._white_level) - float(ref._black_level)) / (y_white - y_black + 1e-10)
        q = float(ref._black_level) - m * y_black
        result["scanner"][path.stem] = {"m": m, "q": q, "y_weights": y_weights.tolist(), "glare_rgb": glare_rgb.tolist()}
        if path.stem in ("kodak_portra_400", "kodak_portra_400__kodak_2383", "kodak_portra_400__fujifilm_crystal_archive_typeii", "fujifilm_provia_100f"):
            from bake_film_stocks import scan_density_to_rgb
            # Interior density points, compared with the upstream scanner itself.
            density = np.asarray([[[.1,.2,.3], [.5,.5,.5], [1,1.2,.7], [1.5,1.4,1.3]]])
            expected = scan_density_to_rgb(pipe, density)
            ref._black_correction = ref._white_correction = False
            original = scan_density_to_rgb(pipe, density)
            scanner_golden[path.stem] = {"original": original.tolist(), "expected": expected.tolist()}
        print(path.stem, flush=True)
    from types import SimpleNamespace
    from spektrafilm.utils.morph_curves import PrintCurvesMorphParams, apply_print_curves_morph
    golden = {}
    axis = [-2, -0.5, 0, 0.5, 2]
    for name, raw in result["papers"].items():
        model = SimpleNamespace(**{k: np.array(raw[k]) for k in ("centers", "amplitudes", "sigmas")}, n_layers=3)
        rows = []
        for gamma, fast, slow, exhaustion in [(1,1,1,0), (2,.5,2,0), (.5,2,.5,1), (1,1,1,.5)]:
            params = PrintCurvesMorphParams(gamma_factor=gamma, gamma_factor_fast=fast, gamma_factor_slow=slow, developer_exhaustion=exhaustion)
            values = apply_print_curves_morph(axis, model, params, profile_type=raw["type"])
            rows.append({"parameters": [gamma,fast,slow,exhaustion], "values": values.tolist()})
        golden[name] = rows
    golden_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "film-print-morph-upstream.json"
    golden_path.parent.mkdir(exist_ok=True)
    golden_path.write_bytes((json.dumps({"source_revision": revision, "axis": axis, "papers": golden, "scanner": scanner_golden}, separators=(",", ":")) + "\n").encode())
    target = DEFAULT_OUT / "controls.json"
    target.write_bytes((json.dumps(result, separators=(",", ":")) + "\n").encode())


if __name__ == "__main__":
    bake(Path(sys.argv[1]))
