"""Saved document helpers; obsolete picture preferences are removed next."""
from copy import deepcopy
from hashlib import sha256
import json, os
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from .library_grades import grade_key
from .library_pictures import LibraryPictureCache

_LOCK=RLock()
EDGES=(512,1024,1920)

def identity(grade):
    return sha256(json.dumps(grade_key(grade),sort_keys=True,separators=(",",":")).encode()).hexdigest()

def atomic_json(path, value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with NamedTemporaryFile(dir=path.parent,suffix=".tmp",delete=False) as f:
        temp=Path(f.name);f.write(json.dumps(value,ensure_ascii=False).encode());f.flush();os.fsync(f.fileno())
    try: os.replace(temp,path)
    finally: temp.unlink(missing_ok=True)

def preferences(root, change=None):
    path=Path(root)/"library-picture-preferences.json"
    with _LOCK:
        try: value=json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError: value={}
        if not isinstance(value,dict): raise ValueError("Library picture settings could not be read; nothing was changed.")
        if change is not None:
            if set(change)-{"edited_resolution","screen_edge"}: raise ValueError("Unknown Library picture setting.")
            candidate=value|change
            if candidate.get("edited_resolution","screen") not in (*EDGES,"screen"): raise ValueError("Choose Screen size, 512, 1024 or 1920 pixels.")
            if not isinstance(candidate.get("screen_edge",2560),int) or not 1280<=candidate.get("screen_edge",2560)<=2560:
                raise ValueError("Screen picture size must be between 1280 and 2560 pixels.")
            value=candidate;atomic_json(path,value)
        resolution=value.get("edited_resolution","screen");screen_edge=value.get("screen_edge",2560)
        return {"edited_resolution":resolution,"screen_edge":screen_edge,
            "edited_edge":screen_edge if resolution=="screen" else resolution}

class KeptPictures:
    def __init__(self,root,marks,worker):
        self.root=Path(root);self.marks=marks;self.cache=LibraryPictureCache(root)

    def request(self,path):
        path=str(self.marks._path(path))
        with self.marks._lock:
            state=self.marks.grades._get(path);doc=self.marks._document(Path(path)) or {}
            grade=state.get("desired") if state.get("pending") else doc.get("grade")
            default=doc.get("grade_default") or state.get("default")
            return {"path":path,"grade":deepcopy(grade),"grade_identity":identity(grade),
                "edited":grade is not None and grade_key(grade)!=grade_key(default),**preferences(self.root)}

    def usage(self):
        return preferences(self.root)|{"used_bytes":sum(p.stat().st_size for p in self.cache.root.glob("*") if p.is_file())}
