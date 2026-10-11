"""Measure one unchanged-folder check, without decoding or writing source files."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_folders import scan_folder
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_worker import LibraryWorker
from hdr_finisher.media_browser import MediaBrowserStore

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    args = parser.parse_args()
    root = str(Path(args.folder).resolve())
    with tempfile.TemporaryDirectory(prefix="hdr-check-measure-") as data:
        browser = MediaBrowserStore(Path(data))
        worker = LibraryWorker(Path(data))
        index = LibraryIndex(LibraryMarks(Path(data)), browser, worker)
        try:
            baseline = scan_folder(root, fingerprints=True)
            index.remember_scan(root, baseline["photos"])
            index.checks.seed(baseline)
            worker.start()  # Helper startup is outside the timed check.
            started = time.perf_counter()
            result = index.checks.check(root)
            elapsed = time.perf_counter() - started
            print(json.dumps({"folder": root, "photos": len(baseline["photos"]), "seconds": round(elapsed, 3),
                "result": result, "minimum_wait_seconds": round(max(15, elapsed * 10), 1)}))
        finally:
            index.close()
            worker.close()

if __name__ == "__main__":
    main()
