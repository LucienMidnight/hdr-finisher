"""Generated oriented / custom-gamma TIFF fixtures, before loader changes."""
import struct
import numpy as np
import pytest
import tifffile
from PIL import ImageCms
from hdr_finisher.loader import _load_tiff

@pytest.fixture
def rgb():
    return (np.arange(2*3*3).reshape(2,3,3)*3001).astype(np.uint16)

@pytest.mark.parametrize("orientation", range(1,9))
@pytest.mark.parametrize("reduced", [False, True])
def test_tiff_orientation(tmp_path, rgb, orientation, reduced):
    path=tmp_path/'oriented.tif'
    tifffile.imwrite(path,rgb,photometric='rgb',extratags=[(274,'H',1,orientation,False)])
    expected={1:rgb,2:rgb[:,::-1],3:rgb[::-1,::-1],4:rgb[::-1],
              5:rgb.transpose(1,0,2),6:np.rot90(rgb,-1),
              7:rgb.transpose(1,0,2)[::-1,::-1],8:np.rot90(rgb,1)}[orientation]
    image,meta=_load_tiff(path,library_edge=5120 if reduced else None)
    np.testing.assert_allclose(image,expected.astype(np.float32)/65535,atol=1e-7)
    if reduced:
        assert (meta['source_width'],meta['source_height'])==expected.shape[1::-1]

@pytest.fixture
def gamma_two_profile():
    # A real RGB ICC profile whose name still says sRGB but whose TRC is gamma 2.
    # Name classification must never stand in for applying its actual transform.
    profile=bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    for index in range(struct.unpack_from('>I',profile,128)[0]):
        signature,offset,size=struct.unpack_from('>4sII',profile,132+index*12)
        if signature in (b'rTRC',b'gTRC',b'bTRC'):
            profile[offset:offset+16]=b'para'+bytes(4)+bytes(4)+struct.pack('>i',2*65536)
    return bytes(profile)

@pytest.mark.parametrize('dtype', [np.uint8,np.uint16])
@pytest.mark.parametrize('reduced', [False,True])
def test_tiff_applies_profile_not_its_name(tmp_path,gamma_two_profile,dtype,reduced):
    path=tmp_path/'custom-profile.tif'
    maximum=np.iinfo(dtype).max
    values=np.array([.2,.5,.8])
    pixels=np.tile(np.rint(values*maximum).astype(dtype),(2,3,1))
    tifffile.imwrite(path,pixels,photometric='rgb',iccprofile=gamma_two_profile)
    image,metadata=_load_tiff(path,library_edge=5120 if reduced else None)
    np.testing.assert_allclose(image,np.broadcast_to((pixels[0,0]/maximum)**2,image.shape),atol=.001)
    assert metadata['color_space']=='sRGB'
    assert metadata['transfer_function']=='LINEAR'
    assert metadata['icc_converted_to_linear_srgb']
    assert not metadata['needs_color_override']


@pytest.mark.parametrize('profile', [b'bad-profile', None])
def test_invalid_or_non_rgb_icc_does_not_get_silent_srgb_fallback(tmp_path,profile):
    if profile is None:
        profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('LAB')).tobytes()
    path=tmp_path/'invalid.tif'
    pixels=np.full((2,3,3),40000,np.uint16)
    tifffile.imwrite(path,pixels,photometric='rgb',iccprofile=profile)
    image,metadata=_load_tiff(path)
    np.testing.assert_allclose(image,pixels/65535,atol=1e-7)
    assert metadata['needs_color_override']
    assert 'icc_interpretation_error' in metadata


def test_custom_profile_import_keeps_finished_sdr_rendition(tmp_path,gamma_two_profile):
    from hdr_finisher.loader import load_image
    from hdr_finisher.models import HDRClassification
    path=tmp_path/'custom-finished.tif'
    tifffile.imwrite(path,np.full((3,4,3),32768,np.uint16),photometric='rgb',iccprofile=gamma_two_profile)
    image,descriptor,metadata,analysis,reference=load_image(path)
    assert metadata['transfer_function']=='LINEAR'
    assert not analysis.needs_color_override
    assert analysis.classification==HDRClassification.SDR_ONLY
    assert descriptor.color_space_confident
    assert reference is not None
    np.testing.assert_allclose(reference,.25,atol=.001)
    assert metadata['sdr_file_rendition']
