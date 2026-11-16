import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent / "helpers"))
from delivery_comparison import compare_delivery, decoded_lanes, finished_capture, metric


@pytest.fixture
def captured_pair(tmp_path, monkeypatch):
    from hdr_finisher import exporters
    from hdr_finisher.models import AdjustmentState
    adjustments = AdjustmentState()
    root = tmp_path / "captures"
    monkeypatch.setenv("HDR_FINISHER_TEST_CAPTURE_DIR", str(root))
    pixels = np.full((6, 8, 3), .18, np.float32)
    monkeypatch.setattr(exporters, "_render_export_branch", lambda *args: pixels.copy())

    def execute(backend, session, settings, **kwargs):
        for lane in ("hdr", "sdr"):
            exporters._render_export_branch(session, settings, SimpleNamespace(value=lane), adjustments)
        Path(settings.output_path).write_bytes(session.payload)
        return SimpleNamespace(accepted=True, output_path=settings.output_path, renderer=session.renderer)

    monkeypatch.setattr(exporters, "_execute_export", execute)
    spec = importlib.util.spec_from_file_location("test_capture", Path(__file__).parent / "helpers/delivery_capture/capture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.install()
    files = []
    for renderer in ("gpu", "cpu"):
        target = tmp_path / f"{renderer}.jpg"
        exporters._execute_export(None, SimpleNamespace(renderer=renderer, payload=renderer.encode()),
                                 SimpleNamespace(output_path=str(target), format="jpeg_ultrahdr"))
        files.append(target)
    monkeypatch.setattr("delivery_comparison.decoded_lanes", lambda *args: {"hdr": pixels * 2, "sdr": pixels * 2})
    return files, root, pixels


def test_encoding_loss_is_reported_without_failing_renderer_agreement(captured_pair, capsys):
    files, root, pixels = captured_pair
    result = compare_delivery(*files)
    assert all(lane["passed"] for lane in result["renderer_agreement"].values())
    assert not result["encoding_fidelity"]["first"]["lanes"]["hdr"]["passed"]
    assert result["decoded_pair_diagnostic"]["hdr"]["passed"]
    folder, metadata = finished_capture(files[0])
    np.testing.assert_array_equal(np.load(folder / "hdr.npy"), pixels)
    assert metadata["renderer"] == "gpu"
    report = capsys.readouterr().err
    assert "Finished renderer agreement — PASS" in report
    assert "REPORT ONLY — jpeg_ultrahdr / gpu" in report
    assert "DIAGNOSTIC ONLY" in report
    assert "outside target" in report


def test_bad_finished_renderer_fails_even_with_identical_decodes(captured_pair):
    files, root, pixels = captured_pair
    folder, metadata = finished_capture(files[0])
    np.save(folder / "hdr.npy", pixels * 2)
    result = compare_delivery(*files)
    assert not result["renderer_agreement"]["hdr"]["passed"]
    assert result["decoded_pair_diagnostic"]["hdr"]["passed"]


def test_stale_capture_and_exact_finished_ceiling_are_not_waived(captured_pair):
    files, root, pixels = captured_pair
    folder, metadata = finished_capture(files[0])
    metadata["ceiling_nits"] = 202.99
    (folder / "metadata.json").write_text(json.dumps(metadata))
    with pytest.raises(AssertionError, match="Exact finished ceiling"):
        compare_delivery(*files)
    files[0].write_bytes(b"changed")
    with pytest.raises(AssertionError, match="Stale capture"):
        finished_capture(files[0])


def test_report_uses_unchanged_metric_limits():
    pixels = np.full((3, 4, 3), .18, np.float32)
    assert metric(pixels, pixels, "hdr")["passed"]
    assert not metric(pixels, pixels * 2, "hdr")["passed"]


def test_cli_path_strings_are_normalized_for_the_decoder(monkeypatch):
    pixels = np.full((3, 4, 3), .18, np.float32)

    def decode(path):
        assert isinstance(path, Path)
        return pixels, None, {}, None, None

    monkeypatch.setattr("delivery_comparison.load_image", decode)
    np.testing.assert_array_equal(decoded_lanes("delivery.jxl", "jpegxl_hdr", 203)["hdr"], pixels)
