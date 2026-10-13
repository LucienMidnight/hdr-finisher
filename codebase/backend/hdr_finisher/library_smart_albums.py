"""Durable saved filters and indexed candidates; the shared frontend engine matches."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4
from threading import RLock
from pydantic import BaseModel, ConfigDict, Field
from fastapi import HTTPException
from .library_kept import atomic_json, identity
from .library_grades import grade_key
from .library_marks import Marks, clean_names
from .library_diagnostics import log


class SmartRules(BaseModel):
    model_config = ConfigDict(extra="forbid")
    any: bool = False
    rules: list[dict] = Field(default_factory=list, max_length=100)
    folders: list[str] = Field(default_factory=list, max_length=100)
    # Common filter-bar controls keep their meaning even in Match any mode.
    rating: str = ""
    pick: str = ""
    label: str = ""
    type: str = ""
    search: str = ""
    raw: bool = False


class SmartCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str
    id: str = ""
    name: str = ""
    filters: SmartRules = Field(default_factory=SmartRules)


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
        with self.index._state: return deepcopy(self.preferences().get("smart_albums", []))

    @staticmethod
    def filters(value):
        value = SmartRules.model_validate(value).model_dump()
        for rule in value["rules"]:
            if not isinstance(rule.get("field"), str) or not rule["field"] or set(rule)-{"field","value","label","from","to","not","op"}:
                raise ValueError("That smart album rule could not be read. Nothing was changed.")
            if rule.get("op", "is") not in {"is","contains","starts","ends","greater","less","at-least","at-most","range"}:
                raise ValueError("That comparison could not be read. Nothing was changed.")
            if any(isinstance(v, (dict,list)) for v in rule.values()):
                raise ValueError("That rule value could not be read. Nothing was changed.")
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
            elif request.action in {"create","edit"}:
                name = clean_names([request.name], "Smart album names")[0]
                if any(a["name"].casefold() == name.casefold() and a["id"] != request.id for a in albums):
                    raise ValueError("That smart album name is taken. Nothing was changed.")
                item = {"id":request.id if request.action == "edit" else uuid4().hex, "name":name, "filters":self.filters(request.filters.model_dump())}
                if request.action == "edit":
                    if at is None: raise ValueError("That smart album is no longer in the library.")
                    albums[at] = item
                else: albums.append(item)
            else: raise ValueError("That smart album command is not available.")
            if albums == before: return {"photos":[],"warnings":[],"undo_available":bool(self.marks._undo)}
            saved["smart_albums"] = albums; atomic_json(self.index.preferences_path, saved)
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

    def version(self):
        try:
            info=self.marks.database.stat()
            with self.marks.database.open("rb") as handle: header=handle.read(100)
            # SQLite's change counter catches rapid writes even if a filesystem
            # rounds timestamps. This database uses its existing rollback journal.
            return f"{info.st_ino}:{info.st_mtime_ns}:{info.st_size}:{header[24:28].hex()}"
        except FileNotFoundError: return "empty"

    def candidates(self, version=""):
        # SQLite writes are serialized by the existing backend ownership lock.
        # The stamp is sampled inside that lock, never before a transaction.
        with self.marks._lock, self._cache_lock:
            scope = getattr(self.marks,"membership",None)
            pins = scope.pins() if scope else []
            stamp = self.version() + (json.dumps(pins) if scope else "")
            if version == stamp: return {"version":stamp,"photos":None}
            if self._version == stamp: return {"version":stamp,"photos":deepcopy(self._snapshot)}
            photos=[]
            if self.marks.database.exists():
                db=self.marks._connect()
                try:
                    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    files=list(db.execute("SELECT path,bytes,mtime_ns,facts FROM files"))
                    paths=[r[0] for r in files]
                    states={p:json.loads(s) for p,s in db.execute("SELECT path,state FROM photo_grades")} if "photo_grades" in tables else {}
                    copies={p:json.loads(s) for p,s in db.execute("SELECT source,state FROM library_copies")} if "library_copies" in tables else {}
                    keys = paths + [p+"|copy|"+item["photo_id"] for p,state in copies.items() for item in (state.get("desired",[]) if state.get("pending") else state.get("baseline",[]))]
                    rows = self.marks._rows(keys)
                finally: db.close()
                def grade_status(key, fallback=None, default=None):
                    s=states.get(key,{})
                    grade=s.get("desired") if s.get("pending") else s.get("indexed_grade",s.get("baseline",fallback))
                    return {"edited":grade is not None and grade_key(grade)!=grade_key(s.get("default",default)), "grade_identity":identity(grade)}
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
    @router.get("/smart-candidates")
    def candidates(version:str=""):
        result=smart.candidates(version)
        return {**result,"indexing":index.status()["state"] not in {"idle","off"},"undo_available":bool(marks._undo),"unreadable_folders":[],"warnings":[]}
    return smart
