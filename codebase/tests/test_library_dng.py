from dataclasses import replace
from types import SimpleNamespace
import numpy as np
import pytest
from hdr_finisher.library_dng import plan, geometry, decoded
from hdr_finisher.library_gpu_raw import NotEligible
from hdr_finisher.linear_dng import DngRoute, crop_and_orient
from test_dng_raw_routing import _inspection


def inspection():
    value=_inspection();value.route=DngRoute.MOSAICED_RAW_DNG
    return value


def test_eligibility_depends_on_supported_ordered_operations():
    source=inspection();ordered,warp,parameters=plan(source)
    assert [op.opcode_id for op in ordered]==[9,1]
    assert warp is ordered[-1]
    assert parameters.coefficients.shape==(1,6)
    source.required_opcodes=tuple(reversed([replace(op,index=1-op.index) for op in ordered]))
    with pytest.raises(NotEligible,match="final Warp"):
        plan(source)
    source=inspection();source.required_opcodes+=(replace(warp,index=2),)
    with pytest.raises(NotEligible):plan(source)
    source=inspection();source.route=DngRoute.LINEAR_DNG
    with pytest.raises(NotEligible):plan(source)
    source=inspection();source.required_opcodes=(replace(warp,opcode_id=14,name="WarpRectilinear2"),)
    with pytest.raises(NotEligible,match="Unsupported mandatory"):plan(source)


@pytest.mark.parametrize("orientation",range(1,9))
@pytest.mark.parametrize("merge",[None,[.1,.2,.9,.8]])
def test_gpu_coordinate_affine_matches_existing_crop_and_orientation(orientation,merge):
    y,x=np.mgrid[:30,:40]
    coordinates=np.stack([x,y,x*0],axis=-1)
    metadata=dict(active_area=[2,3,28,37],default_crop_origin=[2,3],default_crop_size=[28,20],orientation=orientation,xmp_merge_crop=merge)
    expected=crop_and_orient(coordinates,metadata)
    w,h,ax,ay=geometry(metadata,40,30)
    yy,xx=np.mgrid[:h,:w]
    assert expected.shape==(h,w,3)
    np.testing.assert_array_equal(expected[...,0],ax[0]*xx+ax[1]*yy+ax[2])
    np.testing.assert_array_equal(expected[...,1],ay[0]*xx+ay[1]*yy+ay[2])


def test_bridge_demosaics_then_applies_gain_but_never_cpu_warp(monkeypatch,tmp_path):
    from hdr_finisher import library_dng,raw_import,linear_dng,dng_opcodes
    from hdr_finisher.library_live import recipe
    source=inspection();source.fingerprint=SimpleNamespace(width=4,height=4)
    path=tmp_path/"camera.dng";path.write_bytes(b"source")
    monkeypatch.setattr(linear_dng,"inspect_dng",lambda _:source)
    monkeypatch.setattr(raw_import,"_inspect_raw",lambda *a,**k:source)
    monkeypatch.setattr(raw_import,"_build_raw_decode_plan",lambda *a:None)
    monkeypatch.setattr(raw_import,"_execute_raw_decode",lambda *a,**k:SimpleNamespace(developed=np.full((4,4,3),32768,np.uint16)))
    monkeypatch.setattr(raw_import,"_build_raw_provenance",lambda *a:{"audit":a[-1].opcode_audit})
    monkeypatch.setattr(dng_opcodes,"apply_warp_rectilinear",lambda *a,**k:pytest.fail("CPU warp ran"))
    header,parts=decoded(path,recipe(None))
    pixels=np.frombuffer(parts[0],dtype="<f4").reshape(4,4,3)
    np.testing.assert_allclose(pixels,np.float32(32768/65535)*2)
    assert header["dng_warp"]["width"]==4
    assert [op["status"] for op in header["colour"]["decoder_metadata"]["audit"]["operations"]]==["applied","applied_gpu"]
