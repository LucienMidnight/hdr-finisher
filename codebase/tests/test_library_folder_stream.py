"""Folder streaming reads the index first and bounds discovery/reconciliation."""
import asyncio
from concurrent.futures import Future
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from hdr_finisher.library_folder_stream import indexed_page, cached_rows, stream_folder
from hdr_finisher.library_folders import scan_page, _paged_walks
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_marks import LibraryMarks

class Helper:
    def submit_library(self, command, **values):
        future=Future()
        try:
            future.set_result(scan_page(values["token"],values["path"],close=values.get("close",False),restart=values.get("restart",False)))
        except Exception as error: future.set_exception(error)
        return "job",future
    def cancel(self, job): pass
    def status(self): return dict(paused=False,pending=0)

@pytest.fixture
def setup(tmp_path):
    folder=tmp_path/"photos";folder.mkdir()
    data=tmp_path/"data";data.mkdir()
    browser=SimpleNamespace(root=data,pinned=lambda:[])
    marks=LibraryMarks(data)
    db=marks._connect();db.close()
    index=LibraryIndex(marks,browser,Helper())
    return folder,index

def test_index_pages_do_not_read_source_or_settings(setup,monkeypatch):
    folder,index=setup
    rows=[dict(path=str(folder/f"{i:04}.jpg"),bytes=12,mtime_ns=1) for i in range(600)]
    index.remember_scan(str(folder),rows,reconcile=False,removed=[])
    def forbidden(*args,**kwargs): raise AssertionError("An index page opened settings")
    monkeypatch.setattr(index.marks,"_document",forbidden)
    first=indexed_page(index,str(folder),limit=64)
    second=indexed_page(index,str(folder),first[-1]["path"])
    assert len(first)==64 and len(second)==256
    assert first[-1]["path"]<second[0]["path"]
    assert len(cached_rows(index,None,first))==64
    assert not (folder/"0000.jpg").exists()

def test_helper_yields_first_page_and_cancels_without_collecting_tree(tmp_path):
    for i in range(600): (tmp_path/f"{i}.jpg").write_bytes(b"photo")
    first=scan_page("test-bounded",str(tmp_path))
    assert len(first["photos"])==256 and not first["done"]
    assert "test-bounded" in _paged_walks
    scan_page("test-bounded",str(tmp_path),close=True)
    assert "test-bounded" not in _paged_walks
    with pytest.raises(Exception):
        scan_page("test-cancel",str(tmp_path),lambda:True)
    assert "test-cancel" not in _paged_walks

def test_stream_serves_index_before_walk_and_emits_only_differences(setup):
    folder,index=setup
    unchanged=folder/"same.jpg";unchanged.write_bytes(b"same")
    removed=folder/"removed.jpg";removed.write_bytes(b"gone")
    records=[]
    for p in (unchanged,removed):
        stat=p.stat();records.append(dict(path=str(p),bytes=stat.st_size,mtime_ns=stat.st_mtime_ns))
    index.remember_scan(str(folder),records,reconcile=False,removed=[])
    removed.unlink();added=folder/"new.jpg";added.write_bytes(b"new")
    class Request:
        async def is_disconnected(self): return False
    def enrich(result): return result
    async def read():
        stream=stream_folder(index,None,Request(),str(folder),enrich)
        result=[]
        try:
            async for text in stream:
                value=json.loads(text);result.append(value)
                if value["kind"]=="checked":break
        finally: await stream.aclose()
        return result
    result=asyncio.run(read())
    assert result[0]["kind"]=="rows"
    assert str(removed) in [p["path"] for p in result[0]["photos"]]
    changes=[r for r in result if r["kind"]=="changes"]
    assert [p["path"] for r in changes for p in r["photos"]]==[str(added)]
    assert [p for r in changes for p in r["removed"]]==[str(removed)]
    assert result[-1]["added"]==1 and result[-1]["removed"]==1
    assert not index.checks.streaming
    assert [p["path"] for p in indexed_page(index,str(folder))]==sorted([str(unchanged),str(added)])


def test_visible_details_accepts_a_full_page_without_reading_other_photos(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.media_browser import MediaBrowserStore
    app=FastAPI()
    app.include_router(create_library_router(None,MediaBrowserStore(tmp_path/"app")))
    photos=[]
    for i in range(33):
        photo=tmp_path/f"{i}.jpg";photo.write_bytes(b"source");photos.append(str(photo))
    client=TestClient(app)
    result=client.post("/api/library/folder-details",json={"paths":photos[:32]})
    assert result.status_code==200
    assert [row["path"] for row in result.json()["photos"]]==photos[:32]
    assert client.post("/api/library/folder-details",json={"paths":photos}).status_code==400


def test_foreground_metadata_does_not_wait_for_pending_helper_jobs(setup,monkeypatch):
    folder,index=setup
    def forbidden(): raise AssertionError("Visible metadata waited for background work")
    monkeypatch.setattr(index,"wait_for_upkeep",forbidden)
    index.remember_facts([dict(path=str(folder/"photo.jpg"),bytes=4,mtime_ns=1)],foreground=True)


def test_walk_yields_and_can_cancel_through_unsupported_files(tmp_path):
    for i in range(800): (tmp_path/f"{i}.txt").write_text("ignored")
    result=scan_page("unsupported",str(tmp_path))
    assert not result["done"] and not result["photos"]
    with pytest.raises(Exception): scan_page("unsupported",str(tmp_path),lambda:True)
    assert "unsupported" not in _paged_walks
