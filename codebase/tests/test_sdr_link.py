from pathlib import Path
import numpy as np
import pytest
import tifffile
from hdr_finisher import adjustments as rendering
from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.models import AdjustmentState, EditCommand, LocalAdjustment, LocalGrade, PreviewKind
from hdr_finisher.sdr_link import linked_highlight_order_is_safe, try_linked_match
from hdr_finisher.sdr_match import _highlight_order_is_safe, build_sdr_match_target


@pytest.mark.parametrize('film', ['none', 'kodak_portra_400', 'fujifilm_velvia_100'])
@pytest.mark.parametrize('bypass', [False, True])
def test_common_prefix_film_and_overlapping_locals_are_evaluated_once(monkeypatch, film, bypass):
    source = tifffile.imread(Path(__file__).parent / 'fixtures/hdr_match_scene.tiff').astype(np.float32)
    a = AdjustmentState()
    a.hdr.film_look.film_stock = film
    a.hdr.exposure = .2
    a.sdr.exposure = -2
    a.sdr.film_look.film_stock = 'kodak_ektar_100'
    a.shared.local_adjustments_enabled = not bypass
    locals_ = [LocalAdjustment(name='one'), LocalAdjustment(name='overlap')]
    locals_[0].hdr_grade.exposure, locals_[1].hdr_grade.exposure = .2, -.1
    locals_[0].sdr_grade.exposure = 2
    active = a.enabled_locals(locals_)
    hdr = rendering.apply_adjustments(source, a, PreviewKind.HDR, local_adjustments=active)
    common = rendering.apply_adjustments(source, a, PreviewKind.HDR, include_output_highlight_compression=False,
                                         apply_output_clamp=False, local_adjustments=active)
    a.sdr.linked_to_hdr = True
    calls = []
    original = rendering._apply_film_look
    def counted(*args, **kwargs):
        calls.append(args[2])
        return original(*args, **kwargs)
    monkeypatch.setattr(rendering, '_apply_film_look', counted)
    sdr = rendering.apply_adjustments(source, a, PreviewKind.SDR, local_adjustments=active)
    expected = rendering.apply_sdr_output_highlight_compression(
        acescg_to_linear_srgb(common) * rendering.SDR_SCENE_TO_DISPLAY_SCALE, a)
    np.testing.assert_array_equal(sdr, expected)
    assert calls == [PreviewKind.HDR]
    np.testing.assert_array_equal(hdr, rendering.apply_adjustments(source, a, PreviewKind.HDR, local_adjustments=active))
    a.sdr.linked_to_hdr = False
    assert not np.array_equal(sdr, rendering.apply_adjustments(source, a, PreviewKind.SDR, local_adjustments=active))


def test_relative_order_accepts_target_inversions_but_rejects_extra_inversions():
    # Eight repeated highlight populations with a known descending target.
    hdr = np.repeat(np.linspace(.4, 2., 8, dtype=np.float32), 8).reshape(8, 8, 1).repeat(3, 2)
    target = np.repeat(np.linspace(.95, .7, 8, dtype=np.float32), 8).reshape(8, 8, 1).repeat(3, 2)
    assert not _highlight_order_is_safe(hdr, target)
    assert linked_highlight_order_is_safe(hdr, target, target)
    worse = target.copy(); worse[-1] -= .01
    assert not linked_highlight_order_is_safe(hdr, target, worse)
    allowance = target.copy(); allowance[-1] -= .004
    assert linked_highlight_order_is_safe(hdr, target, allowance)
    assert not _highlight_order_is_safe(hdr, target)  # independent rule stays strict


def test_local_edit_unlinks_in_one_undo_and_noop_keeps_link(tmp_path):
    from test_sdr_local_match import store_fixture
    store, sid, lid = store_fixture(tmp_path)
    s = store.get(sid); s.adjustments.sdr.linked_to_hdr = True
    def command(kind, payload=None):
        return store.apply_edit_commands(sid, [EditCommand(expected_revision=s.edit_revision,
            command_type=kind, target_id=lid if kind == 'update_local' else None, payload=payload or {})])
    before = s.edit_document().model_dump()
    command('update_local', {'local': s.local_adjustments[0].model_dump()})
    assert s.adjustments.sdr.linked_to_hdr
    local = s.local_adjustments[0].model_copy(deep=True); local.sdr_grade.exposure = .3
    command('update_local', {'local': local.model_dump()})
    assert not s.adjustments.sdr.linked_to_hdr
    command('undo'); assert s.edit_document().model_dump() == before
    command('redo'); assert not s.adjustments.sdr.linked_to_hdr
    command('undo')
    # HDR-only local edits, shared mask opacity and bypass remain linked.
    local = s.local_adjustments[0].model_copy(deep=True); local.hdr_grade.exposure += .2; local.opacity = .3
    command('update_local', {'local': local.model_dump()}); assert s.adjustments.sdr.linked_to_hdr


