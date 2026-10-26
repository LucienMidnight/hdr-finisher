"""One startup timing on a disposable snapshot; live data is opened read-only."""
import collections
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hdr_finisher import library_diagnostics
from hdr_finisher.library_index import LibraryIndex
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.media_browser import MediaBrowserStore

live = Path(os.environ['APPDATA']) / 'hdr-finisher-desktop'
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=False)
with sqlite3.connect((live / 'library.sqlite3').as_uri() + '?mode=ro', uri=True) as src:
    with sqlite3.connect(target / 'library.sqlite3') as dst:
        src.backup(dst)
for name in ('pinned-folders.json', 'kept-photos.json', 'library-preferences.json'):
    if (live / name).exists(): shutil.copy2(live / name, target / name)
if (live / 'library-kept-records').exists():
    shutil.copytree(live / 'library-kept-records', target / 'library-kept-records')
counts = collections.Counter()
library_diagnostics._sink = lambda row: counts.update([row['event']])
started = time.perf_counter()
index = LibraryIndex(LibraryMarks(target), MediaBrowserStore(target), None)
print(json.dumps({'constructor_ms': (time.perf_counter()-started)*1000,
                  'events': counts, 'snapshot': str(target)}, indent=2))
