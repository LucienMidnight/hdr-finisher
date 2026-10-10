from concurrent.futures import CancelledError
from PIL import Image
import pytest
from PIL.TiffImagePlugin import IFDRational
from hdr_finisher.library_metadata import FACT_FIELDS, read_metadata


def test_capture_date_from_existing_reader_and_no_source_writes(tmp_path):
    path = tmp_path / "photo.jpg"
    exif = Image.Exif()
    exif[34665] = {36867: "2024:02:03 04:05:06"}
    Image.new("RGB", (16, 8)).save(path, exif=exif)
    original = path.read_bytes()
    record = read_metadata([str(path)])["photos"][0]
    assert record["path"] == str(path) and record["capture_time"] == "2024-02-03T04:05:06"
    assert record["bytes"] == len(original) and record["mtime_ns"] == path.stat().st_mtime_ns
    # Facts the file does not record stay empty; nothing is guessed.
    assert set(record) == {"path", "bytes", "mtime_ns", *FACT_FIELDS}
    assert all(record[name] is None for name in FACT_FIELDS if name != "capture_time")
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


def test_camera_lens_exposure_and_location_facts(tmp_path):
    path = tmp_path / "photo.jpg"
    exif = Image.Exif()
    exif[271], exif[272] = "SONY", "ILCE-7RM3"
    exif[34665] = {33434: IFDRational(1, 250), 33437: IFDRational(28, 10), 34855: 400, 37386: IFDRational(85, 1),
        41989: 127, 42036: "FE 85mm F1.8", 37380: IFDRational(-1, 3), 40962: 6000, 40963: 4000}
    exif[34853] = {1: "S", 2: (IFDRational(52), IFDRational(30), IFDRational(0)), 3: "E", 4: (IFDRational(13), IFDRational(24), IFDRational(36))}
    Image.new("RGB", (16, 8)).save(path, exif=exif)
    record = read_metadata([str(path)])["photos"][0]
    assert (record["camera_make"], record["camera"], record["lens"], record["lens_make"]) == ("SONY", "ILCE-7RM3", "FE 85mm F1.8", None)
    assert (record["iso"], record["focal_length"], record["focal_length_35"], record["width"], record["height"]) == (400, 85.0, 127, 6000, 4000)
    assert record["shutter"] == pytest.approx(1 / 250) and record["aperture"] == pytest.approx(2.8)
    assert record["exposure_bias"] == pytest.approx(-1 / 3)
    assert (record["latitude"], record["longitude"]) == (-52.5, 13.41)


def test_unsupported_and_missing_files_have_no_facts(tmp_path):
    text = tmp_path / "notes.txt"
    text.write_text("not a photo")
    records = read_metadata([str(text), str(tmp_path / "gone.jpg")])["photos"]
    assert all(record[name] is None for record in records for name in FACT_FIELDS)
    assert all("mtime_ns" not in record for record in records)
