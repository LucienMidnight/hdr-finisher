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


def setup(monkeypatch):
    recipe=InpaintRecipe(source_size=(80,64),search_rect=(16,8,64,56),mode='clone',
        points=(RepairPoint(x=.5,y=.5),),source_point=RepairPoint(x=.25,y=.25),radius_px=6)
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
    monkeypatch.setattr(retouch_routes,'transfer_repair',lambda *a:(patch,None))
    try:
        result=retouch_routes.solve_record(session,record,worker,token,None,lambda:None)
        assert result.renderer=='cpu' and result.fallback_reason=='Device lost during repair'
        assert retouch_routes.records(session)[0]['name']=='Dust spot'
        proxy=SimpleNamespace(delivery_owner=session)
        for consumer in (session,proxy):
            report=retouch_routes.delivery_record(consumer,{'renderer':'gpu','fallback_reason':None})
            assert 'Dust spot (clone): Device lost' in report['fallback_reason']
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


def test_saved_replay_keeps_cpu_fallback_for_batch_delivery(monkeypatch,tmp_path):
    from PIL import Image
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.projects import open_document
    path=tmp_path/'saved.png'
    Image.fromarray(np.full((64,80,3),180,np.uint8)).save(path)
    store=SessionStore()
    try:
        session=store.get(store.create_session(path,owns_source_path=False).session_id)
        record,_,worker,_,_=setup(monkeypatch)
        worker.close()
        document=session.edit_document().model_copy(update={'repairs':[record]})
        def fail(*a,**kw):raise RuntimeError('GPU unavailable on replay')
        monkeypatch.setattr(retouch_gpu,'solve',fail)
        reopened=open_document(store,document,path)
        assert retouch_routes.records(reopened)[0]['renderer']=='cpu'
        report=retouch_routes.delivery_record(reopened,{'renderer':'gpu'})
        assert 'GPU unavailable on replay' in report['fallback_reason']
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
    with pytest.raises(ValueError,match='outside'):
        bounded[0:1,0:1]
