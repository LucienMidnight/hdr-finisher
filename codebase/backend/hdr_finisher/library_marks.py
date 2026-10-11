"""Culling, tag and album commands: one database writer, atomic settings-only sidecars."""
from __future__ import annotations

from collections import deque
from copy import deepcopy
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from .desktop_security import SOURCE_EXTENSIONS
from .library_pictures import SIDECAR_SUFFIX
from .library_settings_writer import LibrarySettingsWriter


def clean_names(values, kind="Tags"):
    result, seen = [], set()
    for value in values:
        name = " ".join(value.split()) if isinstance(value, str) else ""
        if not name or len(name) > 120:
            raise ValueError(f"{kind} must contain between 1 and 120 characters.")
        if name.casefold() not in seen:
            seen.add(name.casefold())
            result.append(name)
    return result


class Marks(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: StrictInt = Field(default=0, ge=0, le=5)
    pick: Literal["unmarked", "pick", "reject"] = "unmarked"
    label: Literal["", "red", "orange", "green", "blue"] = ""
    tags: list[str] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values):
        return clean_names(values)


class MarkChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: StrictInt | None = Field(default=None, ge=0, le=5)
    pick: Literal["unmarked", "pick", "reject"] | None = None
    label: Literal["", "red", "orange", "green", "blue"] | None = None
    toggle_label: bool = False
    add_tag: str | None = None
    remove_tag: str | None = None

    @field_validator("add_tag", "remove_tag")
    @classmethod
    def clean_tag(cls, value):
        return None if value is None else Marks(tags=[value]).tags[0]


class NameTaken(ValueError):
    """The requested tag name is already in use; the caller may ask to merge."""


