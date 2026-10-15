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
