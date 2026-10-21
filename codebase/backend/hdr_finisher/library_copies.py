"""Virtual item identities; one durable queue and one physical settings file."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4
from .library_marks import Marks, clean_names
from .models import EditDocument
from .projects import validate_saved_document
from .library_diagnostics import log, problem

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
            if item.get("grade") is not None: validate_saved_document(item["grade"])
        return deepcopy(items)

    def state(self, path):
        rows = self.marks._query("SELECT state FROM library_copies WHERE source=?", (source(path),))
        return json.loads(rows[0][0]) if rows else {}

    def put(self, db, path, state):
        db.execute("INSERT OR REPLACE INTO library_copies VALUES (?, ?)", (source(path), json.dumps(state)))

    def items(self, path, document=None, state=None, known=False):
        state = self.state(path) if state is None else state
        if state.get("pending"): return deepcopy(state["desired"])
        if not Path(source(path)).parent.exists(): return deepcopy(state.get("baseline",[]))
        if document is None and not known: document = self.marks._document(Path(source(path)))
        return self.validate(document)

    def document(self, value):
        physical = self.marks._document(Path(source(value))) or {}
        identifier = str(value).split(SEPARATOR, 1)[1]
        item = next((p for p in self.items(value, physical) if p["photo_id"] == identifier), None)
        if item is None: raise ValueError("That virtual copy is no longer available. Nothing was changed.")
        return {"format":"HDR Finisher Photo", "schema_version":1, **deepcopy(item),
                "grade_default": item.get("grade_default") or physical.get("grade_default")}

    def observe(self, path, document, state=None):
        if is_copy(path): return
        state = self.state(path) if state is None else state
        if state.get("pending"): return
        items = self.validate(document)
        # Every folder open reads every photo; write only what changed. One
        # write per photo per visit cost about 1.5 s on a 372-photo folder.
        if state == {"baseline": items}: return
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

    def queue(self, db, path, items, document, rename_only=()):
        state, actual = self.preflight(path,document)
        state.update(baseline=state.get("baseline",actual) if state.get("pending") else actual,desired=deepcopy(items),pending=True,rename_only=list(rename_only))
        self.put(db,path,state)

    def merge(self, path, document):
        state, actual = self.preflight(path, document)
        items = deepcopy(state["desired"]) if state.get("pending") else actual
        for item in items:
            self.marks.grades.merge_item(source(path)+SEPARATOR+item["photo_id"], item, include_history=item["photo_id"] not in state.get("rename_only", []))
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
        return self.commit_many({path: (items, document)}, finalize)

    def commit_many(self, changes, finalize=None, rename_only=()):
        rows, documents, before = [], [], {}
        for path, (items, document) in changes.items():
            self.preflight(path, document)
            before[path] = self.items(path, document)
            row = self.marks.read([path], documents=[document], canonical=True)["photos"][0]
            row["photo_id"] = row["photo_id"] or uuid4().hex
            row["storage"] = "database"
            rows.append(row); documents.append(document)
        def update(db):
            for path, (items, document) in changes.items():
                self.queue(db, path, items, document, rename_only)
                keys = {i["photo_id"] for i in items}
                for item in before[path]:
                    if item["photo_id"] not in keys:
                        for table in ("photos", "photo_tags", "album_photos"):
                            db.execute(f"DELETE FROM {table} WHERE path=?", (path+SEPARATOR+item["photo_id"],))
                for item in items: self.marks._index(db, self.row(path, item))
            if finalize: finalize(db)
        if rows: self.marks._save(rows, documents, update)

    def selection(self, values):
        keys = list(dict.fromkeys(str(self.marks._path(value)) for value in values))
        changes = {}
        for key in keys:
            path = source(key)
            if path not in changes:
                doc = self.marks._document(Path(path))
                self.preflight(path, doc)
                changes[path] = (self.items(path, doc), doc)
        return keys, changes

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
        return self.create_many([value], start, name, grade)

    def create_many(self, values, start="current", name="", grade=None):
        grades = self.marks.grades
        with grades.store._lock, self.marks._lock:
            if start not in ("current", "clean"): raise ValueError("Choose Current grade or Clean start.")
            if name: name = clean_names([name], "Copy names")[0]
            keys, changes = self.selection(values)
            made = []
            for key in keys:
                path = source(key); items, physical = changes[path]
                row = self.marks.read([path], documents=[physical], canonical=True)["photos"][0]
                document = self.marks._document(Path(key)) or {}
                state = grades._get(key)
                default = document.get("grade_default") or state.get("default")
                session = grades.history.current(key)
                current = session.edit_document().model_dump(mode="json") if session else state.get("desired") if state.get("pending") else document.get("grade")
                chosen = deepcopy(grade if grade is not None else current if start == "current" else default)
                if chosen is not None: EditDocument.model_validate(chosen)
                names = {i["name"] for i in items}; number = 1
                while f"Copy {number}" in names: number += 1
                item = {"photo_id":uuid4().hex, "name":name or f"Copy {number}", "marks":deepcopy(row["marks"]),
                        "albums":[], "grade":chosen, "grade_default":deepcopy(default)}
                items.append(item); made.append(self.row(path, item))
            self.commit_many(changes)
            if made:
                self.marks._undo.append({"command":lambda:self.remove_many([row["path"] for row in made], undo=False, skip_open=False)})
            for row in made:
                log("virtual_copy_created", photo=source(row["path"]), copy=row["photo_id"], start=start)
            return {"photos":made, "path":made[-1]["path"] if made else None, "count":len(made),
                    "warnings":[], "undo_available":bool(self.marks._undo), "copies_changed":bool(made)}

    def rename(self, value, name, undo=True, expected=None):
        grades = self.marks.grades
        with grades.store._lock, self.marks._lock:
            name = clean_names([name], "Copy names")[0]
            keys, changes = self.selection([value]); key = keys[0]; path = source(key)
            if not is_copy(key): raise ValueError("Select a virtual copy to rename.")
            items, doc = changes[path]
            item = next(i for i in items if i["photo_id"] == key.split(SEPARATOR,1)[1])
            old = item["name"]
            if expected is not None and old != expected: raise ValueError("The copy name changed since the rename; nothing was overwritten.")
            if old != name:
                item["name"] = name; self.commit_many(changes, rename_only=[item["photo_id"]])
                if undo: self.marks._undo.append({"command":lambda:self.rename(key, old, undo=False, expected=name)})
                log("virtual_copy_renamed", photo=path, copy=item["photo_id"])
            return {"photos":[self.row(path,item)], "warnings":[], "undo_available":bool(self.marks._undo), "copies_changed":old != name}

    def remove(self, value, undo=True):
        return self.remove_many([value], undo=undo, skip_open=False)

    def remove_many(self, values, undo=True, skip_open=True):
        grades = self.marks.grades
        with grades.store._lock, self.marks._lock:
            keys, changes = self.selection(values)
            removed, warnings = [], []
            for key in keys:
                if not is_copy(key): continue
                path = source(key); items, doc = changes[path]
                identifier = key.split(SEPARATOR,1)[1]
                position = next(i for i,p in enumerate(items) if p["photo_id"] == identifier)
                if grades.history.current(key):
                    if not skip_open: raise ValueError("Open another photo or copy before removing this virtual copy. Nothing was changed.")
                    warnings.append(f'Left "{items[position]["name"]}" of {Path(path).name}: it is open in Grade.')
                    continue
                removed.append((path, position, deepcopy(items[position])))
                items.pop(position)
            changed = {p:changes[p] for p,_,_ in removed}
            self.commit_many(changed)
            def restore():
                with grades.store._lock, self.marks._lock:
                    _, plans = self.selection(list(changed))
                    for path, position, item in reversed(removed):
                        items, doc = plans[path]
                        if any(i["photo_id"] == item["photo_id"] for i in items): raise ValueError("That copy already exists; nothing was overwritten.")
                        items.insert(min(position,len(items)), deepcopy(item))
                    self.commit_many(plans)
                    return {"photos":[self.row(p,i) for p,_,i in removed], "copies_changed":True}
            if undo and removed: self.marks._undo.append({"command":restore})
            for path, _, item in removed: log("virtual_copy_removed", photo=path, copy=item["photo_id"], action="photo untouched; removal undoable")
            return {"photos":[], "count":len(removed), "warnings":warnings, "undo_available":bool(self.marks._undo), "copies_changed":bool(removed)}

    def states(self, paths):
        states = {}
        for start in range(0, len(paths), 800):
            chunk = [source(p) for p in paths[start:start+800]]
            for path, value in self.marks._query("SELECT source, state FROM library_copies WHERE source IN (" + ",".join("?" for _ in chunk) + ")", chunk):
                states[path] = json.loads(value)
        return states

    def expand(self, photos, documents=None):
        """``documents``: settings already read in this request, by path."""
        output=[]
        documents = documents or {}
        states = self.states([photo["path"] for photo in photos if not is_copy(photo["path"])])
        for photo in photos:
            if is_copy(photo["path"]): output.append(photo); continue
            try: items=self.items(photo["path"], documents.get(photo["path"]), states.get(source(photo["path"]), {}), photo["path"] in documents)
            except ValueError as error:
                # One unreadable settings file must not blank the whole folder.
                problem("copies_read_failed",photo["path"],error,"copies hidden; settings left untouched"); items=[]
            photo["copy_count"]=len(items); output.append(photo)
            if not items: continue
            rows=self.marks._rows([photo["path"]+SEPARATOR+i["photo_id"] for i in items])
            for order,item in enumerate(items):
                key=photo["path"]+SEPARATOR+item["photo_id"]
                copy={**photo,**rows.get(key,self.row(photo["path"],item)),"source_path":photo["path"],"copy_id":item["photo_id"],"copy_order":order,
                      "name":photo["name"]+" · "+item["name"],"copy_name":item["name"],"copy_count":0}
                output.append(copy)
        return output
