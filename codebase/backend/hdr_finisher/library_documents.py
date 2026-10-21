"""Shared document identity, atomic writes and latest saved/pending grades."""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from .library_grades import grade_key


def identity(grade):
    return sha256(json.dumps(grade_key(grade),sort_keys=True,separators=(",",":")).encode()).hexdigest()


def atomic_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with NamedTemporaryFile(dir=path.parent,suffix=".tmp",delete=False) as f:
        temp=Path(f.name);f.write(json.dumps(value,ensure_ascii=False).encode());f.flush();os.fsync(f.fileno())
    try: os.replace(temp,path)
    finally: temp.unlink(missing_ok=True)


class LibraryDocuments:
    def __init__(self, marks):
        self.marks = marks

    def request(self, path):
        path=str(self.marks._path(path))
        with self.marks._lock:
            state=self.marks.grades._get(path);doc=self.marks._document(Path(path)) or {}
            grade=state.get("desired") if state.get("pending") else doc.get("grade")
            default=doc.get("grade_default") or state.get("default")
            return {"path":path,"grade":deepcopy(grade),"grade_identity":identity(grade),
                "edited":grade is not None and grade_key(grade)!=grade_key(default)}
