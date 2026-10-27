"""Bounded index-first folder reads; the helper only walks, the backend writes.

The complete indexed extent is delivered once; disk checks use bounded pages.
A disposable SQLite seen-set makes
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
        name = os.path.basename(path)
        photos.append(dict(path=path,name=name,type=os.path.splitext(name)[1][1:].upper(),bytes=size,mtime_ns=modified,
            indexed=bool(facts),**(json.loads(facts) if facts else {})))
    return photos


def indexed_paths(index, root, after="", limit=8192):
    prefix=index._prefix(root)
    db=sqlite3.connect(index.marks.database.as_uri()+"?mode=ro",uri=True)
    try:
        return [row[0] for row in db.execute("SELECT path FROM files WHERE path>=? AND path<? AND path>? ORDER BY path LIMIT ?",
            (prefix,prefix[:-1]+chr(ord(prefix[-1])+1),after,limit))]
    finally: db.close()


def cached_rows(index, store, photos, root=None):
    """Database state only: no stat, settings read, or whole-folder lock."""
    if not photos:
        return photos
    marks = index.marks
    paths = [p["path"] for p in photos]
    # Independent WAL reader: indexed delivery must never wait for upkeep's
    # writer lock. Each SELECT sees committed state; visible hydration refreshes.
    rows = marks._rows(paths)
    empty=dict(marks=Marks().model_dump(),albums=[],storage="none")
    for photo in photos:
        photo.update(rows.get(photo["path"],empty))
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
    if root is not None and index.membership.pinned(root, index.membership.pins()):
        for photo in photos: photo["kept_by_album"] = False
    else:
        index.membership.describe(photos)
    return photos


def indexed_snapshot(index, store, root):
    """Full sort/filter extent; enrich only rows with authored/indexed state.

    Most files have no marks, copies or grade. Query their sparse carriers once
    instead of opening hundreds of connections and describing 155k defaults.
    Visible rows still hydrate through folder-details before picture requests.
    """
    photos = indexed_page(index, root, limit=2147483647)
    if not photos:
        return 0, []
    if store is None or len(photos) < 4096:
        return len(photos), cached_rows(index, store, photos, root=root)
    prefix = index._prefix(root)
    bounds = (prefix, prefix[:-1]+chr(ord(prefix[-1])+1))
    db = sqlite3.connect(index.marks.database.as_uri()+"?mode=ro", uri=True)
    try:
        carriers = set()
        for table, column in (("photos", "path"), ("photo_grades", "path")):
            carriers.update(p for p, in db.execute(
                f"SELECT {column} FROM {table} WHERE {column}>=? AND {column}<?", bounds))
        for path, value in db.execute("SELECT source,state FROM library_copies WHERE source>=? AND source<?", bounds):
            state = json.loads(value)
            if state.get("desired", []) if state.get("pending") else state.get("baseline", []):
                carriers.add(path)
    finally:
        db.close()
    exports = getattr(store, "batch_export", None)
    if exports:
        carriers.update(exports.read_records())
    # Non-pinned views need membership descriptions even without authored state.
    if not index.membership.pinned(root, index.membership.pins()):
        return len(photos), cached_rows(index, store, photos, root=root)
    described = cached_rows(index, store, [p for p in photos if p["path"] in carriers], root=root)
    families = {}
    for photo in described:
        families.setdefault(photo.get("source_path", photo["path"]), []).append(photo)
    rows = []
    for photo in photos:
        rows.extend(families.get(photo["path"], [photo]))
    return len(photos), rows


class OrderedExtent:
    """One read-only WAL snapshot, sorted before bounded row hydration."""
    def __init__(self, index, store, root, sort, descending):
        import re
        import unicodedata
        self.index, self.store, self.root = index, store, root
        self.db = sqlite3.connect(index.marks.database.as_uri()+"?mode=ro", uri=True, check_same_thread=False)
        self.db.execute("BEGIN")
        prefix = index._prefix(root)
        bounds = (prefix, prefix[:-1]+chr(ord(prefix[-1])+1))
        def natural(value):
            value = ''.join(c for c in unicodedata.normalize('NFD', str(value)).casefold() if not unicodedata.combining(c))
            return re.sub(r'\d+', lambda m: m[0].lstrip('0').zfill(24), value)
        self.db.create_function('natural', 1, natural, deterministic=True)
        self.db.create_function('basename', 1, os.path.basename, deterministic=True)
        self.db.create_function('extension', 1, lambda p: os.path.splitext(p)[1].upper(), deterministic=True)
        where = "f.path>=? AND f.path<?"
        count = self.db.execute("SELECT count(*) FROM files f WHERE "+where, bounds).fetchone()[0]
        tables = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        extra = 0
        if 'library_copies' in tables and store is not None:
            for value, in self.db.execute("SELECT c.state FROM library_copies c JOIN files f ON f.path=c.source WHERE "+where, bounds):
                state = json.loads(value)
                extra += len(state.get('desired',[]) if state.get('pending') else state.get('baseline',[]))
        self.total = count + extra
        direction = ' DESC' if descending else ' ASC'
        order = ''
        join = ''
        if sort == 'time':
            order = "(json_extract(f.facts,'$.capture_time') IS NULL), json_extract(f.facts,'$.capture_time')"+direction+", "
        elif sort == 'modified': order = 'f.mtime_ns'+direction+', '
        elif sort == 'type': order = 'extension(f.path)'+direction+', '
        elif sort in ('rating','pick'):
            join = ' LEFT JOIN photos p ON p.path=f.path'
            field = "coalesce(json_extract(p.marks,'$.rating'),0)" if sort=='rating' else "CASE coalesce(json_extract(p.marks,'$.pick'),'unmarked') WHEN 'pick' THEN 0 WHEN 'reject' THEN 2 ELSE 1 END"
            order = field+direction+', '
        elif sort == 'state' and store is not None:
            edited = store.library_grades.describe([r[0] for r in self.db.execute("SELECT path FROM photo_grades WHERE path>=? AND path<?",bounds)])
            self.db.create_function('edited',1,lambda p: int(edited.get(p,{}).get('edited',False)))
            order = 'edited(f.path)'+direction+', '
        self.cursor = self.db.execute("SELECT f.path,f.bytes,f.mtime_ns,f.facts FROM files f"+join+" WHERE "+where+
            " ORDER BY "+order+"natural(basename(f.path))"+direction+", natural(f.path)"+direction, bounds)
        self.offset = 0

    def page(self, limit):
        photos=[]
        for path, size, modified, facts in self.cursor.fetchmany(limit):
            name=os.path.basename(path)
            photos.append(dict(path=path,name=name,type=os.path.splitext(name)[1][1:].upper(),bytes=size,
                mtime_ns=modified,indexed=bool(facts),**(json.loads(facts) if facts else {})))
        rows=cached_rows(self.index,self.store,photos,root=self.root)
        offset=self.offset; self.offset+=len(rows)
        return offset,rows

    def close(self):
        self.db.close()


async def stream_folder(index, store, request, root, enrich, sort="time", descending=False):
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
        extent = None
        first = True
        try:
            count = len(await run_in_threadpool(indexed_paths,index,root,"",4096))
            if count < 4096:
                total, rows = await run_in_threadpool(indexed_snapshot,index,store,root)
                pages = [(0,rows)]
            else:
                extent = await run_in_threadpool(OrderedExtent,index,store,root,sort,descending)
                total = extent.total
                pages = None
            while True:
                if extent:
                    offset, rows = await run_in_threadpool(extent.page,256 if first else 4096)
                elif pages: offset, rows = pages.pop()
                else: break
                if not rows: break
                if first:
                    log("folder_open_first_rows",folder=root,request=token,rows=len(rows),duration_ms=(time.perf_counter()-started)*1000,route="index")
                    first=False
                empty_marks=Marks().model_dump()
                columns=sorted({key for photo in rows for key in photo if key not in ("name","type","albums","storage","kept_by_album")})
                yield event("rows",total=total,offset=offset,ordered=bool(extent),columns=columns,values=[
                    [photo.get(key) if key!="marks" or photo.get(key)!=empty_marks else None for key in columns] for photo in rows],photos=[])
                await asyncio.sleep(0)
            if total:
                log("folder_open_all_rows",folder=root,request=token,rows=total,duration_ms=(time.perf_counter()-started)*1000,route="index")
            yield event("indexed",rows=total)
        finally:
            if extent: await run_in_threadpool(extent.close)
        generation = 0
        while True:
            generation += 1; check_started = time.perf_counter()
            epoch = getattr(getattr(index.marks,"file_commands",None),"epoch",None)
            counts = dict(added=0,removed=0,changed=0,settings=0)
            unreadable = []
            while True:
                page_started=time.perf_counter()
                result = await helper(restart=generation>1 and seen.execute("SELECT 1 FROM seen WHERE pass=? LIMIT 1",(generation,)).fetchone() is None)
                helper_ms=(time.perf_counter()-page_started)*1000
                accept_started=time.perf_counter()
                photos = result["photos"]
                unreadable.extend(result.get("unreadable_folders",[]))
                def accept():
                    paths = [p["path"] for p in photos]
                    if not paths: return []
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
                log("folder_disk_page",folder=root,request=token,count=len(photos),helper_ms=helper_ms,
                    accept_ms=(time.perf_counter()-accept_started)*1000,duration_ms=(time.perf_counter()-page_started)*1000)
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
                    paths=await run_in_threadpool(indexed_paths,index,root,after)
                    if not paths: break
                    after=paths[-1]
                    removed=[p for p in paths if not seen.execute("SELECT 1 FROM seen WHERE path=? AND pass=?",(p,generation)).fetchone()]
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
