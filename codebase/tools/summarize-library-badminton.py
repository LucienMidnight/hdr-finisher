"""Summarise the short scroll recorder; retain cancelled visits as missing results."""
import csv
import json
from pathlib import Path
import re
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from hdr_finisher.library_grades import grade_key

output = ROOT / 'output/badminton'
report = json.loads((output / 'scroll.json').read_text())
events = report['events']
rows = []
for request in events:
    if request['stage'] != 'navigation' or request.get('view') != 'grid':
        continue
    path = request['path']
    if not re.search(r'DSC072[0-5]\d\.ARW$', path):
        continue
    sidecar = Path(path + '.hdrf')
    document = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    edited = document.get('grade') is not None and grade_key(document['grade']) != grade_key(document.get('grade_default'))
    # Join the application's trace IDs, never DOM insertion times. Initialising
    # a cell can defer its request, and a photo can be visited more than once.
    def matching(stage):
        return [event for event in events if event['stage'] == 'picture_navigation_to_present'
                and event.get('request') == request['request'] and event.get('picture_size') == stage]
    shown = matching('thumbnail')
    camera = matching('camera preview')
    seconds = round(shown[0]['duration_ms'] / 1000, 3) if shown else None
    next_visit = min((event['at'] for event in events if event['stage'] == 'navigation'
        and event.get('path') == path and event['at'] > request['at']), default=float('inf'))
    observed = [sample['at'] for sample in report['cells'] if request['at'] <= sample['at'] < next_visit
        and any(cell['path'] == path and not cell['finished'] for cell in sample['cells'])]
    pending_seconds = round((max(observed) - request['at']) / 1000, 3) if observed and not shown else None
    rows.append(dict(photo=Path(path).name, edited=edited, request=request['request'], dispatched_ms=round(request['at'], 1),
        thumbnail_seconds=seconds, camera_seconds=round(camera[0]['duration_ms'] / 1000, 3) if camera else None,
        observed_unfinished_seconds=pending_seconds,
        over_2s=(seconds if seconds is not None else pending_seconds or 0) > 2,
        outcome='presented' if shown else 'not presented before scroll/end'))
with (output / 'cell-timings.csv').open('w', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
summary = dict(peakBytes=report['peakBytes'], peakSample=report['peakSample'],
    sidecarsUnchanged=report['sidecarsUnchanged'], protectedProjectsUnchanged=report['protectedProjectsUnchanged'],
    errors=report['errors'], cells=len(rows), drawn=sum(row['thumbnail_seconds'] is not None for row in rows),
    over2s=sum(row['over_2s'] and row['thumbnail_seconds'] is not None for row in rows),
    unfinishedOver2s=sum(row['over_2s'] and row['thumbnail_seconds'] is None for row in rows),
    developmentOrder=[event['path'] for event in events if event['stage'] == 'picture_development_admitted'])
for edited in (False, True):
    values = [row['thumbnail_seconds'] for row in rows if row['edited'] == edited and row['thumbnail_seconds'] is not None]
    summary['edited' if edited else 'unedited'] = dict(count=len(values), minimum=min(values),
        median=statistics.median(values), maximum=max(values)) if values else None
(output / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({key: value for key, value in summary.items() if key not in ('peakSample', 'developmentOrder')}, indent=2))
