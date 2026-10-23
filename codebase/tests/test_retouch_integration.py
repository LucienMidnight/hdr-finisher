"""Interactive repairs publish one native source transaction for every consumer."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import numpy as np
from PIL import Image
import pytest

from hdr_finisher.models import EditCommand, PreviewKind, RepairRecord
from hdr_finisher.projects import save_project, open_project, open_document, _validate_ignoring_unknown_fields
from hdr_finisher.retouch import CpuInpaint
from hdr_finisher.retouch_jobs import RepairWorker
from hdr_finisher.retouch_recipe import InpaintRecipe
from hdr_finisher.sessions import SessionStore, EditCommandError, RevisionConflictError


@pytest.fixture
def photo(tmp_path):
    pixels = np.full((64, 80, 3), 180, np.uint8)
    pixels[29:35, 37:43] = 60
    path = tmp_path / "dust.png"
    Image.fromarray(pixels).save(path)
    store = SessionStore()
    payload = store.create_session(path, owns_source_path=False)
    session = store.get(payload.session_id)
    yield store, session
    store.clear()


def record(**updates):
    return RepairRecord(id="dust", recipe=InpaintRecipe(
        source_size=(80, 64), search_rect=(16, 8, 64, 56),
        points=[dict(x=.5, y=.5)], radius_px=6, hardness=1,
        settings=dict(seed=42, iterations=2, patch_radius=2)), **updates)


def edit(store, session, kind="set_repairs", records=None, **payload):
    if kind == "set_repairs": payload["repairs"] = [r.model_dump(mode="json") for r in records]
    return store.apply_edit_commands(session.session_id, [EditCommand(
        expected_revision=session.edit_revision, command_type=kind, payload=payload)])


def test_native_publication_history_masks_and_seeded_project_replay(photo, tmp_path):
    store, session = photo
    before = session.image.copy()
    old_epoch = session.render_cache.source_epoch
    edit(store, session, records=[record()])
    repaired = session.image.copy()
    assert repaired[32, 40, 0] > before[32, 40, 0]
    np.testing.assert_array_equal(repaired[:20], before[:20])
    assert session.render_cache.source_epoch > old_epoch
    native, _ = session.render_cache.source_pair(100000)
    np.testing.assert_array_equal(native, repaired)
    proxy, _ = session.render_cache.source_proxy(PreviewKind.HDR, 100000)
    np.testing.assert_array_equal(proxy, repaired)
    assert len(session.undo_history) == 1
    edit(store, session, "undo")
    np.testing.assert_array_equal(session.image, before)
    edit(store, session, "redo")
    np.testing.assert_array_equal(session.image, repaired)
    project = tmp_path / "dust.hdrfinisher"
    save_project(session, project)
    restored = open_project(store, project)
    assert restored.repairs == [record()]
    np.testing.assert_array_equal(restored.image, repaired)
    # Reusing a decode with an empty document must also remove old repairs.
    empty = restored.edit_document().model_copy(update={"repairs": []})
    open_document(store, empty, reuse_session_id=restored.session_id)
    np.testing.assert_array_equal(restored.image, before)


def test_float_hdr_negative_values_and_cached_completed_repairs(photo):
    store, session = photo
    class CountingEngine:
        count = 0
        def solve(self, *args):
            self.count += 1
            return CpuInpaint().solve(*args)
    engine = CountingEngine()
    session.retouch_worker = RepairWorker(engine=engine)
    base = np.full((64, 80, 3), [-.25, 2., 9.], np.float32)
    base[29:35, 37:43] *= .2
    session.image = session.retouch_original = base
    session.render_cache.replace_source(base, None)
    edit(store, session, records=[record()])
    expected = session.image.copy()
    np.testing.assert_allclose(expected[32, 40], [-.25, 2., 9.], atol=1e-5)
    edit(store, session, "undo")
    edit(store, session, "redo")
    np.testing.assert_array_equal(session.image, expected)
    assert engine.count == 1
    edit(store, session, records=[record(enabled=False)])
    assert session.image is base
    edit(store, session, records=[record()])
    assert engine.count == 1


@pytest.mark.parametrize("supersede", [False, True])
def test_cancel_and_newer_edit_leave_last_valid_document_and_pixels(photo, supersede):
    store, session = photo
    started, release = Event(), Event()
    class WaitingEngine:
        def solve(self, request, settings, checkpoint):
            started.set()
            assert release.wait(5)
            checkpoint()
            return CpuInpaint().solve(request, settings, checkpoint)
    session.retouch_worker = RepairWorker(engine=WaitingEngine())
    before = session.image
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(edit, store, session, records=[record()])
        assert started.wait(5)
        if supersede:
            edit(store, session, "set_global_adjustments", adjustments=session.adjustments.model_dump(mode="json"))
        else:
            store.cancel_repair(session.session_id)
        release.set()
        with pytest.raises(EditCommandError, match="cancelled|superseded"):
            future.result(timeout=5)
    assert session.image is before
    assert session.repairs == []
    assert session.edit_revision == int(supersede)


def test_invalid_batch_is_atomic_and_old_revision_cannot_solve(photo):
    store, session = photo
    before = session.image
    with pytest.raises(EditCommandError):
        store.apply_edit_commands(session.session_id, [
            EditCommand(expected_revision=0, command_type="set_repairs", payload={"repairs": [record().model_dump(mode="json")]}),
            EditCommand(expected_revision=1, command_type="delete_local", target_id="missing")])
    assert session.image is before and session.repairs == [] and session.edit_revision == 0
    with pytest.raises(RevisionConflictError):
        store.apply_edit_commands(session.session_id, [EditCommand(expected_revision=9, command_type="set_repairs", payload={"repairs": []})])
    assert session.retouch_worker is None


def test_match_controls_are_retained_and_rematch_flag_is_undoable(photo):
    store, session = photo
    # Authored SDR also requires an explicit Match, never paint its independent base.
    authored = np.full_like(session.image, .2)
    session.sdr_reference_image = authored
    controls = session.adjustments.model_dump_json()
    edit(store, session, records=[record()])
    assert session.sdr_match.rematch_required
    assert session.adjustments.model_dump_json() == controls
    assert session.sdr_reference_image is authored
    edit(store, session, "undo")
    assert not session.sdr_match.rematch_required


def test_unknown_engine_cannot_silently_change_a_saved_repair(photo):
    _, session = photo
    document = session.edit_document().model_dump(mode="json")
    document["repairs"] = [record().model_dump(mode="json")]
    document["repairs"][0]["recipe"]["settings"]["algorithm"] = "another-engine"
    with pytest.raises(ValueError):
        _validate_ignoring_unknown_fields(document)


def test_library_native_source_uses_same_repair_before_reduction(photo, tmp_path):
    from hdr_finisher.library_live import _develop_cpu, quality
    from hdr_finisher.library_pictures import reduce_picture
    store, session = photo
    untouched = session.edit_document().model_dump(mode="json")
    edit(store, session, records=[record()])
    saved = session.edit_document().model_dump(mode="json")
    assert quality(saved) != quality(untouched)
    # A capture cache inspects pixels actually passed to the Library store.
    class CaptureCache:
        def cached(self, *args): return None
        def build(self, path, edge, source_quality, cancelled, pixels):
            np.testing.assert_array_equal(pixels[0], reduce_picture(session.image, edge))
            return edge
    assert _develop_cpu(tmp_path, session.source_path, saved, 32, cache=CaptureCache()) == 32


@pytest.mark.parametrize("method", ["standard","edge-feather","original-detail","donor-detail"])
def test_repair_invalidates_proof_cache_and_full_proof_matches_export(photo, tmp_path, method):
    from hashlib import sha256
    from pathlib import Path
    from hdr_finisher.capabilities import probe_capabilities
    from hdr_finisher.exporters import build_export_backends, _denoised_export_source
    from hdr_finisher.models import ExportSettings, ProofArtifactRequest, CapabilityStatus
    from hdr_finisher.proofing import ProofArtifactStore
    store, session = photo
    capabilities = probe_capabilities()
    if capabilities["jpegxl_export"].status != CapabilityStatus.AVAILABLE:
        pytest.skip("JPEG XL encoder unavailable")
    backend = build_export_backends(capabilities)["jpegxl_hdr"]
    proofs = ProofArtifactStore()
    request = ProofArtifactRequest(format="jpegxl_hdr", full_size=True, quality=85, adjustments=session.adjustments)
    try:
        before = proofs.create(session, request, backend)
        repair = record()
        repair = repair.model_copy(update={"recipe":repair.recipe.model_copy(update={"method":method})})
        edit(store, session, records=[repair])
        for lane in (PreviewKind.HDR, PreviewKind.SDR):
            assert _denoised_export_source(session, lane) is session.image
        after = proofs.create(session, request, backend)
        assert after.sha256 != before.sha256, "same-session repair must invalidate cached Proof"
        exported = backend.export(session, ExportSettings(format="jpegxl_hdr", quality=85,
            output_path=str(tmp_path / "repaired.jxl"), overwrite=True))
        assert exported.accepted, exported.message
        assert sha256(Path(exported.output_path).read_bytes()).hexdigest() == after.sha256
    finally:
        proofs.clear()


def test_luminance_selection_reads_the_repaired_source(photo):
    from hdr_finisher.models import LocalAdjustment, MaskExpression, MaskLeaf
    store, session = photo
    mask = LocalAdjustment(mask=MaskExpression(leaf=MaskLeaf(type="luminance_range",
        fade_in_start_ev=-3, full_start_ev=-2, full_end_ev=8, fade_out_end_ev=9)))
    before = session.render_cache.compiled_local_mask(session.adjustments, mask, 100000)
    edit(store, session, records=[record()])
    after = session.render_cache.compiled_local_mask(session.adjustments, mask, 100000)
    assert after[32, 40] > before[32, 40]


def test_cancel_arriving_before_queued_request_prevents_the_solve(photo):
    store, session = photo
    store.cancel_repair(session.session_id, "queued-dust")
    with pytest.raises(EditCommandError, match="cancelled before processing"):
        edit(store, session, records=[record()], repair_request_id="queued-dust")
    assert session.repairs == [] and session.retouch_worker is None
    # A new attempt at the same document revision remains possible.
    edit(store, session, records=[record()], repair_request_id="retry-dust")
    assert len(session.repairs) == 1


@pytest.mark.parametrize("method", ["standard","edge-feather","original-detail","donor-detail"])
def test_new_and_removed_spots_cannot_change_completed_donors(photo, tmp_path, method):
    store, session = photo
    class CountingEngine:
        count = 0
        def solve(self, *args):
            self.count += 1
            return CpuInpaint().solve(*args)
    engine = CountingEngine()
    session.retouch_worker = RepairWorker(engine=engine, cache_bytes=0)
    first = record()
    first = first.model_copy(update={"recipe":first.recipe.model_copy(update={"method":method})})
    second = first.model_copy(update={"id": "second", "recipe": first.recipe.model_copy(update={
        "points": (first.recipe.points[0].model_copy(update={"x": .7}),)})})
    edit(store, session, records=[first])
    first_pixels = session.image[26:38, 34:46].copy()
    edit(store, session, records=[first, second])
    np.testing.assert_array_equal(session.image[26:38, 34:46], first_pixels)
    assert engine.count == 2, "adding a defect must not re-solve completed repairs"
    multi = tmp_path / "multi.hdrfinisher"
    save_project(session, multi)
    multi_pixels = session.image.copy()
    edit(store, session, records=[first])
    np.testing.assert_array_equal(session.image[26:38, 34:46], first_pixels)
    assert engine.count == 2, "removing a defect must not re-solve completed repairs"
    project = tmp_path / "stable.hdrfinisher"
    save_project(session, project)
    restored = open_project(store, project)
    np.testing.assert_array_equal(restored.image, session.image)
    np.testing.assert_array_equal(open_project(store, multi).image, multi_pixels)


@pytest.mark.parametrize("method", ["edge-feather","original-detail","donor-detail"])
def test_prototype_project_replay_and_history_keep_method_and_settings(photo,tmp_path,method):
    store,session=photo
    repair=record()
    repair=repair.model_copy(update={"recipe":repair.recipe.model_copy(update={
        "method":method,"edge_feather":.45,"texture_amount":.65})})
    original=session.image.copy()
    edit(store,session,records=[repair])
    result=session.image.copy()
    from hdr_finisher.retouch_recipe import stroke_mask
    outside=np.ones(original.shape[:2],dtype=bool)
    left,top,right,bottom=repair.recipe.search_rect
    outside[top:bottom,left:right]=stroke_mask(repair.recipe) == 0
    np.testing.assert_array_equal(result[outside],original[outside])
    edit(store,session,"undo")
    edit(store,session,"redo")
    np.testing.assert_array_equal(session.image,result)
    project=tmp_path/"prototype.hdrfinisher"
    save_project(session,project)
    restored=open_project(store,project)
    assert restored.repairs[0].recipe == repair.recipe
    np.testing.assert_array_equal(restored.image,result)
