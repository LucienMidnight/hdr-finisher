"""POSIX counterpart of the Windows diagnostic sampler; no GPU board counter."""
import json
from pathlib import Path
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hdr_finisher.app_memory import process_tree

while True:
    rows = process_tree(int(sys.argv[1]))
    if not rows:
        break
    print(json.dumps(dict(capturedAt=time.time() * 1000, boardSample=None,
                          processes=[dict(id=r['pid'], name=r.get('name', ''),
                                          workingSetBytes=r['workingSetBytes'],
                                          privateBytes=r.get('privateBytes'),
                                          chargedBytes=r.get('chargedBytes'), cpuSeconds=None) for r in rows])), flush=True)
    time.sleep(1)
