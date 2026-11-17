"""Behaviour checks for calibration-backed Pixel cleanup, no private photos."""
import numpy as np
import pytest

from tools.denoise_eval.candidates.pixel_cleanup import (
    candidate_samples, confirm_calibration, repair_sensor,
)


def metadata():
    return dict(noise_parameters=[dict(a=1e-6,b=1e-8)]*4)


def defect(row, column):
    return dict(y=row,x=column,evidence='five independent flat calibration frames')


def test_no_map_preserves_noise_points_text_edges_and_clipping_exactly():
    image = np.random.default_rng(3).normal(.05,.02,(80,82)).astype('float32')
    image[20,20] = 1
    image[40,40] = 0
    image[50:,:] = .8
    result, diagnostic = repair_sensor(image,metadata())
    assert np.array_equal(result,image)
    assert not np.shares_memory(result,image)
    assert diagnostic['repaired'] == 0


@pytest.mark.parametrize('phase',range(4))
@pytest.mark.parametrize('bad_value',[0.,.9,1.])
def test_mapped_dead_hot_stuck_sites_repair_only_same_cfa_plane(phase,bad_value):
    image = np.zeros((80,82),'float32')
    for index,level in enumerate((.1,.2,.3,.4)):
        image[index//2::2,index%2::2] = level
    row,column = 30+phase//2,30+phase%2
    clean = image.copy()
    image[row,column] = bad_value
    result,diagnostic = repair_sensor(image,metadata(),[defect(row,column)])
    assert np.array_equal(result,clean)
    assert diagnostic['repaired'] == 1
    assert image[row,column] == bad_value


def test_map_requires_evidence_and_integer_coordinates():
    image = np.zeros((32,32),'float32')
    with pytest.raises(ValueError,match='evidence'):
        repair_sensor(image,{},[dict(y=10,x=10)])
    with pytest.raises(ValueError,match='integers'):
        repair_sensor(image,{},[defect(10.1,10)])


def test_clipping_edges_clusters_and_nonfinite_are_not_silently_repaired():
    image = np.full((64,64),.1,'float32')
    image[30,30] = .9
    image[29,29] = 1
    result,diagnostic = repair_sensor(image,{},[defect(30,30),defect(2,2),defect(45,45),defect(47,45)])
    assert np.array_equal(image,result)
    assert {item['reason'] for item in diagnostic['skipped']} == {'border','clipped_context','nonisolated_map'}
    image[10,10] = np.nan
    with pytest.raises(ValueError,match='finite'):
        repair_sensor(image,{})


def test_directional_interpolation_preserves_linear_edge():
    image = np.full((64,64),.1,'float32')
    image[:,32:] = .5
    image[30,32] = 0
    result,_ = repair_sensor(image,{},[defect(30,32)])
    assert result[30,32] == .5


def test_single_frame_extremes_are_candidates_not_automatic_defects():
    image = np.full((64,64),.1,'float32')
    image[30,30] = .9
    suspects = candidate_samples(image,metadata())['candidates']
    assert any(item['y']==30 and item['x']==30 for item in suspects)
    assert np.array_equal(repair_sensor(image,metadata())[0],image)
    assert candidate_samples(image,{})['status'] == 'uncalibrated'


@pytest.mark.parametrize('kind,level,bad_value',[('dark',.001,.7),('flat',.2,0.)])
def test_calibration_confirms_persistent_sites_not_one_frame_noise_or_moved_detail(kind,level,bad_value):
    frames = [np.full((64,64),level,'float32') for _ in range(5)]
    for index,frame in enumerate(frames):
        frame[30,30] = bad_value
        frame[40,20+index*4] = .8
    found = confirm_calibration(frames,metadata(),kind=kind,capture_ids=list(range(5)))
    assert [(item['y'],item['x']) for item in found] == [(30,30)]
    with pytest.raises(ValueError,match='five'):
        confirm_calibration(frames[:2],metadata(),kind=kind,capture_ids=list(range(2)))


def test_saturated_hot_sites_require_independent_calibration_not_scene_clipping():
    frames = [np.full((48,48),.001,'float32') for _ in range(5)]
    for frame in frames:
        frame[24,24] = 1
    assert not candidate_samples(frames[0],metadata())['candidates']
    found = confirm_calibration(frames,metadata(),kind='dark',capture_ids=list(range(5)))
    assert [(item['y'],item['x']) for item in found] == [(24,24)]
    with pytest.raises(ValueError,match='distinct'):
        confirm_calibration(frames,metadata(),kind='dark',capture_ids=['same']*5)


def test_adapter_exposure_defaults_and_bypass_match_normal_development():
    from tools.denoise_eval.inputs import develop
    from tools.denoise_eval.candidates.pixel_cleanup import alone, with_denoise
    from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
    image = np.random.default_rng(12).uniform(.005,.012,(96,96)).astype('float32')
    image[48,48] = .9
    md = dict(metadata(),cfa=[[0,1],[1,2]],white_balance=[2,1,1.5],
              camera_to_acescg=np.eye(3).tolist(),exposure_stops=4.)
    developed = develop(image,md)
    current = AppDefault()
    reference = current.process(developed,md,current.prepare(developed,md))
    for adapter,expected in ((alone(),developed),(with_denoise(),reference)):
        state = adapter.prepare(image,md)
        assert np.array_equal(adapter.process(image,md,state),expected)
        assert np.array_equal(adapter.process(image,md,state,bypass=True),developed)
    mapped = dict(md,pixel_cleanup_defects=[defect(48,48)])
    adapter = with_denoise()
    state = adapter.prepare(image,mapped)
    assert state.diagnostics['repaired'] == 1
    assert np.array_equal(adapter.process(image,mapped,state,bypass=True),developed)


def test_independent_tiles_preserve_even_sensor_coordinates():
    image = np.full((100,110),.1,'float32')
    image[50,56] = 0
    mapping = [defect(50,56)]
    whole,_ = repair_sensor(image,{},mapping)
    tile,_ = repair_sensor(image[20:80,22:90],dict(tile_origin=(20,22)),mapping)
    assert np.array_equal(tile,whole[20:80,22:90])
    with pytest.raises(ValueError,match='even'):
        repair_sensor(image,dict(tile_origin=(1,0)),mapping)
