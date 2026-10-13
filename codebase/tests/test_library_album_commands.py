"""Album creation commands on disposable sources, each one undo step."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hdr_finisher.library_api import create_library_router
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_smart_albums import SmartCommand
from hdr_finisher.media_browser import MediaBrowserStore
from test_library_smart_albums import smart, create


def test_smart_duplicate_preserves_rules_unpinned_scopes_and_single_undo(smart,tmp_path):
    filters={"any":True,"rating":"3","search":"holiday","folders":[str(tmp_path/"unplugged")],"rules":[{"field":"name","op":"ends","value":"jpg","not":True},{"field":"iso","op":"range","from":100,"to":800}]}
    create(smart,"Source",filters);before=smart.list()
    result=smart.command(SmartCommand(action="duplicate",id=before[0]["id"],name="Copy of Source",filters={"rules":[]}))
    assert len(result["albums"])==2
    duplicate=result["albums"][1]
    assert duplicate["filters"]==before[0]["filters"] and duplicate["id"]!=before[0]["id"]
    smart.marks.undo();assert smart.list()==before
    with pytest.raises(ValueError):smart.command(SmartCommand(action="duplicate",id=before[0]["id"],name="source"))
    with pytest.raises(ValueError):smart.command(SmartCommand(action="duplicate",id="gone",name="New"))
    assert smart.list()==before


def client_for(tmp_path):
    app=FastAPI();browser=MediaBrowserStore(tmp_path/"app");app.include_router(create_library_router(None,browser))
    return TestClient(app),LibraryMarks(browser.root)


def post(client,route,body):
    response=client.post("/api/library/"+route,json=body)
    assert response.status_code==200,response.text
    return response.json()


def test_manual_duplicate_offline_membership_and_undo(tmp_path):
    folder=tmp_path/"shoot";folder.mkdir();photos=[folder/"one.jpg",folder/"two.jpg"]
    for p in photos:p.write_bytes(b"disposable source")
    client,marks=client_for(tmp_path)
    post(client,"albums/create",{"name":"Source","paths":[str(p) for p in photos]})
    folder.rename(folder.with_name("unplugged"))
    before=marks.album_paths("Source")
    result=post(client,"albums/duplicate",{"name":"Source","new_name":"Edited name"})
    assert result["changed"]==2 and marks.album_paths("Edited name")==before
    assert len(marks._query("SELECT path FROM photos WHERE pending=1"))==2
    post(client,"undo",{})
    assert marks.album_paths("Source")==before and not marks._exists("album","Edited name")
    assert client.post("/api/library/albums/duplicate",json={"name":"gone","new_name":"New"}).status_code==400


def test_manual_snapshot_of_smart_candidates_includes_not_connected_and_undo(tmp_path):
    folder=tmp_path/"shoot";folder.mkdir();photo=folder/"one.jpg";photo.write_bytes(b"disposable source")
    client,marks=client_for(tmp_path)
    post(client,"albums/create",{"name":"Keep","paths":[str(photo)]})
    post(client,"marks",{"paths":[str(photo)],"change":{"rating":5}})
    post(client,"smart-albums",{"action":"create","name":"All","filters":{}})
    source=client.get("/api/library/smart-albums").json()
    folder.rename(folder.with_name("unplugged"))
    candidates=client.get("/api/library/smart-candidates").json()["photos"]
    assert len(candidates)==1
    result=post(client,"albums/create",{"name":"Copy of All","paths":[p["path"] for p in candidates]})
    assert result["changed"]==1 and marks.album_paths("Copy of All")==[str(photo)]
    assert client.get("/api/library/smart-albums").json()==source
    post(client,"undo",{})
    assert not marks._exists("album","Copy of All") and marks.album_paths("Keep")==[str(photo)]


def test_empty_manual_duplicate_is_one_undo_step(tmp_path):
    client,marks=client_for(tmp_path)
    post(client,"albums/create",{"name":"Empty"})
    post(client,"albums/duplicate",{"name":"Empty","new_name":"Copy of Empty"})
    assert marks._exists("album","Copy of Empty")
    post(client,"undo",{})
    assert marks._exists("album","Empty") and not marks._exists("album","Copy of Empty")
