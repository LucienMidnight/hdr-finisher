"""Durable saved filters and indexed candidates; the shared frontend engine matches."""
from copy import deepcopy
import json
import hashlib
import sqlite3
from pathlib import Path
from uuid import uuid4
from threading import RLock
from pydantic import BaseModel, ConfigDict, Field
from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from .library_documents import atomic_json, identity
from .library_grades import grade_key
from .library_marks import Marks, clean_names
from .library_diagnostics import log


class SmartRules(BaseModel):
    model_config = ConfigDict(extra="ignore")
    any: bool = False
    rules: list[dict] = Field(default_factory=list, max_length=100)
    folders: list[str] = Field(default_factory=list, max_length=100)


class SmartCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    id: str = ""
    name: str = ""
    filters: SmartRules = Field(default_factory=SmartRules)


class SmartGrid(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    token: str
    photos: list[dict]


class SmartAlbums:
    def __init__(self, marks, index):
        self.marks, self.index = marks, index
        self._cache_lock = RLock(); self._version = None; self._snapshot = None

    def preferences(self):
        try: value = json.loads(self.index.preferences_path.read_text(encoding="utf-8"))
        except FileNotFoundError: value = {}
        if not isinstance(value, dict) or not isinstance(value.get("smart_albums", []), list):
            raise ValueError("Smart album settings could not be read; nothing was changed.")
        for album in value.get("smart_albums", []):
            if not isinstance(album, dict) or not isinstance(album.get("id"), str) or not isinstance(album.get("name"), str):
                raise ValueError("Smart album settings could not be read; nothing was changed.")
            SmartRules.model_validate(album.get("filters"))
        return value

    def list(self):
        with self.index._state:
            albums = deepcopy(self.preferences().get("smart_albums", []))
            for album in albums: album["filters"] = SmartRules.model_validate(album["filters"]).model_dump()
            return albums

    @staticmethod
    def filters(value):
        value = SmartRules.model_validate(value).model_dump()
        for rule in value["rules"]:
            if not isinstance(rule.get("field"), str) or not rule["field"] or set(rule)-{"field","value","label","from","to","not","op","values","labels"}:
                raise ValueError("That smart album rule could not be read. Nothing was changed.")
            if rule.get("op", "is") not in {"is","contains","starts","ends","greater","less","at-least","at-most","range","in"}:
                raise ValueError("That comparison could not be read. Nothing was changed.")
            if any(isinstance(v, (dict,list)) for k,v in rule.items() if k not in {"values","labels"}):
                raise ValueError("That rule value could not be read. Nothing was changed.")
            for key in ("values", "labels"):
                if key in rule and (not isinstance(rule[key], list) or not all(isinstance(v, str) for v in rule[key])):
                    raise ValueError("That list of rule values could not be read. Nothing was changed.")
            if rule.get("op") == "in" and not rule.get("values"):
                raise ValueError("Choose at least one rule value.")
            if "not" in rule and not isinstance(rule["not"],bool): raise ValueError("That rule could not be read.")
        # Paths may be offline. No filesystem write or original-file access.
        value["folders"] = list(dict.fromkeys(str(Path(p).expanduser().resolve()) for p in value["folders"]))
        return value

    def command(self, request):
        with self.marks._lock, self.index._state:
            saved = self.preferences(); albums = deepcopy(saved.get("smart_albums", [])); before = deepcopy(albums)
            at = next((i for i,a in enumerate(albums) if a["id"] == request.id), None)
            if request.action == "delete":
                if at is None: raise ValueError("That smart album is no longer in the library.")
                albums.pop(at)
            elif request.action in {"create","edit","duplicate"}:
                name = clean_names([request.name], "Smart album names")[0]
                if any(a["name"].casefold() == name.casefold() and (request.action != "edit" or a["id"] != request.id) for a in albums):
                    raise ValueError("That smart album name is taken. Nothing was changed.")
                if request.action == "duplicate" and at is None:
                    raise ValueError("That smart album is no longer in the library.")
                filters = self.filters(albums[at]["filters"]) if request.action == "duplicate" else self.filters(request.filters.model_dump())
                item = {"id":request.id if request.action == "edit" else uuid4().hex, "name":name, "filters":filters}
                if request.action == "edit":
                    if at is None: raise ValueError("That smart album is no longer in the library.")
                    albums[at] = item
                else: albums.append(item)
            else: raise ValueError("That smart album command is not available.")
            if albums == before: return {"photos":[],"warnings":[],"undo_available":bool(self.marks._undo)}
            saved["smart_albums"] = albums; atomic_json(self.index.preferences_path, saved)
            # Removed/edited collections do not retain obsolete derived rows.
            db = self.marks._connect()
            try:
                with db:
                    if db.execute("SELECT 1 FROM sqlite_master WHERE name='smart_album_grids'").fetchone():
                        db.execute("DELETE FROM smart_album_grids WHERE id=?", (request.id,))
            finally: db.close()
            def undo():
                with self.index._state:
                    current = self.preferences()
                    if current.get("smart_albums", []) != albums:
                        raise ValueError("Smart albums changed elsewhere; Undo left them untouched.")
                    current["smart_albums"] = before; atomic_json(self.index.preferences_path,current)
                log("smart_album_undo", action="saved rules restored; photos untouched")
                return {"photos":[],"warnings":["Restored smart album rules. Photos untouched."],"smart_changed":True}
            self.marks._undo.append({"command":undo})
            log("smart_album_"+request.action, name=request.name, id=request.id, action="rules saved outside index; photos untouched")
            return {"albums":deepcopy(albums),"photos":[],"warnings":[],"smart_changed":True,"undo_available":True}

    def grid(self, identifier, token=None, photos=None, *, token_only=False):
        with self.marks._lock, self.index._state:
            item = next((a for a in self.list() if a["id"] == identifier), None)
            if item is None:
                raise ValueError("That smart album is no longer in the library.")
            scope = getattr(self.marks, "membership", None)
            pins = scope.pins(check_available=False) if scope else []
            # Timestamp rejects stale writes even after edit then Undo.
            stamp = self.index.preferences_path.stat().st_mtime_ns
            current = hashlib.sha256(json.dumps([item["filters"], pins, stamp], sort_keys=True).encode()).hexdigest()
            db = self.marks._connect()
            try:
                with db:
                    db.execute("CREATE TABLE IF NOT EXISTS smart_album_grids (id TEXT PRIMARY KEY, token TEXT NOT NULL, photos TEXT NOT NULL)")
                    row = db.execute("SELECT token, photos FROM smart_album_grids WHERE id=?", (identifier,)).fetchone()
                    if token is not None:
                        if token != current: return {"saved": False}
                        encoded = json.dumps(photos, separators=(",", ":"))
                        if row != (current, encoded):
                            db.execute("INSERT OR REPLACE INTO smart_album_grids VALUES (?,?,?)", (identifier, current, encoded))
                        return {"saved": True}
                    return {"token": current, "photos": json.loads(row[1]) if not token_only and row and row[0] == current else None,
                            "filters": item["filters"], "name": item["name"], "indexing": False,
                            "undo_available": bool(self.marks._undo), "unreadable_folders": [], "warnings": []}
            finally: db.close()

    def version(self):
        try:
            info=self.marks.database.stat()
            with self.marks.database.open("rb") as handle: header=handle.read(100)
            # WAL does not increment the main-file change counter per commit.
            # The backend's commit serial catches same-timestamp writes, even
            # when the last connection closes and checkpoints/deletes the WAL.
            wal = self.marks.database.with_name(self.marks.database.name + "-wal")
            try:
                wal_info = wal.stat()
                with wal.open("rb") as handle: wal_header = handle.read(32)
                wal_stamp = f"{wal_info.st_mtime_ns}:{wal_info.st_size}:{wal_header.hex()}" if wal_info.st_size else ""
            except FileNotFoundError:
                wal_stamp = ""
            return f"{self.marks._revision}:{info.st_ino}:{info.st_mtime_ns}:{info.st_size}:{header[24:28].hex()}:{wal_stamp}"
        except FileNotFoundError: return "empty"

    def candidates(self, version=""):
        # Serialize builders here, never while waiting on the shared marks lock.
        # WAL readers keep a consistent view while marks/index writers continue.
        with self._cache_lock:
            db = None
            try:
                with self.marks._lock:
                    scope = getattr(self.marks, "membership", None)
                    pins = scope.pins(check_available=False) if scope else []
                    from .batch_export import RECORD_PATH, read_records, export_state
                    records = read_records()
                    record_version = str(RECORD_PATH.stat().st_mtime_ns) if RECORD_PATH.exists() else ""
                    stamp = self.version() + record_version + (json.dumps(pins) if scope else "")
                    if version == stamp: return {"version":stamp,"photos":None}
                    cached = self._snapshot if self._version == stamp else None
                    if cached is None and self.marks.database.exists():
                        db = sqlite3.connect(self.marks.database.as_uri()+"?mode=ro", uri=True)
                        db.execute("BEGIN")
                        # The first read fixes the snapshot under the same lock
                        # as its version. No whole-library work belongs here.
                        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if cached is not None:
                    return {"version":stamp,"photos":deepcopy(cached)}
                photos, files, states, copies, rows = [], [], {}, {}, {}
                if db is not None:
                    files = list(db.execute("SELECT path,bytes,mtime_ns,facts FROM files"))
                    states = {p:json.loads(s) for p,s in db.execute("SELECT path,state FROM photo_grades")} if "photo_grades" in tables else {}
                    copies = {p:json.loads(s) for p,s in db.execute("SELECT source,state FROM library_copies")} if "library_copies" in tables else {}
                    keys = [r[0] for r in files] + [p+"|copy|"+item["photo_id"] for p,state in copies.items() for item in (state.get("desired",[]) if state.get("pending") else state.get("baseline",[]))]
                    rows = self.marks._rows(keys, db=db)
                    db.close(); db = None
                def grade_status(key, fallback=None, default=None):
                    s=states.get(key,{})
                    grade=s.get("desired") if s.get("pending") else s.get("indexed_grade",s.get("baseline",fallback))
                    return {"edited":grade is not None and grade_key(grade)!=grade_key(s.get("default",default)), "grade_identity":identity(grade), **export_state(key, grade, records)}
                for path,size,modified,facts in files:
                    row={"path":path,"name":Path(path).name,"type":Path(path).suffix[1:].upper(),"bytes":size,"mtime_ns":modified,"indexed":True,
                         "marks":Marks().model_dump(),"albums":[],"storage":"none",**(json.loads(facts) if facts else {}),**rows.get(path,{}),**grade_status(path)}
                    if scope:
                        row["library_pins"] = [p for p in pins if scope.under(path,p)]
                        row["kept_by_album"] = not bool(row["library_pins"])
                    family=copies.get(path,{})
                    items=family.get("desired",[]) if family.get("pending") else family.get("baseline",[])
                    row["copy_count"]=len(items);photos.append(row)
                    for i,item in enumerate(items):
                        key=path+"|copy|"+item["photo_id"]
                        photos.append({**row,**rows.get(key,{}),"path":key,"source_path":path,"name":item["name"],"copy_name":item["name"],"copy_id":item["photo_id"],"copy_order":i,
                                       "marks":rows.get(key,{}).get("marks",item.get("marks",Marks().model_dump())),"albums":rows.get(key,{}).get("albums",item.get("albums",[])),"storage":rows.get(key,{}).get("storage","database" if family.get("pending") else "sidecar"),
                                       **grade_status(key,item.get("grade"),item.get("grade_default"))})
                self._version=stamp;self._snapshot=deepcopy(photos)
                return {"version":stamp,"photos":photos}
            finally:
                if db is not None: db.close()


def add_smart_album_routes(router, marks, index):
    smart=SmartAlbums(marks,index)
    @router.get("/smart-albums")
    def albums():
        try: return {"albums":smart.list()}
        except (ValueError,OSError) as e: raise HTTPException(400,str(e)) from e
    @router.post("/smart-albums")
    def command(request:SmartCommand):
        try: return smart.command(request)
        except (ValueError,OSError) as e: raise HTTPException(400,str(e)) from e
    @router.get("/smart-grid")
    def grid(id: str, token_only: bool = False):
        try: return JSONResponse(smart.grid(id, token_only=token_only))
        except (ValueError, OSError) as e: raise HTTPException(400, str(e)) from e
    @router.post("/smart-grid")
    def save_grid(request: SmartGrid):
        try: return smart.grid(request.id, request.token, request.photos)
        except (ValueError, OSError) as e: raise HTTPException(400, str(e)) from e
    @router.get("/smart-candidates")
    def candidates(version:str=""):
        result=smart.candidates(version)
        metadata = {k:v for k,v in result.items() if k != "photos"}
        metadata.update(indexing=index.status()["state"] not in {"idle","off"},
                        undo_available=bool(marks._undo), unreadable_folders=[], warnings=[])
        def encoded():
            # A single json.dumps of the entire list holds Python's GIL even
            # on a worker thread. Bound each encode and yield between batches.
            yield json.dumps(metadata, ensure_ascii=False, allow_nan=False)[:-1] + ',"photos":'
            photos = result["photos"]
            if photos is None:
                yield "null}"
                return
            yield "["
            for start in range(0, len(photos), 128):
                if start: yield ","
                yield json.dumps(photos[start:start+128], ensure_ascii=False, allow_nan=False, separators=(",", ":"))[1:-1]
            yield "]}"
        return StreamingResponse(encoded(), media_type="application/json")
    return smart
