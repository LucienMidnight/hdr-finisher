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


def test_new_match_materializes_even_when_a_link_would_be_safe():
    from hdr_finisher.sdr_match import materialize_sdr_match, _materialize_sdr_match_impl
    # Neutral ramp with both body and highlights, without the inversions
    # exposed by the brighter target on the coloured fixture.
    ramp = np.linspace(.01, .17, 96, dtype=np.float32)[None, :, None]
    source = np.broadcast_to(ramp, (48, 96, 3)).copy()
    a = AdjustmentState()
    old, reason = try_linked_match(source, a, [], None, reference_white_nits=203, source_pixel_scale=1)
    assert old is not None, reason
    result = materialize_sdr_match(source, a, [], reference_white_nits=203, source_pixel_scale=1)
    expected = _materialize_sdr_match_impl(source, a, [], reference_white_nits=203, source_pixel_scale=1)
    assert not result.adjustments.sdr.linked_to_hdr
    assert result.adjustments == expected.adjustments
    assert result.local_adjustments == expected.local_adjustments
    assert result.quality == expected.quality


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
    assert not changed and s.edit_revision == revision and s.edit_document().model_dump() == before


def test_linked_hue_masks_and_picker_use_hdr_prefix_and_follow_hdr_edits():
    from hdr_finisher.models import MaskExpression, MaskLeaf
    from hdr_finisher.render_cache import SessionRenderCache
    from hdr_finisher.hsl_sampling import capture_stage_input
    source = tifffile.imread(Path(__file__).parent/'fixtures/hdr_match_scene.tiff').astype(np.float32)
    a=AdjustmentState();a.sdr.linked_to_hdr=True;a.sdr.use_authored_base=False
    a.hdr.saturation=.2;a.sdr.saturation=-.5
    local=LocalAdjustment(mask=MaskExpression(leaf=MaskLeaf(type='hue_range',hue_center=230,hue_width=40)))
    cache=SessionRenderCache(source,None)
    try:
        hdr=cache.compiled_local_mask(a,local,256,lane=PreviewKind.HDR,spatial_only=True)
        sdr=cache.compiled_local_mask(a,local,256,lane=PreviewKind.SDR,spatial_only=True)
        np.testing.assert_array_equal(hdr,sdr)
        before=cache.hsl_stage_input(a,256,PreviewKind.SDR).copy()
        expected=acescg_to_linear_srgb(capture_stage_input(source,a,PreviewKind.HDR))
        np.testing.assert_array_equal(before,expected)
        a.hdr.exposure=.4
        assert not np.array_equal(before,cache.hsl_stage_input(a,256,PreviewKind.SDR))
    finally:
        cache.clear_adjusted()


def test_hdr_denoise_mirror_keeps_link_through_undo_redo(tmp_path):
    from test_sdr_local_match import store_fixture
    store,sid,_=store_fixture(tmp_path);s=store.get(sid)
    s.adjustments.sdr.linked_to_hdr=True
    before=s.edit_document().model_dump()
    desired=s.denoise.model_copy(deep=True);desired.hdr.enabled=True;desired.hdr.controls.amount=.8
    store.apply_edit_commands(sid,[EditCommand(expected_revision=s.edit_revision,command_type='set_denoise_settings',payload={'denoise':desired.model_dump()})])
    assert s.adjustments.sdr.linked_to_hdr and s.denoise.sdr==s.denoise.hdr
    after=s.edit_document().model_dump()
    store.apply_edit_commands(sid,[EditCommand(expected_revision=s.edit_revision,command_type='undo')])
    assert s.edit_document().model_dump()==before
    store.apply_edit_commands(sid,[EditCommand(expected_revision=s.edit_revision,command_type='redo')])
    assert s.edit_document().model_dump()==after
