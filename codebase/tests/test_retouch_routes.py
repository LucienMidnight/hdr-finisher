"""Finished patch reuse and route disclosure across preview and delivery."""
from concurrent.futures import CancelledError
from types import SimpleNamespace
from dataclasses import replace
import numpy as np
import pytest
from hdr_finisher.models import RepairRecord, EditDocument
from hdr_finisher.retouch import RepairPatch
from hdr_finisher.retouch_jobs import RepairWorker, RepairRevision
from hdr_finisher.retouch_recipe import InpaintRecipe, RepairPoint
from hdr_finisher import retouch_routes, retouch_gpu, delivery


def setup(monkeypatch, mode='inpaint'):
    recipe=InpaintRecipe(source_size=(80,64),search_rect=(16,8,64,56),mode=mode,
        points=(RepairPoint(x=.5,y=.5),),source_point=RepairPoint(x=.25,y=.25) if mode!='inpaint' else None,radius_px=6)
    record=RepairRecord(id='spot',name='Dust spot',recipe=recipe)
    session=SimpleNamespace(repairs=[record],source_path='photo.ARW',source=SimpleNamespace(filename='photo.ARW'))
    token=RepairRevision('document','frozen-source',1)
    worker=RepairWorker();worker.set_current(token)
    pixels=np.ones((2,2,3),np.float32);empty=np.empty((0,2),np.int32)
    patch=RepairPatch((38,30),pixels,empty,empty,renderer='gpu')
    monkeypatch.setattr(delivery,'preferences',lambda:{'effective_force_cpu':False})
    return record,session,worker,token,patch


def test_gpu_finished_patch_reused_and_not_saved(monkeypatch):
    record,session,worker,token,patch=setup(monkeypatch)
    calls=[]
    monkeypatch.setattr(retouch_gpu,'solve',lambda *a,**kw:calls.append(1) or patch)
    try:
        for _ in range(2):
            assert retouch_routes.solve_record(session,record,worker,token,None,lambda:None) is patch
        assert calls==[1]
        assert retouch_routes.records(session)[0]['renderer']=='gpu'
        assert retouch_routes.notice(session) is None
        assert 'repair_rendering' not in EditDocument.model_fields
    finally:worker.close()


def test_failed_gpu_is_disclosed_per_photo_and_in_proof_export(monkeypatch,capsys):
    record,session,worker,token,patch=setup(monkeypatch)
    def fail(*a,**kw):raise RuntimeError('Device lost during repair')
    monkeypatch.setattr(retouch_gpu,'solve',fail)
    monkeypatch.setattr(retouch_routes,'prepare_repair',lambda *a,**k:None)
    monkeypatch.setattr(worker.engine,'solve',lambda *a:patch)
    monkeypatch.setattr(retouch_routes,'finish_repair',lambda *a:patch)
    try:
        result=retouch_routes.solve_record(session,record,worker,token,None,lambda:None)
        assert result.renderer=='cpu' and result.fallback_reason=='Device lost during repair'
        assert retouch_routes.records(session)[0]['name']=='Dust spot'
        proxy=SimpleNamespace(delivery_owner=session)
        for consumer in (session,proxy):
            report=retouch_routes.delivery_record(consumer,{'renderer':'gpu','fallback_reason':None})
            assert 'Dust spot (inpaint): Device lost' in report['fallback_reason']
        log=capsys.readouterr().err
        assert 'photo.ARW' in log and 'retouch_delivery_fallback' in log
        session.repairs=[]
        assert retouch_routes.records(session)==[]
    finally:worker.close()


def test_cancelled_gpu_never_becomes_a_cpu_fallback(monkeypatch):
    record,session,worker,token,patch=setup(monkeypatch)
    def cancel(*a,**kw):raise CancelledError('newer edit')
    monkeypatch.setattr(retouch_gpu,'solve',cancel)
    try:
        with pytest.raises(CancelledError):
            retouch_routes.solve_record(session,record,worker,token,None,lambda:None)
        assert retouch_routes.records(session)==[]
        assert worker._bytes==0
    finally:worker.close()


