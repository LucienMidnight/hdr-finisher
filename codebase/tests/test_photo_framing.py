from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pytest
from PIL import Image

from hdr_finisher.models import EditCommand, PhotoFraming
from hdr_finisher.projects import open_project, save_project
from hdr_finisher.sessions import SessionStore


def test_framing_history_group_reopen_and_creative_cache(tmp_path):
    source = tmp_path / "photo.png"
    Image.fromarray(np.full((16, 24, 3), 96, dtype=np.uint8)).save(source)
    store = SessionStore()
    payload = store.create_session(source)
    session = store.get(payload.session_id)
    session.render_cache.clear_adjusted = Mock()
    settings = PhotoFraming(enabled=True)
    for revision, value in enumerate((5, 7, 10)):
        settings.frame.value = value
        result = store.apply_edit_commands(payload.session_id, [EditCommand(
            expected_revision=revision, command_type="set_photo_framing", history_group="frame-drag",
            payload={"framing": settings.model_dump(mode="json")})])
    assert result.dirty and result.document.framing.frame.value == 10
    assert len(session.undo_history) == 1
    session.render_cache.clear_adjusted.assert_not_called()
    undone = store.apply_edit_commands(payload.session_id, [EditCommand(expected_revision=3, command_type="undo")])
    assert not undone.document.framing.enabled
    redone = store.apply_edit_commands(payload.session_id, [EditCommand(expected_revision=4, command_type="redo")])
    assert redone.document.framing == settings
    destination = tmp_path / "framing.hdrfinisher"
    save_project(session, destination)
    assert open_project(store, destination).framing == settings
    # A new photo never inherits the previous photo's framing.
    assert not store.create_session(source).edit_document.framing.enabled


def test_rejected_command_batch_restores_framing(tmp_path):
    source = tmp_path / "photo.png"
    Image.new("RGB", (24, 16)).save(source)
    store = SessionStore()
    payload = store.create_session(source)
    with pytest.raises(ValueError):
        store.apply_edit_commands(payload.session_id, [
            EditCommand(expected_revision=0, command_type="set_photo_framing", payload={"framing": {"enabled": True}}),
            EditCommand(expected_revision=1, command_type="set_photo_framing", payload={"framing": {"frame": {"value": -1}}}),
        ])
    session = store.get(payload.session_id)
    assert session.framing == PhotoFraming()
    assert session.edit_revision == 0 and not session.undo_history


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf")])
def test_invalid_thickness_is_rejected(value):
    with pytest.raises(ValueError):
        PhotoFraming.model_validate({"frame": {"value": value}})

def test_replace_document_and_independent_copies(tmp_path):
    source = tmp_path / "photo.png"
    Image.new("RGB", (24, 16)).save(source)
    store = SessionStore()
    payload = store.create_session(source)
    document = payload.edit_document.model_copy(deep=True)
    document.framing.enabled = True
    document.framing.border.color = "#123456"
    changed = store.apply_edit_commands(payload.session_id, [EditCommand(
        expected_revision=0, command_type="replace_document",
        payload={"document": document.model_dump(mode="json")})])
    assert changed.document.framing.border.color == "#123456"
    # Document copies (used by virtual copies and grade paste) own their settings.
    copied = changed.document.model_copy(deep=True)
    copied.framing.border.color = "#abcdef"
    assert store.get(payload.session_id).framing.border.color == "#123456"
    undone = store.apply_edit_commands(payload.session_id, [EditCommand(expected_revision=1, command_type="undo")])
    assert not undone.document.framing.enabled


from hdr_finisher.models import OutputFinishingSettings
from hdr_finisher.photo_framing import source_layout, output_layout, convert_thickness


def test_nested_rectangles_and_source_pixel_units():
    framing = PhotoFraming(enabled=True)
    framing.frame.value = 5
    framing.border.unit, framing.border.value = "px", 3
    layout = source_layout(601, 401, framing)
    assert (layout.width, layout.height, layout.frame, layout.border) == (647, 447, 20, 3)
    assert layout.photo == (23, 23, 601, 401)
    framing.frame.enabled = False
    assert source_layout(601, 401, framing).photo == (3, 3, 601, 401)
    framing.enabled = False
    assert source_layout(601, 401, framing).photo == (0, 0, 601, 401)


@pytest.mark.parametrize("width,height", [(1, 1), (1, 10001), (4001, 6001), (6001, 4001)])
@pytest.mark.parametrize("edge", [1, 2, 3, 17, 2048])
def test_framed_canvas_obeys_export_bounds_and_retains_photo(width, height, edge):
    framing = PhotoFraming(enabled=True)
    framing.frame.value, framing.border.value = 250, 100
    settings = OutputFinishingSettings(resize_mode="long_edge", long_edge=edge, prevent_enlargement=False)
    layout = output_layout(width, height, framing, settings)
    assert max(layout.width, layout.height) == edge
    x, y, w, h = layout.photo
    assert min(w, h) >= 1 and x == y
    assert w + 2 * x == layout.width and h + 2 * y == layout.height
    assert min(layout.frame, layout.border) >= 0


def test_switching_units_does_not_accumulate_visible_width_drift():
    value = 5.125
    for _ in range(1000):
        value = convert_thickness(value, "percent", "px", 601, 401)
        value = convert_thickness(value, "px", "percent", 601, 401)
    assert value == pytest.approx(5.125, abs=1e-12)
    framing = PhotoFraming(enabled=True)
    framing.frame.value = value
    assert source_layout(601, 401, framing).frame == 21


def test_disabled_inclusion_preserves_existing_size_and_prevent_enlargement():
    from hdr_finisher.finishing import resolve_output_dimensions
    settings = OutputFinishingSettings(resize_mode="long_edge", long_edge=2048)
    framing = PhotoFraming(enabled=True)
    assert output_layout(601, 401, framing, settings, include=False).photo == (0, 0, *resolve_output_dimensions(601, 401, settings))
    assert output_layout(601, 401, framing, settings).photo[2:] == (601, 401)


def test_margin_rounding_cannot_enlarge_a_one_pixel_photo():
    framing = PhotoFraming(enabled=True)
    framing.frame.unit, framing.frame.value = "px", 1
    framing.border.value = 0
    settings = OutputFinishingSettings(resize_mode="long_edge", long_edge=6668)
    layout = output_layout(1, 10000, framing, settings)
    assert layout.photo[2] == 1
    assert layout.photo[3] <= 10000
    assert max(layout.width, layout.height) <= 6668
