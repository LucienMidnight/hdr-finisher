import pytest
import numpy as np
from hdr_finisher.library_cpu_bands import _Reduction, _bilinear
from hdr_finisher.library_pictures import reduce_picture
from hdr_finisher.raw_import import _nonzero_chunks


@pytest.mark.parametrize("edge",[117,256,800])
def test_banded_reduction_matches_whole_image_pillow_at_boundaries(edge):
    pixels=np.random.default_rng(41).random((317,453,3),dtype=np.float32)
    result=_Reduction(453,317,edge)
    for start in range(0,317,64):result.add(start,pixels[start:start+64])
    np.testing.assert_allclose(result.pixels,reduce_picture(pixels,edge),atol=3e-7)


def test_bilinear_remap_samples_and_clamps_like_the_live_picture():
    plane=np.array([[0,2],[4,6]],dtype=np.float32)
    np.testing.assert_allclose(_bilinear(plane,np.array([.5,1,-1]),np.array([.5,2,-1])),[3,6,0])


def test_clipped_coordinate_batches_are_bounded_and_keep_row_order():
    mask=np.ones((721,803),dtype=bool);mask[3:40,25:71]=False
    chunks=list(_nonzero_chunks(mask,25000))
    assert all(len(rows)<=25000 for rows,columns in chunks)
    rows=np.concatenate([row for row,column in chunks]);columns=np.concatenate([column for row,column in chunks])
    expected=np.nonzero(mask)
    np.testing.assert_array_equal(rows,expected[0]);np.testing.assert_array_equal(columns,expected[1])


def test_shared_banded_source_reuses_its_reduced_companion_without_reading_raw(tmp_path, monkeypatch):
    import rawpy
    from hdr_finisher.library_cpu_bands import develop
    from hdr_finisher.library_pictures import LibraryPictureCache
    path=tmp_path/'photo.arw';path.write_bytes(b'original remains untouched')
    def forbidden(*args,**kwargs): raise AssertionError('The shared preparation must not read the RAW again')
    monkeypatch.setattr(rawpy,'imread',forbidden)
    prepared={2560:(np.full((32,64,3),.25,np.float32),None,{'route':'library-live','renderer':'cpu'})}
    cache=LibraryPictureCache(tmp_path/'cache')
    result=develop(tmp_path/'cache',path,None,2560,None,cache,None,False,prepared)
    assert result['edge']==2560 and result['width']==64
    assert path.read_bytes()==b'original remains untouched'


def test_native_plane_sampling_matches_ordered_numpy_with_lens_coordinates():
    rng=np.random.default_rng(938)
    plane=rng.normal(size=(53,79)).astype(np.float32)
    x=rng.uniform(-4,85,size=(17,92)).astype(np.float32)
    y=rng.uniform(-4,60,size=x.shape).astype(np.float32)
    cx=np.clip(x,0,78);cy=np.clip(y,0,52)
    x0=cx.astype(np.int32);y0=cy.astype(np.int32)
    x1=np.minimum(x0+1,78);y1=np.minimum(y0+1,52)
    fx=cx-x0;fy=cy-y0
    expected=(plane[y0,x0]*(1-fx)*(1-fy)+plane[y0,x1]*fx*(1-fy)
              +plane[y1,x0]*(1-fx)*fy+plane[y1,x1]*fx*fy).astype(np.float32)
    np.testing.assert_array_equal(_bilinear(plane,y,x),expected)
