"""Library scope: pins plus manual albums; detached pending work is never discarded."""
from collections import OrderedDict
from copy import deepcopy
import json
from hashlib import sha256
import os
from pathlib import Path
from .library_documents import atomic_json
from .library_copies import source

from .library_diagnostics import timed_lock


class LibraryMembership:
    def __init__(self, index):
        self.index, self.marks = index, index.marks
        self.path = Path(index.browser.root) / "kept-photos.json"
        self._busy = False
        self._saved = None
        self._saved_records = {}
        self.records = self.path.parent / "library-kept-records"
        self._observed = {}
        self.transient = OrderedDict()
        self.marks.membership = self
        self.restore()
        self.reconcile()

    def pins(self):
        browser = self.index.browser
        return [pin["path"] for pin in browser.pinned()]

    @staticmethod
    def under(path, folder):
        path, folder = os.path.normcase(source(path)), os.path.normcase(str(folder))
        return path.startswith(folder.rstrip("/\\") + os.sep)

    def pinned(self, path, pins=None):
        return any(self.under(path, pin) for pin in (self.pins() if pins is None else pins))

    def restore(self):
        # Only a missing database is rebuilt from this recovery list. Connected
        # sidecars are reconciled by the same reader as every other library photo.
        if self.marks.database.exists() or not self.path.exists():
            return
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        records = saved.pop("records")
        snapshots = {"albums":saved["albums"], "tags":saved["tags"]}
        for name in records:
            if len(name) != 64 or any(c not in "0123456789abcdef" for c in name):
                raise ValueError("The kept photo list cannot be read; it was left untouched.")
            record = json.loads((self.records / (name+".json")).read_text(encoding="utf-8"))
            for table, rows in record.items(): snapshots.setdefault(table,[]).extend(rows)
        db = self.marks._connect()
        try:
            with db:
                for table in ("photo_grades", "library_copies"):
                    if table in snapshots:
                        key = "source" if table == "library_copies" else "path"
                        db.execute(f"CREATE TABLE IF NOT EXISTS {table} ({key} TEXT PRIMARY KEY, state TEXT NOT NULL)")
                for table, rows in snapshots.items():
                    if table not in {"files", "photos", "tags", "photo_tags", "albums", "album_photos", "settings_writes", "photo_grades", "library_copies"}:
                        raise ValueError("The kept photo list cannot be read; it was left untouched.")
                    for row in rows:
                        db.execute(f"INSERT OR REPLACE INTO {table} VALUES ({','.join('?' for _ in row)})", row)
        finally:
            db.close()

    def impact(self, folder=None, album=None, paths=None):
        with self.marks._lock:
            pins = self.pins()
            remaining = [p for p in pins if os.path.normcase(p) != os.path.normcase(str(folder))] if folder else pins
            members = self.marks._query("SELECT album,path FROM album_photos")
            kept = {source(p) for a,p in members}
            if folder:
                affected = {p for (p,) in self.marks._query("SELECT path FROM files") if self.under(p, folder) and not self.pinned(p, remaining)}
                return {"leaving": len(affected-kept), "kept": len(affected & kept)}
            removed = set(paths) if paths is not None else {p for a,p in members if a.casefold() == album.casefold()}
            survivors = {source(p) for a,p in members if not (a.casefold() == album.casefold() and p in removed)}
            leaving = {source(p) for a,p in members if a.casefold() == album.casefold() and p in removed and not self.pinned(p, pins)} - survivors
            return {"leaving": len(leaving), "kept": 0}

    def reconcile(self):
        with timed_lock(self.marks._lock, "reconcile"):
            if self._busy or not self.marks.database.exists():
                return
            self._busy = True
            try:
                db = self.marks._connect()
                try:
                    pins = self.pins()
                    members = list(db.execute("SELECT album,path FROM album_photos"))
                    kept = {source(p) for _,p in members}
                    contains = lambda p: source(p) in kept or self.pinned(p, pins)
                    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    rows = list(db.execute("SELECT path,photo_id,marks,pending FROM photos"))
                    files = {r[0]: list(r) for r in db.execute("SELECT * FROM files")}
                    retained = {source(p) for p,_,_,pending in rows if pending}
                    if "photo_grades" in tables:
                        retained.update(source(p) for p,state in db.execute("SELECT path,state FROM photo_grades") if any(json.loads(state).get(k) for k in ("pending","recovery","conflict")) or "previous_grade" in json.loads(state))
                    if "library_copies" in tables:
                        retained.update(p for p,state in db.execute("SELECT source,state FROM library_copies") if json.loads(state).get("pending"))
                    with db:
                        # An album may be made from a temporarily browsed or offline photo.
                        for p in kept-files.keys():
                            try:
                                info = Path(p).stat(); size, modified = info.st_size, info.st_mtime_ns
                            except OSError:
                                size = modified = 0
                            db.execute("INSERT OR IGNORE INTO files VALUES (?,?,?,NULL)", (p,size,modified))
                        db.executemany("DELETE FROM files WHERE path=?", [(p,) for p in files if not contains(p)])
                        for p,identifier,marks,pending in rows:
                            if not contains(p):
                                db.execute("DELETE FROM photo_tags WHERE path=?", (p,))
                                # Grades, recovery and retained history remain in their durable
                                # table. Pending marks/album removals still use the existing writer.
                                if not pending and source(p) not in retained:
                                    self.remember([{"path":p,"photo_id":identifier,"marks":json.loads(marks),"albums":[],"storage":"sidecar"}])
                                    db.execute("DELETE FROM photos WHERE path=?", (p,))
                            else:
                                for tag in json.loads(marks).get("tags", []):
                                    db.execute("INSERT OR IGNORE INTO photo_tags VALUES (?,?)", (p,tag))
                    protected = kept | retained
                    snapshot = {}
                    for table in ("files", "photos", "tags", "photo_tags", "albums", "album_photos", "settings_writes", "photo_grades", "library_copies"):
                        if table not in tables:
                            continue
                        if table == "albums":
                            data = [list(r) for r in db.execute("SELECT * FROM albums ORDER BY name")]
                        elif table == "tags":
                            data = [list(r) for r in db.execute("SELECT * FROM tags ORDER BY tag")]
                        else:
                            column = "source" if table == "library_copies" else "path"
                            data = [list(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY {column}") if source(r[1] if table == "album_photos" else r[0]) in (kept if table == "files" else protected)]
                        snapshot[table] = data
                    records = {}
                    for table, data in snapshot.items():
                        if table in {"tags","albums"}: continue
                        for row in data:
                            key = source(row[1] if table == "album_photos" else row[0])
                            name = sha256(key.encode()).hexdigest()
                            records.setdefault(name,{}).setdefault(table,[]).append(row)
                    for name, record in records.items():
                        if record != self._saved_records.get(name):
                            atomic_json(self.records / (name+".json"),record)
                    manifest = {"records":sorted(records),"albums":snapshot.get("albums",[]),"tags":snapshot.get("tags",[])}
                    if manifest != self._saved:
                        atomic_json(self.path, manifest)
                        self._saved = manifest
                    for name in self._saved_records.keys()-records.keys():
                        (self.records / (name+".json")).unlink(missing_ok=True)
                    self._saved_records = records
                finally:
                    db.close()
            finally:
                self._busy = False

    def remember(self, photos):
        # Bounded session cache for temporary-folder Details, outside every
        # database query. Writer acknowledgments and sidecar reads refresh it.
        for photo in photos:
            self.transient[photo["path"]] = deepcopy(photo)
            self.transient.move_to_end(photo["path"])
        while len(self.transient) > 1000: self.transient.popitem(last=False)

    def status_rows(self, paths):
        rows = self.marks._rows(paths)
        for p in paths:
            if p not in rows:
                row = self.transient.get(p)
                if row is None: row = self.marks.read([p], canonical=True)["photos"][0]
                rows[p] = deepcopy(row)
        return list(rows.values())

    def describe(self, photos):
        pins = self.pins()
        kept = {source(p) for _,p in self.marks._query("SELECT album,path FROM album_photos")}
        for photo in photos:
            photo["kept_by_album"] = source(photo["path"]) in kept and not self.pinned(photo["path"], pins)

    def check(self, checks):
        # Exact-path helper batches: no unrelated folder walk and no picture decode.
        pins = self.pins()
        paths = sorted({source(p) for _,p in self.marks._query("SELECT album,path FROM album_photos") if not self.pinned(p, pins)})
        changed = False
        for start in range(0, len(paths), 200):
            self.index.wait_for_grade()
            result = checks._job("kept-check", paths=paths[start:start+200])
            refresh, read = [], []
            known = {p:(size,mtime) for p,size,mtime in self.marks._query("SELECT path,bytes,mtime_ns FROM files")}
            for item in result["photos"]:
                path = item["path"]
                if item.get("offline") or item.get("unreadable"):
                    continue
                stamp = (item.get("bytes"), item.get("mtime_ns"), item.get("settings"))
                if stamp == self._observed.get(path):
                    continue
                self._observed[path] = stamp
                changed = True
                with self.marks._lock:
                    if not self.marks._query("SELECT 1 FROM album_photos WHERE path=? OR substr(path,1,?)=?", (path,len(path)+6,path+"|copy|")):
                        continue
                    if item.get("missing"):
                        # A move/delete on a connected volume retires membership.
                        # Pending writes and all grade recovery remain protected.
                        db = self.marks._connect()
                        with db:
                            db.execute("DELETE FROM album_photos WHERE path=? OR substr(path,1,?)=?", (path,len(path)+6,path+"|copy|"))
                        db.close()
                    else:
                        read.append(path)
                if not item.get("missing") and known.get(path) != (item["bytes"], item["mtime_ns"]):
                    refresh.append(path)
            if read:
                self.index.wait_for_grade()
                self.marks.read(read)
            for at in range(0,len(refresh),32):
                self.index.wait_for_grade()
                self.index.remember_facts(checks._job("metadata", paths=refresh[at:at+32])["photos"])
            self.reconcile()
        self._observed = {p:v for p,v in self._observed.items() if p in paths}
        return changed
