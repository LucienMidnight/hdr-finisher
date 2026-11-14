"""Independent observer: stays alive even if the backend request thread stalls."""
import json
import os
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hdr_finisher.app_memory import process_tree
from hdr_finisher.resource_preflight import detect_memory_resources
root=int(sys.argv[1])
while True:
    try:
        started=time.monotonic()
        retries=0
        try:
            rows=process_tree(root)
        except (ProcessLookupError,PermissionError):
            # Child processes can disappear during the OS walk. A second full
            # census may succeed; never fill a failed process with zero bytes.
            retries=1
            rows=process_tree(root)
        if not rows:break
        memory=detect_memory_resources()
        print(json.dumps(dict(censusRetries=retries,loadAverage=list(os.getloadavg()) if hasattr(os,"getloadavg") else None,availableBytes=memory.available_ram_bytes,totalRamBytes=memory.total_ram_bytes,systemReserveBytes=max(2_000_000_000,(memory.total_ram_bytes or 0)//10),at=time.time()*1000,processes=rows,totalBytes=sum(r['chargedBytes'] for r in rows),workingSetBytes=sum(r['workingSetBytes'] for r in rows))),flush=True)
        time.sleep(max(0, float(sys.argv[2])-(time.monotonic()-started)) if len(sys.argv) > 2 else .5)
    except (ProcessLookupError,PermissionError) as error:
        try:
            os.kill(root,0)
        except ProcessLookupError:
            break
        # A disappearing child must not silently end the rest of the census.
        # Retain the failure (the harness fails memory qualification), but
        # continue observing the live app and its later CPU/headroom samples.
        print(f"Memory census failed while app {root} is alive: {error}",file=sys.stderr,flush=True)
        time.sleep(float(sys.argv[2]) if len(sys.argv)>2 else .5)
