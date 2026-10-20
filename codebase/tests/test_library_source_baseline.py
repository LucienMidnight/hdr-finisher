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
    assert result["summary"]["paired"]["preparations"] == [1]
    assert all(run["sources"][0]["has_reference"] for run in result["runs"])
    assert source.read_bytes() == before
    assert sidecar.read_bytes() == b"existing sidecar must not be read or changed"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["original.png", "original.png.hdrf"]


def _iso_probe_text(base="0/1", alternate="5/2", gamma="3/2"):
    def scalar(name, fraction):
        return f" * {name}: 0 (as fraction: {fraction})"
    def channels(name, fractions):
        return f" * {name}: " + " ".join(f"{c} 0 (as fraction: {f})" for c, f in zip("RGB", fractions))
    return "\n".join([
        scalar("Base headroom", base), scalar("Alternate headroom", alternate),
        channels("Gain Map Min", ["-1/2", "-1/3", "-1/4"]),
        channels("Gain Map Max", ["5/2", "7/3", "9/4"]),
        channels("Base Offset", ["1/64", "1/32", "1/16"]),
        channels("Alternate Offset", ["1/128", "1/64", "1/32"]),
        channels("Gain Map Gamma", [gamma, "2/1", "5/2"]),
        " * Use Base Color Space: False"])


def test_iso_probe_keeps_direction_exact_headroom_and_per_channel_metadata(monkeypatch):
    import pytest
    monkeypatch.syspath_prepend(str(Path(__file__).parent / "performance"))
    driver = importlib.import_module("library-source-baseline")
    for base, alternate in [("0/1", "15558869/4194304"), ("5/2", "0/1")]:
        fields = driver.parse_iso_metadata_probe(_iso_probe_text(base, alternate))
        assert fields["base_headroom"]["fractions"] == [[int(v) for v in base.split("/")]]
        assert fields["alternate_headroom"]["fractions"] == [[int(v) for v in alternate.split("/")]]
        assert fields["gain_map_gamma"]["values"] == [1.5, 2., 2.5]
        assert fields["gain_map_min"]["values"] == pytest.approx([-.5, -1/3, -.25])
        assert fields["base_offset"]["values"] == [1/64, 1/32, 1/16]
        assert fields["alternate_offset"]["values"] == [1/128, 1/64, 1/32]
        assert fields["use_base_color_space"] is False
    for invalid in [_iso_probe_text(gamma="0/1"), _iso_probe_text(gamma="1/0"),
                    _iso_probe_text().replace(" B 0 (as fraction: 5/2)", ""), ""]:
        with pytest.raises((ValueError, ZeroDivisionError)):
            driver.parse_iso_metadata_probe(invalid)


def test_iso_interface_probe_preserves_real_source_and_does_not_claim_gpu(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parent / "performance"))
    driver = importlib.import_module("library-source-baseline")
    result = driver.profile_iso_gainmap(Path(__file__).parents[1] / "samples/hdr_reference.avif", 1)
    assert result["qualified_gpu_interface"] is False
    assert result["info"]["gain_map_present"] is True
    cpu, extracted = result["runs"]
    assert cpu["sdr_base_preserved"] is True
    assert cpu["decoder_reference_white_nits"] == 203
    assert extracted["shape"] == cpu["shape"]
    assert extracted["dtype"] == "uint16"
    assert result["library_rejection"]