@pytest.mark.parametrize('mode',['clone','heal'])
def test_saved_replay_uses_cpu_by_default_for_batch_delivery(monkeypatch,tmp_path,mode):
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.projects import open_document
    path=tmp_path/'saved.png'
    Image.fromarray(np.full((64,80,3),180,np.uint8)).save(path)
    store=SessionStore()
    try:
        session=store.get(store.create_session(path,owns_source_path=False).session_id)
        record,_,worker,_,_=setup(monkeypatch,mode)
        worker.close()
        document=session.edit_document().model_copy(update={'repairs':[record]})
        monkeypatch.setattr(retouch_gpu,'solve',lambda *a,**kw:pytest.fail('Transfer replay must use the CPU'))
        reopened=open_document(store,document,path)
        assert retouch_routes.records(reopened)[0]['renderer']=='cpu'
        report=retouch_routes.delivery_record(reopened,{'renderer':'gpu'})
        assert not report.get('fallback_reason')
        from hdr_finisher.retouch_source import build_repaired_source
        np.testing.assert_array_equal(build_repaired_source(reopened,reopened.repairs),reopened.image)
    finally:store.clear()


@pytest.mark.parametrize('mode',['inpaint','clone','heal'])
def test_declared_context_matches_whole_photo_preparation(mode):
    rng=np.random.default_rng(8);base=rng.random((64,80,3),dtype=np.float32)
    recipe=InpaintRecipe(source_size=(80,64),search_rect=(16,8,64,56),mode=mode,
        points=(RepairPoint(x=.5,y=.5),),source_point=RepairPoint(x=.193,y=.213) if mode!='inpaint' else None,
        radius_px=6,settings=dict(patch_radius=2,iterations=2,seed=7))
    rectangles=retouch_gpu.context_rectangles(recipe)
    values=np.concatenate([base[t:b,l:r].reshape(-1) for l,t,r,b in rectangles])
    bounded=retouch_gpu.BoundedSource(rectangles,values)
    (full_meta,full),_=retouch_gpu.packet(recipe,base)
    (meta,result),_=retouch_gpu.packet(recipe,bounded)
    assert meta==full_meta
    np.testing.assert_array_equal(result,full)
    if mode != 'inpaint':
        bounded.shape = base.shape
        full_patch, full_mask = retouch_routes.transfer_repair(recipe, base, replay=True)
        bounded_patch, mask = retouch_routes.transfer_repair(recipe, bounded, replay=True)
        assert bounded_patch.origin == full_patch.origin
        np.testing.assert_array_equal(mask, full_mask)
        np.testing.assert_array_equal(bounded_patch.pixels, full_patch.pixels)
    with pytest.raises(ValueError,match='outside'):
        bounded[0:1,0:1]


@pytest.mark.parametrize('priority',[0,15,20])
def test_repair_inherits_source_priority_and_cancellation(monkeypatch,priority):
    from hdr_finisher.highlight_edge_gpu import source_work
    record,session,worker,token,patch=setup(monkeypatch)
    received=[]
    monkeypatch.setattr(retouch_gpu,'solve',lambda *a,**kw:received.append(kw['priority']) or patch)
    try:
        with source_work(priority=priority):
            assert retouch_routes.solve_record(session,record,worker,token,None,lambda:None) is patch
        assert received==[priority]
        with source_work(priority=priority,cancelled=lambda:True):
            with pytest.raises(CancelledError,match='Source repair cancelled'):
                retouch_routes.solve_record(session,record,worker,token,None,lambda:None)
        assert received==[priority]
    finally:worker.close()


