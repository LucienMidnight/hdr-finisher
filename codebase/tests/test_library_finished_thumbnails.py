import json
import os
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

from hdr_finisher.library_finished_thumbnails import FinishedThumbnails
from hdr_finisher.library_live import LivePictures, quality
from hdr_finisher.library_pictures import picture_key, indexed_picture_key
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.models import AdjustmentState


def setup_cache(tmp_path):
    root = tmp_path / "test-finished"
    root.mkdir()
    marks = LibraryMarks(root)
    db = marks._connect()
    db.execute("CREATE TABLE photo_grades(path TEXT PRIMARY KEY,state TEXT)")
    source = tmp_path / "photo.jpg"
    source.write_bytes(b"source")
    stat = source.stat()
    db.execute("INSERT INTO files VALUES (?,?,?,NULL)", (str(source),stat.st_size,stat.st_mtime_ns))
    db.commit();db.close()
    live = LivePictures(root, marks)
    cache = FinishedThumbnails(live)
    metadata = dict(path=str(source),edge=640,quality=quality(None),key=picture_key(source,640,quality(None)),
        width=2,height=2,source_width=2,source_height=2,adjustments=AdjustmentState().model_dump(mode="json"))
    meta = live.describe(str(source), metadata)
    # JS serializes integral floating-point values as JSON integers.
    meta = json.loads(json.dumps(meta), parse_float=lambda n: int(float(n)) if float(n).is_integer() else float(n))
    return source, marks, cache, meta


def test_exact_finished_bytes_survive_restart_and_offline_source(tmp_path, monkeypatch):
    source, marks, cache, meta = setup_cache(tmp_path)
    body = bytes(range(256))*2
    assert cache.write(str(source),"sdr","bgra8unorm",meta,body,2,2,256)
    source.unlink()
    restarted = FinishedThumbnails(cache.live)
    info, stored = restarted.read(str(source),"sdr","bgra8unorm")
    assert stored == body and info["key"] == meta["key"]
    assert restarted.read(str(source),"hdr","rgba16float") is None


def test_known_source_and_pending_grade_changes_reject_old_surfaces(tmp_path):
    source, marks, cache, meta = setup_cache(tmp_path)
    body=bytes(512)
    assert cache.write(str(source),"sdr","bgra8unorm",meta,body,2,2,256)
    db=marks._connect()
    doc={"global_adjustments":meta["adjustments"]}
    doc["global_adjustments"]["hdr"]["exposure"]=2
    db.execute("INSERT INTO photo_grades VALUES (?,?)",(str(source),json.dumps(dict(pending=True,desired=doc))))
    db.commit()
    assert cache.read(str(source),"sdr","bgra8unorm") is None
    assert not cache.write(str(source),"sdr","bgra8unorm",meta,body,2,2,256)
    db.execute("DELETE FROM photo_grades")
    db.execute("UPDATE files SET bytes=bytes+1")
    db.commit();db.close()
    assert cache.read(str(source),"sdr","bgra8unorm") is None
    assert not cache.write(str(source),"sdr","bgra8unorm",meta,body,2,2,256)


def test_indexed_identity_matches_existing_scene_identity(tmp_path):
    source, marks, cache, meta = setup_cache(tmp_path)
    stat=source.stat()
    assert indexed_picture_key(str(source),640,quality(None),(stat.st_size,stat.st_mtime_ns)) == picture_key(source,640,quality(None))


def test_existing_stored_scene_uses_indexed_facts_without_a_source_read(tmp_path):
    import numpy as np
    source, marks, cache, meta = setup_cache(tmp_path)
    stamp=(source.stat().st_size,source.stat().st_mtime_ns)
    metadata=dict(path=str(source),edge=640,quality=quality(None),width=2,height=2,source_width=2,source_height=2,adjustments=AdjustmentState().model_dump(mode="json"))
    scene=cache.live.cache.build(source,640,quality(None),decoded=(np.zeros((2,2,3),np.float32),None,metadata))
    expected=cache.live.describe(str(source),scene)["key"]
    source.unlink()
    stored=cache.live.cache.cached(str(source),640,quality(None),stamp=stamp)
    assert stored["key"] == scene["key"]
    described=cache.live.describe(str(source),stored,document=None,source_identity=indexed_picture_key(str(source),640,quality(None),stamp))
    assert described["key"] == expected


def test_batched_http_response_restores_exact_surfaces_and_handles_missing(tmp_path):
    import struct
    from threading import BoundedSemaphore
    from fastapi import FastAPI, APIRouter
    from fastapi.testclient import TestClient
    from hdr_finisher.library_finished_thumbnails import add_finished_thumbnail_routes
    source, marks, cache, meta = setup_cache(tmp_path)
    body = bytes(range(256))*2
    assert cache.write(str(source),"sdr","bgra8unorm",meta,body,2,2,256)
    router = APIRouter()
    add_finished_thumbnail_routes(router,cache.live,BoundedSemaphore(2))
    app = FastAPI();app.include_router(router)
    source.unlink()
    with TestClient(app) as client:
        response = client.post('/finished-thumbnails?lane=sdr&format=bgra8unorm',json={'paths':[str(source),str(source)+'missing']})
        assert response.status_code == 200
        data = response.content
        length = struct.unpack('<I',data[:4])[0]
        records = json.loads(data[4:4+length])
        assert len(records) == 1 and records[0]['path'] == str(source)
        assert data[4+length:] == body
        assert records[0]['length'] == len(data)-4-length
        empty = client.post('/finished-thumbnails?lane=hdr&format=rgba16float',json={'paths':[str(source)]}).content
        assert json.loads(empty[4:]) == []
