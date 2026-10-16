"""Physical paper/development controls; measured source data stays immutable."""
import numpy as np
import pytest
from hdr_finisher.film_stock import (load_film_stock, controlled_film_stock, controlled_stock_payload,
    measured_push_stock, development_gamma, parse_film_stock)
from hdr_finisher.film_print_morph import PrintCurvesMorphParams, apply_print_curves_morph


def test_measured_push_only_for_the_two_measured_portra_profiles():
    assert measured_push_stock("kodak_portra_800", 1) == "kodak_portra_800_push1"
    assert measured_push_stock("kodak_portra_800", 2) == "kodak_portra_800_push2"
    assert development_gamma("kodak_portra_800", 1) == 1
    assert measured_push_stock("kodak_portra_400", 1) == "kodak_portra_400"
    assert development_gamma("kodak_portra_400", -2) < 1 < development_gamma("kodak_portra_400", 2)


@pytest.mark.parametrize("paper", [None, "kodak_2383", "fujifilm_crystal_archive_typeii"])
def test_paper_controls_are_independent_bounded_and_do_not_mutate_data(paper):
    base = load_film_stock("kodak_portra_400", paper)
    original = base.print_curves.copy()
    for controls in ((100, 0, 0), (0, 100, 0), (0, 0, -100), (-100, -100, 100)):
        altered = controlled_film_stock(base.id, paper, *controls)
        assert np.isfinite(altered.print_curves).all()
        assert not np.array_equal(altered.print_curves, original)
        # All fitted layers retain their amplitude and the same physical range.
        assert altered.print_curves.min() >= -1e-7
        assert altered.print_curves.max() <= original.max() + 1e-5
    np.testing.assert_array_equal(base.print_curves, original)
    assert controlled_film_stock(base.id, paper) is base


@pytest.mark.parametrize("stock,paper", [("kodak_portra_400", None), ("kodak_portra_400", "kodak_2383"),
    ("kodak_portra_400", "fujifilm_crystal_archive_typeii"), ("fujifilm_provia_100f", None)])
def test_scanner_levels_work_on_papers_and_slides_and_api_shares_cpu_arrays(stock, paper):
    base = load_film_stock(stock, paper)
    changed = controlled_film_stock(stock, paper, lab_levels=True)
    assert np.isfinite(changed.scan_table.values).all()
    assert not np.array_equal(base.scan_table.values, changed.scan_table.values)
    served = parse_film_stock(controlled_stock_payload(stock, paper, lab_levels=True))
    np.testing.assert_array_equal(served.scan_table.values, changed.scan_table.values)
    np.testing.assert_array_equal(changed.film_curves_plain, base.film_curves_plain)


def test_slide_print_controls_are_an_exact_bypass():
    base = load_film_stock("fujifilm_provia_100f")
    changed = controlled_film_stock(base.id, contrast=100, shadows=-100, highlights=100)
    np.testing.assert_array_equal(changed.scan_table.values, base.scan_table.values)
    np.testing.assert_array_equal(changed.print_curves, base.print_curves)


def test_dependency_free_morph_matches_the_pinned_upstream_oracle():
    import json
    from pathlib import Path
    from types import SimpleNamespace
    from hdr_finisher.film_stock import _controls_data
    golden = json.loads((Path(__file__).parent / "fixtures" / "film-print-morph-upstream.json").read_text())
    for name, rows in golden["papers"].items():
        raw = _controls_data()["papers"][name]
        model = SimpleNamespace(**{k: np.array(raw[k]) for k in ("centers", "amplitudes", "sigmas")}, n_layers=3)
        for row in rows:
            gamma, fast, slow, exhaustion = row["parameters"]
            params = PrintCurvesMorphParams(gamma_factor=gamma, gamma_factor_fast=fast,
                gamma_factor_slow=slow, developer_exhaustion=exhaustion)
            actual = apply_print_curves_morph(golden["axis"], model, params, profile_type=raw["type"])
            np.testing.assert_allclose(actual, row["values"], atol=2e-9, rtol=0)


def test_scanner_coefficients_match_upstream_before_glare_and_colour_conversion():
    import json
    from pathlib import Path
    from hdr_finisher.film_stock import _controls_data
    golden = json.loads((Path(__file__).parent / "fixtures" / "film-print-morph-upstream.json").read_text())
    for name, values in golden["scanner"].items():
        ref = _controls_data()["scanner"][name]
        rgb = np.asarray(values["original"]) - ref["glare_rgb"]
        y = rgb @ np.asarray(ref["y_weights"])
        expected = rgb * (np.clip(ref["m"] * y + ref["q"], 0, 1) / (y + 1e-10))[..., None] + ref["glare_rgb"]
        np.testing.assert_allclose(expected, values["expected"], atol=1e-9, rtol=0)


def test_control_api_uses_shared_curves_and_rejects_out_of_range_input():
    from fastapi.testclient import TestClient
    from hdr_finisher.main import app
    client = TestClient(app)
    response = client.get("/api/film-stocks/kodak_portra_400?paper=kodak_2383&contrast=100&shadows=-100&highlights=50&lab_levels=true")
    assert response.status_code == 200
    served = parse_film_stock(response.json())
    expected = controlled_film_stock("kodak_portra_400", "kodak_2383", 100, -100, 50, True)
    np.testing.assert_array_equal(served.print_curves, expected.print_curves)
    np.testing.assert_array_equal(served.scan_table.values, expected.scan_table.values)
    assert client.get("/api/film-stocks/kodak_portra_400?contrast=101").status_code == 422


