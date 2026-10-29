"""Independent observer: stays alive even if the backend request thread stalls."""
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hdr_finisher.app_memory import process_tree
root=int(sys.argv[1])
while True:
    try:
        rows=process_tree(root)
        if not rows:break
        print(json.dumps(dict(at=time.time()*1000,processes=rows,totalBytes=sum(r['chargedBytes'] for r in rows),workingSetBytes=sum(r['workingSetBytes'] for r in rows))),flush=True)
        time.sleep(.5)
    except (ProcessLookupError,PermissionError):break
