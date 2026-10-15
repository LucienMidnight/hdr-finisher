from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hdr_finisher import adjustments as adjustments_module
from hdr_finisher import film_stock as film_stock_module
from hdr_finisher.adjustments import _acescg_luma, _apply_film_look, _apply_film_stock, _linear_luma
from hdr_finisher.color import linear_srgb_to_acescg
from hdr_finisher.film_stock import (
    FILM_STOCK_FORMAT,
    FilmStockError,
    load_film_stock,
    parse_film_stock,
    render_film_stock,
    stock_parameters,
)
from hdr_finisher.main import app
from hdr_finisher.models import AdjustmentState, FilmLookAdjustments, HDRAdjustments, PreviewKind, SDRAdjustments


REAL_STOCK_DIR = film_stock_module.FILM_STOCK_DIR
LUMA = {PreviewKind.HDR: _acescg_luma, PreviewKind.SDR: _linear_luma}


def _identity_table(size: int, low: float, high: float) -> dict[str, object]:
    axis = np.linspace(low, high, size)
    grid = np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), axis=-1)
    return {
        "size": size,
        "domain_min": [low] * 3,
        "domain_max": [high] * 3,
        "values": grid.reshape(-1).tolist(),
    }


def _synthetic_stock(input_matrix: list[list[float]] | None = None, gamma: float = 1.0) -> dict[str, object]:
    """A stock whose chain F is close to ``(M_in . rgb) ** gamma`` on 1e-3..10.

    Film and print tables are identities in log10 space and the print curve
    takes the exponent back, so with the defaults F(rgb) ~= rgb. Linear tables
    are exact under trilinear interpolation; the 256-sample exponent curve is
    good to about 0.02%. ``gamma`` gives the stock a tone curve of its own.
    """
    log_axis = np.linspace(-3.0, 1.0, 256)
    identity_curve = np.repeat(log_axis[:, None], 3, axis=1).tolist()
    return {
        "format": FILM_STOCK_FORMAT,
        "id": "kodak_portra_400",
        "name": "Synthetic Test Stock",
        "attribution": "Synthetic test data.",
        "film_profile": "synthetic",
        "print_profile": "synthetic",
        "input_matrix": input_matrix or np.eye(3).tolist(),
        "film_log_exposure_range": [-3.0, 1.0],
        "film_curves_plain": identity_curve,
        "film_curves_corrected": identity_curve,
        "coupler_matrix": np.zeros((3, 3)).tolist(),
        "coupler_high_exposure_shift": 0.0,
        "print_table": _identity_table(5, -3.0, 1.0),
        "preflash_raw": [1.0, 1.0, 1.0],
        "print_filter_cc_full_scale": 20.0,
        "print_warmth_log_shift": [-0.08, -0.04, 0.12],
        "print_tint_log_shift": [-0.05, 0.11, -0.07],
        "print_log_exposure_range": [-3.0, 1.0],
        "print_curves": np.repeat((10.0 ** (gamma * log_axis))[:, None], 3, axis=1).tolist(),
        "scan_table": _identity_table(5, 0.0, 10.0),
    }


# Rows sum to one, so greys stay grey while colours gain saturation.
COLOURFUL_MATRIX = [[1.3, -0.2, -0.1], [-0.15, 1.25, -0.1], [-0.05, -0.25, 1.3]]


@pytest.fixture
def stock_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def install(payload: dict[str, object]) -> Path:
        directory = tmp_path / f"stocks{len(list(tmp_path.iterdir()))}"
        directory.mkdir()
        (directory / f"{payload['id']}.json").write_text(json.dumps(payload), encoding="utf-8")
        monkeypatch.setattr(film_stock_module, "FILM_STOCK_DIR", directory)
        return directory

    return install


def _look(**fields: object) -> FilmLookAdjustments:
    return FilmLookAdjustments(film_stock="kodak_portra_400", **fields)


def _state(kind: PreviewKind, look: FilmLookAdjustments, *, black_and_white: bool = False) -> AdjustmentState:
    branch = {
        "film_look_section_enabled": True,
        "film_look": look,
        "black_and_white_section_enabled": black_and_white,
    }
    if kind == PreviewKind.HDR:
        return AdjustmentState(hdr=HDRAdjustments(**branch))
    return AdjustmentState(sdr=SDRAdjustments(**branch))


