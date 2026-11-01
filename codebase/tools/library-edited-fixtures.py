"""Disposable Part C edited fixtures; never open or save the protected projects."""
import copy, json, shutil, sys, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hdr_finisher.projects import validate_saved_document
from hdr_finisher.models import EditDocument
from hdr_finisher.retouch_recipe import InpaintRecipe
root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]).resolve()
assert folder.is_relative_to(root / 'output')
folder.mkdir(parents=True, exist_ok=True)
shared = root / 'output/test-photos/DSC00264.ARW'
assert shared.exists()
manifest = []
copies = []
target = folder / 'DSC00264.ARW'
if not target.exists(): shutil.copyfile(shared, target)
for index, name in enumerate(['four-masks', 'fifty-locals', 'film-denoise', 'retouch']):
    project = root / ('local-test-media/viewport/DSC00264-' + ('fifty-locals' if index == 1 else 'four-masks') + '.hdrfinisher')
    with zipfile.ZipFile(project) as archive:
        document = validate_saved_document(json.loads(archive.read('edit-state.json'))).model_dump(mode='json')
    document['source'].update(filename=target.name, durable_path=str(target))
    if index == 2:
        for lane in ['hdr', 'sdr']:
            document['global_adjustments'][lane]['film_look']['film_stock'] = 'kodak_portra_400'
            document['denoise'][lane]['enabled'] = True
    if index == 3:
        # Native 7952 x 5304 Sony source; small central dust repair.
        document['repairs'] = [dict(id='baseline-dust', name='Baseline dust', enabled=True,
            recipe=InpaintRecipe(source_size=(7952,5304),search_rect=(3900,2580,4060,2740),
                points=[dict(x=.5,y=.5)],radius_px=8).model_dump(mode='json'))]
    document = EditDocument.model_validate(document).model_dump(mode='json')
    sidecar = dict(format='HDR Finisher Photo',schema_version=1,photo_id=name,
        source=dict(filename=target.name),contains_source_pixels=False,marks={},grade=document)
    if index == 2:
        virtual = copy.deepcopy(document)
        virtual['global_adjustments']['hdr']['exposure'] += .25
        sidecar['virtual_copies'] = [dict(photo_id='baseline-copy',name='Virtual Film',marks={},grade=virtual)]
    if index == 0: physical = sidecar
    else: copies.append(dict(photo_id=name,name=name,marks={},grade=document))
    copies.extend(sidecar.get('virtual_copies', []))
    manifest.append(dict(name=name,project=str(project),path=str(target)))
(root/'output/part-c-edited/fixtures.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
physical['virtual_copies'] = copies
target.with_suffix(target.suffix+'.hdrf').write_text(json.dumps(physical),encoding='utf-8')
