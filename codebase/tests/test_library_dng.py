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


def test_bridge_demosaics_but_defers_ordered_gain_and_warp_to_gpu(monkeypatch,tmp_path):
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
    monkeypatch.setattr(dng_opcodes,"apply_gain_map",lambda *a,**k:pytest.fail("CPU GainMap ran"))
    header,parts=decoded(path,recipe(None))
    pixels=np.frombuffer(parts[0],dtype="<f4").reshape(4,4,3)
    np.testing.assert_allclose(pixels,np.float32(32768/65535))
    assert header["dng_warp"]["width"]==4
    assert [op["status"] for op in header["colour"]["decoder_metadata"]["audit"]["operations"]]==["applied_gpu","applied_gpu"]

    assert header["dng_gain_maps"][0]["gains"]==[2.0]


def test_linear_bridge_preserves_samples_and_defers_colour(monkeypatch,tmp_path):
    from test_linear_dng import _write_linear
    from hdr_finisher import dng_color
    from hdr_finisher.library_live import recipe
    path=tmp_path/"linear.dng"
    image=np.full((24,32,3),32768,np.uint16);image[8:12,9:15,0]=65535
    _write_linear(path,image)
    monkeypatch.setattr(dng_color,"transform_normalized_to_acescg_in_place",lambda *a,**k:pytest.fail("CPU colour conversion ran"))
    header,parts=decoded(path,recipe(None))
    np.testing.assert_allclose(np.frombuffer(parts[0],dtype="<f4").reshape(image.shape),image.astype(np.float32)/65535,rtol=1e-6)
    assert header["dng_linear"]["width"]==32
    assert header["dng_linear"]["support"]["bytes"]>0
    assert header["dng_references"]=={}
    assert header["colour"]["decoder_metadata"]["raw_input"]


def test_linear_operations_keep_cpu_fallback(tmp_path):
    from hdr_finisher.library_dng_linear import decoded as linear
    source=inspection();source.route=DngRoute.LINEAR_DNG
    with pytest.raises(NotEligible,match="operations"):
        linear(tmp_path/"unused.dng",{},source)


def test_native_embedded_sdr_keeps_cpu_fallback(tmp_path):
    from hdr_finisher.library_dng_linear import decoded as linear
    source=inspection();source.route=DngRoute.LINEAR_DNG
    source.required_opcodes=();source.optional_opcodes=()
    source.metadata["sdr_preview_series_index"]=1
    with pytest.raises(NotEligible,match="embedded SDR"):
        linear(tmp_path/"unused.dng",{},source,edge=100000)


def test_linear_embedded_reference_survives_publication(tmp_path):
    import tifffile
    from test_linear_dng import _write_linear
    from hdr_finisher import library_rgb
    from hdr_finisher.library_live import recipe,quality
    from hdr_finisher.library_pictures import LibraryPictureCache
    from hdr_finisher.sessions import SessionStore
    path=tmp_path/"reference.dng"
    _write_linear(path,np.full((24,32,3),32768,np.uint16))
    with tifffile.TiffWriter(path,append=True) as tif:
        tif.write(np.full((24,32,3),128,np.uint8),photometric="rgb",subfiletype=1,metadata={"axes":"YXS"})
    expected=SessionStore().prepare_session(path,owns_source_path=False)
    header,parts=decoded(path,recipe(None))
    assert set(header["dng_references"])=={"640","2560"}
    data=b"".join(bytes(p) for p in parts);ref=header["dng_references"]["640"]
    reference=np.frombuffer(data,dtype="<f4",offset=ref["offset"],count=ref["bytes"]//4).reshape(3,24,32).transpose(1,2,0)
    np.testing.assert_array_equal(reference,expected.sdr_reference_image)
    a=expected.analysis
    header.update(has_sdr_reference=True,height=24,width=32,source_height=24,source_width=32,edge=640,source_quality=quality(None),memory_peak_bytes=1,
        peaks=dict(peak=a.peak_linear,peak_luma=a.peak_luma_linear,peak_bt2020=a.peak_bt2020_linear,sdr=float(np.max(reference))),
        robust=dict(channel=a.robust_peak_linear,luma=a.robust_peak_luma_linear,bt2020=a.robust_peak_bt2020_linear))
    cache=LibraryPictureCache(tmp_path/"cache")
    planes=np.concatenate([expected.image.transpose(2,0,1),reference.transpose(2,0,1)]).astype("<f4")
    result=library_rgb.developed(cache,path,header,planes.tobytes())
    assert result["has_reference"]
    assert cache.default_document(path)==expected.edit_document().model_dump(mode="json")
