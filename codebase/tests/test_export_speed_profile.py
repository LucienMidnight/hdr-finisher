import json
import os
import sys

import numpy as np
import pytest

from hdr_finisher import batch_export
from hdr_finisher.export_presets import ExportPreset
from hdr_finisher.exporters import _render_export_branch, delivery_denoise_inputs
from hdr_finisher.finishing import apply_geometry
from hdr_finisher.hsl import recipe_active
from hdr_finisher.models import EditDocument, HDRClassification, PreviewKind
from hdr_finisher.projects import open_document, validate_saved_document
from hdr_finisher.sessions import SessionStore
from tools import export_speed_profile as profile


def _load_profile(folder, name):
    grade = json.loads((folder / f"profile-{name}-grade.json").read_text())
    preset = ExportPreset.model_validate_json((folder / f"profile-{name}-preset.json").read_text())
    return grade, preset.versions[0].settings


def test_synthetic_is_deterministic_and_opens_as_hdr(tmp_path):
    photo = profile.synthetic("128x96", tmp_path / "photo.exr")
    original = photo.read_bytes()
    assert profile.synthetic("128x96", photo, force=True).read_bytes() == original
    photo.write_bytes(b"existing fixture")
    assert profile.synthetic("128x96", photo).read_bytes() == b"existing fixture"
    assert profile.synthetic("128x96", photo, force=True).read_bytes() == original

    store = SessionStore()
    try:
        payload = store.create_session(photo)
        session = store.get(payload.session_id)
        assert payload.analysis.classification is HDRClassification.HDR_TRUE
        assert not payload.analysis.needs_color_override
        assert not any(session.interpretation_override.model_dump().values())
        assert session.image.shape == (96, 128, 3)
        assert session.image.dtype == np.float32
        assert np.isfinite(session.image).all()
        assert session.image.max() > 1
    finally:
        store.clear()


def test_build_writes_valid_profiles_with_active_max_stages(tmp_path):
    photo = profile.synthetic("128x96", tmp_path / "photo.exr")
    store = SessionStore()
    try:
        payload = store.create_session(photo)
        own = store.get(payload.session_id).edit_document()
    finally:
        store.clear()
    profile.build(photo, tmp_path)
    docs = {}
    for name in profile.PROFILES:
        raw_grade, settings = _load_profile(tmp_path, name)
        doc = docs[name] = validate_saved_document(raw_grade)
        assert doc == EditDocument.model_validate(raw_grade)
        assert doc.source.raw_import_settings == own.source.raw_import_settings
        assert doc.interpretation_override == own.interpretation_override
        assert doc.source.fingerprint_sha256 == own.source.fingerprint_sha256
        assert settings.format == "avif_gain_map"
        assert settings.output_finishing.resize_mode == ("long_edge" if name == "A" else "original")
        assert settings.output_finishing.long_edge == (1920 if name == "A" else None)
        assert settings.export_with_frame == (name in {"A", "Max"})
        for denoise in (doc.denoise.hdr, doc.denoise.sdr):
            assert denoise.enabled and denoise.controls.method == "clean_grain"
            assert denoise.controls.splotch_size == "small"
    assert docs["A"] == docs["A-native"]
    assert docs["B"].global_adjustments == own.global_adjustments

    maximum = docs["Max"]
    _, settings = _load_profile(tmp_path, "Max")
    assert settings.output_finishing.sharpening == "standard"
    assert settings.output_finishing.method == "edge_aware_multiscale"
    assert settings.watermark.mode == "text" and settings.watermark.text and settings.watermark.opacity > 0
    assert maximum.framing.enabled and maximum.framing.frame.enabled and maximum.framing.border.enabled
    geometry = maximum.global_adjustments.shared.geometry
    assert geometry.straighten_angle != 0 and 0 < geometry.crop.width < 1
    local, = maximum.local_adjustments
    assert local.enabled and local.mask.enabled
    assert local.mask.leaf.type == "brush" and local.mask.leaf.mask_feather > 0
    assert local.mask.leaf.strokes and local.mask.leaf.strokes[0].hardness < 1
    for adjustment in (local.hdr_grade, local.sdr_grade):
        assert adjustment.enabled and adjustment.exposure != 0
    for branch in (maximum.global_adjustments.hdr, maximum.global_adjustments.sdr):
        assert branch.tone_section_enabled and branch.exposure != 0 and branch.shadows != 0
        assert branch.color_section_enabled and branch.white_balance_kelvin != 6500
        assert branch.tone_equalizer_section_enabled and any(node.adjustment_ev for node in branch.tone_equalizer_nodes)
        assert branch.curves_section_enabled and any(x != y for x, y in branch.luma_curve)
        assert branch.color_grading_section_enabled and branch.color_grading.midtones.saturation > 0
        assert branch.highlight_section_enabled and branch.highlight_compression_mode == "peak_fit"
        assert branch.hsl_section_enabled and any(recipe_active(channel.recipe) for channel in branch.hsl.channels)
        assert branch.black_and_white_section_enabled and any(branch.black_and_white.model_dump().values())
        assert branch.detail_section_enabled
        assert branch.detail.texture_amount and branch.detail.clarity_amount and branch.detail.sharpen_amount
        assert branch.film_look_section_enabled
        look = branch.film_look
        assert look.look_strength == 1.0 and look.film_stock != "none" and look.lens_filter != "none"
        assert look.halation_enabled and look.halation_amount > 0 and look.halation_radius > 0
        assert look.grain_enabled and look.grain_amount > 0 and look.scan_sharpening > 0
        assert branch.vignette_section_enabled and branch.vignette.amount != 0


