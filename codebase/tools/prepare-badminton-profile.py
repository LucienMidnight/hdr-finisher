"""Read-only saved-scene audit; copy existing thumbnail scenes to a disposable profile.

No RAW copies, cache links, original cache touches/publication, or photo writes.
The runner may mutate only the disposable copies. Its owner removes the profile.
"""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from hashlib import sha256

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from hdr_finisher.library_live import quality, equivalent_qualities, recipe, _quality
from hdr_finisher.library_pictures import picture_key
from hdr_finisher.library_grades import grade_key

folder = Path('D:/Photos/2026/20261017 badminton')
cache = Path(os.environ['LOCALAPPDATA']) / 'HDR Finisher/Cache'
output = ROOT / 'output/badminton'
output.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='hdr-finisher-test-badminton-'))
destination = profile / 'Cache/library-pictures'
destination.mkdir(parents=True)
(profile / 'Cache/.hdr-finisher-cache').write_text('HDR Finisher Library cache v1\n')
rows = []
copied = {}
for photo in sorted(folder.iterdir()):
    if photo.suffix.lower() not in ('.arw', '.jpg', '.jpeg'):
        continue
    sidecar = Path(str(photo) + '.hdrf')
    document = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    grade = document.get('grade')
    edited = grade is not None and grade_key(grade) != grade_key(document.get('grade_default'))
    value = quality(grade)
    candidates = equivalent_qualities(value)
    found = []
    for q in candidates:
        key = picture_key(photo, 640, q)
        source = cache / 'library-pictures' / (key + '.npz')
        if source.is_file():
            found.append(dict(key=key, quality=q, bytes=source.stat().st_size))
            # Only small thumbnail scenes; never another copy of a RAW.
            target = destination / source.name
            if source.name not in copied:
                shutil.copyfile(source, target)
                copied[source.name] = sha256(source.read_bytes()).hexdigest()
    if edited:
        rows.append(dict(photo=photo.name, canonical=picture_key(photo,640,value), stored=found))
# Adjacent exported JPEGs and initial cells must see the same warm small-scene
# cache too. Copy NPZs only, never large scenes, linked originals or RAW files.
for source in (cache / 'library-pictures').glob('*.npz'):
    target = destination / source.name
    if not target.exists():
        shutil.copyfile(source, target)
report = dict(edited=len(rows), hits=sum(bool(row['stored']) for row in rows),
              photos=rows, profile=str(profile), copied=copied, sourceCache=str(cache))
(output / 'scene-audit.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ('photos','copied')}, indent=2))
for row in rows:
    if any(row['photo'].startswith(n) for n in ('DSC0727','DSC0750','DSC0751')):
        print(row['photo'], [s['key'][:12] for s in row['stored']])