def _stage(image: np.ndarray, look: FilmLookAdjustments, kind: PreviewKind, master: float = 1.0) -> np.ndarray:
    return _apply_film_stock(image.astype(np.float32, copy=True), look, kind, np.float32(master))


COLOURS = np.array(
    [[[0.02, 0.05, 0.01], [0.18, 0.12, 0.08], [0.1, 0.3, 0.6], [0.7, 0.4, 0.2], [0.9, 0.85, 0.95]]],
    dtype=np.float32,
)
GREYS = np.repeat(np.array([0.01, 0.05, 0.18, 0.5, 0.9], dtype=np.float32).reshape(1, -1, 1), 3, axis=2)


def test_film_look_model_declares_film_stock_fields_with_bounds() -> None:
    look = FilmLookAdjustments()
    assert look.film_stock == "none"
    assert (look.stock_color, look.stock_tone, look.stock_exposure) == (100.0, 100.0, 0.0)
    assert (look.stock_separation, look.stock_print_warmth, look.stock_print_tint, look.stock_preflash) == (
        0.0, 0.0, 0.0, 0.0,
    )
    for field, value in (
        ("film_stock", "kodak_portra_9000"),
        ("stock_color", 101.0),
        ("stock_color", -1.0),
        ("stock_tone", 100.5),
        ("stock_exposure", 3.5),
        ("stock_exposure", -3.5),
        ("stock_separation", -101.0),
        ("stock_print_warmth", 101.0),
        ("stock_print_tint", -101.0),
        ("stock_preflash", -1.0),
        ("stock_preflash", float("nan")),
    ):
        with pytest.raises(ValidationError):
            FilmLookAdjustments(**{field: value})
    for stock_id in film_stock_module.FILM_STOCK_IDS:
        assert FilmLookAdjustments(film_stock=stock_id).film_stock == stock_id


def test_synthetic_stock_chain_is_near_identity(stock_dir) -> None:
    stock_dir(_synthetic_stock())
    stock = load_film_stock("kodak_portra_400")
    rgb = COLOURS.reshape(-1, 3)
    output = render_film_stock(stock, rgb, stock_parameters(_look()))
    np.testing.assert_allclose(output, rgb, rtol=1e-3)
    brighter = render_film_stock(stock, rgb, stock_parameters(_look(stock_exposure=1.0)))
    np.testing.assert_allclose(brighter, rgb * 2.0, rtol=1e-3)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_near_identity_stock_leaves_the_picture_alone_at_full_colour_and_tone(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock())
    # In-gamut sRGB colours, so the HDR lane's ACEScg pixels stay in gamut too.
    image = linear_srgb_to_acescg(COLOURS) if kind == PreviewKind.HDR else COLOURS
    output = _stage(image, _look(), kind)
    np.testing.assert_allclose(output, image, rtol=2e-3, atol=1e-5)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_greys_are_preserved_at_stock_tone_zero(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX))
    output = _stage(GREYS, _look(stock_tone=0.0, stock_exposure=0.7, stock_print_warmth=0.0), kind)
    np.testing.assert_allclose(output, GREYS, rtol=1e-4, atol=1e-6)
    # The stock still changes colours, so the test is not vacuous.
    assert np.max(np.abs(_stage(COLOURS, _look(stock_tone=0.0), kind) - COLOURS)) > 1e-2


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_colour_and_tone_at_zero_is_identity(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX))
    look = _look(stock_color=0.0, stock_tone=0.0, stock_exposure=1.5)
    assert np.array_equal(_stage(COLOURS, look, kind), COLOURS)
    assert np.array_equal(_apply_film_look(COLOURS, _state(kind, look), kind), COLOURS)


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_colour_zero_keeps_each_pixels_hue(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX, gamma=1.5))
    output = _stage(COLOURS, _look(stock_color=0.0, stock_exposure=1.0), kind)
    gain = output / COLOURS
    np.testing.assert_allclose(gain, np.repeat(gain[..., :1], 3, axis=-1), rtol=1e-5)
    assert np.max(np.abs(gain - 1.0)) > 0.1


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_look_strength_zero_is_identity(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX, gamma=1.5))
    look = _look(stock_exposure=1.0, look_strength=0.0)
    assert np.array_equal(_apply_film_look(COLOURS, _state(kind, look), kind), COLOURS)
    assert np.array_equal(_stage(COLOURS, _look(stock_exposure=1.0), kind, master=0.0), COLOURS)
    full = _stage(COLOURS, _look(stock_exposure=1.0), kind)
    half = _stage(COLOURS, _look(stock_exposure=1.0), kind, master=0.5)
    np.testing.assert_allclose(half, (COLOURS + full) * 0.5, rtol=1e-5, atol=1e-7)


