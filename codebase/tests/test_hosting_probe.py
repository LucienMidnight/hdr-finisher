from __future__ import annotations

from email.message import Message
from pathlib import Path

from hdr_finisher.hosting_probe import inspect_delivery_file, probe_hosted_url


JPEG_GAIN_MAP = (
    b"\xff\xd8first"
    b"http://ns.adobe.com/hdr-gain-map/1.0/ hdrgm:Version"
    b"urn:iso:std:iso:ts:21496:-1"
    b"\xff\xd8second"
    b"\xff\xd9"
)


class _Response:
    status = 200

    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.headers = Message()
        self.headers["Content-Type"] = "image/jpeg"
        self.headers["ETag"] = '"test"'

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload

    def geturl(self) -> str:
        return "https://cdn.example/image.jpg"

    def getcode(self) -> int:
        return self.status


def test_inspect_delivery_file_detects_both_jpeg_metadata_flavors(tmp_path: Path) -> None:
    image = tmp_path / "proof.jpg"
    image.write_bytes(JPEG_GAIN_MAP)
    result = inspect_delivery_file(image)
    assert result["format"] == "jpeg_ultrahdr"
    assert result["gain_map_present"] is True
    assert result["metadata"]["ultra_hdr_v1_xmp"] is True
    assert result["metadata"]["iso_21496_1"] is True


def test_probe_hosted_url_reports_byte_and_metadata_survival(monkeypatch, tmp_path: Path) -> None:
    original = tmp_path / "proof.jpg"
    original.write_bytes(JPEG_GAIN_MAP)
    monkeypatch.setattr("hdr_finisher.hosting_probe.urlopen", lambda *_args, **_kwargs: _Response(JPEG_GAIN_MAP))
    result = probe_hosted_url("https://example.test/proof.jpg", original=original)
    assert result["bytes_identical"] is True
    assert result["gain_map_preserved"] is True
    assert result["metadata_preserved"] is True
    assert result["content_type"] == "image/jpeg"


def test_probe_hosted_url_reports_destructive_format_conversion(monkeypatch, tmp_path: Path) -> None:
    original = tmp_path / "proof.jpg"
    original.write_bytes(JPEG_GAIN_MAP)
    png = b"\x89PNG\r\n\x1a\nconverted"
    monkeypatch.setattr("hdr_finisher.hosting_probe.urlopen", lambda *_args, **_kwargs: _Response(png))
    result = probe_hosted_url("https://example.test/transformed", original=original)
    assert result["delivered"]["format"] == "png"
    assert result["bytes_identical"] is False
    assert result["gain_map_preserved"] is False
    assert result["metadata_preserved"] is False
