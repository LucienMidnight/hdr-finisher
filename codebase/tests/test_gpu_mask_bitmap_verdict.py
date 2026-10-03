import base64,json,struct
import numpy as np
from fastapi.testclient import TestClient
from conftest import make_png_bytes
from hdr_finisher.main import app,store


def test_gpu_bitmap_verdict_does_not_compile_or_prepare_source(monkeypatch):
    client=TestClient(app)
    opened=client.post('/api/session',files={'file':('mask.png',make_png_bytes(),'image/png')}).json()
    session_id=opened['session']['session_id']
    mask={'operator':'leaf','leaf':{'type':'brush','mask_feather':.005,'strokes':[]}}
    created=client.post(f'/api/session/{session_id}/edit-commands',json={'commands':[{'expected_revision':0,'command_type':'create_local','payload':{'local':{'id':'gpu-mask','name':'GPU mask','mask':mask}}}]}).json()
    session=store.get(session_id)
    def forbidden(*args,**kwargs):
        raise AssertionError('Verdict must not prepare image pixels or compile a mask')
    monkeypatch.setattr(session.render_cache,'_proxies',forbidden)
    monkeypatch.setattr(session.render_cache,'compiled_mask_draft',forbidden)
    width,height=session.source.width,session.source.height
    body={'mask':mask,'edit_revision':1,'long_edge':256,'geometry_signature':json.dumps(created['document']['global_adjustments']['shared']['geometry']), 'width':width,'height':height,'bitmap':base64.b64encode(np.zeros((height,width),np.uint8).tobytes()).decode()}
    url=f'/api/session/{session_id}/local-mask/gpu-mask/bitmap-verdict'
    response=client.post(url,json=body)
    assert response.status_code==200
    assert response.headers['x-mask-soft-limit']=='3.000'
    raw_url=url+'-raw'
    metadata=json.dumps({k:v for k,v in body.items() if k!='bitmap'}).encode()
    raw=struct.pack('<I',len(metadata))+metadata+base64.b64decode(body['bitmap'])
    raw_response=client.post(raw_url,content=raw,headers={'Content-Type':'application/octet-stream'})
    assert raw_response.status_code==200
    for header in ['x-mask-soft','x-mask-soft-estimate','x-mask-soft-reason','x-mask-soft-terms','x-mask-frame-rect','x-geometry-signature']:
        assert raw_response.headers[header]==response.headers[header]
    assert json.loads(raw_response.headers['x-mask-soft-terms'])['gpu-rounding']==1
    assert client.post(raw_url,content=raw[:-1]).status_code==400
    assert client.post(raw_url,content=struct.pack('<I',len(raw)+1)+raw[4:]).status_code==400
    assert client.post(raw_url,content=b'').status_code==400
    assert client.get(f'/api/session/{session_id}/edit-state').json()['revision']==1
    assert client.post(url,json={**body,'bitmap':'!'}).status_code==400
    assert client.post(url,json={**body,'bitmap':''}).status_code==400
    assert client.post(url,json={**body,'width':width+1}).status_code==400
    assert client.post(url,json={**body,'edit_revision':0}).status_code==409
    assert client.post(url,json={**body,'geometry_signature':'{}'}).status_code==409

def test_gpu_verdict_reserves_its_raster_error_before_soft_admission():
    from hdr_finisher.mask_softness import gpu_bitmap_soft_verdict,soft_mask_verdict
    from hdr_finisher.models import MaskExpression
    mask=MaskExpression(leaf={'type':'brush','mask_feather':.005,'strokes':[]})
    bitmap=np.zeros((5,5),np.uint8)
    bitmap[2,2]=3
    assert soft_mask_verdict(mask,bitmap,5,5).soft
    gpu=gpu_bitmap_soft_verdict(mask,bitmap,5,5)
    assert not gpu.soft
    assert gpu.estimate==4
    assert gpu.reason=='bend'
    assert gpu.terms['gpu-rounding']==1
