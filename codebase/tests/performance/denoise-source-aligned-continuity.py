"""Recheck bounded GPU readbacks through actual geometry source mappings.
The near-axis rectangle approximation is rejected above 0.01 native pixel.
This is a diagnostic, not replacement PRD acceptance evidence.
"""
import argparse, sys, json, zipfile, hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from hdr_finisher.models import GeometryAdjustments
from hdr_finisher.finishing import geometry_coordinate_map
from zoom_block_compare import compare_frames
parser=argparse.ArgumentParser()
parser.add_argument('--reports',type=Path,nargs='+',required=True)
parser.add_argument('--source-size',type=int,nargs=2,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
rows=[]
for path in args.reports:
 report=json.loads(path.read_text(encoding='utf-8'))
 project=Path(report['project'])
 assert hashlib.sha256(project.read_bytes()).hexdigest()==report['projectSha256']
 with zipfile.ZipFile(project) as z:saved=json.loads(z.read('edit-state.json'))
 geo=saved['global_adjustments']['shared']['geometry'].copy()
 for edit in report.get('edits',[]):
  key=edit['key'].split('.')[-1]
  if key in geo:geo[key]=edit['value']
 g=GeometryAdjustments.model_validate(geo)
 maps={}
 for row in report['results']:
  for f in row['frames']:
   edge=f['accepted']['processedLongEdge']
   if edge not in maps:
    sw,sh=args.source_size
    ratio=min(1,edge/max(sw,sh))
    m,_,w,h=geometry_coordinate_map(round(sw*ratio),round(sh*ratio),g)
    assert (w,h)==(f['width'],f['height']),((w,h),(f['width'],f['height']))
    maps[edge]=np.array(m).reshape(3,3)
  a,b=row['frames'];ea=a['accepted']['processedLongEdge'];eb=b['accepted']['processedLongEdge']
  m=np.diag([a['width'],a['height'],1])@np.linalg.inv(maps[ea])@maps[eb]@np.diag([1/b['width'],1/b['height'],1]);m/=m[2,2]
  result=compare_frames(dict(lane=row['lane'],frames=row['frames'],lowToNativePixels=m.tolist()))
  rows.append(dict(report=str(path),zoom=row['zoom'],mapping=m.tolist(),**result))
  print(path.stem,row['zoom'],result['tone']['luminance']['p99']*100,result['tone']['oklab']['p99'],result['maxCrossAxisBlockDriftPixels'])
args.output.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
