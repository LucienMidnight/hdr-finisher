from copy import deepcopy
import json
from types import SimpleNamespace
from threading import RLock
import pytest
from hdr_finisher.library_smart_albums import SmartAlbums, SmartCommand
from hdr_finisher.library_marks import LibraryMarks, MarkChange
from hdr_finisher.library_grades import LibraryGrades
from hdr_finisher.library_copies import LibraryCopies
from test_library_grades import setup, saved, settings

@pytest.fixture
def smart(tmp_path):
    marks=LibraryMarks(tmp_path/"app")
    index=SimpleNamespace(preferences_path=tmp_path/"app"/"library-preferences.json",_state=RLock())
    return SmartAlbums(marks,index)


def create(smart,name="Picked",filters=None):
    return smart.command(SmartCommand(action="create",name=name,filters=filters or {"rules":[{"field":"pick","value":"pick"}]}))


def test_rules_survive_database_loss_and_each_command_undo(smart):
    smart.index.preferences_path.parent.mkdir(parents=True)
    smart.index.preferences_path.write_text(json.dumps({"label_names":{"green":"Ready"},"pin_labels":{"x":"Shoot"},"future":8}))
    create(smart);original=smart.list();identifier=original[0]["id"]
    smart.marks._connect().close();smart.marks.database.unlink()
    assert smart.list()==original
    smart.command(SmartCommand(action="edit",id=identifier,name="Five stars",filters={"rules":[{"field":"rating","op":"at-least","value":5}]}))
    assert smart.list()[0]["name"]=="Five stars"
    smart.marks.undo();assert smart.list()==original
    smart.command(SmartCommand(action="delete",id=identifier));assert smart.list()==[]
    smart.marks.undo();assert smart.list()==original
    smart.marks.undo();assert smart.list()==[]
    value=json.loads(smart.index.preferences_path.read_text())
    assert value["future"]==8 and value["pin_labels"]=={"x":"Shoot"} and value["label_names"]=={"green":"Ready"}


def test_invalid_rules_or_unreadable_preferences_never_replace(smart):
    create(smart);before=smart.index.preferences_path.read_bytes()
    for filters in [{"rules":[{"field":"pick","op":"guess","value":"pick"}]},{"rules":[{"field":"rating","value":{"x":1}}]},{"rules":[{"field":"","value":"x"}]}]:
        with pytest.raises(ValueError):create(smart,"Invalid",filters)
        assert smart.index.preferences_path.read_bytes()==before
    with pytest.raises(ValueError):create(smart,"picked")
    smart.index.preferences_path.write_text("broken")
    with pytest.raises(ValueError):create(smart,"New")
    assert smart.index.preferences_path.read_text()=="broken"


def test_undo_never_overwrites_outside_rules(smart):
    create(smart)
    value=json.loads(smart.index.preferences_path.read_text());value["smart_albums"][0]["name"]="Outside"
    smart.index.preferences_path.write_text(json.dumps(value))
    with pytest.raises(ValueError):smart.marks.undo()
    assert smart.list()[0]["name"]=="Outside" and smart.marks._undo


def test_index_candidates_update_marks_tags_grade_and_virtual_copy(setup,tmp_path):
    photo,store,session,marks,grades=setup
    smart=SmartAlbums(marks,SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock()))
    db=marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,?)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns,json.dumps({"camera":"Camera","iso":800})))
    db.close()
    before=smart.candidates();assert len(before["photos"])==1 and before["photos"][0]["marks"]["rating"]==0
    assert smart.candidates(before["version"])["photos"] is None
    marks.change([photo],MarkChange(rating=5,pick="pick",add_tag="Kids"))
    marked=smart.candidates();assert marked["version"]!=before["version"]
    assert marked["photos"][0]["marks"]["tags"]==["Kids"] and marked["photos"][0]["marks"]["rating"]==5
    grade=saved(setup);assert smart.candidates()["photos"][0]["edited"]
    # Candidate reads use only the index, not original or settings files.
    photo.unlink()
    assert smart.candidates()["photos"][0]["path"]==str(photo)
    assert smart.candidates()["photos"][0]["camera"]=="Camera"


def test_scope_is_saved_as_paths_without_touching_photos(smart,tmp_path):
    folder=tmp_path/"disconnected";before=deepcopy(smart.list())
    create(smart,filters={"any":True,"rules":[{"field":"name","op":"contains","value":"holiday","not":True}],"folders":[str(folder)]})
    assert smart.list()[0]["filters"]["folders"]==[str(folder)]
    assert not folder.exists()


def test_virtual_candidate_marks_follow_pending_virtual_marks(setup,tmp_path):
    photo,store,session,marks,grades=setup
    copies=LibraryCopies(marks)
    db=marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns))
    db.close()
    copies.create(str(photo), "clean")
    smart=SmartAlbums(marks,SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock()))
    items=smart.candidates()["photos"];assert len(items)==2
    key=items[1]["path"]
    marks.change([key],MarkChange(rating=4,add_tag="Copy"))
    assert smart.candidates()["photos"][1]["marks"]["rating"]==4
    assert smart.candidates()["photos"][0]["marks"]["rating"]==0


def test_same_timestamp_database_write_invalidates_snapshot(smart,tmp_path):
    import os
    db=smart.marks._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(tmp_path/"a.jpg"),100,1))
    db.close()
    before=smart.candidates();info=smart.marks.database.stat()
    db=smart.marks._connect()
    with db:db.execute("UPDATE files SET bytes=101")
    db.close();os.utime(smart.marks.database,ns=(info.st_atime_ns,info.st_mtime_ns))
    after=smart.candidates(before["version"])
    assert after["photos"][0]["bytes"]==101 and after["version"]!=before["version"]


def test_rebuild_candidates_from_saved_settings_after_database_loss(setup,tmp_path):
    photo,store,session,marks,grades=setup
    saved(setup)
    preference=SimpleNamespace(preferences_path=tmp_path/"preferences.json",_state=RLock())
    service=SmartAlbums(marks,preference);create(service,name="Edited",filters={"rules":[{"field":"state","value":"edited"}]})
    before=service.list();marks.database.unlink()
    rebuilt=LibraryMarks(marks.database.parent);LibraryGrades(rebuilt,store);LibraryCopies(rebuilt)
    rebuilt.read([photo])
    db=rebuilt._connect()
    with db:db.execute("INSERT INTO files VALUES (?,?,?,NULL)",(str(photo),photo.stat().st_size,photo.stat().st_mtime_ns))
    db.close()
    fresh=SmartAlbums(rebuilt,preference)
    assert fresh.list()==before and fresh.candidates()["photos"][0]["edited"]
