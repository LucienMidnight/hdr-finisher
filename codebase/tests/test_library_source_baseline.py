"""Exercise the measurement driver against real stored scenes in a disposable profile."""
import importlib
from pathlib import Path

from PIL import Image


def test_source_baseline_counts_preparations_without_touching_source_or_sidecar(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parent / "performance"))
    driver = importlib.import_module("library-source-baseline")
    source = tmp_path / "original.png"
    Image.new("RGB", (80, 40), (120, 80, 40)).save(source)
    sidecar = source.with_name(source.name + ".hdrf")
    sidecar.write_bytes(b"existing sidecar must not be read or changed")
    before = source.read_bytes()
    result = driver.measure({"name": "png", "path": str(source)}, repeats=1)
    assert result["summary"]["sequential"]["preparations"] == [1]
    assert result["summary"]["paired"]["preparations"][0] in (1, 2)
    assert all(run["sources"][0]["has_reference"] for run in result["runs"])
    assert source.read_bytes() == before
    assert sidecar.read_bytes() == b"existing sidecar must not be read or changed"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["original.png", "original.png.hdrf"]
