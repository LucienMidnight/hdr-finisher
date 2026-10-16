"""Stock metadata and saved ownership; rendering equations remain unchanged."""
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from pydantic import ValidationError

from hdr_finisher.models import AdjustmentState, EditCommand, FilmLookAdjustments
from hdr_finisher.projects import open_project, save_project
from hdr_finisher.sessions import SessionStore
from hdr_finisher.adjustments import _grain_pitch_pixels

DATA = json.loads((Path(__file__).parents[1] / "backend/hdr_finisher/film_stocks/character.json").read_text())

@pytest.mark.parametrize("stock", list(DATA["stocks"]))
def test_each_character_is_a_valid_renderable_recipe(stock):
    values = DATA["stocks"][stock]["defaults"]
    look = FilmLookAdjustments(film_stock=stock, **values)
    assert all(getattr(look, key) == value for key, value in values.items())
    if stock != "none":
        assert look.grain_amount > 0 and look.halation_amount > 0
    assert look.stock_overrides == []


def test_format_halving_doubles_physical_grain_pitch():
    look = FilmLookAdjustments(**DATA["stocks"]["kodak_portra_400"]["defaults"],
        grain_film_format="custom", grain_custom_width_mm=36, grain_custom_height_mm=24)
    base = _grain_pitch_pixels(2400, 1600, look)
    smaller = look.model_copy(update={"grain_custom_width_mm":18, "grain_custom_height_mm":12})
    assert _grain_pitch_pixels(2400, 1600, smaller) / base == pytest.approx(2, rel=1e-6)


def test_ownership_is_strict_and_survives_the_real_project_and_undo_paths(tmp_path):
    source = tmp_path / "generated.png"
    Image.fromarray(np.full((12, 16, 3), 96, np.uint8)).save(source)
    store = SessionStore()
    session_id = store.create_session(source, owns_source_path=False).session_id
    session = store.get(session_id)
    target = session.adjustments.model_copy(deep=True)
    target.hdr.film_look = FilmLookAdjustments(film_stock="kodak_portra_400",
        **{**DATA["stocks"]["kodak_portra_400"]["defaults"], "grain_amount":19},
        stock_overrides=["grain_amount", "print_paper"])
    def apply(kind, payload=None):
        return store.apply_edit_commands(session_id, [EditCommand(
            expected_revision=store.get(session_id).edit_revision,
            command_type=kind, payload=payload or {})])
    apply("set_global_adjustments", {"adjustments":target.model_dump(mode="json")})
    undo = apply("undo").document.global_adjustments
    assert undo.hdr.film_look.stock_overrides == []
    redo = apply("redo").document.global_adjustments
    assert redo.hdr.film_look.stock_overrides == ["grain_amount", "print_paper"]
    assert redo.hdr.film_look.grain_amount == 19
    assert redo.sdr.film_look.stock_overrides == []
    saved = tmp_path / "character.hdrfinisher"
    save_project(store.get(session_id), saved)
    reopened = open_project(SessionStore(), saved)
    assert reopened.adjustments.hdr.film_look == target.hdr.film_look
    assert reopened.adjustments.sdr.film_look == target.sdr.film_look
    with pytest.raises(ValidationError):
        FilmLookAdjustments(stock_overrides=["stock_exposure"])