class LibraryMarks:
    def __init__(self, root: Path):
        self.database = Path(root) / "library.sqlite3"
        self._lock = RLock()
        self._schema_ready = False
        self._undo = deque(maxlen=100)
        self.writer = LibrarySettingsWriter(self)

    def _connect(self):
        existed = self.database.exists()
        if not self._schema_ready or not existed:
            self.database.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.database)
        if self._schema_ready and existed:
            return db
        db.execute("BEGIN")
        db.execute("CREATE TABLE IF NOT EXISTS photos (path TEXT PRIMARY KEY, photo_id TEXT NOT NULL, marks TEXT NOT NULL, pending INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS tags (tag TEXT PRIMARY KEY COLLATE NOCASE)")
        db.execute("CREATE TABLE IF NOT EXISTS photo_tags (path TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(path, tag))")
        db.execute("CREATE INDEX IF NOT EXISTS photo_tags_tag ON photo_tags (tag)")
        db.execute("CREATE TABLE IF NOT EXISTS albums (name TEXT PRIMARY KEY COLLATE NOCASE)")
        db.execute("CREATE TABLE IF NOT EXISTS album_photos (album TEXT NOT NULL COLLATE NOCASE, path TEXT NOT NULL, PRIMARY KEY(album, path))")
        db.execute("CREATE INDEX IF NOT EXISTS album_photos_path ON album_photos (path)")
        # File facts found by folder visits and background indexing (library_index).
        db.execute("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, bytes INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, facts TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS settings_writes (path TEXT PRIMARY KEY, revision TEXT NOT NULL, fingerprint TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL, next_try REAL NOT NULL, attempts INTEGER NOT NULL)")
        db.commit()
        self._schema_ready = True
        return db

    @staticmethod
    def _path(value):
        path = Path(value).expanduser().resolve(strict=True)
        if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
            raise ValueError("Select a supported photo to mark.")
        return path

    @staticmethod
    def _sidecar(path):
        return path.with_name(path.name + SIDECAR_SUFFIX)

    def _document(self, path):
        sidecar = self._sidecar(path)
        if sidecar.is_symlink():
            raise ValueError(f"Settings for {path.name} are a link; they were left untouched.")
        try:
            document = json.loads(sidecar.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as error:
            raise ValueError(f"Settings for {path.name} cannot be read; they were left untouched.") from error
        if not isinstance(document, dict) or document.get("format") != "HDR Finisher Photo" or document.get("schema_version") != 1:
            raise ValueError(f"Settings for {path.name} have an unsupported format; they were left untouched.")
        if not isinstance(document.get("photo_id"), str) or not document["photo_id"]:
            raise ValueError(f"Settings for {path.name} have no photo ID; they were left untouched.")
        Marks.model_validate(document.get("marks", {}))
        self._albums(document, path)
        return document

    def _documents(self, paths):
        # One directory read identifies absent settings without two failed file
        # opens per photo. Present files still receive full validation.
        folders = {}
        for value in paths:
            folder = Path(value).parent
            if folder not in folders:
                try:
                    folders[folder] = {entry.name for entry in folder.iterdir()}
                except OSError:
                    folders[folder] = None  # Individual checks retain their errors.
        return [self._document(Path(value)) if folders[Path(value).parent] is None
            or self._sidecar(Path(value)).name in folders[Path(value).parent] else None for value in paths]

    @staticmethod
    def _albums(document, path):
        try:
            values = document.get("albums", [])
            if not isinstance(values, list):
                raise ValueError("Albums must be a list.")
            return sorted(clean_names(values, "Album names"), key=str.casefold)
        except ValueError as error:
            raise ValueError(f"Settings for {path.name} have unreadable albums; they were left untouched.") from error

    def _rows(self, paths):
        if not self.database.exists():
            return {}
        db = self._connect()
        try:
            rows = {}
            for start in range(0, len(paths), 800):
                chunk = paths[start:start + 800]
                marker = ",".join("?" for _ in chunk)
                for path, photo_id, marks, pending in db.execute(f"SELECT path, photo_id, marks, pending FROM photos WHERE path IN ({marker})", chunk):
                    rows[path] = {"path": path, "photo_id": photo_id, "marks": Marks.model_validate_json(marks).model_dump(), "albums": [], "storage": "database" if pending else "sidecar"}
                for album, path in db.execute(f"SELECT album, path FROM album_photos WHERE path IN ({marker})", chunk):
                    if path in rows:
                        rows[path]["albums"].append(album)
            for start in range(0, len(paths), 800):
                chunk = paths[start:start + 800]
                marker = ",".join("?" for _ in chunk)
                for path, reason in db.execute(f"SELECT path, reason FROM settings_writes WHERE path IN ({marker})", chunk):
                    if path in rows and rows[path]["storage"] == "database":
                        rows[path]["write_reason"] = reason
            for row in rows.values():
                row["albums"].sort(key=str.casefold)
            return rows
        finally:
            db.close()

    @staticmethod
    def _index(db, row):
        db.execute("INSERT OR REPLACE INTO photos VALUES (?, ?, ?, ?)", (row["path"], row["photo_id"], json.dumps(row["marks"]), int(row["storage"] == "database")))
        db.execute("DELETE FROM photo_tags WHERE path = ?", (row["path"],))
        for tag in row["marks"]["tags"]:
            db.execute("INSERT OR IGNORE INTO tags VALUES (?)", (tag,))
            db.execute("INSERT INTO photo_tags VALUES (?, ?)", (row["path"], tag))
        db.execute("DELETE FROM album_photos WHERE path = ?", (row["path"],))
        for album in row["albums"]:
            db.execute("INSERT OR IGNORE INTO albums VALUES (?)", (album,))
            db.execute("INSERT OR IGNORE INTO album_photos VALUES (?, ?)", (album, row["path"]))

    def read(self, values, *, documents=None, canonical=False):
        """Rebuild visited sidecar records; unmarked browsing creates no files."""
        with self._lock:
            paths = [str(value) for value in values] if canonical else [str(Path(value).resolve()) for value in values]
            cached = self._rows(paths)
            photos, warnings, rebuilt, removed = [], [], [], []
            for position, value in enumerate(paths):
                path, row = Path(value), cached.get(value)
                invalid = False
                try:
                    document = documents[position] if documents is not None else self._document(path)
                except ValueError as error:
                    document = None
                    invalid = True
                    warnings.append(str(error))
                if row and row["storage"] == "database":
                    pass  # A failed sidecar write is retained across visits/restarts.
                elif document:
                    current = {"path": value, "photo_id": document["photo_id"], "marks": Marks.model_validate(document.get("marks", {})).model_dump(), "albums": self._albums(document, path), "storage": "sidecar"}
                    if current != row:
                        rebuilt.append(current)
                    row = current
                elif row and not invalid:
                    removed.append(value)
                    row = None  # A removed sidecar clears the disposable index.
                photos.append(row or {"path": value, "photo_id": None, "marks": Marks().model_dump(), "albums": [], "storage": "none"})
            if rebuilt or removed:
                db = self._connect()
                try:
                    with db:
                        for row in rebuilt:
                            self._index(db, row)
                        for value in removed:
                            db.execute("DELETE FROM photos WHERE path = ?", (value,))
                            db.execute("DELETE FROM photo_tags WHERE path = ?", (value,))
                            db.execute("DELETE FROM album_photos WHERE path = ?", (value,))
                finally:
                    db.close()
            return {"photos": photos, "warnings": warnings, "undo_available": bool(self._undo)}

    def _write_sidecar(self, path, document, *, revision=None, fingerprint=None, owner_id=None):
        destination, temporary = self._sidecar(path), None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", prefix=f".hdrf-settings.{destination.name}.{self.writer.owner(owner_id or document['photo_id'])}.", suffix=".tmp", dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(document, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            # Slow preparation runs without the marks lock. Recheck immediately
            # before replacement: Undo or a newer command supersedes this file.
            with self._lock:
                if revision is not None and not self.writer.is_current(str(path), revision):
                    return False
                if fingerprint is not None and self.writer.fingerprint(self._document(path)) != fingerprint:
                    return False  # External edit during preparation; reread next pass.
                os.replace(temporary, destination)
                if revision is not None:
                    self.writer.acknowledge(str(path))
            return True
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _save(self, rows, documents, finalize=None):
        # The pending flag is the durable queue; there is no command journal.
        db = self._connect()
        try:
            with db:
                for row, document in zip(rows, documents):
                    path = Path(row["path"])
                    if row["storage"] == "none" and not self._sidecar(path).exists():
                        # Undo before the first write must not create an empty file.
                        for table in ("photos", "photo_tags", "album_photos", "settings_writes"):
                            db.execute(f"DELETE FROM {table} WHERE path = ?", (row["path"],))
                        row["photo_id"] = None
                        row.pop("write_reason", None)
                        continue
                    row["storage"] = "database"
                    row["write_reason"] = ""
                    self._index(db, row)
                    self.writer.enqueue(db, row, document)
                if finalize is not None:
                    finalize(db)
            self.writer.wake()
            return []
        finally:
            db.close()

    @staticmethod
    def _new_document(row):
        return {"format": "HDR Finisher Photo", "schema_version": 1, "photo_id": row["photo_id"], "source": {"filename": Path(row["path"]).name}, "contains_source_pixels": False}

    def _apply(self, paths, mutate, finalize=None):
        """Validate every settings file, then save only the photos mutate() changes."""
        documents = self._documents(paths)  # Validate all before accepting any change.
        before = self.read(paths, documents=documents, canonical=True)["photos"]
        after, changed_documents, originals = [], [], []
        for old, document in zip(before, documents):
            row = deepcopy(old)
            mutate(row)
            if row["marks"] == old["marks"] and row["albums"] == old["albums"]:
                continue
            row["albums"].sort(key=str.casefold)
            row["photo_id"] = row["photo_id"] or str(uuid4())
            row["storage"] = "database"
            after.append(row); changed_documents.append(document); originals.append(deepcopy(old))
        warnings = self._save(after, changed_documents, finalize) if after or finalize else []
        return after, originals, warnings

    def _result(self, photos, warnings, **extra):
        return {"photos": photos, "warnings": warnings, "undo_available": bool(self._undo), **extra}

    def change(self, values, change: MarkChange):
        with self._lock:
            paths = list(dict.fromkeys(str(self._path(value)) for value in values))
            clear_label = change.toggle_label and all(row["marks"]["label"] == change.label for row in self.read(paths, canonical=True)["photos"])

            def mutate(row):
                marks = row["marks"]
                for key in ("rating", "pick", "label"):
                    value = getattr(change, key)
                    if value is not None:
                        marks[key] = "" if key == "label" and clear_label else value
                if change.add_tag is not None and not any(tag.casefold() == change.add_tag.casefold() for tag in marks["tags"]):
                    marks["tags"].append(change.add_tag)
                if change.remove_tag is not None:
                    marks["tags"] = [tag for tag in marks["tags"] if tag.casefold() != change.remove_tag.casefold()]

            after, originals, warnings = self._apply(paths, mutate)
            if after:
                self._undo.append({"rows": originals})
            return self._result(after, warnings)

    def undo(self):
        with self._lock:
            if not self._undo:
                return self._result([], [])
            entry = self._undo[-1]
            before = deepcopy(entry["rows"])
            restored, paths, skipped = [], [], 0
            for row in before:
                try:
                    path = self._path(row["path"])
                except (FileNotFoundError, OSError):
                    skipped += 1
                    continue
                paths.append(str(path))
                restored.append(row)
            documents = self._documents(paths)
            current = self._rows(paths)
            for row in restored:
                row["photo_id"] = current.get(row["path"], {}).get("photo_id") or str(uuid4())
            def finalize(db):
                if "tags" in entry:
                    for table in ("tags", "albums"):
                        db.execute(f"DELETE FROM {table}")
                        db.executemany(f"INSERT OR IGNORE INTO {table} VALUES (?)", [(name,) for name in entry[table]])
            warnings = self._save(restored, documents, finalize)
            if skipped:
                warnings.append(f"Undid the change on {len(restored)} photos; {skipped} photos could no longer be found and were skipped.")
            before = restored
            self._undo.pop()
            return self._result(before, warnings, skipped=skipped)

    def tags(self, query="", limit=20):
        with self._lock:
            if not self.database.exists():
                return []
            db = self._connect()
            try:
                rows = db.execute("SELECT tags.tag, COUNT(photo_tags.path) FROM tags LEFT JOIN photo_tags ON photo_tags.tag = tags.tag GROUP BY tags.tag ORDER BY COUNT(photo_tags.path) DESC, tags.tag COLLATE NOCASE")
                return [{"tag": tag, "count": count} for tag, count in rows if query.casefold() in tag.casefold()][:limit]
            finally:
                db.close()

    # Library-wide tag and album commands. Each is one undo step.

    def _query(self, statement, arguments=()):
        if not self.database.exists():
            return []
        db = self._connect()
        try:
            return db.execute(statement, arguments).fetchall()
        finally:
            db.close()

    def _lists(self):
        return {"tags": [row[0] for row in self._query("SELECT tag FROM tags")], "albums": [row[0] for row in self._query("SELECT name FROM albums")]}

    def _carriers(self, table, column, names):
        """Connected photos carrying any of the names, and how many are not connected."""
        found = []
        for name in names:
            found.extend(row[0] for row in self._query(f"SELECT path FROM {table} WHERE {column} = ?", (name,)))
        paths = list(dict.fromkeys(found))
        present = [path for path in paths if Path(path).is_file()]
        return present, len(paths) - len(present)

    def _rename_everywhere(self, kind, olds, new):
        """Replace names on every connected photo; new=None removes them."""
        table, column, list_table, list_column = ("photo_tags", "tag", "tags", "tag") if kind == "tag" else ("album_photos", "album", "albums", "name")
        lists = self._lists()
        paths, offline = self._carriers(table, column, olds)
        keys = {name.casefold() for name in olds}
        if new is not None and new.casefold() not in keys:
            # Merging into an existing name keeps the spelling photos already carry.
            new = next((name for name in lists[list_table] if name.casefold() == new.casefold()), new)

        def mutate(row):
            names = row["marks"]["tags"] if kind == "tag" else row["albums"]
            if not any(name.casefold() in keys for name in names):
                return
            kept = [name for name in names if name.casefold() not in keys]
            if new is not None and not any(name.casefold() == new.casefold() for name in kept):
                kept.append(new)
            names[:] = kept

        def finalize(db):
            for old in olds:
                db.execute(f"DELETE FROM {list_table} WHERE {list_column} = ? AND NOT EXISTS (SELECT 1 FROM {table} WHERE {column} = ?)", (old, old))
            if new is not None:
                db.execute(f"INSERT OR IGNORE INTO {list_table} VALUES (?)", (new,))
                db.execute(f"UPDATE {list_table} SET {list_column} = ? WHERE {list_column} = ?", (new, new))
        after, originals, warnings = self._apply(paths, mutate, finalize)
        if offline:
            warnings.append(f"{offline} photos on folders that are not connected were not changed.")
        self._undo.append({"rows": originals, **lists})
        return self._result(after, warnings, changed=len(after), offline=offline)

    def _exists(self, kind, name):
        table, column = ("tags", "tag") if kind == "tag" else ("albums", "name")
        return bool(self._query(f"SELECT 1 FROM {table} WHERE {column} = ?", (name,)))

    def _create(self, kind, name):
        lists = self._lists()
        db = self._connect()
        try:
            with db:
                db.execute(f"INSERT INTO {'tags' if kind == 'tag' else 'albums'} VALUES (?)", (name,))
        finally:
            db.close()
        return lists

    def tag_create(self, value):
        with self._lock:
            tag = clean_names([value])[0]
            if self._exists("tag", tag):
                raise ValueError("That tag already exists.")
            self._undo.append({"rows": [], **self._create("tag", tag)})
            return self._result([], [], changed=0, offline=0)

    def tag_rename(self, old, new, merge=False):
        with self._lock:
            old, new = clean_names([old])[0], clean_names([new])[0]
            if not self._exists("tag", old):
                raise ValueError("That tag is no longer in the library.")
            if old.casefold() != new.casefold() and self._exists("tag", new) and not merge:
                raise NameTaken(f"A tag named {new} already exists.")
            return self._rename_everywhere("tag", [old], new)

    def tag_merge(self, values, into):
        with self._lock:
            into = clean_names([into])[0]
            olds = [tag for tag in clean_names(values) if tag.casefold() != into.casefold()]
            if not olds:
                raise ValueError("Select at least two tags to merge.")
            return self._rename_everywhere("tag", olds, into)

    def tag_remove(self, values):
        with self._lock:
            return self._rename_everywhere("tag", clean_names(values), None)

    def tag_paths(self, value):
        with self._lock:
            return [row[0] for row in self._query("SELECT path FROM photo_tags WHERE tag = ?", (value,))]

    def albums(self):
        with self._lock:
            rows = self._query("SELECT albums.name, COUNT(album_photos.path) FROM albums LEFT JOIN album_photos ON album_photos.album = albums.name GROUP BY albums.name ORDER BY albums.name COLLATE NOCASE")
            return [{"name": name, "count": count} for name, count in rows]

    def album_paths(self, value):
        with self._lock:
            return [row[0] for row in self._query("SELECT path FROM album_photos WHERE album = ?", (value,))]

    def _album_members(self, name, values, add):
        paths = list(dict.fromkeys(str(self._path(value)) for value in values))

        def mutate(row):
            kept = [album for album in row["albums"] if album.casefold() != name.casefold()]
            row["albums"] = [*kept, name] if add else kept

        return self._apply(paths, mutate)

    def album_create(self, value, paths=()):
        with self._lock:
            name = clean_names([value], "Album names")[0]
            if self._exists("album", name):
                raise ValueError("An album with that name already exists. Nothing was created.")
            lists = self._lists()
            # Validate the photos before the album appears.
            after, originals, warnings = self._album_members(name, paths, True)
            if not after:
                self._create("album", name)
            self._undo.append({"rows": originals, **lists})
            return self._result(after, warnings, changed=len(after))

    def album_change(self, value, paths, add):
        with self._lock:
            name = clean_names([value], "Album names")[0]
            stored = self._query("SELECT name FROM albums WHERE name = ?", (name,))
            if not stored:
                raise ValueError("That album is no longer in the library.")
            after, originals, warnings = self._album_members(stored[0][0], paths, add)
            if after:
                self._undo.append({"rows": originals})
            return self._result(after, warnings, changed=len(after))

    def album_rename(self, old, new):
        with self._lock:
            old, new = clean_names([old], "Album names")[0], clean_names([new], "Album names")[0]
            if not self._exists("album", old):
                raise ValueError("That album is no longer in the library.")
            if old.casefold() != new.casefold() and self._exists("album", new):
                raise ValueError("An album with that name already exists. Nothing was renamed.")
            return self._rename_everywhere("album", [old], new)

    def album_delete(self, value):
        with self._lock:
            return self._rename_everywhere("album", clean_names([value], "Album names"), None)
