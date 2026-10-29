"""Result checks for damaged and future saved grades. All files are disposable."""
from copy import deepcopy
import json
from pathlib import Path
import zipfile
import pytest
from PIL import Image
from hdr_finisher.models import EditDocument, AdjustmentState
from hdr_finisher.projects import validate_saved, open_document, save_project, open_project, choose_saved_grade, ProjectError
from hdr_finisher.saved_grades import notice
from hdr_finisher.sessions import SessionStore
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_grades import LibraryGrades
from hdr_finisher.library_picture_errors import PictureErrors

CASES = json.loads((Path(__file__).parent / "fixtures/graceful-grades.json").read_text())

def payload(case):
    base = {"source": {"filename":"photo.png", "luminance":{"luminance_semantics":"scene_relative","transfer_function":"linear"}},
            "hdr_reference_white_nits":203}
    if not isinstance(case["grade"], dict): return deepcopy(case["grade"])
    return {**base, **deepcopy(case["grade"])}

@pytest.mark.parametrize("case", CASES, ids=lambda case:case["name"])
def test_fixture_recovery(case):
    raw = payload(case); before = deepcopy(raw)
    doc = validate_saved(EditDocument, raw)
    assert raw == before
    assert (notice(doc) or {}).get("sections", []) == case["sections"]
    assert doc.app_version and doc.section_versions["tone"] == 1
    if case["name"] == "damaged-tone":
        assert doc.global_adjustments.hdr.exposure == 0
        assert doc.global_adjustments.hdr.contrast == 0
        assert doc.global_adjustments.hdr.saturation == 1.25
        assert doc.global_adjustments.sdr.exposure == .4
    if case["name"] == "newer":
        assert doc.global_adjustments.hdr.exposure == .75
        assert notice(doc)["newer"]
    if case["name"] == "newer-section":
        assert doc.global_adjustments.hdr.exposure == 0
        assert doc.global_adjustments.hdr.saturation == 1.25
    assert not doc.repairs and not doc.local_adjustments

def test_live_edits_remain_strict():
    with pytest.raises(ValueError):
        AdjustmentState.model_validate({"hdr":{"exposure":999}})

@pytest.mark.parametrize("lane", ["hdr","sdr"])
def test_each_panel_defaults_independently(lane):
    for field, broken in (("exposure",999),("hsl",{"channels":"broken"}),("film_look",{"amount":999}),
                          ("detail",{"sharpening":999}),("vignette",{"amount":999}),
                          ("luma_curve","broken"),("highlight_compression_softness",999)):
        raw = payload({"grade":{"global_adjustments":{lane:{field:broken,"saturation":1.25}}}})
        doc = validate_saved(EditDocument,raw)
        assert notice(doc), field
        assert doc.global_adjustments.model_dump()[lane]["saturation"] == 1.25

@pytest.fixture
def library(tmp_path):
    photo = tmp_path/"photo.png"
    Image.new("RGB",(64,32),(100,120,80)).save(photo)
    store = SessionStore()
    session = store.prepare_session(photo, owns_source_path=False)
    raw = session.edit_document().model_dump(mode="json")
    raw["global_adjustments"]["hdr"].update(exposure=999, saturation=1.25)
    raw["app_version"] = "99.0.0"
    marks = LibraryMarks(tmp_path/"app")
    marks.change([photo],MarkChange(rating=4,add_tag="keep"))
    marks.writer.drain()
    sidecar = Path(str(photo)+".hdrf")
    document = json.loads(sidecar.read_text())
    document["grade"] = raw
    sidecar.write_text(json.dumps(document),encoding="utf-8")
    grades = LibraryGrades(marks,store)
    errors = PictureErrors(marks)
    yield photo, store, marks, grades, errors, sidecar, raw
    marks.writer.drain()
    store.clear()

@pytest.mark.parametrize("action",["continue","original","leave"])
def test_choice_changes_only_authorized_files_and_keeps_backup(library, action):
    photo,store,marks,grades,errors,sidecar,raw = library
    before = sidecar.read_bytes(); source = photo.read_bytes()
    opened = open_document(store,validate_saved(EditDocument,raw),photo)
    grades.attach(str(opened.session_id))
    revision = errors.revision(str(photo))
    result = grades.recover_grades([{"path":str(photo),"revision":revision}],action)
    marks.writer.drain()
    assert photo.read_bytes() == source
    if action == "leave":
        assert sidecar.read_bytes() == before
        assert opened.grade_notice
        return
    saved = json.loads(sidecar.read_text())
    assert saved["marks"]["rating"] == 4 and saved["marks"]["tags"] == ["keep"]
    assert raw in saved["grade_history"]["grade_backups"]
    if action == "original":
        assert saved.get("grade") is None or saved["grade"]["global_adjustments"]["hdr"]["saturation"] == 0
    else:
        assert saved["grade"]["global_adjustments"]["hdr"]["exposure"] == 0
        assert saved["grade"]["global_adjustments"]["hdr"]["saturation"] == 1.25
        # A subsequent save does not replace the untouched backup.
        grades.save(str(store._current.session_id)); marks.writer.drain()
        assert raw in json.loads(sidecar.read_text())["grade_history"]["grade_backups"]

