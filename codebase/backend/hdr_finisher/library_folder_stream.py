"""Bounded index-first folder reads; the helper only walks, the backend writes.

Only one small page is retained in memory. A disposable SQLite seen-set makes
removal reconciliation independent of folder size. No photo folder is written.
"""
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from uuid import uuid4
from starlette.concurrency import run_in_threadpool
from .library_diagnostics import log
from .library_marks import Marks

PAGE = 256


def indexed_page(index, root, after="", limit=PAGE):
    prefix = index._prefix(root)
    if not index.marks.database.exists():
        return []
    db = sqlite3.connect(index.marks.database.as_uri()+"?mode=ro", uri=True)
    try:
        rows = db.execute("SELECT path,bytes,mtime_ns,facts FROM files WHERE path>=? AND path<? AND path>? ORDER BY path LIMIT ?",
            (prefix, prefix[:-1]+chr(ord(prefix[-1])+1), after, limit)).fetchall()
    finally:
        db.close()
    photos = []
    for path, size, modified, facts in rows:
        p = Path(path)
        photos.append(dict(path=path,name=p.name,type=p.suffix[1:].upper(),bytes=size,mtime_ns=modified,
            indexed=bool(facts),**(json.loads(facts) if facts else {})))
    return photos


def cached_rows(index, store, photos):
    """Database state only: no stat, settings read, or whole-folder lock."""
    if not photos:
        return photos
    marks = index.marks
    paths = [p["path"] for p in photos]
    with marks._lock:
        rows = marks._rows(paths)
    for photo in photos:
        photo.update(rows.get(photo["path"],dict(marks=Marks().model_dump(),albums=[],storage="none")))
    if store is not None:
        # Expand the indexed copy baseline without opening a settings file.
        states = marks.copies.states(paths)
        expanded = []
        for photo in photos:
            state = states.get(photo["path"],{})
            copies = state.get("desired",[]) if state.get("pending") else state.get("baseline",[])
            photo["copy_count"] = len(copies)
            expanded.append(photo)
            for order, item in enumerate(copies):
                expanded.append({**photo,**marks.copies.row(photo["path"],item),
                    "source_path":photo["path"],"copy_id":item["photo_id"],"copy_order":order,
                    "name":photo["name"]+" · "+item["name"],"copy_name":item["name"],"copy_count":0})
        photos = expanded
        described = store.library_grades.describe([p["path"] for p in photos])
        for photo in photos:
            photo.update(described.get(photo["path"],{}))
    index.membership.describe(photos)
    return photos