@pytest.mark.parametrize('virtual_copy', [False, True], ids=['original', 'virtual-copy'])
def test_library_batches_share_validated_saved_recipes(tmp_path, monkeypatch, virtual_copy):
    from copy import deepcopy
    import json
    from PIL import Image
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hdr_finisher.library_api import create_library_router
    from hdr_finisher.library_documents import LibraryDocuments, atomic_json
    from hdr_finisher.library_gpu_raw import frame, unframe
    from hdr_finisher import library_retouch
    from hdr_finisher.media_browser import MediaBrowserStore
    from hdr_finisher.sessions import SessionStore

    path = tmp_path / 'clone.png'
    Image.new('RGB', (80,64)).save(path)
    store = SessionStore()
    session = store.prepare_session(path)
    first, _, worker, _, _ = setup(monkeypatch, 'clone')
    worker.close()
    second = first.model_copy(update={'id':'other', 'recipe':first.recipe.model_copy(update={'radius_px':8})})
    grade = session.edit_document().model_copy(update={'repairs':[first,second]}).model_dump(mode='json')
    sidecar = path.with_suffix('.png.hdrf')
    document = {'format':'HDR Finisher Photo', 'schema_version':1, 'photo_id':'original'}
    item = str(path)
    if virtual_copy:
        document['virtual_copies'] = [{'photo_id':'copy', 'name':'Copy 1', 'grade':grade}]
        item += '|copy|copy'
    else:
        document['grade'] = grade
    atomic_json(sidecar, document)
    reads = []
    writer = None
    request_document = LibraryDocuments.request

    def read_document(reader, item, **kwargs):
        nonlocal writer
        writer = reader.marks.writer
        reads.append(item)
        return request_document(reader, item, **kwargs)

    monkeypatch.setattr(LibraryDocuments, 'request', read_document)
    helper = SimpleNamespace(status=lambda:dict(paused=False))
    app = FastAPI()
    app.include_router(create_library_router(helper, MediaBrowserStore(tmp_path/'profile'), store))
    client = TestClient(app)
    try:
        result = client.post('/api/library/live-scene', json={'path':item,'edge':640,'gpu':True})
        assert result.status_code == 200, result.text
        header, _ = unframe(result.content)
        assert len(header['repairs']) == 1
        assert len(header['repairs'][0]) == 2
        base = np.arange(64*80*3, dtype=np.float32).reshape(64,80,3) / (64*80*3)
        batch, = library_retouch.plan([first,second], (80,64))
        body = b''.join(base[t:b,l:r].tobytes() for _, rectangles in batch for l,t,r,b in rectangles)
        packet_header = dict(source_job=header['source_job'], item_path=item, batch=0)

        def submit(data=body, **overrides):
            packet = frame({**packet_header, **overrides}, data)
            return client.post('/api/library/retouch-packet', content=packet)

        response = submit()
        assert response.status_code == 200, response.text
        info, pixels = unframe(response.content)
        for record, meta in zip((first,second), info['repairs'], strict=True):
            patch, mask = retouch_routes.transfer_repair(record.recipe, base, replay=True)
            start = meta['offset']
            actual = np.frombuffer(pixels[start:start+meta['bytes']],dtype='<f4').reshape(*mask.shape,4)
            np.testing.assert_array_equal(actual[...,:3], patch.pixels)
            np.testing.assert_array_equal(actual[...,3],mask)
        assert reads == [item]
        marked = client.post('/api/library/marks', json={'paths':[item], 'change':{'rating':4, 'add_tag':'To print'}})
        assert marked.status_code == 200, marked.text
        writer.drain()
        marked_document = json.loads(sidecar.read_text())
        marked_item = marked_document['virtual_copies'][0] if virtual_copy else marked_document
        assert marked_item['marks']['rating'] == 4
        assert marked_item['marks']['tags'] == ['To print']
        for _ in range(2):
            accepted = submit()
            assert accepted.status_code == 200, accepted.text
            assert unframe(accepted.content)[1] == pixels
        assert reads == [item, item]  # Only the first batch after the write re-reads the grade.

        for malformed in (submit(batch=1), submit(data=body[:-4])):
            assert malformed.status_code == 409
            assert 'superseded' not in malformed.json()

        for change in ('repair', 'order', 'source-settings', 'fingerprint', 'unreadable', 'deleted'):
            current = deepcopy(marked_document)
            current_grade = (current['virtual_copies'][0] if virtual_copy else current)['grade']
            if change == 'repair':
                current_grade['repairs'][0]['recipe']['radius_px'] = 7
            elif change == 'order':
                current_grade['repairs'].reverse()
            elif change == 'source-settings':
                current_grade['source']['raw_import_settings']['pixel_cleanup']['remove_hot_pixels'] = True
            elif change == 'fingerprint':
                current_grade['source']['fingerprint_sha256'] = 'a' * 64
            if change == 'unreadable':
                sidecar.write_text('{')
            elif change == 'deleted':
                sidecar.unlink()
            else:
                atomic_json(sidecar, current)
            rejected = submit()
            assert rejected.status_code == 409, (change, rejected.text)
            assert rejected.json()['superseded'] is True

        atomic_json(sidecar, marked_document)
        replay = library_retouch.replay

        def edit_during_replay(*args):
            result = replay(*args)
            marked_item['grade']['repairs'].reverse()
            atomic_json(sidecar, marked_document)
            return result

        monkeypatch.setattr(library_retouch, 'replay', edit_during_replay)
        rejected = submit()
        assert rejected.status_code == 409 and rejected.json()['superseded'] is True
    finally:
        client.close()
        store.clear()