def test_newer_grade_blocks_autosave_and_stale_choice(library):
    photo,store,marks,grades,errors,sidecar,raw = library
    opened = open_document(store,validate_saved(EditDocument,raw),photo)
    grades.attach(str(opened.session_id))
    before = sidecar.read_bytes()
    opened.dirty = True
    result = grades.save(str(opened.session_id))
    marks.writer.drain()
    assert result["grade_notice"] and sidecar.read_bytes() == before
    revision = errors.revision(str(photo))
    doc = json.loads(before); doc["grade"]["global_adjustments"]["sdr"]["exposure"] = .5
    sidecar.write_text(json.dumps(doc),encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        grades.recover_grades([{"path":str(photo),"revision":revision}],"continue")
    assert json.loads(sidecar.read_text()) == doc

@pytest.mark.parametrize("action",["continue","original","leave"])
def test_project_choices_and_embedded_original(tmp_path, action):
    photo=tmp_path/"photo.png"; Image.new("RGB",(32,16)).save(photo)
    store=SessionStore(); session=store.prepare_session(photo,owns_source_path=False)
    project=tmp_path/"photo.hdrfinisher"
    save_project(session,project)
    with zipfile.ZipFile(project) as archive:
        manifest=archive.read("manifest.json")
        raw=json.loads(archive.read("edit-state.json"))
    raw["app_version"]="99.0.0"
    raw["global_adjustments"]["hdr"]["exposure"]=999
    with zipfile.ZipFile(project,"w") as archive:
        archive.writestr("manifest.json",manifest)
        archive.writestr("edit-state.json",json.dumps(raw))
    before=project.read_bytes()
    opened=open_project(store,project)
    with pytest.raises(ProjectError,match="choice"):
        save_project(opened,project)
    choose_saved_grade(store,str(opened.session_id),action)
    if action=="leave":
        assert project.read_bytes()==before
    else:
        with zipfile.ZipFile(project) as archive:
            names=[name for name in archive.namelist() if name.startswith("grade-backups/")]
            assert len(names)==1 and json.loads(archive.read(names[0]))==raw
            assert json.loads(archive.read("edit-state.json"))["global_adjustments"]["hdr"]["exposure"]==0
    store.clear()

def test_virtual_copy_choice_reaches_sidecar(library):
    from hdr_finisher.library_copies import LibraryCopies
    photo,store,marks,grades,errors,sidecar,raw=library
    LibraryCopies(marks)
    doc=json.loads(sidecar.read_text())
    doc["grade"]=None
    doc["virtual_copies"]=[{"photo_id":"copy-one","name":"Copy","marks":{},"grade":raw}]
    sidecar.write_text(json.dumps(doc),encoding="utf-8")
    key=str(photo)+"|copy|copy-one"
    grades.recover_grades([{"path":key,"revision":errors.revision(key)}],"continue")
    marks.writer.drain()
    saved=json.loads(sidecar.read_text())
    assert raw in saved["virtual_copies"][0]["grade_history"]["grade_backups"]
    assert saved["virtual_copies"][0]["grade"]["global_adjustments"]["hdr"]["exposure"]==0


def test_removed_panel_defaults_are_quiet():
    raw = payload({"grade":{"global_adjustments":{"hdr":{"film_look":{
        "reference_model":"custom", "bloom_enabled":True, "bloom_sensitivity":80,
        "bloom_radius":.5, "bloom_highlight_detail":75, "halation_sensitivity":75}}}}})
    assert notice(validate_saved(EditDocument, raw)) is None
    raw["global_adjustments"]["hdr"]["film_look"]["bloom_amount"] = 15
    assert notice(validate_saved(EditDocument, raw))["sections"] == ["HDR Film Look"]


def test_standalone_broken_adjustments_have_defaults():
    value=validate_saved(AdjustmentState, "damaged")
    assert value == AdjustmentState() and notice(value)


def test_replay_failure_skips_frozen_repair_without_changing_original(tmp_path):
    from hdr_finisher.models import RepairRecord
    from hdr_finisher.retouch_recipe import InpaintRecipe
    photo=tmp_path/"photo.png"; Image.new("RGB",(64,32),(70,90,100)).save(photo)
    store=SessionStore(); source=store.prepare_session(photo,owns_source_path=False)
    doc=source.edit_document()
    doc.global_adjustments.hdr.saturation=1.25
    doc.repairs=[RepairRecord(id="dust",recipe=InpaintRecipe(source_size=(80,64), search_rect=(16,8,64,56),
        points=[dict(x=.5,y=.5)], radius_px=6, hardness=1,settings=dict(seed=42,iterations=2,patch_radius=2)))]
    raw=doc.model_dump(mode="json")
    saved=validate_saved(EditDocument,raw)
    opened=open_document(store,saved,photo)
    assert not opened.repairs
    assert opened.adjustments.hdr.saturation == 1.25
    assert opened.grade_notice["issues"][0]["repair_id"] == "dust"
    assert opened.grade_original == raw
    store.clear()


def test_look_notice_dismissal_survives_library_reopen(library):
    photo,store,marks,grades,errors,sidecar,raw=library
    raw["global_adjustments"]["hdr"]["exposure"]=0
    raw["global_adjustments"]["hdr"]["lift"]=.5
    raw.pop("app_version",None)
    settings=json.loads(sidecar.read_text());settings["grade"]=raw
    sidecar.write_text(json.dumps(settings),encoding="utf-8")
    report=notice(validate_saved(EditDocument,raw))
    errors.observe_grade(str(photo),report)
    before=sidecar.read_bytes()
    grades.recover_grades([{"path":str(photo),"revision":errors.revision(str(photo))}],"dismiss")
    assert PictureErrors(marks).get(str(photo))["ignored"]
    assert sidecar.read_bytes()==before


def test_damaged_denoise_keeps_other_lane():
    raw=payload({"grade":{"denoise":{"hdr":{"controls":{"amount":99}},"sdr":{"enabled":True,"controls":{"amount":.7}}}}})
    saved=validate_saved(EditDocument,raw)
    assert saved.denoise.hdr.controls.amount == .5
    assert saved.denoise.sdr.enabled and saved.denoise.sdr.controls.amount == .7
    assert notice(saved)["sections"] == ["HDR Denoise"]


def test_broken_project_json_relinks_to_photo_and_preserves_raw_backup(tmp_path):
    photo=tmp_path/"photo.png"; Image.new("RGB",(32,16)).save(photo)
    store=SessionStore(); source=store.prepare_session(photo,owns_source_path=False)
    project=tmp_path/"photo.hdrfinisher"; save_project(source,project)
    with zipfile.ZipFile(project) as archive:manifest=archive.read("manifest.json")
    broken='{ damaged grade json'
    with zipfile.ZipFile(project,"w") as archive:
        archive.writestr("manifest.json",manifest);archive.writestr("edit-state.json",broken)
    before=project.read_bytes()
    opened=open_project(store,project,photo)
    assert opened.grade_notice and project.read_bytes()==before
    choose_saved_grade(store,str(opened.session_id),"continue")
    with zipfile.ZipFile(project) as archive:
        backup=next(n for n in archive.namelist() if n.startswith("grade-backups/"))
        assert json.loads(archive.read(backup))==broken
    store.clear()


def test_missing_source_section_keeps_readable_finishing():
    from hdr_finisher.saved_grades import whole_grade_fallback
    saved=validate_saved(EditDocument,{"global_adjustments":{"hdr":{"exposure":.7}}})
    assert saved.global_adjustments.hdr.exposure == .7
    assert not whole_grade_fallback(notice(saved))
    assert notice(saved)["sections"] == ["Source settings"]


@pytest.mark.parametrize("lane", ["hdr", "sdr"])
@pytest.mark.parametrize("off", ["strength", "section", "bloom", "bloom-amount", "bloom-radius",
                                  "halation", "halation-amount", "halation-radius", "print"])
def test_retired_film_controls_only_warn_when_they_affected_the_picture(lane, off):
    film = {"look_strength": 100, "print_strength": 62, "print_toe": 12,
            "bloom_enabled": True, "bloom_amount": 8, "bloom_sensitivity": 78,
            "halation_enabled": True, "halation_amount": 13, "halation_sensitivity": 72}
    raw = payload({"grade": {"global_adjustments": {lane: {"film_look": film}}}})
    branch = raw["global_adjustments"][lane]
    film = branch["film_look"]
    prefix = f"global_adjustments.{lane}.film_look."
    active = {i["path"] for i in notice(validate_saved(EditDocument, raw))["issues"]}
    assert active == {prefix + f for f in ("print_strength", "print_toe", "bloom_amount",
                                         "bloom_sensitivity", "halation_sensitivity")}
    if off == "strength": film["look_strength"] = 0
    elif off == "section": branch["film_look_section_enabled"] = False
    elif off == "bloom": film["bloom_enabled"] = False
    elif off == "bloom-amount": film["bloom_amount"] = 0
    elif off == "bloom-radius": film["bloom_radius"] = 0
    elif off == "halation": film["halation_enabled"] = False
    elif off == "halation-amount": film["halation_amount"] = 0
    elif off == "halation-radius": film["halation_radius"] = 0
    elif off == "print": film["print_strength"] = 0
    before = deepcopy(raw)
    saved = validate_saved(EditDocument, raw)
    paths = {i["path"] for i in (notice(saved) or {}).get("issues", [])}
    if off in ("strength", "section"):
        assert not paths
    else:
        effect = off.split("-")[0]
        assert paths == {p for p in active if not p.startswith(prefix + effect + "_")}
    assert raw == before
    assert saved.global_adjustments.model_dump()[lane]["film_look"]["halation_amount"] == film["halation_amount"]
