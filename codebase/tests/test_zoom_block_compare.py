"""Validate PRD block alignment/area integration before trusting its verdicts."""
from pathlib import Path
import sys
import numpy as np
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parent/'performance'))
from zoom_block_compare import area_blocks, compare_frames


def test_fractional_rectangle_integrates_each_pixel_overlap():
    image=np.arange(12,dtype=float).reshape(3,4,1)
    x,y=np.array([.3,1.7,3.8]),np.array([.2,1.2,2.9])
    actual=area_blocks(image,x,y)
    for row in range(2):
        for col in range(2):
            total=0
            for iy in range(3):
                for ix in range(4):
                    weight=max(0,min(x[col+1],ix+1)-max(x[col],ix))*max(0,min(y[row+1],iy+1)-max(y[row],iy))
                    total+=image[iy,ix,0]*weight
            expected=total/((x[col+1]-x[col])*(y[row+1]-y[row]))
            assert actual[row,col,0]==pytest.approx(expected,abs=1e-12)


@pytest.mark.parametrize('odd,brightness,shift',[(False,1,0),(True,1,0),(False,1.1,0),(False,1,2)])
def test_same_scene_blocks_match_and_brightness_difference_fails(tmp_path,odd,brightness,shift):
    # Coarse checker scene with an exact 2:1 replication (or uniform odd frame).
    y,x=np.mgrid[:256,:256]
    low=np.stack([.2+.05*((x//16+y//16)%2)]*3,axis=-1)
    if odd:low[:]=.25
    native=np.repeat(np.repeat(low,2,0),2,1)
    if odd:native=np.pad(native,((0,1),(0,1),(0,0)),mode='edge')
    if shift:native=np.pad(native,((0,0),(shift,0),(0,0)),mode='edge')
    frames=[]
    for index,(image,zoom) in enumerate([(native,100),(low*brightness,50)]):
        h,w=image.shape[:2]
        encoded=np.where(image<=.0031308,image*12.92,1.055*image**(1/2.4)-.055)
        rgba=np.concatenate([encoded,np.ones((h,w,1))],axis=-1).astype(np.float32)
        file=tmp_path/f'{zoom}.rgba32';rgba.tofile(file)
        frames.append(dict(file=str(file),rect=dict(x=0,y=0,width=w,height=h),width=w,height=h,zoom=zoom,
            format='rgba16float',white=203,screenScale=dict(x=1,y=1,dpr=1),laneAdjustments={},denoise={}))
    data=dict(lane='hdr',frames=frames)
    if shift:
        assert not compare_frames(data)['passed']
        data['lowToNativePixels']=[[2,0,shift],[0,2,0],[0,0,1]]
    result=compare_frames(data)
    assert result['passed']==(brightness==1)
    assert result['tone']['luminance']['p99']==pytest.approx(abs(brightness-1),abs=1e-6)
