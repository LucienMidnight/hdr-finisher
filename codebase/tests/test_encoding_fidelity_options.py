import importlib.util
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture
def options():
    path = Path(__file__).resolve().parents[1] / "tools/encoding-fidelity-fixes.py"
    spec = importlib.util.spec_from_file_location("fidelity_options", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_jpeg_experiment_restores_shipping_functions_after_failure(options):
    original_write = options.exporters._write_sdr_rgba8888_pixels
    original_filter = options.exporters._denoise_ultrahdr_gain_map
    with pytest.raises(RuntimeError, match="cancel experiment"):
        with options.jpeg_options(True, "none"):
            assert options.exporters._write_sdr_rgba8888_pixels is not original_write
            assert options.exporters._denoise_ultrahdr_gain_map is not original_filter
            raise RuntimeError("cancel experiment")
    assert options.exporters._write_sdr_rgba8888_pixels is original_write
    assert options.exporters._denoise_ultrahdr_gain_map is original_filter


def test_preparation_stages_measure_actual_quantization_without_mutating_inputs(options):
    hdr = np.linspace(.01, .65, 72, dtype=np.float32).reshape(4, 6, 3)
    sdr = np.linspace(.01, .9, 72, dtype=np.float32).reshape(4, 6, 3)
    original_hdr, original_sdr = hdr.copy(), sdr.copy()
    result = options.preparation_stages(hdr, sdr)
    assert result["jpeg_half_float_intent"]["passed"]
    assert result["avif_hdr_yuv"]["12"]["passed"]
    assert result["avif_hdr_yuv"]["12"]["mean"] < result["avif_hdr_yuv"]["10"]["mean"]
    np.testing.assert_array_equal(hdr, original_hdr)
    np.testing.assert_array_equal(sdr, original_sdr)


def test_private_source_instrumentation_rejects_unexpected_source(options, tmp_path):
    source = tmp_path / "gainmap.c"
    source.write_text("unexpected source")
    with pytest.raises(ValueError, match="Unexpected pinned source"):
        options.replace_once(source, "pinned source", "replacement")
    assert source.read_text() == "unexpected source"
