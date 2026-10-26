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

# Disable copied recovery writes to original photos during measurement.
with sqlite3.connect(target / 'library.sqlite3') as db:
    db.execute("UPDATE photos SET pending=0")
    db.execute("DELETE FROM settings_writes")
    photo_count = db.execute("SELECT COUNT(*) FROM files").fetchone()[0]
preferences = json.loads((target / 'library-preferences.json').read_text()) if (target / 'library-preferences.json').exists() else {}
preferences['background_indexing'] = False
(target / 'library-preferences.json').write_text(json.dumps(preferences))
cache_settings = live / 'library-cache-settings.json'
settings = json.loads(cache_settings.read_text()) if cache_settings.exists() else {}
cache_source = Path(settings.get('location', Path(os.environ['LOCALAPPDATA']) / 'HDR Finisher' / 'Cache'))
cache_target = target / 'Cache'
shutil.copytree(cache_source, cache_target, ignore=shutil.ignore_patterns('*.sqlite3', '*.sqlite3-wal', '*.sqlite3-shm'))
ledger = cache_source / '.library-cache-size.sqlite3'
if ledger.exists():
    with sqlite3.connect(ledger.as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(cache_target / ledger.name) as dst:
            src.backup(dst)
            dst.execute("UPDATE files SET path=? || substr(path, ?) WHERE substr(path,1,?)=?",
                        (str(cache_target), len(str(cache_source))+1, len(str(cache_source)), str(cache_source)))
settings.update(location=str(cache_target), old_locations=[])
(target / 'library-cache-settings.json').write_text(json.dumps(settings))
folder = r'D:\Photos\2026\20261017 badminton'
(target / 'pinned-folders.json').write_text(json.dumps([folder]))
print(json.dumps({'snapshot': str(target), 'files': photo_count, 'cache_source_read_only': str(cache_source)}), flush=True)
import subprocess
subprocess.run(['node', str(Path(__file__).with_suffix('.cjs')), str(target)], check=True, cwd=Path(__file__).resolve().parents[1])
