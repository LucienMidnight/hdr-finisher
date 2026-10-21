from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import hdr_delivery
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.models import AdjustmentState, ExportSettings
from hdr_finisher.exporters import build_export_backends


@pytest.mark.parametrize("format_name,decoder_module,decoder_name", [
    ("jpeg_ultrahdr", "gainmap_decoders", "decode_ultrahdr_jpeg"),
    ("avif_gain_map", "gainmap_decoders", "decode_avif"),
    ("jpegxl_hdr", "jpegxl", "decode_jpegxl"),
])
def test_decoded_ceiling_accepts_990_but_rejects_one_1010_pixel(
    monkeypatch, tmp_path, format_name, decoder_module, decoder_name,
):
    import importlib
    image = np.full((8, 8, 3), 990 * .18 / 203, dtype=np.float32)
    def decode(_):
        return (image, {}) if decoder_module == "jpegxl" else (image, None, {})
    module = importlib.import_module("hdr_finisher." + decoder_module)
    monkeypatch.setattr(module, decoder_name, decode)
    path = tmp_path / "fixture"
    assert hdr_delivery.check_decoded_hdr_ceiling(path, format_name, 1000) == pytest.approx(990, abs=.01)
    image[0, 0] = 1010 * .18 / 203
    with pytest.raises(ValueError, match="exceeds"):
        hdr_delivery.check_decoded_hdr_ceiling(path, format_name, 1000)
    image[0, 0] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        hdr_delivery.check_decoded_hdr_ceiling(path, format_name, 1000)


@pytest.mark.parametrize("format_name", ["jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"])
def test_ceiling_reads_real_exported_hdr_pixels(tmp_path, format_name):
    backend = build_export_backends(probe_capabilities())[format_name]
    if backend.capability.status.value != "available":
        pytest.skip(backend.capability.detail)
    session = SimpleNamespace(session_id="ceiling", image=np.full((48, 64, 3), .5, dtype=np.float32),
        adjustments=AdjustmentState(), hdr_reference_white_nits=203,
        sdr_reference_image=None, local_adjustments=[])
    result = backend.export(session, ExportSettings(format=format_name, quality=95,
        output_path=str(tmp_path / "ceiling")))
    assert result.accepted, result.message
    path = Path(result.output_path)
    assert 400 < hdr_delivery.check_decoded_hdr_ceiling(path, format_name, 1000) < 800
    with pytest.raises(ValueError, match="exceeds"):
        hdr_delivery.check_decoded_hdr_ceiling(path, format_name, 100)