def test_hdr_highlights_keep_their_ratios_and_are_not_clipped_to_paper_white(stock_dir) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX, gamma=1.5))
    kind = PreviewKind.HDR
    colour = np.array([1.2, 0.8, 0.5], dtype=np.float32)
    colour = colour / _acescg_luma(colour)
    levels = np.array([1.0, 2.0, 4.0, 8.0], dtype=np.float32)
    image = (levels[:, None] * colour[None, :]).reshape(1, -1, 3)

    colour_only = _stage(image, _look(stock_tone=0.0), kind)[0]
    np.testing.assert_allclose(colour_only / levels[:, None], np.repeat(colour_only[:1], 4, axis=0), rtol=1e-5)
    grey = np.repeat(levels[:, None], 3, axis=1).reshape(1, -1, 3)
    # ACEScg <-> sRGB do not map white exactly to white (about 1.5e-4), and the
    # stock's gamma of 1.5 does not undo that on the way back.
    np.testing.assert_allclose(_stage(grey, _look(stock_tone=0.0), kind), grey, rtol=5e-4)

    toned = _stage(image, _look(stock_tone=100.0, stock_exposure=-0.5), kind)[0]
    np.testing.assert_allclose(toned / levels[:, None], np.repeat(toned[:1], 4, axis=0), rtol=1e-5)
    assert _acescg_luma(toned)[-1] > 4.0


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_separation_leaves_greys_unchanged_and_moves_colours(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX))
    for separation in (-100.0, 100.0):
        look = _look(stock_separation=separation)
        np.testing.assert_allclose(_stage(GREYS, look, kind), _stage(GREYS, _look(), kind), rtol=1e-6, atol=1e-7)
        assert np.max(np.abs(_stage(COLOURS, look, kind) - _stage(COLOURS, _look(), kind))) > 1e-3


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_black_and_white_forces_stock_colour_off_but_keeps_tone(stock_dir, kind) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX, gamma=1.5))
    coloured = _look(stock_exposure=1.0, stock_color=100.0)
    toned_only = _look(stock_exposure=1.0, stock_color=0.0)
    mono = _apply_film_look(COLOURS, _state(kind, coloured, black_and_white=True), kind)
    np.testing.assert_array_equal(mono, _apply_film_look(COLOURS, _state(kind, toned_only), kind))
    assert np.max(np.abs(mono - _apply_film_look(COLOURS, _state(kind, coloured), kind))) > 1e-3
    assert np.max(np.abs(mono - COLOURS)) > 1e-2


def test_print_warmth_and_tint_apply_the_stocks_own_filter_shift(stock_dir) -> None:
    payload = _synthetic_stock()
    stock_dir(payload)
    stock = load_film_stock("kodak_portra_400")
    grey = np.full((1, 3), 0.18, dtype=np.float32)
    neutral = render_film_stock(stock, grey, stock_parameters(_look()))
    for warmth, tint in ((100.0, 0.0), (-50.0, 0.0), (0.0, 100.0), (30.0, -60.0)):
        shifted = render_film_stock(
            stock, grey, stock_parameters(_look(stock_print_warmth=warmth, stock_print_tint=tint))
        )
        log_shift = (
            warmth / 100.0 * np.asarray(payload["print_warmth_log_shift"])
            + tint / 100.0 * np.asarray(payload["print_tint_log_shift"])
        )
        np.testing.assert_allclose(shifted / neutral, 10.0 ** log_shift[None, :], rtol=1e-3)


def test_stage_is_identical_chunk_by_chunk(stock_dir, monkeypatch) -> None:
    stock_dir(_synthetic_stock(COLOURFUL_MATRIX))
    rng = np.random.default_rng(7)
    image = rng.uniform(0.0, 3.0, size=(37, 41, 3)).astype(np.float32)
    look = _look(stock_separation=40.0, stock_print_warmth=30.0, stock_preflash=20.0, stock_tone=60.0)
    whole = _stage(image, look, PreviewKind.HDR)
    monkeypatch.setattr(adjustments_module, "FILM_STOCK_CHUNK_PIXELS", 97)
    chunked = _stage(image, look, PreviewKind.HDR)
    np.testing.assert_array_equal(chunked, whole)
    strips = np.concatenate([_stage(image[:20], look, PreviewKind.HDR), _stage(image[20:], look, PreviewKind.HDR)])
    np.testing.assert_array_equal(strips, whole)


