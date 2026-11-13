import json
import subprocess
import sys

import imagecodecs
import numpy as np
import pytest

from hdr_finisher import jpegxl


@pytest.mark.parametrize("response", [
    "hang", "fail", "garbage", "invalid-utf8", "[]", '{"schema_version":2}',
    '{"schema_version":1}', "bad-precision", "bad-profile", "bad-gamma",
    "missing", "unlaunchable",
])
def test_helper_failure_decodes_with_real_header_fallback(tmp_path, monkeypatch, response):
    source = np.arange(18 * 24 * 3, dtype=np.uint16).reshape(18, 24, 3)
    path = tmp_path / "source.jxl"
    path.write_bytes(imagecodecs.jpegxl_encode(source, bitspersample=12, lossless=True))
    monkeypatch.setattr(jpegxl, "resolve_binary", lambda _: None)
    expected, _ = jpegxl.decode_jpegxl(path)
    helper = tmp_path / "helper.py"
    info = {
        "schema_version": 1, "width": 24, "height": 18,
        "bits_per_sample": 12, "exponent_bits_per_sample": 0,
        "data_color_encoding": {"color_space": 0, "white_point": 1,
                                "primaries": 11, "transfer_function": 16, "gamma": 0},
        "original_color_encoding": None,
    }
    if response == "bad-precision":
        info["bits_per_sample"] = "twelve"
    elif response == "bad-profile":
        info["data_color_encoding"]["primaries"] = []
    elif response == "bad-gamma":
        info["data_color_encoding"]["gamma"] = float("nan")
    scripts = {
        "hang": "import time; time.sleep(60)",
        "fail": "raise SystemExit(1)",
        "garbage": "print('not JSON')",
        "invalid-utf8": "import sys; sys.stdout.buffer.write(b'\\xff')",
    }
    output = json.dumps(info) if response.startswith("bad-") else response
    helper.write_text(scripts.get(response, f"print({output!r})"))
    native_run = subprocess.run
    processes = []

    def run_helper(command, **kwargs):
        assert command == [str(helper)]
        assert kwargs["timeout"] == 0.2
        try:
            return native_run([sys.executable, str(helper)], **kwargs)
        except subprocess.TimeoutExpired as error:
            processes.append(error)
            raise

    if response == "missing":
        monkeypatch.setattr(jpegxl, "resolve_binary", lambda _: None)
    elif response == "unlaunchable":
        monkeypatch.setattr(jpegxl, "resolve_binary", lambda _: tmp_path / "absent")
    else:
        monkeypatch.setattr(jpegxl, "resolve_binary", lambda _: helper)
        monkeypatch.setattr(jpegxl.subprocess, "run", run_helper)
    monkeypatch.setattr(jpegxl, "_INFO_HELPER_TIMEOUT_SECONDS", 0.2)
    decoded, metadata = jpegxl.decode_jpegxl(path)
    np.testing.assert_array_equal(decoded, expected)
    assert metadata["color_space"] == "unknown"
    assert metadata["needs_color_override"] is True
    assert metadata["jpegxl_info"]["bits_per_sample"] == 12
    assert "data_color_encoding" not in metadata["jpegxl_info"]
    if response == "hang":
        assert len(processes) == 1


def test_well_formed_helper_keeps_standard_colour_interpretation(tmp_path, monkeypatch):
    helper = tmp_path / "helper.py"
    info = {
        "schema_version": 1, "width": 24, "height": 18,
        "bits_per_sample": 12, "exponent_bits_per_sample": 0,
        "data_color_encoding": {"color_space": 0, "white_point": 1,
                                "primaries": 11, "transfer_function": 16, "gamma": 0},
        "original_color_encoding": None,
    }
    helper.write_text(f"print({json.dumps(info)!r})")
    native_run = subprocess.run

    def run_helper(command, **kwargs):
        assert kwargs["timeout"] == 5.0
        return native_run([sys.executable, str(helper)], **kwargs)

    monkeypatch.setattr(jpegxl, "resolve_binary", lambda _: helper)
    monkeypatch.setattr(jpegxl.subprocess, "run", run_helper)
    result = jpegxl._probe_basic_info(b"unused by fake helper")
    assert result == info
    assert jpegxl._standard_data_interpretation(result) == {
        "color_space": "Display P3", "transfer_function": "PQ",
    }
