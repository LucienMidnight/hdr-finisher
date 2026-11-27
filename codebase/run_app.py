from __future__ import annotations

import argparse
import multiprocessing
import sys
from pathlib import Path

if sys.version_info < (3, 12):
    raise SystemExit("HDR Finisher requires Python 3.12 or newer.")

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# A packaged windowed app (and its spawned helpers) starts with no console:
# sys.stdout/sys.stderr are None, and any print or traceback would raise.
if sys.stdout is None or sys.stderr is None:
    import os
    _devnull = open(os.devnull, "w", encoding="utf-8")
    sys.stdout = sys.stdout or _devnull
    sys.stderr = sys.stderr or _devnull

# PyInstaller must dispatch spawned library workers before importing the app
# or parsing its normal command line (otherwise the helper relaunches the UI).
if __name__ == "__main__":
    multiprocessing.freeze_support()

    if "--desktop-sidecar" in sys.argv and "--parent-pid" in sys.argv:
        from hdr_finisher.backend_parent_watch import watch_desktop
        watch_desktop(int(sys.argv[sys.argv.index("--parent-pid") + 1]))

    # Micro Grain distributes tiles on the shared CPU pool. OpenCV's process
    # setting must be configured before any requests or worker calls start.
    import json
    import time
    def startup_progress(phase):
        if "--desktop-sidecar" in sys.argv:
            print("HDR_FINISHER_PROGRESS " + json.dumps({"phase": phase, "time": time.time()}), flush=True)
    startup_progress("Loading OpenCV")
    import cv2
    cv2.setNumThreads(1)
    startup_progress("OpenCV loaded")

if __name__ == "__main__" and len(sys.argv) == 4 and sys.argv[1] == "--batch-export-worker":
    from hdr_finisher.batch_export_worker import main as batch_main
    sys.argv = [sys.argv[0], *sys.argv[2:]]
    batch_main()
    raise SystemExit(0)

if __name__ == "__main__":
    startup_progress("Loading server runtime")
from hdr_finisher.launcher import run, run_desktop_sidecar
if __name__ == "__main__":
    startup_progress("Server runtime loaded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--desktop-sidecar", action="store_true")
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()
    if args.desktop_sidecar:
        if args.parent_pid <= 0:
            parser.error("--parent-pid is required for the desktop sidecar")
        run_desktop_sidecar(args.parent_pid)
    else:
        run()
