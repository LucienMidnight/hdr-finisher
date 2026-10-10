"""Culling commands: one database writer, atomic settings-only sidecars."""
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


class Marks(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: StrictInt = Field(default=0, ge=0, le=5)
    pick: Literal["unmarked", "pick", "reject"] = "unmarked"
    label: Literal["", "red", "orange", "green", "blue"] = ""
    tags: list[str] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values):
        result, seen = [], set()
        for value in values:
            tag = " ".join(value.split())
            if not tag or len(tag) > 120:
                raise ValueError("Tags must contain between 1 and 120 characters.")
            if tag.casefold() not in seen:
                seen.add(tag.casefold())
                result.append(tag)
        return result


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


class LibraryMarks:
    def __init__(self, root: Path):
        self.database = Path(root) / "library.sqlite3"
        self._lock = RLock()
        self._undo = deque(maxlen=100)

    def _connect(self):
        self.database.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.database)
        db.execute("CREATE TABLE IF NOT EXISTS photos (path TEXT PRIMARY KEY, photo_id TEXT NOT NULL, marks TEXT NOT NULL, pending INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS tags (tag TEXT PRIMARY KEY COLLATE NOCASE)")
        db.execute("CREATE TABLE IF NOT EXISTS photo_tags (path TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(path, tag))")
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
        return document

    def _rows(self, paths):
        if not self.database.exists():
            return {}
        db = self._connect()
        try:
            rows = {}
            for start in range(0, len(paths), 800):
                chunk = paths[start:start + 800]
                query = "SELECT path, photo_id, marks, pending FROM photos WHERE path IN (" + ",".join("?" for _ in chunk) + ")"
                for path, photo_id, marks, pending in db.execute(query, chunk):
                    rows[path] = {"path": path, "photo_id": photo_id, "marks": Marks.model_validate_json(marks).model_dump(), "storage": "database" if pending else "sidecar"}
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

    def read(self, values):
        """Rebuild visited sidecar records; unmarked browsing creates no files."""
        with self._lock:
            paths = [str(Path(value).resolve()) for value in values]
            cached = self._rows(paths)
            photos, warnings, rebuilt, removed = [], [], [], []
            for value in paths:
                path, row = Path(value), cached.get(value)
                invalid = False
                try:
                    document = self._document(path)
                except ValueError as error:
                    document = None
                    invalid = True
                    warnings.append(str(error))
                if row and row["storage"] == "database":
                    pass  # A failed sidecar write is retained across visits/restarts.
                elif document:
                    current = {"path": value, "photo_id": document["photo_id"], "marks": Marks.model_validate(document.get("marks", {})).model_dump(), "storage": "sidecar"}
                    if current != row:
                        rebuilt.append(current)
                    row = current
                elif row and not invalid:
                    removed.append(value)
                    row = None  # A removed sidecar clears the disposable index.
                photos.append(row or {"path": value, "photo_id": None, "marks": Marks().model_dump(), "storage": "none"})
            if rebuilt or removed:
                db = self._connect()
                try:
                    with db:
                        for row in rebuilt:
                            self._index(db, row)
                        for value in removed:
                            db.execute("DELETE FROM photos WHERE path = ?", (value,))
                            db.execute("DELETE FROM photo_tags WHERE path = ?", (value,))
                finally:
                    db.close()
            return {"photos": photos, "warnings": warnings, "undo_available": bool(self._undo)}

    def _write_sidecar(self, path, document):
        destination, temporary = self._sidecar(path), None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", prefix=f".{destination.name}.", suffix=".tmp", dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(document, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _save(self, rows, documents):
        # Commit every new mark to the index first. Interrupted/failed sidecar
        # writes remain pending, so a stale sidecar cannot discard the marks.
        db = self._connect()
        try:
            with db:
                for row in rows:
                    row["storage"] = "database"
                    self._index(db, row)
            warnings = []
            for row, document in zip(rows, documents):
                document["marks"] = deepcopy(row["marks"])
                try:
                    self._write_sidecar(Path(row["path"]), document)
                except OSError:
                    warnings.append(f"{Path(row['path']).name}: marks are kept in the library because its settings file cannot be written. They will not travel with the photo.")
                else:
                    row["storage"] = "sidecar"
                    with db:
                        self._index(db, row)
            return warnings
        finally:
            db.close()

    def change(self, values, change: MarkChange):
        with self._lock:
            paths = list(dict.fromkeys(str(self._path(value)) for value in values))
            documents = [self._document(Path(value)) for value in paths]  # Validate all before writing any.
            before = self.read(paths)["photos"]
            clear_label = change.toggle_label and all(row["marks"]["label"] == change.label for row in before)
            after, changed_documents = [], []
            originals = []
            for old, document in zip(before, documents):
                row = deepcopy(old)
                marks = row["marks"]
                for key in ("rating", "pick", "label"):
                    value = getattr(change, key)
                    if value is not None:
                        marks[key] = "" if key == "label" and clear_label else value
                if change.add_tag is not None and not any(tag.casefold() == change.add_tag.casefold() for tag in marks["tags"]):
                    marks["tags"].append(change.add_tag)
                if change.remove_tag is not None:
                    marks["tags"] = [tag for tag in marks["tags"] if tag.casefold() != change.remove_tag.casefold()]
                if marks == old["marks"]:
                    continue
                row["photo_id"] = row["photo_id"] or str(uuid4())
                document = document or {"format": "HDR Finisher Photo", "schema_version": 1, "photo_id": row["photo_id"], "source": {"filename": Path(row["path"]).name}, "contains_source_pixels": False}
                after.append(row); changed_documents.append(document); originals.append(deepcopy(old))
            warnings = self._save(after, changed_documents) if after else []
            if after:
                self._undo.append(originals)
            return {"photos": after, "warnings": warnings, "undo_available": bool(self._undo)}

    def undo(self):
        with self._lock:
            if not self._undo:
                return {"photos": [], "warnings": [], "undo_available": False}
            before = deepcopy(self._undo[-1])
            paths = [self._path(row["path"]) for row in before]
            documents = [self._document(path) for path in paths]
            current = self.read([str(path) for path in paths])["photos"]
            for row, now in zip(before, current):
                row["photo_id"] = now["photo_id"] or str(uuid4())
            documents = [document or {"format": "HDR Finisher Photo", "schema_version": 1, "photo_id": row["photo_id"], "source": {"filename": path.name}, "contains_source_pixels": False} for row, path, document in zip(before, paths, documents)]
            warnings = self._save(before, documents)
            self._undo.pop()
            return {"photos": before, "warnings": warnings, "undo_available": bool(self._undo)}

    def tags(self, query=""):
        with self._lock:
            if not self.database.exists():
                return []
            db = self._connect()
            try:
                rows = db.execute("SELECT tags.tag, COUNT(photo_tags.path) FROM tags LEFT JOIN photo_tags ON photo_tags.tag = tags.tag GROUP BY tags.tag ORDER BY COUNT(photo_tags.path) DESC, tags.tag COLLATE NOCASE")
                return [{"tag": tag, "count": count} for tag, count in rows if query.casefold() in tag.casefold()][:20]
            finally:
                db.close()
