import numpy as np
from hdr_finisher.library_cpu_bands import _Reduction, _bilinear
from hdr_finisher.library_pictures import reduce_picture
from hdr_finisher.raw_import import _nonzero_chunks


def test_banded_reduction_matches_whole_image_pillow_at_boundaries():
    pixels=np.random.default_rng(41).random((317,453,3),dtype=np.float32)
    result=_Reduction(453,317,117)
    for start in range(0,317,64):result.add(start,pixels[start:start+64])
    np.testing.assert_allclose(result.pixels,reduce_picture(pixels,117),atol=3e-7)


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
