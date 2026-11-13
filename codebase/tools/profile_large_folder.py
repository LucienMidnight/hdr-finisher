"""One read-only D:\\Photos timing per invocation; output is a new disposable profile."""
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(_ToolPath(__file__).resolve().parents[1] / 'tools'))
from lib.machine_settings import photos_path, desktop_profile, desktop_cache
from pathlib import Path
import json, os, sqlite3, subprocess, sys
root = Path(__file__).resolve().parents[1]
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=False)
with sqlite3.connect((desktop_profile()/'library.sqlite3').as_uri()+'?mode=ro',uri=True) as src, sqlite3.connect(target/'library.sqlite3') as dst:
    src.backup(dst)
    dst.execute('UPDATE photos SET pending=0')
    dst.execute('DELETE FROM settings_writes')
for name,value in {
    'pinned-folders.json':[photos_path(r'D:\Photos')],
    'library-preferences.json':{'background_indexing':False},
    'library-cache-settings.json':{'location':str(target/'Cache'),'old_locations':[]},
    'window-state.json':{'x':0,'y':0,'width':2560,'height':1440},
}.items(): (target/name).write_text(json.dumps(value),encoding='utf-8')
(target/'sitecustomize.py').write_text("""import sys, os
sys.path.insert(0, os.environ['HDR_PROFILE_BACKEND'])
from hdr_finisher.library_marks import LibraryMarks
from hdr_finisher.library_membership import LibraryMembership
LibraryMarks._write_sidecar = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('Source writes disabled in profile'))
LibraryMembership.reconcile = lambda *a, **k: None
""",encoding='utf-8')
subprocess.run(['node',str(root/'tools/profile_large_folder.cjs'),str(target),*sys.argv[2:]],cwd=root,check=True)
