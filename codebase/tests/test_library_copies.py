from copy import deepcopy
from pathlib import Path
import pytest
from test_library_grades import setup, saved, edit, settings, outside
from hdr_finisher.library_copies import LibraryCopies, source
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_grades import LibraryGrades, grade_key
from hdr_finisher.sessions import SessionStore
from hdr_finisher.projects import open_document
from hdr_finisher.models import EditDocument

def copies(setup):
    return LibraryCopies(setup[3])

def test_create_both_ways_inherit_marks_but_not_albums_and_preserve_unknown(setup):
    photo,store,session,marks,grades=setup
    c=copies(setup); original=photo.read_bytes(); grade=saved(setup)
    marks.change([photo],MarkChange(rating=4,pick="pick",label="blue",add_tag="Keep"));marks.album_create("Album",[photo]);marks.writer.drain()
    doc=settings(photo);doc["unknown"]={"keep":42};outside(photo,doc)
    first=c.create(photo);second=c.create(photo,"clean","Clean")
    marks.writer.drain();doc=settings(photo)
    a,b=doc["virtual_copies"]
    assert a["name"]=="Copy 1" and b["name"]=="Clean" and a["photo_id"]!=b["photo_id"]
    assert grade_key(a["grade"])==grade_key(grade)
    assert b["grade"]["global_adjustments"]["hdr"]["exposure"]==0
    assert a["marks"]==b["marks"]==doc["marks"] and a["albums"]==[]
    assert doc["unknown"]=={"keep":42} and doc["albums"]==["Album"]
    assert source(first["path"])==str(photo) and photo.read_bytes()==original
    marks.change([first["path"]],MarkChange(rating=1));marks.writer.drain()
    third=c.create(first["path"]);marks.writer.drain()
    assert settings(photo)["virtual_copies"][2]["marks"]==doc["marks"]

def test_copy_grade_marks_album_history_independent_and_rebuild(setup,tmp_path):
    photo,store,session,marks,grades=setup;c=copies(setup);grade=saved(setup)
    key=c.create(photo)["path"];marks.writer.drain()
    marks.change([key],MarkChange(rating=2,add_tag="Copy"));marks.album_create("Copies",[key]);marks.writer.drain()
    document=marks._document(Path(key));opened=open_document(store,EditDocument.model_validate(document["grade"]),photo)
    grades.attach(str(opened.session_id),key);edit(store,opened,3);grades.save(str(opened.session_id));marks.writer.drain()
    result=settings(photo);copy=result["virtual_copies"][0]
    assert result["grade"]==grade and result["marks"]["rating"]==0
    assert copy["grade"]["global_adjustments"]["hdr"]["exposure"]==3
    assert copy["marks"]["rating"]==2 and copy["albums"]==["Copies"]
    assert copy["grade_history"]["session_start"]["global_adjustments"]["hdr"]["exposure"]==1
    fresh=LibraryMarks(tmp_path/"rebuilt");new_grades=LibraryGrades(fresh,SessionStore());new_copies=LibraryCopies(fresh)
    fresh.read([photo]);assert fresh.album_paths("Copies")==[key]
    assert fresh.read([key])["photos"][0]["marks"]["rating"]==2
    assert new_grades._get(key)["session_start"]==copy["grade_history"]["session_start"]
    assert new_copies.items(photo)[0]["grade"]==copy["grade"]