def test_missing_stock_data_leaves_the_picture_alone(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(film_stock_module, "FILM_STOCK_DIR", tmp_path)
    assert load_film_stock("kodak_portra_400") is None
    assert load_film_stock("none") is None
    assert np.array_equal(_stage(COLOURS, _look(), PreviewKind.SDR), COLOURS)


def test_stock_parser_rejects_malformed_files() -> None:
    payload = _synthetic_stock()
    parse_film_stock(payload, "kodak_portra_400")
    with pytest.raises(FilmStockError):
        parse_film_stock({**payload, "format": "something-else"})
    with pytest.raises(FilmStockError):
        parse_film_stock(payload, "kodak_gold_200")
    with pytest.raises(FilmStockError):
        parse_film_stock({**payload, "film_curves_plain": payload["film_curves_plain"][:10]})
    with pytest.raises(FilmStockError):
        parse_film_stock({**payload, "input_matrix": [[float("nan")] * 3] * 3})


def test_film_stock_api_lists_and_serves_known_stocks_only(stock_dir) -> None:
    payload = _synthetic_stock()
    stock_dir(payload)
    client = TestClient(app)
    listing = client.get("/api/film-stocks")
    assert listing.status_code == 200
    assert listing.json() == [
        {"id": "kodak_portra_400", "name": "Synthetic Test Stock", "attribution": "Synthetic test data."}
    ]
    served = client.get("/api/film-stocks/kodak_portra_400")
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("application/json")
    assert served.json() == payload
    for unknown in ("kodak_gold_200", "none", "nope", "..%2Fmodels.py", "kodak_portra_400.json"):
        assert client.get(f"/api/film-stocks/{unknown}").status_code == 404


def _real_portra() -> object:
    if not (REAL_STOCK_DIR / "kodak_portra_400.json").is_file():
        pytest.skip("kodak_portra_400.json has not been baked yet")
    return film_stock_module.parse_film_stock(
        json.loads((REAL_STOCK_DIR / "kodak_portra_400.json").read_text(encoding="utf-8")), "kodak_portra_400"
    )


@pytest.mark.parametrize("kind", [PreviewKind.HDR, PreviewKind.SDR])
def test_real_portra_400_keeps_middle_grey_near_neutral(kind, monkeypatch) -> None:
    _real_portra()
    monkeypatch.setattr(film_stock_module, "FILM_STOCK_DIR", REAL_STOCK_DIR)
    # HDR keeps reference white at 0.18, so its middle grey is the SDR one
    # divided by the generated-SDR scale.
    level = 0.18 / float(adjustments_module.SDR_SCENE_TO_DISPLAY_SCALE) if kind == PreviewKind.HDR else 0.18
    grey = np.full((1, 1, 3), level, dtype=np.float32)
    for tone in (0.0, 100.0):
        output = _stage(grey, FilmLookAdjustments(film_stock="kodak_portra_400", stock_tone=tone), kind)[0, 0]
        assert LUMA[kind](output) == pytest.approx(level, rel=1e-3)
        # Portra on Endura with spektrafilm's neutral filters prints mid grey
        # slightly warm (blue about 4% under in October 2026's bake); a
        # broken chain or swapped layer order lands far outside this.
        np.testing.assert_allclose(output, level, rtol=0.05)


def test_real_portra_400_meets_both_lanes_at_the_same_exposure(monkeypatch) -> None:
    _real_portra()
    monkeypatch.setattr(film_stock_module, "FILM_STOCK_DIR", REAL_STOCK_DIR)
    scale = float(adjustments_module.SDR_SCENE_TO_DISPLAY_SCALE)
    sdr = np.array([[[0.32, 0.18, 0.09], [0.05, 0.12, 0.04], [0.6, 0.55, 0.5]]], dtype=np.float32)
    hdr = linear_srgb_to_acescg(sdr / scale)
    look = FilmLookAdjustments(film_stock="kodak_portra_400", stock_tone=100.0)
    sdr_out = _stage(sdr, look, PreviewKind.SDR)
    hdr_out = _stage(hdr, look, PreviewKind.HDR)
    np.testing.assert_allclose(adjustments_module.acescg_to_linear_srgb(hdr_out) * scale, sdr_out, rtol=2e-3, atol=1e-5)
