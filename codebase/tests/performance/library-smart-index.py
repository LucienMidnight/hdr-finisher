"""Disposable synthetic 50,000-photo index; no real photo folder is accessed."""
import json
from pathlib import Path
import sys
import tempfile
from time import perf_counter
from types import SimpleNamespace
from threading import RLock
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_smart_albums import SmartAlbums, SmartCommand
root=Path(tempfile.mkdtemp(prefix="smart-50000-",dir=Path(__file__).resolve().parents[2]/"output"))
marks=LibraryMarks(root/"app")
index=SimpleNamespace(preferences_path=root/"app"/"library-preferences.json",_state=RLock())
service=SmartAlbums(marks,index)
folder=root/"synthetic-photo-paths"
facts=json.dumps({"camera":"Trial camera","lens":"Trial lens","iso":800})
db=marks._connect()
with db:
    db.executemany("INSERT INTO files VALUES (?,?,?,?)",[(str(folder/f"photo-{i:05d}.jpg"),1000,1,facts) for i in range(50000)])
    db.executemany("INSERT INTO photos VALUES (?,?,?,0)",[(str(folder/f"photo-{i:05d}.jpg"),str(i),json.dumps({"rating":5,"pick":"pick","label":"green","tags":["Trial"]})) for i in range(0,50000,10)])
db.close()
service.command(SmartCommand(action="create",name="Trial picked",filters={"rules":[{"field":"pick","value":"pick"}]}))
start=perf_counter();snapshot=service.candidates();cold=(perf_counter()-start)*1000
start=perf_counter();service.candidates();warm=(perf_counter()-start)*1000
start=perf_counter();assert service.candidates(snapshot["version"])["photos"] is None;unchanged=(perf_counter()-start)*1000
start=perf_counter();payload=json.dumps(snapshot);serialize=(perf_counter()-start)*1000
(root/"candidates.json").write_text(payload,encoding="utf-8")
result={"photos":len(snapshot["photos"]),"backend_cold_ms":round(cold,2),"backend_warm_ms":round(warm,2),"unchanged_ms":round(unchanged,2),"json_ms":round(serialize,2),"json_bytes":len(payload.encode()),"candidates":str(root/"candidates.json"),"synthetic_index_only":True}
(root/"timing.json").write_text(json.dumps(result,indent=2),encoding="utf-8");print(json.dumps(result))
