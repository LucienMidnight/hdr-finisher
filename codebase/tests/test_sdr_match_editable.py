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


def test_section_fits_preserve_other_modules_and_undo_exactly(tmp_path):
    from hdr_finisher.sdr_match_tone import TONE_FIELDS, SHOULDER_FIELDS
    _, store, s = session(tmp_path)
    store.apply_sdr_match_action(s.session_id, expected_revision=s.edit_revision)
    matched = s.adjustments.model_copy(deep=True)
    for section, fields, changed_key, changed_value in (
        ("tone", TONE_FIELDS, "exposure", -.1),
        ("highlight", SHOULDER_FIELDS, "highlight_compression_start_percent", 50.),
    ):
        starting = matched.model_copy(deep=True)
        setattr(starting.sdr, changed_key, changed_value)
        store.apply_edit_commands(s.session_id, [EditCommand(expected_revision=s.edit_revision,
            command_type="set_global_adjustments", payload={"adjustments": starting.model_dump(mode="json")})])
        before = s.edit_document().model_copy(deep=True)
        after = store.apply_sdr_match_action(s.session_id, expected_revision=s.edit_revision, section=section)
        old_grade = before.global_adjustments
        new_grade = after.document.global_adjustments
        assert new_grade.hdr == old_grade.hdr and new_grade.shared == old_grade.shared
        assert new_grade.sdr.model_dump(exclude=set(fields)) == old_grade.sdr.model_dump(exclude=set(fields))
        assert after.document.local_adjustments == before.local_adjustments
        assert after.document.denoise == before.denoise
        assert getattr(new_grade.sdr, changed_key) != changed_value
        store.apply_edit_commands(s.session_id, [EditCommand(expected_revision=s.edit_revision, command_type="undo")])
        assert s.edit_document() == before
    store.clear()
