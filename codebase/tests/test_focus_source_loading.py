"""Focus source loading preserves import pixels without a Grade document."""
from concurrent.futures import CancelledError
from contextlib import contextmanager
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher import loader, library_overlays as overlays, library_pictures
from hdr_finisher.models import RawImportSettings


@pytest.fixture
def raw_source(tmp_path, monkeypatch):
    path = tmp_path / "source.arw"
    path.write_bytes(b"stand-in camera source")
    from hdr_finisher import file_gate
    monkeypatch.setattr(file_gate, "decode_suffix", lambda p: ".arw")
    pixels = np.arange(18*24*3, dtype=np.float32).reshape(18, 24, 3) / 1000
    calls = []
    def decode(path, settings, **kwargs):
        calls.append(settings.model_dump())
        # Stand-in decoder output is already oriented and lens corrected.
        return pixels.copy(), {"decoder_normalized_to_acescg": True,
            "color_space": "ACEScg", "transfer_function": "LINEAR", "raw_input": True}
    monkeypatch.setattr(loader, "decode_raw", decode)
    return path, calls


def test_full_raw_matches_native_session_pixels_and_defaults(raw_source, monkeypatch):
    from hdr_finisher.sessions import SessionStore
    path, calls = raw_source
    native = library_pictures.decode_picture(path, 100000, "native")[0]
    def forbidden(*args, **kwargs):
        pytest.fail("Focus created a Grade session or classified HDR")
    monkeypatch.setattr(SessionStore, "prepare_session", forbidden)
    monkeypatch.setattr(loader, "classify_hdr", forbidden)
    import hdr_finisher.sessions as sessions
    monkeypatch.setattr(sessions, "_sha256_file", forbidden)
    direct = overlays.full_focus_source(path)
    np.testing.assert_array_equal(direct, native)
    assert calls == [RawImportSettings().model_dump()] * 2
    assert calls[0]["demosaic"] == "ahd"
    assert calls[0]["white_balance"] == "as_shot"
    assert calls[0]["lens"]["mode"] == "auto"


def test_analysis_is_optional_and_default_is_preserved(raw_source, monkeypatch):
    path, _ = raw_source
    seen = []
    marker = object()
    def classify(*args, **kwargs):
        seen.append(args[0].copy())
        return marker
    monkeypatch.setattr(loader, "classify_hdr", classify)
    normal = loader.load_image(path)
    skipped = loader.load_image(path, analyze_hdr=False)
    assert normal[3] is marker and skipped[3] is None and len(seen) == 1
    np.testing.assert_array_equal(normal[0], skipped[0])
    assert normal[1] == skipped[1]


def test_direct_raw_uses_library_cpu_band(raw_source, monkeypatch):
    from hdr_finisher import cpu_budget
    path, _ = raw_source
    active = []
    original = loader.decode_raw
    @contextmanager
    def band():
        active.append(True)
        try: yield
        finally: active.pop()
    monkeypatch.setattr(cpu_budget, "library_bands", band)
    def decode(*args, **kwargs):
        assert active
        return original(*args, **kwargs)
    monkeypatch.setattr(loader, "decode_raw", decode)
    overlays.full_focus_source(path)
    assert not active


@pytest.mark.parametrize("route_name", ["LINEAR_DNG", "MOSAICED_RAW_DNG"])
def test_dng_keeps_existing_route_boundary(tmp_path, monkeypatch, route_name):
    from hdr_finisher import linear_dng
    path = tmp_path / "source.dng"
    pixels = np.ones((10, 12, 3), dtype=np.float32)
    route = getattr(linear_dng.DngRoute, route_name)
    monkeypatch.setattr(linear_dng, "inspect_dng", lambda p: SimpleNamespace(route=route))
    calls = []
    def native(*args):
        calls.append("native")
        return pixels, None, {}
    def direct(*args, **kwargs):
        assert kwargs["analyze_hdr"] is False
        calls.append("loader")
        return pixels, None, {}, None, None
    monkeypatch.setattr(library_pictures, "decode_picture", native)
    monkeypatch.setattr(loader, "load_image", direct)
    assert overlays.full_focus_source(path) is pixels
    assert calls == (["native"] if route_name == "LINEAR_DNG" else ["loader"])


def test_cancelled_full_source_does_not_decode(raw_source, monkeypatch):
    path, calls = raw_source
    with pytest.raises(CancelledError):
        overlays.full_focus_source(path, lambda: True)
    assert calls == []


def test_cancellation_reaches_loader(raw_source, monkeypatch):
    path, _ = raw_source
    checks = []
    def cancelled():
        checks.append(True)
        return len(checks) >= 3
    with pytest.raises(loader.LoaderError, match="cancelled"):
        overlays.full_focus_source(path, cancelled)


@pytest.mark.parametrize("suffix,quality", [(".png", "full"), (".arw", "half")])
def test_other_focus_routes_still_use_picture_decoder(tmp_path, monkeypatch, suffix, quality):
    path = tmp_path / ("source" + suffix)
    path.write_bytes(b"source")
    calls = []
    def decode(p, edge, mode):
        calls.append(mode)
        return np.ones((32, 48, 3), dtype=np.float32), None, {"route": "quick-half-raw"}
    monkeypatch.setattr(library_pictures, "decode_picture", decode)
    monkeypatch.setattr(overlays, "camera_frame", lambda *args: {})
    maps = overlays.OverlayMaps(tmp_path / "cache")
    maps.build(path, "focus", quality)
    assert calls == (["native"] if quality == "full" else ["quick"])


def test_changed_full_raw_source_is_not_published(raw_source, tmp_path, monkeypatch):
    path, _ = raw_source
    maps = overlays.OverlayMaps(tmp_path / "cache")
    original = overlays.full_focus_source
    def changed(*args):
        pixels = original(*args)
        path.write_bytes(b"changed photo with different size")
        return pixels
    monkeypatch.setattr(overlays, "full_focus_source", changed)
    monkeypatch.setattr(overlays, "camera_frame", lambda *args: {})
    with pytest.raises(ValueError, match="source photo changed"):
        maps.build(path, "focus", "full")
    assert not list(maps.cache.root.glob("*.map.npz"))
    assert not list(maps.cache.root.glob("*.tmp"))
