"""Match commits one editable recipe, shared by persistence and rendering."""
from pathlib import Path
import numpy as np
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.models import EditCommand, PreviewKind
from hdr_finisher.sessions import SessionStore
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_grades import LibraryGrades
from hdr_finisher.library_paste import LibraryPaste
from hdr_finisher.sdr_link import try_linked_match


def session(tmp_path):
    photo = tmp_path / 'photo.tiff'
    photo.write_bytes((Path(__file__).parent / 'fixtures/hdr_match_scene.tiff').read_bytes())
    store = SessionStore()
    s = store.get(store.create_session(photo, owns_source_path=False).session_id)
    s.adjustments.hdr.exposure = .2
    s.adjustments.hdr.contrast = .12
    return photo, store, s


def test_match_tweak_history_sidecar_and_paste_keep_the_visible_recipe(tmp_path):
    photo, store, s = session(tmp_path)
    marks = LibraryMarks(tmp_path / 'app')
    grades = LibraryGrades(marks, store)
    grades.attach(s.session_id)
    def command(kind, payload=None):
        return store.apply_edit_commands(s.session_id, [EditCommand(expected_revision=s.edit_revision,
            command_type=kind, payload=payload or {})])
    store.apply_sdr_match_action(s.session_id, expected_revision=s.edit_revision)
    matched = s.adjustments.model_copy(deep=True)
    assert not matched.sdr.linked_to_hdr
    desired = matched.model_copy(deep=True)
    desired.sdr.exposure += .25
    command('set_global_adjustments', {'adjustments': desired.model_dump(mode='json')})
    assert s.adjustments == desired
    command('undo'); assert s.adjustments == matched
    command('redo'); assert s.adjustments == desired
    grades.save(s.session_id); marks.writer.drain()
    saved, _ = LibraryPaste(grades).document(str(photo))
    assert saved['global_adjustments'] == desired.model_dump(mode='json')
    paste = LibraryPaste(grades)
    groups = paste.copy(str(photo))['groups']
    target = tmp_path / 'target.tiff'; target.write_bytes(photo.read_bytes())
    paste.paste([str(target)], {'lanes': ['sdr'], 'settings': [row['id'] for group in groups
        if group['lane'] == 'sdr' for row in group['settings']]})
    marks.writer.drain()
    pasted, _ = paste.document(str(target))
    pasted_branch = pasted['global_adjustments']['sdr']
    expected_branch = desired.sdr.model_dump(mode='json')
    # Source peak is measured for each photo, never copied as an edit.
    pasted_branch.pop('highlight_compression_source_peak_percent')
    expected_branch.pop('highlight_compression_source_peak_percent')
    assert pasted_branch == expected_branch
    pixels = apply_adjustments(s.image, s.adjustments, PreviewKind.SDR, local_adjustments=s.local_adjustments)
    np.testing.assert_array_equal(pixels, apply_adjustments(s.image, desired, PreviewKind.SDR,
        local_adjustments=s.local_adjustments))
    store.apply_sdr_match_action(s.session_id, expected_revision=s.edit_revision)
    assert s.adjustments == matched
    from hdr_finisher.models import EditDocument, ExportSettings
    from hdr_finisher.projects import open_document
    from hdr_finisher.exporters import _render_export_branch
    before_export = _render_export_branch(s, ExportSettings(), PreviewKind.SDR, desired)
    reopened = open_document(store, EditDocument.model_validate(saved), photo)
    assert reopened.adjustments == desired
    np.testing.assert_array_equal(before_export,
        _render_export_branch(reopened, ExportSettings(), PreviewKind.SDR, reopened.adjustments))
    store.clear()


def test_saved_linked_document_still_renders_identically_after_project_roundtrip(tmp_path):
    from hdr_finisher.projects import save_project, open_project
    _, store, s = session(tmp_path)
    old, reason = try_linked_match(s.image, s.adjustments, [], None,
        reference_white_nits=203, source_pixel_scale=1)
    assert old is not None, reason
    s.adjustments = old.adjustments
    before = apply_adjustments(s.image, s.adjustments, PreviewKind.SDR)
    project = tmp_path / 'linked.hdrfinisher'; save_project(s, project)
    reopened = open_project(store, project)
    assert reopened.adjustments.sdr.linked_to_hdr
    np.testing.assert_array_equal(before, apply_adjustments(reopened.image, reopened.adjustments, PreviewKind.SDR))
    store.clear()


def test_bright_population_refinement_improves_actual_pixels_without_sacrificing_body(tmp_path, monkeypatch):
    import hdr_finisher.sdr_match as matching
    from hdr_finisher.sdr_gamut import linear_srgb_to_oklab
    _, store, s = session(tmp_path)
    options = dict(reference_white_nits=203, source_pixel_scale=1)
    refine = matching._refine_editable_tones
    monkeypatch.setattr(matching, '_refine_editable_tones', lambda *args: args[-2:])
    baseline = matching.materialize_sdr_match(s.image, s.adjustments, [], **options)
    monkeypatch.setattr(matching, '_refine_editable_tones', refine)
    result = matching.materialize_sdr_match(s.image, s.adjustments, [], **options)
    hdr = apply_adjustments(s.image, s.adjustments, PreviewKind.HDR)
    target = matching.build_sdr_match_target(hdr)
    bright = matching._acescg_luma(hdr) * matching.SDR_DISPLAY_REFERENCE_WHITE / .18 > matching.MATCH_SHOULDER_START
    def error(recipe):
        pixels = apply_adjustments(s.image, recipe.adjustments, PreviewKind.SDR)
        return np.linalg.norm(linear_srgb_to_oklab(pixels) - linear_srgb_to_oklab(target), axis=-1)[bright].mean()
    assert error(result) < error(baseline)
    assert result.quality.median_luma_error <= max(.01, baseline.quality.median_luma_error)
    store.clear()
