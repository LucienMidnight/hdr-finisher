"""Result-based batch orchestration checks; tiny disposable sources only."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from threading import Event
from time import monotonic, sleep
import numpy as np
from PIL import Image
import pytest
from hdr_finisher.batch_export import BatchExports, export_photo, export_state, share_grade_source
from hdr_finisher.export_presets import ExportPreset, ExportPresets, ExportVersion, render_pattern, version_destination
from hdr_finisher.models import EditCommand, ExportSettings, PreviewKind, RawImportSettings, RepairRecord, SourceInterpretationOverride
from hdr_finisher.sessions import SessionStore
from hdr_finisher.projects import open_document, validate_saved_document
from hdr_finisher.exporters import build_export_backends
from hdr_finisher.capabilities import probe_capabilities

def fixture_photo(tmp_path, number=1):
    source=tmp_path/f"photo{number}.png"
    image=np.arange(64*48*3,dtype=np.uint8).reshape(48,64,3)
    Image.fromarray(image).save(source)
    store=SessionStore()
    payload=store.create_session(source,owns_source_path=False)
    session=store.get(payload.session_id)
    session.adjustments.hdr.exposure=number/4
    session.adjustments.sdr.exposure=-number/4
    grade=session.edit_document().model_dump(mode="json")
    store.clear()
    return {"path":str(source),"source_path":str(source),"grade":grade,"rating":number,"capture_time":"2026-10-17T14:05:00","copy_name":""}

def preset(formats=("sdr_png","sdr_jpeg")):
    return ExportPreset(name="Delivery",versions=[ExportVersion(name=f"Version {i}",pattern="{filename}_{copy}_{sequence:3}_{date:YYYYMMDD}_{rating}_{version}",subfolder=f"set{i}",settings=ExportSettings(format=f,dithering="off")) for i,f in enumerate(formats,1)])


def exported_hashes(results):
    assert results and all(row["outcome"] in {"exported", "renamed"} for row in results), results
    return [sha256(Path(row["output_path"]).read_bytes()).hexdigest() for row in results]


@pytest.mark.slow
@pytest.mark.parametrize("saved_grade", [True, False])
def test_grade_source_hardlink_survives_grade_close_and_worker_exports_exactly(tmp_path, monkeypatch, capsys, saved_grade):
    from hdr_finisher import delivery_frames

    photo = fixture_photo(tmp_path)
    if not saved_grade:
        photo["grade"] = None
    versions = preset()
    headless = BatchExports(lambda path: photo, tmp_path / "records.json")
    try:
        baseline = exported_hashes(headless._subprocess(photo, versions, str(tmp_path), 1))
    finally:
        headless.close()
    monkeypatch.setattr(delivery_frames, "SOURCE_SPILL_BYTES", 1)
    store = SessionStore(file_back_sources=True)
    source_path = Path(photo["source_path"])
    if saved_grade:
        session = open_document(store, validate_saved_document(photo["grade"]), source_path)
    else:
        session = store.get(store.create_session(source_path).session_id)
    backends = build_export_backends(probe_capabilities())
    for version, expected_hash in zip(versions.versions, baseline, strict=True):
        settings = version.settings.model_copy(update={"output_path": str(tmp_path / f"grade-{version.name}")})
        response = backends[settings.format].export(session, settings)
        assert response.accepted, response.message
        assert sha256(Path(response.output_path).read_bytes()).hexdigest() == expected_hash
    session.adjustments.sdr.exposure = -2
    assert session.image is session.retouch_original is session.render_cache.image
    owner = session.image._mmap
    frame = delivery_frames.DeliveryFrame.grade_source_frame(session.image)
    view = np.asarray(session.image)[::2]
    before = view.copy()
    assert not view.flags.writeable
    assert store._retained_session_bytes() == session.image.nbytes + session.sdr_reference_image.nbytes
    expected_inode = frame.path.stat().st_ino
    paths = []
    del session

    def handoff(item, directory):
        nonlocal view
        shared = share_grade_source(store, item, directory)
        shared_path = Path(shared["image"]["path"])
        paths.extend((shared_path, Path(shared["sdr_reference_image"]["path"])))
        assert shared_path.stat().st_ino == expected_inode
        store.clear()
        assert store._retained_session_bytes() == 0
        np.testing.assert_array_equal(view, before)
        del view
        assert owner.closed and not frame.path.exists()
        return shared

    queue = BatchExports(lambda path: photo, tmp_path / "records.json", shared_source=handoff)
    try:
        assert exported_hashes(queue._subprocess(photo, versions, str(tmp_path), 1)) == baseline
    finally:
        queue.close()
        store.clear()
    assert paths and not any(path.exists() for path in paths)
    assert any(record.get("event") == "batch_source_shared" and record["proc"] == "batch_worker"
               and record["reason"] == "grade_source_reused" for record in diagnostic_records(capsys))


def diagnostic_records(capsys):
    for line in capsys.readouterr().err.splitlines():
        if line.startswith("{"):
            yield json.loads(line)


def test_replacing_grade_source_keeps_active_view_valid_until_released(tmp_path, monkeypatch):
    from hdr_finisher import delivery_frames

    photo = fixture_photo(tmp_path)
    monkeypatch.setattr(delivery_frames, "SOURCE_SPILL_BYTES", 1)
    store = SessionStore(file_back_sources=True)
    path = Path(photo["source_path"])
    store.create_session(path)
    pixels = store.current().image
    frame = delivery_frames.DeliveryFrame.grade_source_frame(pixels)
    mapping = pixels._mmap
    view = np.asarray(pixels)[:8]
    expected = view.copy()
    borrowed = delivery_frames.DeliveryFrame.borrow_grade_source(pixels)
    del pixels
    store.create_session(path)
    assert not mapping.closed
    np.testing.assert_array_equal(view, expected)
    del view
    with borrowed.map("r") as reopened:
        np.testing.assert_array_equal(reopened[:8], expected)
    del borrowed
    assert mapping.closed and not frame.path.exists()
    assert store.current().image.nbytes * 2 == store._retained_session_bytes()
    store.clear()


@pytest.mark.needs_native_helper
@pytest.mark.parametrize(("format_name", "capability"), [
    ("jpeg_ultrahdr", "ultrahdr_encoder"), ("avif_gain_map", "avif_gain_map_encoder"),
])
def test_shared_grade_source_preserves_hdr_delivery_hash(tmp_path, format_name, capability):
    encoder = probe_capabilities()[capability]
    if encoder.status.value != "available":
        pytest.skip(encoder.detail)
    photo = fixture_photo(tmp_path)
    versions = preset((format_name,))
    baseline = exported_hashes(export_photo(photo, versions, tmp_path, 1))
    store = SessionStore(file_back_sources=True)
    try:
        open_document(store, validate_saved_document(photo["grade"]), Path(photo["source_path"]))
        shared = share_grade_source(store, photo, tmp_path)
        assert shared is not None
        assert exported_hashes(export_photo(photo, versions, tmp_path, 1, shared_source=shared)) == baseline
    finally:
        store.clear()


@pytest.mark.parametrize("backing", ["heap", "cross-device"])
def test_shared_batch_decodes_nothing_and_replays_only_saved_repairs(tmp_path, monkeypatch, capsys, backing):
    from errno import EXDEV
    from hdr_finisher import delivery_frames, raw_import, sessions
    from hdr_finisher.retouch_recipe import InpaintRecipe
    from hdr_finisher.scopes import build_scope

    if backing == "cross-device":
        monkeypatch.setattr(delivery_frames, "SOURCE_SPILL_BYTES", 1)
    path = tmp_path / "dust.png"
    pixels = np.full((64, 80, 3), 180, np.uint8)
    pixels[29:35, 21:27] = 60
    pixels[29:35, 53:59] = 70
    Image.fromarray(pixels).save(path)
    store = SessionStore(file_back_sources=True)
    payload = store.create_session(path)
    session = store.get(payload.session_id)

    def repair(name, center):
        return RepairRecord(id=name, recipe=InpaintRecipe(
            source_size=(80, 64), search_rect=(center-20, 8, center+20, 56),
            points=[dict(x=center/80, y=.5)], radius_px=6, hardness=1,
            settings=dict(seed=42, iterations=2, patch_radius=2),
        )).model_dump(mode="json")

    def edit(repairs):
        store.apply_edit_commands(session.session_id, [EditCommand(
            expected_revision=session.edit_revision, command_type="set_repairs", payload={"repairs": repairs},
        )])

    original = session.retouch_original.copy()
    saved = repair("saved", 24)
    edit([saved])
    saved_pixels = session.image.copy()
    assert not np.array_equal(saved_pixels, original)
    photo = {"path": str(path), "source_path": str(path), "grade": session.edit_document().model_dump(mode="json")}
    versions = preset()
    baseline = exported_hashes(export_photo(photo, versions, tmp_path, 1))
    edit([saved, repair("unsaved", 56)])
    session.adjustments.sdr.exposure = -2
    assert not np.array_equal(session.image, saved_pixels)
    np.testing.assert_array_equal(session.retouch_original, original)
    assert not session.image.flags.writeable
    assert not session.retouch_original.flags.writeable
    if backing == "cross-device":
        assert store._retained_session_bytes() == sum(
            array.nbytes for array in (session.image, session.retouch_original, session.sdr_reference_image)
        )
    assert build_scope(session.image, session.adjustments, PreviewKind.SDR, sdr_reference_image=session.sdr_reference_image)
    np.testing.assert_array_equal(session.render_cache.source_pair(1000)[0], session.image)

    def cross_device(*args):
        raise OSError(EXDEV, "cross-device link")

    def unexpected_decode(*args, **kwargs):
        pytest.fail("The worker decoded a source it already received from Grade")

    scratch = tmp_path / "handoff"
    scratch.mkdir()
    with monkeypatch.context() as checks:
        if backing == "cross-device":
            checks.setattr("hdr_finisher.batch_export.os.link", cross_device)
        shared = share_grade_source(store, photo, scratch)
    assert shared is not None
    assert (scratch / "shared_source.rgb").read_bytes() == original.tobytes()
    with monkeypatch.context() as checks:
        checks.setattr(sessions, "load_image", unexpected_decode)
        checks.setattr(raw_import, "decode_raw", unexpected_decode)
        assert exported_hashes(export_photo(photo, versions, tmp_path, 1, shared_source=shared)) == baseline
    assert any(record.get("event") == "batch_source_shared" for record in diagnostic_records(capsys))
    store.clear()


@pytest.mark.parametrize("mismatch", ["raw", "override", "white", "decode_white", "source", "late_source", "short_frame"])
def test_shared_batch_source_refuses_mismatch_and_decodes_normally(tmp_path, monkeypatch, capsys, mismatch):
    from hdr_finisher import sessions

    photo = fixture_photo(tmp_path)
    path = Path(photo["source_path"])
    options = {}
    if mismatch == "raw":
        options["raw_import_settings"] = RawImportSettings(pixel_cleanup={"remove_hot_pixels": False})
    if mismatch == "override":
        options["interpretation_override"] = SourceInterpretationOverride(color_space="sRGB")
    if mismatch in {"white", "decode_white"}:
        options["hdr_reference_white_nits"] = 100
    if mismatch in {"source", "late_source"}:
        photo["grade"]["source"]["fingerprint_sha256"] = None
        path.write_bytes(path.read_bytes() + b"X")
    store = SessionStore(file_back_sources=True)
    store.activate_session(store.prepare_session(path, **options))
    if mismatch == "decode_white":
        live = store.current()
        store.apply_edit_commands(live.session_id, [EditCommand(
            expected_revision=0, command_type="set_hdr_reference_white",
            payload={"hdr_reference_white_nits": photo["grade"]["hdr_reference_white_nits"]},
        )])

    def touch_source():
        original = path.read_bytes()
        path.write_bytes(original[:-1] + b"Y")

    if mismatch == "source":
        touch_source()
    scratch = tmp_path / "handoff"
    scratch.mkdir()
    shared = share_grade_source(store, photo, scratch)
    if mismatch in {"late_source", "short_frame"}:
        assert shared is not None
        if mismatch == "late_source":
            touch_source()
        else:
            Path(shared["image"]["path"]).write_bytes(b"short")
    else:
        assert shared is None
    store.clear()

    decoded = []
    load_image = sessions.load_image

    def observed_decode(path, *args, **kwargs):
        decoded.append(path)
        return load_image(path, *args, **kwargs)

    monkeypatch.setattr(sessions, "load_image", observed_decode)
    exported_hashes(export_photo(photo, preset(), tmp_path, 1, shared_source=shared))
    assert decoded == [path]
    assert not any(record.get("event") == "batch_source_shared" for record in diagnostic_records(capsys))


def test_shared_batch_source_ignores_auto_lensfun_resolved_labels(tmp_path):
    photo = fixture_photo(tmp_path)
    path = Path(photo["source_path"])
    auto_lens = RawImportSettings(lens={"mode": "auto"})
    photo["grade"]["source"]["raw_import_settings"] = auto_lens.model_dump(mode="json")
    store = SessionStore(file_back_sources=True)
    session = store.prepare_session(path, raw_import_settings=auto_lens)
    session.raw_import_settings = auto_lens.model_copy(
        update={"lens": auto_lens.lens.model_copy(update={"profile_id": "Sigma 65mm F2", "database_version": "2026.1"})}
    )
    store.activate_session(session)
    scratch = tmp_path / "handoff"
    scratch.mkdir()
    try:
        shared = share_grade_source(store, photo, scratch)
        assert shared is not None
        session.raw_import_settings = RawImportSettings(lens={"mode": "off"})
        assert share_grade_source(store, photo, scratch) is None
    finally:
        store.clear()


@pytest.mark.parametrize("formats", [("sdr_jpeg",), ("sdr_png", "sdr_jpeg")])
def test_batch_spills_sources_and_releases_only_after_final_prepare(tmp_path, monkeypatch, formats):
    from hdr_finisher import batch_export, delivery_frames, export_metadata, exporters

    photo = fixture_photo(tmp_path)
    versions = preset(formats)
    monkeypatch.setattr(delivery_frames, "SOURCE_SPILL_BYTES", 1)
    original_render = exporters._render_export_branch
    original_metadata = export_metadata.write_metadata
    original_jpeg_write = exporters._write_sdr_jpeg
    renders, encodes, maps, sessions = [], [], [], []

    def render(session, settings, *args, **kwargs):
        assert not session.image.flags.writeable
        assert not session.sdr_reference_image.flags.writeable
        assert session.image is session.retouch_original is session.render_cache.image
        assert session.sdr_reference_image is session.render_cache.sdr_reference_image
        renders.append(settings.format)
        maps.extend((session.image, session.sdr_reference_image))
        sessions.append(session)
        return original_render(session, settings, *args, **kwargs)

    def metadata(path, session, settings):
        encodes.append(settings.format)
        final = settings.format == versions.versions[-1].settings.format
        assert (session.image is None) == final
        assert (session.sdr_reference_image is None) == final
        assert (session.render_cache is None) == final
        assert all(pixels._mmap.closed == final for pixels in maps)
        return original_metadata(path, session, settings)

    def write_jpeg(*args, **kwargs):
        assert sessions[-1].image is None
        assert all(pixels._mmap.closed for pixels in maps)
        return original_jpeg_write(*args, **kwargs)

    with monkeypatch.context() as checks:
        checks.setattr(exporters, "_render_export_branch", render)
        checks.setattr(exporters, "_write_sdr_jpeg", write_jpeg)
        checks.setattr(export_metadata, "write_metadata", metadata)
        results = export_photo(photo, versions, tmp_path, 1)
    assert renders == encodes == list(formats)
    assert all(not Path(pixels.filename).exists() for pixels in maps)

    store = SessionStore()
    try:
        interactive = open_document(store, validate_saved_document(photo["grade"]), Path(photo["source_path"]))
        source, cache = interactive.image, interactive.render_cache
        backends = build_export_backends(probe_capabilities())
        for row, version in zip(results, versions.versions, strict=True):
            assert row["outcome"] == "exported", row
            settings = version.settings.model_copy(update={"output_path": str(tmp_path / f"grade-{version.name}")})
            response = backends[settings.format].export(interactive, settings)
            assert response.accepted, response.message
            assert interactive.image is source and interactive.render_cache is cache
            assert Path(response.output_path).read_bytes() == Path(row["output_path"]).read_bytes()
    finally:
        store.clear()


def test_peak_check_is_saved_independently_for_each_preset_version(tmp_path):
    library = ExportPresets(tmp_path / "presets")
    delivery = preset(("jpeg_ultrahdr", "jpegxl_hdr"))
    assert all(not version.settings.guarantee_hdr_peak for version in delivery.versions)
    delivery.versions[1].settings.guarantee_hdr_peak = True
    library.save(delivery)
    restored = library.list()[0]
    assert [version.settings.guarantee_hdr_peak for version in restored.versions] == [False, True]

def wait_job(queue,identity,states={"finished","cancelled"}):
    deadline=monotonic()+20
    while monotonic()<deadline:
        job=queue.status(identity)
        if job["state"] in states:return job
        sleep(.01)
    raise AssertionError(queue.status(identity))

def test_preset_crud_names_subfolders_and_validation(tmp_path):
    library=ExportPresets(tmp_path/"presets"); p=preset();library.save(p)
    assert library.list()[0]==p
    p.name="Renamed";library.save(p);assert library.list()[0].name=="Renamed"
    clone=p.model_copy(deep=True);clone.id="duplicate";library.save(clone);assert len(library.list())==2
    library.delete(p.id);assert library.list()==[clone]
    photo={"source_path":"original.raw","copy_name":"Copy: 2","rating":4,"capture_time":"2026-10-17T01:00:00"}
    assert render_pattern("{filename}_{copy}_{sequence:4}_{date:YYYYMMDD}_{rating}_{version}_{preset}",photo,7,"HDR","Delivery")=="original_Copy_ 2_0007_20261017_4_HDR_Delivery"
    assert render_pattern("CON",photo,1,"HDR","Delivery")=="_CON"
    with pytest.raises(ValueError):render_pattern("{unknown}",photo,1,"HDR","Delivery")
    with pytest.raises(ValueError):version_destination(tmp_path,ExportVersion(subfolder="../escape"),photo,1,"p")

@pytest.mark.slow
@pytest.mark.parametrize("formats",[("sdr_png","sdr_jpeg"),("jpeg_ultrahdr","avif_gain_map")])
def test_three_photos_two_versions_match_single_export_exactly(tmp_path,formats):
    caps=probe_capabilities()
    required={"jpeg_ultrahdr":"ultrahdr_encoder","avif_gain_map":"avif_gain_map_encoder"}
    for format in formats:
        if format in required and caps[required[format]].status.value!="available":pytest.skip(caps[required[format]].detail)
    p=preset(formats)
    photos=[fixture_photo(tmp_path,i) for i in (1,2)]
    copy=deepcopy(photos[0]);copy["path"]+="|copy|disposable";copy["copy_name"]="Virtual copy";copy["grade"]["global_adjustments"]["hdr"]["exposure"]=1.;photos.append(copy)
    output=tmp_path/"out";output.mkdir()
    all_results=[]
    for sequence,photo in enumerate(photos,1):
        progress=[]
        all_results.extend(export_photo(photo,p,output,sequence,lambda rows:progress.append(deepcopy(rows))))
        assert [len(rows) for rows in progress]==[1,2]
        assert all(Path(rows[-1]["output_path"]).is_file() for rows in progress)
    assert len(all_results)==6
    assert all(row["outcome"]=="exported" for row in all_results),all_results
    backends=build_export_backends(caps)
    for sequence,photo in enumerate(photos,1):
        store=SessionStore();session=open_document(store,validate_saved_document(photo["grade"]),Path(photo["source_path"]))
        try:
            for version in p.versions:
                expected=version_destination(output,version,photo,sequence,p.name)
                actual=next(r for r in all_results if r["photo"]==photo["path"] and r["version"]==version.name)
                assert actual["output_path"]==str(expected)
                reference=tmp_path/("single"+expected.suffix)
                result=backends[version.settings.format].export(session,version.settings.model_copy(update={"output_path":str(reference),"overwrite":True}))
                assert result.accepted,result.message
                if version.settings.format in required:
                    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg,decode_avif
                    decode=decode_ultrahdr_jpeg if version.settings.format=="jpeg_ultrahdr" else decode_avif
                    left,right=decode(expected),decode(reference)
                    np.testing.assert_array_equal(left[0],right[0]);np.testing.assert_array_equal(left[1],right[1])
                    assert left[2]["gain_map_metadata"]==right[2]["gain_map_metadata"]
                else:
                    np.testing.assert_array_equal(np.asarray(Image.open(expected)),np.asarray(Image.open(reference)))
        finally:store.clear()
    before=Path(all_results[0]["output_path"]).read_bytes()
    repeated=export_photo(photos[0],p,output,1)
    assert all(r["outcome"]=="renamed" and " (2)" in r["output_path"] for r in repeated)
    assert Path(all_results[0]["output_path"]).read_bytes()==before
    assert not list(output.rglob("*.tmp*"))

def test_cancel_pause_records_and_virtual_copy_states(tmp_path):
    entered,release=Event(),Event();calls=[]
    photos={str(i):{"path":str(i),"source_path":f"{i}.raw","grade":{"global_adjustments":{"hdr":{"exposure":i}}}} for i in range(3)}
    def runner(photo,preset,directory,sequence):
        calls.append(photo["path"]);entered.set();assert release.wait(5)
        return [{"photo":photo["path"],"version":v.name,"outcome":"exported","output_path":str(Path(directory)/(photo["path"]+v.name))} for v in preset.versions]
    record_path=tmp_path/"records.json";queue=BatchExports(photos.__getitem__,record_path,runner)
    job=queue.start(list(photos),preset(),tmp_path);assert entered.wait(5)
    queue.control(job["id"],"pause");release.set();sleep(.05)
    assert calls==["0"]
    assert queue.status(job["id"])["state"]=="paused"
    queue.control(job["id"],"cancel");final=wait_job(queue,job["id"])
    assert final["state"]=="cancelled" and final["completed"]==2
    records=json.loads(record_path.read_text())
    assert export_state("0",photos["0"]["grade"],records)["exported"]
    assert not export_state("0",photos["0"]["grade"],records)["edited_since_export"]
    assert export_state("0",{"changed":True},records)["edited_since_export"]
    assert not export_state("0|copy|separate",photos["0"]["grade"],records)["exported"]
    resumed=queue.start(["1"],preset(),tmp_path);assert wait_job(queue,resumed["id"])["completed"]==2

def test_sdr_only_skips_hdr_without_partial_output(tmp_path):
    photo=fixture_photo(tmp_path);photo["sdr_only"]=True
    results=export_photo(photo,preset(("jpeg_ultrahdr","sdr_png")),tmp_path,1)
    assert [r["outcome"] for r in results]==["skipped","exported"]
    assert "no HDR grade" in results[0]["reason"]
    assert not list(tmp_path.rglob("*.tmp*"))


def test_real_workers_overlap_two_photos_and_keep_result_order(tmp_path, monkeypatch):
    # One photo decodes on the CPU while the previous one is on the GPU.
    monkeypatch.setenv("HDR_FINISHER_BATCH_PARALLEL", "2")
    started, release = [], Event()
    photos = {str(i): {"path": str(i), "source_path": f"{i}.raw", "grade": {"n": i}} for i in range(3)}
    class Overlapping(BatchExports):
        def _subprocess(self, photo, preset, directory, sequence, progress=None, cancelled=lambda: False):
            started.append(photo["path"])
            if photo["path"] == "0": assert release.wait(5)
            return [{"photo": photo["path"], "version": v.name, "outcome": "exported", "output_path": photo["path"] + v.name} for v in preset.versions]
    queue = Overlapping(photos.__getitem__, tmp_path / "records.json")
    job = queue.start(list(photos), preset(), tmp_path)
    deadline = monotonic() + 5
    while "1" not in started and monotonic() < deadline: sleep(.01)
    assert started[:2] == ["0", "1"]
    release.set()
    final = wait_job(queue, job["id"])
    assert [row["photo"] for row in final["results"]] == ["0", "0", "1", "1", "2", "2"]
    assert final["completed"] == 6


def test_three_workers_with_16_gb_one_below_and_the_setting_wins(monkeypatch):
    from hdr_finisher import resource_preflight
    from hdr_finisher.resource_preflight import ResourceSnapshot
    monkeypatch.delenv("HDR_FINISHER_BATCH_PARALLEL", raising=False)
    for total, expected in ((64 * 1024 ** 3, 3), (16 * 1024 ** 3, 3), (16 * 1024 ** 3 - 1, 1),
                            (8 * 1024 ** 3, 1), (None, 1)):
        monkeypatch.setattr(resource_preflight, "detect_memory_resources", lambda total=total: ResourceSnapshot(total, None, "test"))
        assert BatchExports._parallel() == expected
    monkeypatch.setenv("HDR_FINISHER_BATCH_PARALLEL", "2")
    assert BatchExports._parallel() == 2


@pytest.mark.parametrize("blocked_attempts", [2, 3])
def test_batch_worker_progress_survives_windows_replace_collisions(tmp_path, monkeypatch, blocked_attempts):
    from hdr_finisher import batch_export_worker, library_worker

    task = tmp_path / "task.json"
    progress_file = tmp_path / "progress.json"
    result_file = tmp_path / "result.json"
    rows = [{"photo": "photo.raw", "outcome": "exported"}]
    task.write_text(json.dumps({"preset": preset().model_dump(mode="json"), "progress": str(progress_file),
                               "directory": str(tmp_path), "cancel": str(tmp_path / "cancel"),
                               "photo": {}, "sequence": 1}), encoding="utf-8")
    monkeypatch.setattr(batch_export_worker.sys, "argv", ["batch_export_worker", str(task), str(result_file)])
    monkeypatch.setattr(library_worker, "_lower_priority", lambda: None)
    monkeypatch.setattr(batch_export_worker, "LIVE_INTERVAL_S", 60)
    monkeypatch.setattr(batch_export_worker, "export_photo",
                        lambda _photo, _preset, _directory, _sequence, progress, _cancelled, **_kwargs:
                        progress(rows) or rows)
    original_replace = Path.replace
    attempts = []

    def replace(source, target):
        attempts.append(target)
        if len(attempts) <= blocked_attempts:
            raise PermissionError("progress reader has this file open")
        return original_replace(source, target)

    monkeypatch.setattr(Path, "replace", replace)
    batch_export_worker.main()
    assert attempts == [progress_file] * 3
    assert json.loads(result_file.read_text(encoding="utf-8")) == rows
    assert not progress_file.with_suffix(".tmp").exists()
    if blocked_attempts < 3:
        assert json.loads(progress_file.read_text(encoding="utf-8"))["results"] == rows
    else:
        assert not progress_file.exists()


def test_export_snapshot_completes_during_grade_status(tmp_path):
    from threading import RLock, Thread, current_thread
    from hdr_finisher.batch_export_api import create_batch_router
    from hdr_finisher.library_grades import LibraryGrades
    from hdr_finisher.library_marks import LibraryMarks

    store = SessionStore()
    marks = LibraryMarks(tmp_path / "library")
    LibraryGrades(marks, store)
    create_batch_router(store)
    attempted = Event()

    class ObservedSessionLock:
        def __init__(self):
            self.lock = RLock()

        def __enter__(self):
            if current_thread().name == "snapshot-regression":
                attempted.set()
            self.lock.acquire()
            return self

        def __exit__(self, *args):
            self.lock.release()

    store._lock = ObservedSessionLock()
    source = tmp_path / "photo.png"
    Image.new("RGB", (4, 4)).save(source)
    results, errors = [], []

    def snapshot():
        try:
            results.append(store.batch_exports.snapshot(str(source)))
        except Exception as error:
            errors.append(error)

    worker = Thread(target=snapshot, name="snapshot-regression", daemon=True)
    try:
        # Grade status holds the session lock before reading Library marks.
        with store._lock:
            worker.start()
            assert attempted.wait(3), "Export did not reach the session read"
            available = marks._lock.acquire(timeout=1)
            if available:
                marks._lock.release()
        worker.join(3)
        assert available, "Export held Library marks while waiting for grade status"
        assert not worker.is_alive(), "Export snapshot did not finish"
        assert not errors, errors
        assert results[0]["source_path"] == str(source)
    finally:
        worker.join(3)
        store.batch_exports.close()


def test_cancellation_cannot_be_undone_by_late_pause_or_resume(tmp_path):
    entered, release = Event(), Event()
    calls = []
    photos = {str(i): {"path": str(i), "source_path": f"{i}.raw"} for i in range(2)}

    def runner(photo, preset, directory, sequence):
        calls.append(photo["path"])
        entered.set()
        assert release.wait(5)
        return []

    queue = BatchExports(photos.__getitem__, tmp_path / "records.json", runner)
    try:
        job = queue.start(list(photos), preset(), tmp_path)
        assert entered.wait(5)
        assert queue.control(job["id"], "cancel")["state"] == "cancelling"
        assert queue.control(job["id"], "pause")["state"] == "cancelling"
        assert queue.control(job["id"], "resume")["state"] == "cancelling"
        release.set()
        assert wait_job(queue, job["id"])["state"] == "cancelled"
        assert calls == ["0"]
    finally:
        release.set()
        queue.close()


def test_closed_queue_rejects_new_jobs(tmp_path):
    queue = BatchExports(lambda path: {"path": path}, tmp_path / "records.json", lambda *args: [])
    queue.close()
    with pytest.raises(ValueError, match="closing"):
        queue.start(["photo.raw"], preset(), tmp_path)
    assert not queue.jobs


def test_large_avif_memory_warning_gates_on_ram_and_megapixels():
    from hdr_finisher.exporters import _large_avif_memory_warning

    assert _large_avif_memory_warning((5320, 7968, 3), ram_bytes=8 * 1024**3) is None
    assert _large_avif_memory_warning((6354, 9600, 3), ram_bytes=16 * 1024**3) is None
    assert _large_avif_memory_warning((8334, 12000, 3), ram_bytes=32 * 1024**3) is None
    warning = _large_avif_memory_warning((6354, 9600, 3), ram_bytes=8 * 1024**3)
    assert warning is not None and "50 MP" in warning and "HDR JPEG XL" in warning
