"""Result-based batch orchestration checks; tiny disposable sources only."""
from copy import deepcopy
import json
from pathlib import Path
from threading import Event
from time import monotonic, sleep
import numpy as np
from PIL import Image
import pytest
from hdr_finisher.batch_export import BatchExports, export_photo, export_state
from hdr_finisher.export_presets import ExportPreset, ExportPresets, ExportVersion, render_pattern, version_destination
from hdr_finisher.models import ExportSettings
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


def test_real_workers_overlap_two_photos_and_keep_result_order(tmp_path):
    # One photo decodes on the CPU while the previous one is on the GPU.
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


def test_three_workers_with_16_gb_two_below_and_the_setting_wins(monkeypatch):
    from hdr_finisher import resource_preflight
    from hdr_finisher.resource_preflight import ResourceSnapshot
    monkeypatch.delenv("HDR_FINISHER_BATCH_PARALLEL", raising=False)
    for total, expected in ((64 * 1024 ** 3, 3), (16 * 1024 ** 3, 3), (8 * 1024 ** 3, 2), (None, 2)):
        monkeypatch.setattr(resource_preflight, "detect_memory_resources", lambda total=total: ResourceSnapshot(total, None, "test"))
        assert BatchExports._parallel() == expected
    monkeypatch.setenv("HDR_FINISHER_BATCH_PARALLEL", "1")
    assert BatchExports._parallel() == 1


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
