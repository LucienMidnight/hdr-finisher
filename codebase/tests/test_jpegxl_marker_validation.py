"""Bad typed marker values must be reported as a JPEG XL input error."""
import json
import struct

import pytest

from hdr_finisher.jpegxl import JPEGXLError, inspect_jpegxl


@pytest.mark.parametrize("field,value", [
    ("schema_version", []), ("schema_version", {}),
    ("bit_depth", []), ("sample_type", {}), ("transfer_function", []),
])
def test_malformed_marker_reports_codec_error(tmp_path, field, value):
    marker = {"schema_version": 3, "color_space": "BT.2020", "transfer_function": "PQ",
              "bit_depth": 12, "sample_type": "integer", "reference_white_nits": 203}
    marker[field] = value
    body = json.dumps(marker).encode()
    path = tmp_path / "malformed.jxl"
    path.write_bytes(b"\x00\x00\x00\x0cJXL \r\n\x87\n" + struct.pack(">I4s", len(body) + 8, b"hfmd") + body)
    with pytest.raises(JPEGXLError):
        inspect_jpegxl(path)
