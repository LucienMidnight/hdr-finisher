"""Read-only saved-grade scan: no Library services, decodes, or writes."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import sys
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from hdr_finisher.models import EditDocument
from hdr_finisher.projects import validate_saved
from hdr_finisher.saved_grades import notice

def scan(profile, projects=()):
    profile=Path(profile)
    dbpath=profile/"library.sqlite3"
    paths=set(); pending={}; database_grades=[]
    if dbpath.exists():
        db=sqlite3.connect(dbpath.as_uri()+"?mode=ro",uri=True)
        try:
            paths.update(path.split("|copy|",1)[0] for path, in db.execute("SELECT path FROM files"))
            paths.update(path.split("|copy|",1)[0] for path, in db.execute("SELECT path FROM photos"))
            for path, state in db.execute("SELECT path,state FROM photo_grades"):
                state=json.loads(state)
                if state.get("pending"): pending[path]=state.get("desired")
                if state.get("recovery") and not state.get("pending"): database_grades.append((path,state["recovery"]))
        finally: db.close()
    sidecars=set()
    project_paths={Path(p) for p in projects}
    # One directory listing per indexed folder, rather than 150,000 stats.
    for parent in {Path(p).parent for p in paths}:
        if parent.is_dir():
            sidecars.update(parent.glob("*.hdrf"))
            project_paths.update(parent.glob("*.hdrfinisher"))
    notices={}; reasons=Counter(); history=0; scanned=0; unreadable=0; changed=[]
    def grade(key, raw, historical=False):
        nonlocal history
        if raw is None:return
        report=notice(validate_saved(EditDocument,raw))
        if report:
            if historical: history+=1; return
            notices[key]=report
            reasons.update(set(i["section"] for i in report["issues"]))
    for file in sorted(sidecars|project_paths):
        if not file.is_file():continue
        before=file.read_bytes(); digest=sha256(before).digest(); scanned+=1
        try:
            if file.suffix.lower()==".hdrfinisher":
                with zipfile.ZipFile(file) as archive: raw=json.loads(archive.read("edit-state.json"))
                grade(str(file),raw)
            else:
                doc=json.loads(before); key=str(file)[:-5]
                grade(key,pending.get(key,doc.get("grade")))
                for item in doc.get("virtual_copies",[]):
                    copy_key=key+"|copy|"+item["photo_id"]
                    grade(copy_key,pending.get(copy_key,item.get("grade")))
                    for raw in item.get("grade_history",{}).values():
                        if isinstance(raw,dict):grade(copy_key,raw,True)
                for raw in doc.get("grade_history",{}).values():
                    if isinstance(raw,dict):grade(key,raw,True)
        except (ValueError,KeyError,OSError,zipfile.BadZipFile):
            unreadable+=1
        if sha256(file.read_bytes()).digest()!=digest:changed.append(str(file))
    for key,raw in pending.items():
        if raw is not None and key not in notices:grade(key,raw)
    for key,raw in database_grades:grade(key,raw,True)
    return dict(indexed_photos=len(paths),settings_and_projects=scanned,
                photo_items_with_notices=len([p for p in notices if not p.endswith(".hdrfinisher")]),
                projects_with_notices=len([p for p in notices if p.endswith(".hdrfinisher")]),
                reasons=dict(reasons),historical_notices=history,unreadable_files=unreadable,
                changed_during_scan=changed,notices=notices)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile",required=True,type=Path)
    parser.add_argument("--project",action="append",default=[],type=Path)
    parser.add_argument("--details",action="store_true")
    args=parser.parse_args()
    result=scan(args.profile,args.project)
    if not args.details:result.pop("notices")
    print(json.dumps(result,indent=2))