def test_remove_and_undo_without_overwriting_other_copy_or_original_marks(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    key=c.create(photo)["path"];other=c.create(photo)["path"];marks.writer.drain()
    c.remove(key);marks.writer.drain();assert len(settings(photo)["virtual_copies"])==1
    marks.change([photo],MarkChange(rating=5));marks.writer.drain();marks.undo();marks.writer.drain()
    marks.undo();marks.writer.drain();assert len(settings(photo)["virtual_copies"])==2
    assert settings(photo)["virtual_copies"][1]["photo_id"]==other.split("|copy|")[1]
    assert photo.exists() and settings(photo)["marks"]["rating"]==0

def test_unreadable_and_external_copy_changes_preserve_both_versions(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    key=c.create(photo)["path"]
    doc=settings(photo);doc["virtual_copies"]=[{"photo_id":"external","name":"Elsewhere","marks":{},"grade":doc["grade"]}];outside(photo,doc)
    marks.writer.drain();assert c.state(photo)["pending"] and settings(photo)==doc
    with pytest.raises(ValueError,match="changed elsewhere"):c.create(photo)
    assert c.items(photo)[0]["photo_id"]==key.split("|copy|")[1]
    doc["virtual_copies"]="broken";outside(photo,doc)
    with pytest.raises(ValueError):c.create(photo)
    assert settings(photo)==doc

def test_copy_revert_undo_and_open_copy_removal_guard(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    key=c.create(photo)["path"];marks.writer.drain();store.clear()
    grades.history.revert([key],"original");marks.writer.drain()
    assert settings(photo)["virtual_copies"][0]["grade"]["global_adjustments"]["hdr"]["exposure"]==0
    assert settings(photo)["grade"]["global_adjustments"]["hdr"]["exposure"]==1
    marks.undo();marks.writer.drain();doc=marks._document(Path(key))
    opened=open_document(store,EditDocument.model_validate(doc["grade"]),photo);grades.attach(str(opened.session_id),key)
    with pytest.raises(ValueError,match="Open another"):c.remove(key)
    assert len(settings(photo)["virtual_copies"])==1

def test_keep_both_brings_external_grade_into_copy(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    edit(store,session,2);doc=settings(photo);external=deepcopy(doc["grade"]);external["global_adjustments"]["hdr"]["exposure"]=4;doc["grade"]=external;outside(photo,doc)
    grades.check(str(session.session_id),True)
    grades.resolve(str(session.session_id),"both",external);marks.writer.drain()
    result=settings(photo)
    assert result["grade"]["global_adjustments"]["hdr"]["exposure"]==2
    assert result["virtual_copies"][0]["grade"]["global_adjustments"]["hdr"]["exposure"]==4

def test_folder_refreshes_and_collections_keep_virtual_item_identity(setup):
    from concurrent.futures import Future
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.library_api import create_library_router
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    key=c.create(photo)["path"];marks.album_create("Only copy",[key]);marks.writer.drain()
    stat=photo.stat()
    record={"path":str(photo),"name":photo.name,"type":"PNG","bytes":stat.st_size,"mtime_ns":stat.st_mtime_ns}
    class Helper:
        def status(self):return {"paused":False}
        def submit_library(self,command,**kwargs):
            f=Future();f.set_result({"path":str(photo.parent),"photos":[dict(record)],"unreadable_folders":[]})
            return "job",f
        def cancel(self,job):pass
    app=FastAPI();app.include_router(create_library_router(Helper(),MediaBrowserStore(marks.database.parent),store))
    client=TestClient(app)
    initial=client.post('/api/library/scan',json={"path":str(photo.parent)}).json()
    assert len(initial["photos"])==2 and initial["photos"][1]["path"]==key
    for _ in range(2):
        refreshed=client.post('/api/library/view',json={"path":str(photo.parent)}).json()
        assert len(refreshed["photos"])==2
        assert refreshed["photos"][1]["copy_id"]==key.split('|copy|')[1]
        assert refreshed["photos"][1]["name"].endswith('Copy 1')
    collection=client.post('/api/library/collection',json={"kind":"album","name":"Only copy"}).json()
    assert [p["path"] for p in collection["photos"]]==[key]

def test_status_read_started_before_writer_acknowledgement_cannot_reload_old_grade(setup,monkeypatch):
    photo,store,session,marks,grades=setup;saved(setup)
    old=settings(photo); newer=deepcopy(old["grade"]);newer["global_adjustments"]["hdr"]["exposure"]=3
    def read_before_ack(path):
        state=grades._get(str(photo));state.update(baseline=newer,indexed_grade=newer,pending=False)
        grades._put(str(photo),state)
        return old
    monkeypatch.setattr(marks,"_document",read_before_ack)
    result=grades.check(str(session.session_id))
    assert not result.get("reload") and not result["conflict"]


def test_rename_open_copy_and_undo_preserve_everything_but_name(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    key=c.create(photo, name="Before")["path"];other=c.create(photo,name="Shared")["path"];marks.writer.drain()
    marks.change([key],MarkChange(rating=3,add_tag="Copy"));marks.album_create("Copies",[key]);marks.writer.drain()
    doc=settings(photo);doc["virtual_copies"][0]["unknown"]={"keep":42};outside(photo,doc)
    opened=open_document(store,EditDocument.model_validate(doc["virtual_copies"][0]["grade"]),photo)
    grades.attach(str(opened.session_id),key);edit(store,opened,3)
    grade=opened.edit_document().model_dump(mode="json");dirty=opened.dirty
    c.rename(key,"Shared");marks.writer.drain()
    expected=deepcopy(doc);expected["virtual_copies"][0]["name"]="Shared"
    assert settings(photo)==expected
    assert grades.status(str(opened.session_id))["name"]=="Shared"
    assert opened.edit_document().model_dump(mode="json")==grade and opened.dirty==dirty
    marks.undo();marks.writer.drain();assert settings(photo)==doc
    for name in ("   ","x"*121):
        with pytest.raises(ValueError,match="Copy names"):c.rename(key,name)
    with pytest.raises(ValueError,match="Select a virtual copy"):c.rename(photo,"No")


def test_bulk_create_remove_and_undo_are_one_step_each(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    second=photo.with_name("second.png");second.write_bytes(photo.read_bytes())
    baseline=len(marks._undo)
    made=c.create_many([photo,second],name="Shared");marks.writer.drain()
    assert made["count"]==2 and len(marks._undo)==baseline+1
    assert settings(photo)["virtual_copies"][0]["name"]==settings(second)["virtual_copies"][0]["name"]=="Shared"
    keys=[r["path"] for r in made["photos"]]
    c.remove_many([photo,*keys]);marks.writer.drain()
    assert len(marks._undo)==baseline+2
    assert not settings(photo)["virtual_copies"] and not settings(second)["virtual_copies"]
    marks.undo();marks.writer.drain()
    assert len(settings(photo)["virtual_copies"])==len(settings(second)["virtual_copies"])==1
    marks.undo();marks.writer.drain()
    assert len(marks._undo)==baseline and not settings(photo)["virtual_copies"] and not settings(second)["virtual_copies"]
    c.create_many([photo,second]);marks.writer.drain()
    assert settings(photo)["virtual_copies"][0]["name"]==settings(second)["virtual_copies"][0]["name"]=="Copy 1"


def test_bulk_remove_skips_open_copy_and_restores_order(setup):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    keys=[c.create(photo)["path"] for _ in range(3)];marks.writer.drain();before=settings(photo)["virtual_copies"]
    opened=open_document(store,EditDocument.model_validate(before[1]["grade"]),photo);grades.attach(str(opened.session_id),keys[1])
    result=c.remove_many([photo,*keys]);marks.writer.drain()
    assert result["count"]==2 and 'Copy 2' in result["warnings"][0] and 'open in Grade' in result["warnings"][0]
    assert settings(photo)["virtual_copies"]==[before[1]]
    marks.undo();marks.writer.drain();assert settings(photo)["virtual_copies"]==before


@pytest.mark.parametrize("failure",["unreadable","unwritable","external"])
def test_bulk_middle_failure_accepts_no_partial_changes(setup,monkeypatch,failure):
    photo,store,session,marks,grades=setup;c=copies(setup);saved(setup)
    others=[photo.with_name(name+".png") for name in ("middle","last")]
    for other in others:other.write_bytes(photo.read_bytes())
    paths=[photo,*others];keys=[c.create(p)["path"] for p in paths];marks.writer.drain()
    middle=others[0]
    if failure=="unreadable":Path(str(middle)+".hdrf").write_text("broken")
    elif failure=="external":
        c.create(middle);doc=settings(middle);doc["virtual_copies"][0]["name"]="Elsewhere";outside(middle,doc)
    else:
        original=marks._document
        def denied(path):
            if source(path)==str(middle):raise PermissionError("Settings file cannot be changed")
            return original(path)
        monkeypatch.setattr(marks,"_document",denied)
    states=[deepcopy(c.state(p)) for p in paths];undo=len(marks._undo)
    files=[Path(str(p)+".hdrf").read_bytes() for p in paths]
    for action in (lambda:c.create_many(paths),lambda:c.remove_many(keys)):
        with pytest.raises((ValueError,OSError)):action()
        assert [c.state(p) for p in paths]==states and len(marks._undo)==undo
        assert [Path(str(p)+".hdrf").read_bytes() for p in paths]==files