def test_synthetic_through_max_source_filter_and_render(tmp_path):
    photo = profile.synthetic("256x256", tmp_path / "photo.exr")
    profile.build(photo, tmp_path)
    raw_grade, settings = _load_profile(tmp_path, "Max")
    store = SessionStore()
    try:
        session = open_document(store, validate_saved_document(raw_grade), photo)
        assert session.analysis.classification is HDRClassification.HDR_TRUE
        assert not session.analysis.needs_color_override
        geometry = session.adjustments.shared.geometry
        fixed = apply_geometry(session.image, geometry)
        for kind in PreviewKind:
            _, _, source_filter = delivery_denoise_inputs(session, kind, session.adjustments)
            assert source_filter is not None
            filtered = source_filter(fixed, False)
            assert filtered.shape == fixed.shape and np.isfinite(filtered).all()
            assert np.max(np.abs(filtered - fixed)) > 0

            enabled = session.adjustments.model_copy(deep=True)
            branch = getattr(enabled, kind.value)
            rendered = _render_export_branch(session, settings, kind, enabled)
            assert rendered.shape[2] == 3 and np.isfinite(rendered).all()
            assert np.max(rendered) > np.min(rendered)

            # HSL runs after monochrome conversion. Exercise its coloured
            # response as well as rendering the original Max combination.
            branch.black_and_white_section_enabled = False
            hsl_on = _render_export_branch(session, settings, kind, enabled)
            branch.hsl_section_enabled = False
            hsl_off = _render_export_branch(session, settings, kind, enabled)
            assert np.max(np.abs(hsl_on - hsl_off)) > 0
            branch.film_look.halation_enabled = False
            halation_off = _render_export_branch(session, settings, kind, enabled)
            assert np.max(np.abs(hsl_off - halation_off)) > 0
            branch.highlight_section_enabled = False
            peak_fit_off = _render_export_branch(session, settings, kind, enabled)
            assert np.max(np.abs(halation_off - peak_fit_off)) > 0
    finally:
        store.clear()


def test_attribute_stage_peaks_matches_spans_across_workers():
    samples = [
        {"t_epoch": 9.75, "total": 9e9, "python_worker": 7e9, "encoder": 1e9},
        {"t_epoch": 10.00, "total": 3e9, "python_worker": 2.6e9, "encoder": 0},
        {"t_epoch": 10.25, "total": 4e9, "python_worker": 1e9, "encoder": 2e9},
        {"t_epoch": 10.50, "total": 6e9, "python_worker": 4e9, "encoder": 1.5e9},
        {"t_epoch": 10.76, "total": 9e9, "python_worker": 7e9, "encoder": 1e9},
    ]
    peaks = profile.attribute_stage_peaks(samples, [
        {"stage_trace": [["hdr", "render", 10.12, 10.30], ["sdr", "encode", 10.35, 10.60]]},
        {"stage_trace": [["hdr", "render", 10.36, 10.40], ["sdr", "validate", 12.0, 12.01]]},
        {},
    ])
    assert [(row["timing_index"], row["lane"], row["stage"]) for row in peaks] == [
        (0, "hdr", "render"), (0, "sdr", "encode"), (1, "hdr", "render"), (1, "sdr", "validate"),
    ]
    assert [row["duration_ms"] for row in peaks] == [180, 250, 40, 10]
    assert [row["sample_count"] for row in peaks] == [2, 2, 2, 0]
    assert [row["peak_total_gb"] for row in peaks] == [4, 6, 6, None]
    assert [row["peak_worker_gb"] for row in peaks] == [2.6, 4, 4, None]
    assert [row["peak_encoder_gb"] for row in peaks] == [2, 2, 2, None]


@pytest.mark.parametrize("fails", [False, True])
def test_run_reuses_source_and_restores_environment(tmp_path, monkeypatch, fails):
    photo = profile.synthetic("128x96", tmp_path / "photo.exr")
    profile.build(photo, tmp_path)
    preset_path = tmp_path / "profile-A-preset.json"
    original_preset = preset_path.read_bytes()
    trace_env = "HDR_FINISHER_EXPORT_STAGE_TRACE"
    parallel_env = "HDR_FINISHER_BATCH_PARALLEL"
    monkeypatch.delenv(trace_env, raising=False)
    monkeypatch.setenv(parallel_env, "3")
    stderr = sys.stderr
    closed = []

    class Queue:
        def __init__(self, snapshot, record_path):
            self.snapshot = snapshot

        def start(self, paths, preset, directory):
            assert len(set(paths)) == 2
            assert all(self.snapshot(path)["path"] == path for path in paths)
            assert {self.snapshot(path)["source_path"] for path in paths} == {str(photo)}
            assert preset.versions[0].settings.format == "sdr_png"
            assert os.environ[trace_env] == "1" and os.environ[parallel_env] == "2"
            if fails:
                raise RuntimeError("batch start failed")
            return {"id": "job"}

        def status(self, job):
            return {"state": "finished", "results": []}

        def close(self):
            closed.append(True)

    monkeypatch.setattr(batch_export, "BatchExports", Queue)
    monkeypatch.setattr(profile, "process_rows", lambda pid: [{"pid": pid, "chargedBytes": 100_000_000}])
    kwargs = {"format": "sdr_png", "batch_count": 2, "parallel": 2}
    if fails:
        with pytest.raises(RuntimeError, match="batch start failed"):
            profile.run("A", tmp_path, "test", **kwargs)
    else:
        result = profile.run("A", tmp_path, "test", **kwargs)
        assert result["format"] == "sdr_png" and result["batch_count"] == 2
    assert closed == [True]
    assert trace_env not in os.environ and os.environ[parallel_env] == "3"
    assert sys.stderr is stderr
    assert preset_path.read_bytes() == original_preset
