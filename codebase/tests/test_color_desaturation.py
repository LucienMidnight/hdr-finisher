import numpy as np
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.adjustments import _apply_color_desaturation, _apply_hdr_color, _acescg_luma

def test_color_desaturation_neutral_luminance_continuity_and_replay():
    image=np.array([[[.7,.2,.03],[-.01,.02,.03],[4.,1.,.3]]],np.float32)
    state=AdjustmentState()
    for kind in PreviewKind:
        if kind.value not in ("hdr","sdr"): continue
        branch=getattr(state,kind.value)
        branch.highlight_desaturation_start=.7
        assert _apply_color_desaturation(image,branch,kind) is image
        assert np.array_equal(_apply_hdr_color(image,branch,kind),image)
        branch.highlight_desaturation=100;branch.shadow_desaturation=40
        result=_apply_color_desaturation(image,branch,kind)
        np.testing.assert_allclose(_acescg_luma(result),_acescg_luma(image),rtol=2e-7,atol=2e-7)
        assert np.all(result>=image.min(axis=-1,keepdims=True)-1e-7)
        assert np.all(result<=image.max(axis=-1,keepdims=True)+1e-7)
        ramp=np.linspace(0,5,10001,dtype=np.float32)[:,None,None]*np.array([1.4,.8,.3],np.float32)
        output=_apply_color_desaturation(ramp,branch,kind)
        assert np.max(np.abs(np.diff(output,axis=0)))<.005
    replay=AdjustmentState.model_validate_json(state.model_dump_json())
    assert replay.hdr.highlight_desaturation==100
    assert replay.sdr.shadow_desaturation==40


def test_entire_match_carries_color_desaturation():
    from hdr_finisher.sdr_match import _semantic_sdr_translation
    state=AdjustmentState()
    state.hdr.highlight_desaturation=63
    state.hdr.shadow_desaturation=27
    state.hdr.highlight_desaturation_start=2
    state.hdr.shadow_desaturation_start=.2
    result=_semantic_sdr_translation(state,np.full((8,8,3),.18,np.float32))
    for field in ("highlight_desaturation","shadow_desaturation","highlight_desaturation_start","shadow_desaturation_start"):
        expected=min(state.hdr.highlight_desaturation_start,.99) if field=="highlight_desaturation_start" else getattr(state.hdr,field)
        assert getattr(result,field)==expected
