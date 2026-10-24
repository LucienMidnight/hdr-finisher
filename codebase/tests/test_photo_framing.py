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


from types import SimpleNamespace
from hdr_finisher.models import AdjustmentState, ExportSettings, ProofArtifactRequest
from hdr_finisher.photo_framing import compose, delivery_layout, layer_colors


def test_composition_keeps_photo_and_flat_layers_separate():
    framing = PhotoFraming(enabled=True)
    framing.frame.unit, framing.frame.value = "px", 2
    framing.border.unit, framing.border.value = "px", 1
    framing.frame.color, framing.border.color = "#ffffff", "#ff0000"
    photo = np.full((7, 11, 3), .03125, dtype=np.float32)
    layout = source_layout(11, 7, framing)
    colors = layer_colors(framing, "sdr", 203)
    result = compose(photo, layout, colors)
    np.testing.assert_array_equal(result[3:10, 3:14], photo)
    np.testing.assert_allclose(result[0, 0], [1, 0, 0])
    np.testing.assert_allclose(result[1, 1], [1, 1, 1])
    np.testing.assert_array_equal(photo, np.full_like(photo, .03125))
    assert compose(photo, None, colors) is photo


def test_hdr_picker_white_is_reference_white_and_respects_ceiling():
    framing = PhotoFraming(enabled=True)
    white, _ = layer_colors(framing, "hdr", 203)
    np.testing.assert_allclose(white, [.18]*3, atol=2e-5)
    from hdr_finisher.color import acescg_to_linear_bt2020
    limited, _ = layer_colors(framing, "hdr", 203, ceiling=100)
    assert np.max(acescg_to_linear_bt2020(limited))*203/.18 <= 100.0001


def test_delivery_inclusion_proof_reduction_and_serialized_settings():
    session = SimpleNamespace(image=np.zeros((80, 120, 3), np.float32), framing=PhotoFraming(enabled=True))
    settings = ExportSettings(output_path="unused.png", format="sdr_png")
    full = delivery_layout(session, settings, AdjustmentState())
    assert (full.width, full.height) == (128, 88)
    session.framing_output_limit = 64
    reduced = delivery_layout(session, settings, AdjustmentState())
    assert max(reduced.width, reduced.height) == 64
    settings.export_with_frame = False
    assert delivery_layout(session, settings, AdjustmentState()) is None
    assert ExportSettings.model_validate_json(settings.model_dump_json()).export_with_frame is False
    proof = ProofArtifactRequest(export_with_frame=False)
    assert proof.to_export_settings("unused.jpg").export_with_frame is False


def test_impossible_canvas_rejected_before_allocation(monkeypatch):
    from hdr_finisher.resource_preflight import ResourceSnapshot
    monkeypatch.setattr("hdr_finisher.resource_preflight.detect_memory_resources", lambda: ResourceSnapshot(8*1024**3, 4*1024**3, "test"))
    framing = PhotoFraming(enabled=True)
    framing.frame.unit, framing.frame.value = "px", 100000
    session = SimpleNamespace(image=np.zeros((8, 12, 3), np.float32), framing=framing)
    with pytest.raises(ValueError, match="canvas is too large"):
        delivery_layout(session, ExportSettings(output_path="unused.png"), AdjustmentState())


def test_saved_versions_export_framed_and_unframed_from_one_photo(tmp_path):
    from hdr_finisher.export_presets import ExportPreset, ExportVersion, ExportPresets
    from hdr_finisher.batch_export import export_photo
    source = tmp_path / "photo.png"
    Image.new("RGB", (60, 40), (50, 60, 70)).save(source)
    store = SessionStore()
    payload = store.create_session(source, owns_source_path=False)
    session = store.get(payload.session_id)
    session.framing.enabled = True
    session.framing.frame.unit, session.framing.frame.value = "px", 4
    session.framing.border.unit, session.framing.border.value = "px", 2
    document = session.edit_document().model_dump(mode="json")
    preset = ExportPreset(name="Mixed framing", versions=[ExportVersion(name=name,
        pattern="{filename}_{version}", settings=ExportSettings(format="sdr_png",
            dithering="off", export_with_frame=include)) for name,include in [("framed",True),("plain",False)]])
    presets = ExportPresets(tmp_path / "presets")
    presets.save(preset)
    restored = presets.list()[0]
    assert [v.settings.export_with_frame for v in restored.versions] == [True,False]
    photo = {"path":str(source),"source_path":str(source),"grade":document}
    results = export_photo(photo, restored, tmp_path / "out", 1, lambda rows:None)
    assert len(results) == 2
    assert [Image.open(row["output_path"]).size for row in results] == [(72,52),(60,40)]
    store.clear()


def test_astronomical_width_fails_cleanly_instead_of_overflow():
    framing = PhotoFraming(enabled=True)
    framing.frame.value = 1e308
    with pytest.raises(ValueError, match="thickness is too large"):
        output_layout(6001, 4001, framing, OutputFinishingSettings(resize_mode="long_edge", long_edge=2048))


def test_proof_cache_tracks_authored_frame_only_when_included():
    from hdr_finisher.proofing import ProofArtifactStore
    from hdr_finisher.color_context import RenderColorContext
    first = PhotoFraming(enabled=True)
    second = first.model_copy(deep=True)
    second.border.color = "#123456"
    request = ProofArtifactRequest()
    key = lambda f: ProofArtifactStore._request_signature("photo", request, RenderColorContext(203), framing=f)
    assert key(first) != key(second)
    request.export_with_frame = False
    assert key(first) == key(second)


def test_small_source_with_large_frame_has_honest_reduced_proof(tmp_path):
    from hdr_finisher.proofing import ProofArtifactStore
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends
    caps = probe_capabilities()
    if caps["jpegxl_export"].status.value != "available":
        pytest.skip("JPEG XL encoder unavailable")
    source = tmp_path / "small.png"
    Image.new("RGB", (24,16), (60,70,80)).save(source)
    sessions = SessionStore()
    payload = sessions.create_session(source)
    session = sessions.get(payload.session_id)
    session.framing.enabled = True
    session.framing.frame.unit, session.framing.frame.value = "px", 500
    proofs = ProofArtifactStore()
    try:
        proof = proofs.create(session, ProofArtifactRequest(format="jpegxl_hdr", adjustments=session.adjustments,
            long_edge=256, full_size=False), build_export_backends(caps)["jpegxl_hdr"])
        assert max(proof.width, proof.height) == 256
        assert not proof.full_size
    finally:
        proofs.clear()
        sessions.clear()


def test_unit_conversion_retains_decimal_half_pixel_tie():
    framing = PhotoFraming(enabled=True)
    framing.frame.value = 1.005
    assert source_layout(10000,10000,framing).frame == 101
    framing.frame.value = convert_thickness(1.005, "percent", "px", 10000,10000)
    framing.frame.unit = "px"
    assert framing.frame.value == 100.5
    assert source_layout(10000,10000,framing).frame == 101