def test_global_edit_unlinks_but_output_trim_and_hdr_edits_stay_linked(tmp_path):
    from test_sdr_local_match import store_fixture
    store, sid, _ = store_fixture(tmp_path); s = store.get(sid)
    s.adjustments.sdr.linked_to_hdr = True
    def put(a):
        store.apply_edit_commands(sid, [EditCommand(expected_revision=s.edit_revision,
            command_type='set_global_adjustments', payload={'adjustments': a.model_dump()})])
    a = s.adjustments.model_copy(deep=True); a.hdr.exposure += .2; a.sdr.output_exposure = .1
    put(a); assert s.adjustments.sdr.linked_to_hdr
    before = s.edit_document().model_dump()
    a = s.adjustments.model_copy(deep=True); a.sdr.film_look.print_exposure = .3
    put(a); assert not s.adjustments.sdr.linked_to_hdr
    store.apply_edit_commands(sid, [EditCommand(expected_revision=s.edit_revision, command_type='undo')])
    assert s.edit_document().model_dump() == before


def test_link_survives_saved_document_roundtrip():
    from hdr_finisher.models import EditDocument
    from test_sdr_match_state import _store_with_source
    a = AdjustmentState(); a.sdr.linked_to_hdr = True; a.sdr.use_authored_base = False; a.sdr.output_exposure = .2
    assert AdjustmentState.model_validate_json(a.model_dump_json()) == a


def test_match_evaluates_common_film_once_and_fallback_keeps_independent_fit(monkeypatch):
    from hdr_finisher.sdr_match import materialize_sdr_match, _materialize_sdr_match_impl
    source = tifffile.imread(Path(__file__).parent / 'fixtures/hdr_match_scene.tiff').astype(np.float32)
    a = AdjustmentState(); a.hdr.film_look.film_stock = 'kodak_portra_400'; a.hdr.film_look.look_strength = 50
    calls = []; film = rendering._apply_film_look
    def counted(*args, **kwargs):
        calls.append(args[2]); return film(*args, **kwargs)
    monkeypatch.setattr(rendering, '_apply_film_look', counted)
    linked = materialize_sdr_match(source, a, [], reference_white_nits=203, source_pixel_scale=1)
    assert linked.adjustments.sdr.linked_to_hdr
    assert calls == [PreviewKind.HDR]
    monkeypatch.setattr('hdr_finisher.sdr_link.try_linked_match', lambda *args, **kwargs: (None, 'white-growth test'))
    fallback = materialize_sdr_match(source, a, [], reference_white_nits=203, source_pixel_scale=1)
    incumbent = _materialize_sdr_match_impl(source, a, [], reference_white_nits=203, source_pixel_scale=1)
    assert fallback.adjustments == incumbent.adjustments
    assert fallback.local_adjustments == incumbent.local_adjustments
    assert fallback.quality == incumbent.quality and fallback.status == incumbent.status
    assert fallback.link_fallback_reason == 'white-growth test'


def test_refused_and_equal_local_matches_keep_link(tmp_path, monkeypatch):
    from test_sdr_local_match import store_fixture
    from hdr_finisher.sdr_local_match import LocalMatchResult
    store, sid, lid = store_fixture(tmp_path); s = store.get(sid)
    s.adjustments.sdr.linked_to_hdr = True
    before = s.edit_document().model_dump(); revision = s.edit_revision
    monkeypatch.setattr('hdr_finisher.sdr_local_match.fit_local_sdr', lambda *args, **kwargs: LocalMatchResult(None, 'No change', {}))
    response, message, changed = store.apply_local_sdr_match_action(sid, expected_revision=revision, target_id=lid)
    assert not changed and s.edit_revision == revision and s.edit_document().model_dump() == before
    grade = s.local_adjustments[0].sdr_grade.model_copy(deep=True)
    monkeypatch.setattr('hdr_finisher.sdr_local_match.fit_local_sdr', lambda *args, **kwargs: LocalMatchResult(grade, 'Already equal', {}))
    response, message, changed = store.apply_local_sdr_match_action(sid, expected_revision=revision, target_id=lid)
    assert s.adjustments.sdr.linked_to_hdr and s.local_adjustments[0].sdr_grade == grade
