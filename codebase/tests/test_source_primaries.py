"""Independent transfer equations and asymmetric colours catch forced BT.2020."""
import numpy as np
import pytest
from colour import RGB_COLOURSPACES
from colour.models import matrix_RGB_to_RGB
from hdr_finisher import color

SAMPLES = np.array([[[.72, .31, .12], [.16, .63, .43], [.51, .23, .81]]], dtype=np.float32)

@pytest.mark.parametrize("white", [100, 203])
@pytest.mark.parametrize("transfer", ["PQ", "HLG"])
@pytest.mark.parametrize("space", ["Display P3", "sRGB", "ITU-R BT.2020", None, "unknown"])
def test_hdr_source_primaries_independent_oracle(space, transfer, white):
    actual = color.normalize_to_acescg(SAMPLES, space, transfer, white)
    source = space if space not in (None, "unknown") else "ITU-R BT.2020"
    x = SAMPLES.astype(np.float64)
    if transfer == "PQ":
        v = x ** (32 / 2523)
        linear = (np.maximum(v - 3424 / 4096, 0) / (2413 / 128 - 2392 / 128 * v)) ** (16384 / 2610) * 10000
    else:
        scene = np.where(x <= .5, x*x/3, (np.exp((x-.55991073)/.17883277)+.28466892)/12)
        weights = [ .2627, .6780, .0593 ] if source == "ITU-R BT.2020" else RGB_COLOURSPACES[source].matrix_RGB_to_XYZ[1]
        linear = scene * np.sum(scene * weights, axis=-1, keepdims=True) ** .2 * 1000
    matrix = matrix_RGB_to_RGB(RGB_COLOURSPACES[source], RGB_COLOURSPACES["ACEScg"], "CAT02")
    expected = (linear * (.18 / white)) @ matrix.T
    # Numerical equation check, not an image-agreement tolerance.
    np.testing.assert_allclose(actual, expected, rtol=2e-6, atol=2e-7)

@pytest.mark.parametrize("white", [100, 203])
@pytest.mark.parametrize("transfer", ["PQ", "HLG"])
def test_bt2020_default_remains_exact(white, transfer):
    helper = color._pq_bt2020_to_acescg if transfer == "PQ" else color._hlg_bt2020_to_acescg
    expected = helper(SAMPLES, white)
    for space in (None, "unknown", "BT.2020"):
        np.testing.assert_array_equal(color.normalize_to_acescg(SAMPLES, space, transfer, white), expected)


def test_private_gpu_weight_writer_contract():
    import subprocess
    from pathlib import Path
    script = r"""
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
let source=fs.readFileSync('frontend/library-rgb-gpu.js','utf8');
source=source.replace('return Object.freeze({develop:developRGB,warmup});','return {writeRGBMatrix};');
const ctx={window:{},HDRLibraryGpuRaw:{shared:{COMMON:'',TURN:'',FINISHING:''}}};
vm.runInNewContext(source,ctx);
const api=ctx.window.HDRLibraryRGB;
for(const weights of [[.22897456,.69173852,.07928691],[.2126,.7152,.0722],null]) {
  const buffer=new Float32Array(22*4), rows=[[1,2,3],[4,5,6],[7,8,9]];
  api.writeRGBMatrix((slot,values)=>buffer.set(values,slot*4),{rgb_to_acescg:rows,hlg_luminance_weights:weights});
  const expected=weights||[.2627,.6780,.0593];
  for(let k=0;k<3;k++) {
    assert.equal(buffer[(10+k)*4+3],Math.fround(expected[k]));
    assert.deepEqual(Array.from(buffer.slice((10+k)*4,(10+k)*4+3)),rows[k]);
  }
}
"""
    subprocess.run(["node", "-e", script], cwd=Path(__file__).resolve().parents[1], check=True)


@pytest.mark.parametrize("space", ["Display P3", "sRGB", "BT.2020"])
@pytest.mark.parametrize("transfer", ["PQ", "HLG"])
@pytest.mark.parametrize("white", [100, 203])
def test_library_header_uses_declared_linear_matrix(tmp_path, monkeypatch, space, transfer, white):
    from hdr_finisher import library_rgb, jpegxl
    from hdr_finisher.library_live import recipe
    path = tmp_path / "colour.jxl"
    path.write_bytes(b"mock header")
    metadata = dict(color_space=space, transfer_function=transfer, bit_depth="32", sample_type="float", jpegxl_info={})
    monkeypatch.setattr("hdr_finisher.file_gate.decode_suffix", lambda path: ".jxl")
    monkeypatch.setattr(jpegxl, "inspect_jpegxl", lambda path: {"app_metadata": metadata})
    monkeypatch.setattr(library_rgb.loader, "decode_jpegxl", lambda *a, **k: (SAMPLES.copy(), metadata.copy()))
    inputs = recipe(None)
    inputs["hdr_reference_white_nits"] = white
    header, parts = library_rgb.decoded(path, inputs)
    source = color._canonical_colourspace(space, transfer)
    matrix = matrix_RGB_to_RGB(RGB_COLOURSPACES[source], RGB_COLOURSPACES["ACEScg"], "CAT02")
    np.testing.assert_allclose(header["rgb_to_acescg"], matrix, rtol=2e-6, atol=2e-7)
    np.testing.assert_array_equal(header["hlg_luminance_weights"], color.hlg_luminance_weights(source))
    np.testing.assert_array_equal(np.frombuffer(parts[0], dtype="<f4").reshape(SAMPLES.shape), SAMPLES)
