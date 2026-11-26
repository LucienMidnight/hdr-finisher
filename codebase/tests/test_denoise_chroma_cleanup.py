"""Behaviour checks for non-shipping colour-cleanup research."""
import numpy as np
import pytest
from tools.denoise_eval.candidates import chroma_cleanup as trial


def test_gm_repair_changes_only_chroma_and_keeps_orange_blue():
    rgb=np.full((48,48,3),.02,np.float32);rgb[20:22,20:22]+=.2*trial.GM_DIRECTION
    result,counts=trial.repair_component(rgb,np.full((48,48),.01,np.float32),threshold=2,max_area=9)
    assert counts['changed']==4
    assert np.max(abs((result-rgb)@trial.Y))<2e-8
    assert np.max(abs((result-rgb)@trial.OB))<2e-8
    assert np.max(abs(result@trial.GM))<np.max(abs(rgb@trial.GM))


def test_real_supported_colour_line_and_oversize_blob_survive():
    rgb=np.zeros((48,48,3),np.float32);rgb[15:30,15]=.2*trial.GM_DIRECTION
    result,counts=trial.repair_component(rgb,np.full((48,48),.005,np.float32),threshold=2,max_area=9)
    assert np.array_equal(result,rgb)
    assert counts['changed']==0


def test_median_holds_green_but_not_necessarily_luminance():
    rgb=np.full((32,32,3),.03,np.float32);rgb[16,16,0]=.3
    result=trial.false_colour(rgb,3)
    assert np.array_equal(result[...,1],rgb[...,1])
    assert result[16,16,0]<rgb[16,16,0]
    assert abs((result-rgb)@trial.Y).max()>.01


@pytest.mark.parametrize('pattern', [[[0,1],[1,2]],[[2,1],[1,0]],[[1,0],[2,1]],[[1,2],[0,1]]])
def test_green_match_preserves_cell_green_sum_and_signed_values(pattern):
    pattern=np.asarray(pattern);sensor=np.full((48,48),-.01,np.float32);p,q=np.argwhere(pattern==1)
    sensor[p[0]::2,p[1]::2]=.02;sensor[q[0]::2,q[1]::2]=.01
    result,counts=trial.match_greens(sensor,pattern,np.tile([.001,.0001],(4,1)))
    assert counts['green_cells']>0
    assert np.allclose(result[p[0]::2,p[1]::2]+result[q[0]::2,q[1]::2],sensor[p[0]::2,p[1]::2]+sensor[q[0]::2,q[1]::2],atol=2e-9,rtol=0)
    assert np.all(result[np.tile(pattern!=1,(24,24))]==-.01)


def test_targeted_repair_bounded_context_matches_interior():
    rgb=np.random.default_rng(19).normal(.01,.002,(128,128,3)).astype('float32');rgb[60:62,61:63]+=.1*trial.GM_DIRECTION
    sigma=np.full((128,128),.001,np.float32)
    full=trial.repair_component(rgb,sigma,threshold=2,max_area=25)[0]
    crop=trial.repair_component(rgb[20:108,20:108],sigma[20:108,20:108],threshold=2,max_area=25)[0]
    assert np.array_equal(full[48:80,48:80],crop[28:60,28:60])


def test_post_local_pipeline_preserves_the_actual_denoise_luminance():
    metadata=dict(cfa=[[0,1],[1,2]],white_balance=[1,1,1],camera_to_acescg=np.eye(3).tolist(),
                  noise_parameters=[dict(a=.001,b=.00001)]*4)
    sensor=np.random.default_rng(71).normal(.03,.01,(96,96)).astype('float32')
    adapter=trial.local2_a25();state=adapter.prepare(sensor,metadata)
    before=adapter.denoise.process(state[0],metadata,state[1])
    output=adapter.process(sensor,metadata,state)
    assert state[2]['post_gm']['changed']>0
    assert np.max(abs((output-before)@trial.Y))<2e-8
    assert np.isfinite(output).all()
    with pytest.raises(ValueError,match='bypass'):
        adapter.process(sensor,metadata,state,bypass=True)


def test_no_cleanup_is_exactly_the_existing_approved_taming():
    from tools.denoise_eval.candidates.early_outlier import develop
    metadata=dict(cfa=[[0,1],[1,2]],white_balance=[2,1,1.5],camera_to_acescg=np.eye(3).tolist(),
                  noise_parameters=[dict(a=.001,b=.00001)]*4)
    sensor=np.random.default_rng(34).normal(.01,.01,(48,48)).astype('float32')
    assert np.array_equal(trial.develop(sensor,metadata)[0],develop(sensor,metadata)[0])


def test_wide_detector_reaches_a_five_pixel_colour_blob_without_luma_change():
    rgb=np.full((64,64,3),.03,np.float32)
    rgb[29:34,29:34]+=.2*trial.GM_DIRECTION
    floor=np.full((64,64),.002,np.float32)
    result,counts=trial.repair_component(rgb,floor,threshold=2,max_area=25,radius=4)
    assert counts['changed']>0
    # The similar-colour outer ring protects the blob's rim, but the wider
    # estimator must reach its unsupported centre.
    assert np.array_equal(result[29,29],rgb[29,29])
    assert abs((result@trial.GM)[31,31]) < abs((rgb@trial.GM)[31,31])
    assert np.max(abs((result-rgb)@trial.Y))<2e-8


def test_median_development_does_not_double_convert_neutral_background():
    from dataclasses import replace
    # Non-unity WB/matrix make accidental reuse of an in-place colour bridge
    # observable. The constant sensor field must stay the same after medians.
    metadata=dict(cfa=[[0,1],[1,2]],white_balance=[2,1,1.5],
        camera_to_acescg=[[1.1,-.08,-.02],[-.1,1.3,-.2],[.02,-.1,1.08]],
        noise_parameters=[dict(a=.001,b=.00001)]*4)
    sensor=np.full((64,64),.02,np.float32)
    reference,_=trial.develop(sensor,metadata)
    for steps in (1,3):
        rgb,_=trial.develop(sensor,metadata,trial.Controls(median_steps=steps))
        assert np.allclose(rgb[12:-12,12:-12],reference[12:-12,12:-12],atol=1e-8,rtol=0)
