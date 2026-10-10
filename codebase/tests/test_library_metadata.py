from concurrent.futures import CancelledError
from PIL import Image
import pytest
from hdr_finisher.library_metadata import read_metadata


def test_capture_date_from_existing_reader_and_no_source_writes(tmp_path):
    path = tmp_path / "photo.jpg"
    exif = Image.Exif()
    exif[34665] = {36867: "2024:02:03 04:05:06"}
    Image.new("RGB", (16, 8)).save(path, exif=exif)
    original = path.read_bytes()
    assert read_metadata([str(path)])["photos"] == [{"path": str(path), "capture_time": "2024-02-03T04:05:06"}]
    assert path.read_bytes() == original
    assert len(list(tmp_path.iterdir())) == 1


def test_missing_invalid_dates_and_cancel(tmp_path):
    path = tmp_path / "photo.jpg"
    exif = Image.Exif()
    exif[34665] = {36867: "not a date"}
    Image.new("RGB", (16, 8)).save(path, exif=exif)
    assert read_metadata([str(path)])["photos"][0]["capture_time"] is None
    with pytest.raises(CancelledError):
        read_metadata([str(path)], lambda: True)


def test_metadata_cache_tracks_changed_source(tmp_path):
    path = tmp_path / "photo.jpg"
    Image.new("RGB", (16, 8)).save(path)
    assert read_metadata([str(path)])["photos"][0]["capture_time"] is None
    exif = Image.Exif()
    exif[34665] = {36867: "2025:02:03 04:05:06"}
    Image.new("RGB", (16, 8)).save(path, exif=exif)
    assert read_metadata([str(path)])["photos"][0]["capture_time"] == "2025-02-03T04:05:06"
