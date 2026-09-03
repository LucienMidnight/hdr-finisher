from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


CORPUS_ROOT = os.environ.get("HDR_FINISHER_RAW_TEST_SUITE")


@pytest.mark.skipif(
    not CORPUS_ROOT,
    reason="set HDR_FINISHER_RAW_TEST_SUITE for the private camera-RAW qualification corpus",
)
def test_private_camera_linear_raw_corpus(tmp_path: Path) -> None:
    output = tmp_path / "qualification.json"
    subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parents[1] / "tools" / "qualify_camera_linear_raw.py"),
            "--root",
            str(CORPUS_ROOT),
            "--output",
            str(output),
            "--repeats",
            "1",
        ],
        check=True,
    )
    result = json.loads(output.read_text(encoding="utf-8"))

    assert all(item["match"] for item in result["hashes"].values())
    assert result["route_isolation"][
        "line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng"
    ]["route"] == "linear_dng"
    heic = result["route_isolation"]["iphone_16_pro_IMG_3324.HEIC"]
    assert heic["route"] == "HEIC/HEIF loader branch"
    assert heic["full_decode"] is True
    assert heic["pixels"]["dtype"] == "float32"
    assert heic["pixels"]["contiguous"] is True
    assert heic["pixels"]["non_finite_count"] == 0
    for name, qualification in result["files"].items():
        assert qualification["bridge"]["transport"]["pipeline"] == "camera_linear_float_bridge_opposed_v2", name
        assert qualification["bridge"]["pixels"]["dtype"] == "float32", name
        assert qualification["bridge"]["pixels"]["contiguous"] is True, name
        assert qualification["bridge"]["pixels"]["non_finite_count"] == 0, name
        assert qualification["comparison"]["shape_match"] is True, name
        assert qualification["highlight_reconstruction_comparison"]["shape_match"] is True, name
        reconstruction = qualification["bridge"]["transport"]["metadata"]["highlight_reconstruction"]
        assert reconstruction["enabled"] is True, name
        assert reconstruction["method"] == "opposed_color_v1", name
    niagara = result["files"]["2L1B8631.CR2"]
    assert niagara["legacy"]["transport"]["exact_65535_count"][2] > 1_000_000
    assert niagara["bridge"]["transport"]["exact_65535_count"] == [0, 0, 0]
    assert sum(niagara["bridge"]["pixels"]["above_one_count"]) > 0