@pytest.mark.parametrize("kind", ["hdr", "sdr"])
@pytest.mark.parametrize("contrast,shadows,highlights", [(100,100,100), (-100,-100,-100)])
def test_physical_print_extremes_are_finite_and_monotonic(kind, contrast, shadows, highlights):
    from hdr_finisher.adjustments import _apply_film_stock
    from hdr_finisher.models import FilmLookAdjustments, PreviewKind
    lane = PreviewKind(kind)
    levels = np.geomspace(1e-6, 32 if kind == "hdr" else 1, 512, dtype=np.float32)
    rgb = np.repeat(levels[None, :, None], 3, axis=2)
    look = FilmLookAdjustments(film_stock="kodak_portra_400", stock_color=0, print_contrast=contrast,
        shadow_contrast=shadows, highlight_contrast=highlights)
    result = _apply_film_stock(rgb.copy(), look, lane, np.float32(1))
    assert np.isfinite(result).all()
    assert result.min() >= 0
    assert np.all(np.diff(result[0, :, 0]) >= -2e-6)
    if kind == "hdr":
        assert result[0, -1, 0] > 1


@pytest.mark.parametrize("kind", ["hdr", "sdr"])
def test_print_exposure_works_alone_and_differs_from_film_exposure(kind):
    from hdr_finisher.adjustments import _apply_film_stock
    from hdr_finisher.models import FilmLookAdjustments, PreviewKind
    lane = PreviewKind(kind)
    rgb = np.array([[[.01,.02,.04], [.18,.18,.18], [.6,.4,.2]]], dtype=np.float32)
    def run(**fields):
        return _apply_film_stock(rgb.copy(), FilmLookAdjustments(film_stock="kodak_portra_400", **fields), lane, np.float32(1))
    base = run()
    printed, exposed = run(print_exposure=1), run(stock_exposure=1)
    assert not np.allclose(printed, base)
    assert not np.allclose(printed, exposed)
    assert not np.allclose(printed[0,1], base[0,1])


def test_scanner_sharpening_keeps_rgb_energy_and_has_no_luma_threshold():
    from hdr_finisher.adjustments import _apply_scan_sharpening
    rgb = np.full((31,31,3), .18, dtype=np.float32)
    rgb[15,15] += [.02,.01,.005]
    sharpened = _apply_scan_sharpening(rgb, .7)
    np.testing.assert_allclose(sharpened.sum(axis=(0,1)), rgb.sum(axis=(0,1)), atol=.002, rtol=0)
    assert np.all(sharpened[15,15] > rgb[15,15])
    assert np.all(sharpened[15,14] < rgb[15,14])
    np.testing.assert_array_equal(_apply_scan_sharpening(rgb, 0), rgb)


@pytest.mark.parametrize("kind", ["hdr", "sdr"])
def test_scanner_is_inside_the_single_look_strength_mix(kind):
    from hdr_finisher.adjustments import _apply_film_look
    from hdr_finisher.models import AdjustmentState, PreviewKind
    lane = PreviewKind(kind)
    rgb = np.full((31,31,3), .18, dtype=np.float32)
    rgb[15,15] += .02
    state = AdjustmentState()
    look = getattr(state,kind).film_look
    look.scan_sharpening = 70
    full = _apply_film_look(rgb, state, lane)
    look.look_strength = 50
    half = _apply_film_look(rgb, state, lane)
    np.testing.assert_allclose(half, rgb + (full-rgb)*.5, atol=2e-6, rtol=2e-6)


def test_neutral_default_chain_is_straight_and_all_physical_controls_work_alone():
    from hdr_finisher.adjustments import _apply_film_stock
    from hdr_finisher.film_stock import render_film_stock, stock_parameters
    from hdr_finisher.models import FilmLookAdjustments, PreviewKind
    levels = np.geomspace(.0001, 1, 64, dtype=np.float32)
    rgb = np.repeat(levels[:, None], 3, axis=1)
    stock = controlled_film_stock("none")
    np.testing.assert_allclose(render_film_stock(stock, rgb, stock_parameters(FilmLookAdjustments())), rgb, atol=2e-6, rtol=2e-5)
    image = np.array([[[.01,.02,.04], [.18,.18,.18], [.6,.4,.2]]], dtype=np.float32)
    for field, value in (("stock_exposure",1), ("stock_separation",50), ("stock_print_warmth",50),
        ("stock_print_tint",50), ("stock_preflash",50), ("push_pull",1), ("print_exposure",1),
        ("print_contrast",50), ("shadow_contrast",50), ("highlight_contrast",50),
        ("lab_levels",True), ("print_paper","kodak_2383"), ("print_paper","fujifilm_crystal_archive_typeii")):
        look = FilmLookAdjustments(**{field:value})
        result = _apply_film_stock(image.copy(), look, PreviewKind.SDR, np.float32(1))
        assert np.isfinite(result).all(), field
        assert not np.allclose(result, image, atol=2e-6), field
    payload = controlled_stock_payload("none", contrast=50, lab_levels=True)
    served = parse_film_stock(payload)
    expected = controlled_film_stock("none", contrast=50, lab_levels=True)
    np.testing.assert_array_equal(served.print_curves, expected.print_curves)


def test_stock_gpu_return_conversion_matches_exact_cpu_cat02_matrix():
    import re
    from pathlib import Path
    from hdr_finisher.color import _LINEAR_SRGB_TO_ACESCG
    source = (Path(__file__).parents[1]/"frontend"/"webgpu-shaders.js").read_text(encoding="utf-8")
    body = source.split("fn stockFromSrgb(",1)[1].split("fn filmStockStage(",1)[0]
    rows = re.findall(r"dot\(rgb, vec3f\(([^)]+)\)\)",body)
    matrix = np.array([[float(value) for value in row.split(",")] for row in rows])
    np.testing.assert_allclose(matrix, _LINEAR_SRGB_TO_ACESCG.T, rtol=0, atol=1e-10)
