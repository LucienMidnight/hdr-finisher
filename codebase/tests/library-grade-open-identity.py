"""Exact 42 MP before/after source, measurements, candidates and proxy check."""
from pathlib import Path
import json, os, shutil, sys
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/library-grade-open/identity'
OUT.mkdir(parents=True, exist_ok=True)
os.environ['HDR_FINISHER_USER_DATA_DIR'] = str(OUT / 'profile')
sys.path.insert(0, str(ROOT / 'backend'))
from hdr_finisher.sessions import SessionStore
from hdr_finisher.projects import open_document
from hdr_finisher.models import PreviewKind
photo = OUT / 'identity.ARW'
if not photo.exists():
    shutil.copyfile(ROOT / 'output/library-slow-spots/development-final-photos-ZHfVZM/DSC07060.ARW', photo)
before = '--before' in sys.argv
store = SessionStore()
for kind in ('new', 'saved'):
    session = store.prepare_session(photo)
    if kind == 'saved':
        doc = session.edit_document().model_copy(deep=True)
        doc.global_adjustments.hdr.exposure = .75
        doc.global_adjustments.sdr.exposure = -.25
        store.activate_session(session)
        session = open_document(store, doc, photo, reuse_session_id=session.session_id)
    proxy = session.render_cache.geometry_source_proxy(PreviewKind.HDR, 1920, session.adjustments)[0]
    metadata = dict(session.metadata)
    metadata.pop('import_timings_ms', None)
    values = {'source': session.source.model_dump(mode='json'), 'analysis': session.analysis.model_dump(mode='json'),
              'metadata': metadata, 'document': session.edit_document().model_dump(mode='json')}
    arrays = {'image': session.image, 'proxy': proxy, **session.render_cache._peak_candidates}
    record = OUT / (kind + '.json')
    if before:
        record.write_text(json.dumps(values, sort_keys=True), encoding='utf-8')
        for key, array in arrays.items():
            np.save(OUT / f'{kind}-{key}.npy', array)
    else:
        assert values == json.loads(record.read_text(encoding='utf-8')), kind + ' measurements changed'
        for key, array in arrays.items():
            reference = np.load(OUT / f'{kind}-{key}.npy', mmap_mode='r')
            assert reference.shape == array.shape and reference.dtype == array.dtype
            for start in range(0, array.shape[0], 128):
                # Compare bytes as well as values, including signed zero.
                assert reference[start:start+128].tobytes() == array[start:start+128].tobytes(), (kind, key, start)
    print(kind, 'reference recorded' if before else 'bit-for-bit identical', flush=True)
    store.clear()
    del session, arrays, proxy