async def stream_folder(index, store, request, root, enrich):
    worker = index.worker
    token = uuid4().hex
    started = time.perf_counter()
    epoch = getattr(getattr(index.marks,"file_commands",None),"epoch",None)
    temporary = tempfile.TemporaryDirectory(prefix="hdr-folder-open-")
    seen = sqlite3.connect(str(Path(temporary.name)/"seen.sqlite3"),check_same_thread=False)
    seen.execute("CREATE TABLE seen(path TEXT PRIMARY KEY, bytes INTEGER, mtime INTEGER, settings TEXT, pass INTEGER)")
    # Timed checks must not start a second whole-tree snapshot for this view.
    with index.checks.lock:
        index.checks.streaming[root] = index.checks.streaming.get(root,0)+1
    if index._thread is not None:
        index.kick()  # Cancel an already queued whole-tree index read.
    log("folder_open_started",folder=root,request=token)
    def event(kind, **values):
        return json.dumps(dict(kind=kind,request=token,path=root,**values),separators=(",",":"))+"\n"
    close_reason = "client disconnected or app closing"
    async def helper(**values):
        job, future = await run_in_threadpool(worker.submit_library,"scan-page",priority=100,token=token,path=root,**values)
        try:
            # StreamingResponse owns disconnect listening and cancels this
            # task. Await completion directly; polling added 20 ms per page.
            return await asyncio.wrap_future(future)
        finally:
            worker.cancel(job)
    try:
        after = ""; total = 0; first = True
        while True:
            photos = await run_in_threadpool(indexed_page,index,root,after,64 if first else PAGE)
            if not photos: break
            after = photos[-1]["path"]
            total += len(photos)
            rows = await run_in_threadpool(cached_rows,index,store,photos)
            if first:
                log("folder_open_first_rows",folder=root,request=token,rows=len(rows),duration_ms=(time.perf_counter()-started)*1000,route="index")
                first = False
            yield event("rows",photos=rows)
        if total:
            log("folder_open_all_rows",folder=root,request=token,rows=total,duration_ms=(time.perf_counter()-started)*1000,route="index")
        yield event("indexed",rows=total)
        generation = 0
        while True:
            generation += 1; check_started = time.perf_counter()
            epoch = getattr(getattr(index.marks,"file_commands",None),"epoch",None)
            counts = dict(added=0,removed=0,changed=0,settings=0)
            unreadable = []
            while True:
                result = await helper(restart=generation>1 and seen.execute("SELECT 1 FROM seen WHERE pass=? LIMIT 1",(generation,)).fetchone() is None)
                photos = result["photos"]
                unreadable.extend(result.get("unreadable_folders",[]))
                def accept():
                    paths = [p["path"] for p in photos]
                    if not paths: return []
                    with index.marks._lock:
                        db=index.marks._connect()
                        try:
                            known={p:(b,m) for p,b,m in db.execute("SELECT path,bytes,mtime_ns FROM files WHERE path IN ("+",".join("?" for _ in paths)+")",paths)}
                        finally: db.close()
                    changed=[]; read=[]
                    for photo in photos:
                        key=photo["path"]; stat=(photo["bytes"],photo["mtime_ns"])
                        old=seen.execute("SELECT bytes,mtime,settings FROM seen WHERE path=?",(key,)).fetchone()
                        settings=json.dumps(photo.get("settings"))
                        if key not in known:
                            counts["added"]+=1; changed.append(photo); read.append(photo)
                        elif known[key]!=stat:
                            counts["changed"]+=1; changed.append(photo); read.append(photo)
                        elif (old and old[2]!=settings) or (not old and photo.get("settings") is not None):
                            counts["settings"]+=1; read.append(photo)
                        seen.execute("INSERT OR REPLACE INTO seen VALUES (?,?,?,?,?)",(key,*stat,settings,generation))
                    seen.commit()
                    # No enclosing lock: each 32-photo index transaction gives way.
                    if changed:
                        index.remember_scan(root,changed,epoch=epoch,reconcile=False,removed=[])
                    output=[]
                    for at in range(0,len(read),16):
                        batch=read[at:at+16]
                        output.extend(enrich(dict(path=root,photos=batch,unreadable_folders=[]))["photos"])
                    return output
                rows=await run_in_threadpool(accept)
                if rows:
                    if first:
                        log("folder_open_first_rows",folder=root,request=token,rows=len(rows),duration_ms=(time.perf_counter()-started)*1000,route="disk")
                        first=False
                    yield event("changes",photos=rows,removed=[])
                if result["done"]: break
            # A partial/offline walk cannot establish that a photo was removed.
            if not unreadable:
                after=""
                while True:
                    photos=await run_in_threadpool(indexed_page,index,root,after)
                    if not photos: break
                    after=photos[-1]["path"]
                    removed=[p["path"] for p in photos if not seen.execute("SELECT 1 FROM seen WHERE path=? AND pass=?",(p["path"],generation)).fetchone()]
                    if removed:
                        def retire():
                            index.remember_scan(root,[],epoch=epoch,reconcile=False,removed=removed)
                            for value in removed:
                                index.marks.read([value],documents=[None],canonical=True,connected=True)
                        await run_in_threadpool(retire)
                        counts["removed"]+=len(removed)
                        yield event("changes",photos=[],removed=removed)
            if generation==1 and total==0:
                discovered=seen.execute("SELECT count(*) FROM seen WHERE pass=?",(generation,)).fetchone()[0]
                log("folder_open_all_rows",folder=root,request=token,rows=discovered,duration_ms=(time.perf_counter()-started)*1000,route="disk")
            duration=time.perf_counter()-check_started
            log("folder_open_disk_finished",folder=root,request=token,duration_ms=(time.perf_counter()-started)*1000,check_ms=duration*1000,**counts,unreadable=len(unreadable))
            yield event("checked",**counts,unreadable_folders=unreadable)
            # Only the seen set persists, on disk. No settings or picture work
            # is scheduled merely because a row exists in the index.
            for _ in range(int(max(15,10*duration)*4)):
                with index.checks.lock:
                    requested=root in index.checks.stream_requested
                    index.checks.stream_requested.discard(root)
                if requested: break
                await asyncio.sleep(.25)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        close_reason = "failed: " + str(error)
        log("folder_open_failed",folder=root,request=token,reason=str(error))
        yield event("error",message=str(error))
    finally:
        try:
            worker.submit_library("scan-page",priority=0,token=token,path=root,close=True)
        except (RuntimeError,OSError): pass
        with index.checks.lock:
            count=index.checks.streaming.get(root,1)-1
            if count: index.checks.streaming[root]=count
            else: index.checks.streaming.pop(root,None)
        seen.close(); temporary.cleanup()
        log("folder_open_closed",folder=root,request=token,duration_ms=(time.perf_counter()-started)*1000,reason=close_reason)
