"""Virtual item identities; one durable queue and one physical settings file."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4
from .library_marks import Marks, clean_names
from .models import EditDocument
from .library_diagnostics import log

SEPARATOR = "|copy|"

def source(value):
    return str(value).split(SEPARATOR, 1)[0]

def is_copy(value):
    return SEPARATOR in str(value)

class LibraryCopies:
    def __init__(self, marks):
        self.marks = marks
        marks.copies = self
        db = marks._connect()
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS library_copies (source TEXT PRIMARY KEY, state TEXT NOT NULL)")
        db.close()

    @staticmethod
    def validate(document):
        items = (document or {}).get("virtual_copies", [])
        if not isinstance(items, list): raise ValueError("Virtual copies cannot be read; settings were left untouched.")
        ids = set()
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("photo_id"), str) or not item["photo_id"] or item["photo_id"] in ids:
                raise ValueError("Virtual copy IDs cannot be read; settings were left untouched.")
            if SEPARATOR in item["photo_id"] or any(c in item["photo_id"] for c in '/\\'):
                raise ValueError("Virtual copy IDs cannot be read; settings were left untouched.")
            ids.add(item["photo_id"])
            clean_names([item.get("name", "")], "Copy names")
            Marks.model_validate(item.get("marks", {}))
            if not isinstance(item.get("albums",[]),list): raise ValueError("Virtual copy albums cannot be read; settings were left untouched.")
            clean_names(item.get("albums", []), "Album names")
            if item.get("grade") is not None: EditDocument.model_validate(item["grade"])
        return deepcopy(items)

    def state(self, path):
        rows = self.marks._query("SELECT state FROM library_copies WHERE source=?", (source(path),))
        return json.loads(rows[0][0]) if rows else {}

    def put(self, db, path, state):
        db.execute("INSERT OR REPLACE INTO library_copies VALUES (?, ?)", (source(path), json.dumps(state)))

    def items(self, path, document=None):
        state = self.state(path)
        if state.get("pending"): return deepcopy(state["desired"])
        if not Path(source(path)).parent.exists(): return deepcopy(state.get("baseline",[]))
        if document is None: document = self.marks._document(Path(source(path)))
        return self.validate(document)

    def document(self, value):
        physical = self.marks._document(Path(source(value))) or {}
        identifier = str(value).split(SEPARATOR, 1)[1]
        item = next((p for p in self.items(value, physical) if p["photo_id"] == identifier), None)
        if item is None: raise ValueError("That virtual copy is no longer available. Nothing was changed.")
        return {"format":"HDR Finisher Photo", "schema_version":1, **deepcopy(item),
                "grade_default": item.get("grade_default") or physical.get("grade_default")}

    def observe(self, path, document):
        if is_copy(path): return
        state = self.state(path)
        if state.get("pending"): return
        items = self.validate(document)
        db = self.marks._connect()
        try:
            with db:
                self.put(db, path, {"baseline":items})
                prefix = str(path)+SEPARATOR
                current = {prefix+i["photo_id"] for i in items}
                old = [r[0] for r in db.execute("SELECT path FROM photos WHERE substr(path,1,?)=?", (len(prefix),prefix))]
                for key in set(old)-current:
                    for table in ("photos", "photo_tags", "album_photos"):
                        db.execute(f"DELETE FROM {table} WHERE path=?", (key,))
                for item in items:
                    self.marks._index(db, self.row(path,item,"sidecar"))
        finally: db.close()
        if getattr(self.marks,"grades",None):
            self.marks.grades.observe_documents([str(path)+SEPARATOR+i["photo_id"] for i in items], items)

    @staticmethod
    def row(path, item, storage="database"):
        return {"path":source(path)+SEPARATOR+item["photo_id"],"photo_id":item["photo_id"],
                "marks":Marks.model_validate(item.get("marks",{})).model_dump(),"albums":item.get("albums",[]),"storage":storage}

    def preflight(self, path, document):
        state = self.state(path); actual = self.validate(document)
        if not Path(source(path)).parent.exists(): actual=deepcopy(state.get("baseline",[]))
        if state.get("pending") and actual != state.get("baseline",[]):
            raise ValueError("Virtual copies changed elsewhere. Both versions are kept; settings were left untouched.")
        return state, actual

    def queue(self, db, path, items, document):
        state, actual = self.preflight(path,document)
        state.update(baseline=state.get("baseline",actual) if state.get("pending") else actual,desired=deepcopy(items),pending=True)
        self.put(db,path,state)

    def merge(self, path, document):
        state, actual = self.preflight(path, document)
        items = deepcopy(state["desired"]) if state.get("pending") else actual
        for item in items:
            self.marks.grades.merge_item(source(path)+SEPARATOR+item["photo_id"], item)
        if items or "virtual_copies" in document: document["virtual_copies"] = items
        return document

    def acknowledge(self, path, document):
        items = self.validate(document)
        db = self.marks._connect()
        try:
            with db:
                self.put(db,path,{"baseline":items,"pending":False})
                for item in items: self.marks._index(db,self.row(path,item,"sidecar"))
        finally: db.close()
        for item in items: self.marks.grades.acknowledge_item(source(path)+SEPARATOR+item["photo_id"],item)

    def commit(self, path, items, document, finalize=None):
        row = self.marks.read([path],documents=[document],canonical=True)["photos"][0]
        row["photo_id"] = row["photo_id"] or uuid4().hex; row["storage"]="database"
        before = self.items(path,document)
        def update(db):
            self.queue(db,path,items,document)
            keys={i["photo_id"] for i in items}
            for item in before:
                if item["photo_id"] not in keys:
                    for table in ("photos","photo_tags","album_photos"):
                        db.execute(f"DELETE FROM {table} WHERE path=?",(path+SEPARATOR+item["photo_id"],))
            for item in items: self.marks._index(db,self.row(path,item))
            if finalize: finalize(db)
        self.marks._save([row],[document],update)

    def save_rows(self, rows, documents, finalize):
        """Translate virtual mark/grade rows into the physical writer transaction."""
        physical = {}; updates = {}; virtual = []
        for row, document in zip(rows, documents):
            path=source(row["path"])
            if not is_copy(row["path"]): physical[path]=(row,document); continue
            virtual.append(row)
            if path not in updates:
                doc=self.marks._document(Path(path)); self.preflight(path,doc)
                updates[path]=(self.items(path,doc),doc)
            items,doc=updates[path]
            item=next(i for i in items if i["photo_id"]==row["photo_id"])
            item.update(marks=deepcopy(row["marks"]),albums=deepcopy(row["albums"]))
            if path not in physical:
                original=self.marks.read([path],documents=[doc],canonical=True)["photos"][0]
                original["photo_id"]=original["photo_id"] or uuid4().hex; original["storage"]="database"
                physical[path]=(original,doc)
        def update(db):
            for path,(items,doc) in updates.items(): self.queue(db,path,items,doc)
            for row in virtual:
                row["storage"]="database";self.marks._index(db,row)
            if finalize: finalize(db)
        return self.marks._save([v[0] for v in physical.values()],[v[1] for v in physical.values()],update)

    def create(self, value, start="current", name="", grade=None):
        grades=self.marks.grades
        with grades.store._lock,self.marks._lock:
            key=str(self.marks._path(value)); path=source(key)
            physical=self.marks._document(Path(path)); self.preflight(path,physical)
            row=self.marks.read([path],canonical=True)["photos"][0]
            document=self.marks._document(Path(key)) or {}
            items=self.items(path,physical); default=document.get("grade_default") or grades._get(key).get("default")
            if start not in ("current","clean"): raise ValueError("Choose Current grade or Clean start.")
            session=grades.history.current(key)
            current=session.edit_document().model_dump(mode="json") if session else grades._get(key).get("desired") if grades._get(key).get("pending") else document.get("grade")
            chosen=deepcopy(grade if grade is not None else current if start=="current" else default)
            if chosen is not None: EditDocument.model_validate(chosen)
            names={i["name"] for i in items}; number=1
            while f"Copy {number}" in names: number+=1
            name=clean_names([name or f"Copy {number}"],"Copy names")[0]
            item={"photo_id":uuid4().hex,"name":name,"marks":deepcopy(row["marks"]),"albums":[],"grade":chosen,"grade_default":deepcopy(default)}
            items.append(item); self.commit(path,items,physical)
            copy_key=path+SEPARATOR+item["photo_id"]
            self.marks._undo.append({"command":lambda:self.remove(copy_key,undo=False)})
            if getattr(self.marks,"kept",None): self.marks.kept.schedule(copy_key,chosen)
            log("virtual_copy_created",photo=path,copy=item["photo_id"],start=start)
            return {"photos":[self.row(path,item)],"path":copy_key,"warnings":[],"undo_available":True,"copies_changed":True}

    def remove(self, value, undo=True):
        grades=self.marks.grades
        with grades.store._lock,self.marks._lock:
            key=str(self.marks._path(value)); path=source(key)
            if not is_copy(key): raise ValueError("Select a virtual copy to remove.")
            if grades.history.current(key): raise ValueError("Open another photo or copy before removing this virtual copy. Nothing was changed.")
            doc=self.marks._document(Path(path)); self.preflight(path,doc)
            items=self.items(path,doc); identifier=key.split(SEPARATOR,1)[1]
            position=next(i for i,p in enumerate(items) if p["photo_id"]==identifier); removed=items.pop(position)
            self.commit(path,items,doc)
            def restore():
                document=self.marks._document(Path(path)); self.preflight(path,document)
                current=self.items(path,document)
                if any(i["photo_id"]==identifier for i in current): raise ValueError("That copy already exists; nothing was overwritten.")
                current.insert(min(position,len(current)),deepcopy(removed)); self.commit(path,current,document)
                return {"photos":[self.row(path,removed)],"copies_changed":True}
            if undo: self.marks._undo.append({"command":restore})
            log("virtual_copy_removed",photo=path,copy=identifier,action="photo untouched; removal undoable")
            return {"photos":[],"warnings":[],"undo_available":bool(self.marks._undo),"copies_changed":True}

    def expand(self, photos):
        output=[]
        for photo in photos:
            if is_copy(photo["path"]): output.append(photo); continue
            items=self.items(photo["path"]); photo["copy_count"]=len(items); output.append(photo)
            rows=self.marks._rows([photo["path"]+SEPARATOR+i["photo_id"] for i in items])
            for order,item in enumerate(items):
                key=photo["path"]+SEPARATOR+item["photo_id"]
                copy={**photo,**rows.get(key,self.row(photo["path"],item)),"source_path":photo["path"],"copy_id":item["photo_id"],"copy_order":order,
                      "name":photo["name"]+" · "+item["name"],"copy_name":item["name"],"copy_count":0}
                state=self.marks.kept.request(key)
                copy.update(edited=state["edited"],grade_identity=state["grade_identity"]);output.append(copy)
        return output
