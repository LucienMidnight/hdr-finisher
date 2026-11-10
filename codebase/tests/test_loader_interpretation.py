"""A manual interpretation resolves both fields and starts from encoded pixels."""
import numpy as np
import pytest
from hdr_finisher import loader

@pytest.mark.parametrize('overrides,resolved',[
 ({'color_space':'Display P3'},False),
 ({'transfer_function':'PQ'},False),
 ({'color_space':'Display P3','transfer_function':'PQ'},True),
])
def test_unknown_jxl_requires_complete_interpretation(tmp_path,monkeypatch,overrides,resolved):
 path=tmp_path/'sample.jxl';path.write_bytes(b'\xff\x0a')
 def decode(*args,**kwargs):
  assert kwargs['encoded_samples'] is True
  return np.full((4,6,3),.5,np.float32),{'color_space':'unknown','transfer_function':None,'needs_color_override':True,'jpegxl_input':True,'bit_depth':'16'}
 monkeypatch.setattr(loader,'decode_jpegxl',decode)
 image,descriptor,metadata,analysis,_=loader.load_image(path,overrides=overrides)
 assert analysis.needs_color_override is not resolved
 assert descriptor.color_space_confident is resolved
 assert np.isfinite(image).all()


def test_manual_jxl_uses_encoded_samples_once(tmp_path,monkeypatch):
 from colour import RGB_to_RGB
 from colour.models import eotf_ST2084
 from hdr_finisher.color_context import nits_to_scene_linear
 path=tmp_path/'sample.jxl';path.write_bytes(b'\xff\x0a')
 encoded=np.tile(np.array([.65,.4,.2],np.float32),(4,6,1))
 def decode(*args,**kwargs):
  assert kwargs['encoded_samples'] is True
  return encoded.copy(),{'color_space':'ACEScg','transfer_function':'LINEAR','decoder_normalized_to_acescg':True,
    'decoder_reference_white_nits':203,'sample_color_space':'Display P3','sample_transfer_function':'PQ','needs_color_override':False,'jpegxl_input':True,'bit_depth':'16'}
 monkeypatch.setattr(loader,'decode_jpegxl',decode)
 actual,descriptor,_,analysis,_=loader.load_image(path,overrides={'color_space':'Display P3','transfer_function':'PQ'})
 expected=RGB_to_RGB(nits_to_scene_linear(eotf_ST2084(encoded),203),'Display P3','ACEScg',chromatic_adaptation_transform='CAT02')
 np.testing.assert_allclose(actual,expected,rtol=1e-5,atol=1e-7)
 assert descriptor.source_color_space=='Display P3' and descriptor.transfer_function=='PQ'
 assert not analysis.needs_color_override


@pytest.mark.parametrize('overrides', [{'color_space':'Display P3'}, {'transfer_function':'PQ'}, {'color_space':'Display P3','transfer_function':'PQ'}])
def test_library_jxl_override_starts_from_encoded_samples(tmp_path,monkeypatch,overrides):
 from hdr_finisher import library_rgb, jpegxl
 from hdr_finisher.library_live import recipe
 path=tmp_path/'sample.jxl';path.write_bytes(b'mock')
 encoded=np.tile(np.array([.65,.4,.2],np.float32),(4,6,1))
 monkeypatch.setattr('hdr_finisher.file_gate.decode_suffix',lambda _:'.jxl')
 monkeypatch.setattr(jpegxl,'inspect_jpegxl',lambda _:{'data_color_encoding':{'color_space':0,'white_point':1,'primaries':11,'transfer_function':16}})
 monkeypatch.setattr(loader,'decode_jpegxl',lambda *a,**k:(encoded.copy(),{'color_space':'ACEScg','transfer_function':'LINEAR','decoder_normalized_to_acescg':True,'decoder_reference_white_nits':203,'sample_color_space':'Display P3','sample_transfer_function':'PQ','needs_color_override':False,'bit_depth':'16','sample_type':'integer','jpegxl_info':{}}))
 inputs=recipe(None);inputs['interpretation_override'].update(overrides)
 header,parts=library_rgb.decoded(path,inputs)
 assert header['colour']['primaries']=='Display P3'
 assert header['colour']['transfer']=='PQ'
 np.testing.assert_array_equal(np.frombuffer(parts[0],dtype='<f4').reshape(encoded.shape),encoded)


@pytest.mark.parametrize('overrides',[{'color_space':'Display P3'},{'transfer_function':'PQ'}])
def test_library_unknown_jxl_partial_override_is_ineligible(tmp_path,monkeypatch,overrides):
 from hdr_finisher import library_rgb,jpegxl
 from hdr_finisher.library_live import recipe
 from hdr_finisher.library_gpu_raw import NotEligible
 path=tmp_path/'sample.jxl';path.write_bytes(b'mock')
 monkeypatch.setattr('hdr_finisher.file_gate.decode_suffix',lambda _:'.jxl')
 monkeypatch.setattr(jpegxl,'inspect_jpegxl',lambda _: {})
 inputs=recipe(None);inputs['interpretation_override'].update(overrides)
 with pytest.raises(NotEligible,match='unresolved'):
  library_rgb.decoded(path,inputs)


def test_auto_jxl_descriptor_keeps_source_interpretation(tmp_path):
 import imagecodecs
 path=tmp_path/'p3-pq.jxl'
 path.write_bytes(imagecodecs.jpegxl_encode(np.full((4,6,3),30000,np.uint16),lossless=True,bitspersample=16,primaries=11,transfer=16,usecontainer=True))
 image,descriptor,metadata,analysis,_=loader.load_image(path)
 assert descriptor.source_color_space=='Display P3'
 assert descriptor.transfer_function=='PQ'
 assert metadata['color_space']=='ACEScg' and metadata['transfer_function']=='LINEAR'
 assert not analysis.needs_color_override and np.isfinite(image).all()
