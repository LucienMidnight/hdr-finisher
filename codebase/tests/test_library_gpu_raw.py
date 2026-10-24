"""Camera RAW Library thumbnails developed on the GPU: the backend half."""
import json
import os

import numpy as np
import pytest

from hdr_finisher import library_gpu_raw as gpu_raw
from hdr_finisher.library_pictures import LibraryPictureCache


def test_frame_round_trip_keeps_payload_aligned():
    header = {"path": "photo.ARW", "values": [1, 2, 3]}
    payload = np.arange(10, dtype="<u2").tobytes()
    body = gpu_raw.frame(header, payload)
    length = int.from_bytes(body[:4], "little")
    assert (4 + length) % 4 == 0
    decoded, rest = gpu_raw.unframe(body)
    assert decoded == header and bytes(rest) == payload
    with pytest.raises(ValueError):
        gpu_raw.unframe(body[:3])


@pytest.mark.parametrize("name", ["photo.png", "photo.dng", "photo.jpg"])
def test_photos_outside_the_gpu_route_keep_the_cpu_route(tmp_path, name):
    photo = tmp_path / name
    photo.write_bytes(b"not read")
    with pytest.raises(gpu_raw.NotEligible):
        gpu_raw.sensor(photo)


def _payload(height, width, value):
    planes = np.empty((3, height, width), dtype="<f4")
    for channel, level in enumerate(value):
        planes[channel] = level
    return planes.tobytes()


def _header(photo, flip=0, height=8, width=12):
    return {"path": str(photo), "identity": gpu_raw._identity(photo), "edge": 640, "flip": flip,
            "height": height, "width": width, "source_width": 4000, "source_height": 3000,
            "peaks": {"peak": 2.5, "peak_luma": 2.0, "peak_bt2020": 2.6},
            "robust": {"luma": 1.5, "channel": 1.8, "bt2020": 1.9},
            "raw_start_brightness": {"calibration_ev": -0.8}, "lens_corrected": False, "gpu_ms": 120}


def test_developed_picture_is_stored_where_grade_development_would_be(tmp_path):
    photo = tmp_path / "photo.ARW"
    photo.write_bytes(b"read-only fixture")
    cache = LibraryPictureCache(tmp_path / "cache")
    result = gpu_raw.developed(cache, str(photo), _header(photo, flip=6), _payload(8, 12, (0.1, 0.2, 0.3)))
    assert result["route"] == gpu_raw.ROUTE and result["renderer"] == "gpu"
    # Turned like LibRaw's output: a 90 degree flip swaps height and width.
    assert (result["height"], result["width"]) == (12, 8)
    # The starting grade is Grade's, computed from the GPU's full-source peaks.
    from hdr_finisher.import_defaults import starting_adjustments
    from hdr_finisher.models import HDRAnalysis, HDRClassification
    expected = starting_adjustments(HDRAnalysis(
        classification=HDRClassification.HDR_TRUE, peak_linear=2.5, robust_peak_linear=1.8,
        peak_luma_linear=2.0, robust_peak_luma_linear=1.5, peak_bt2020_linear=2.6,
        robust_peak_bt2020_linear=1.9, badge_message=""))
    assert result["adjustments"] == expected.model_dump(mode="json")
    from hdr_finisher.models import EditDocument
    from hashlib import sha256
    document = EditDocument.model_validate(cache.default_document(photo))
    assert document.global_adjustments == expected
    assert document.source.fingerprint_sha256 == sha256(photo.read_bytes()).hexdigest()
    assert document.source.durable_path == str(photo.resolve())
    # Grade's own request for this photo now finds it in the cache.
    cached = cache.cached(photo, 640, "grade-thumbnail")
    assert cached and cached["key"] == result["key"] and cached["route"] == gpu_raw.ROUTE
    with np.load(cache.file(result["key"])) as stored:
        np.testing.assert_allclose(stored["pixels"][0, 0], [0.1, 0.2, 0.3], rtol=1e-3)
    assert photo.read_bytes() == b"read-only fixture"


def test_a_photo_changed_during_development_is_not_stored(tmp_path):
    photo = tmp_path / "photo.ARW"
    photo.write_bytes(b"first")
    header = _header(photo)
    photo.write_bytes(b"changed contents")
    cache = LibraryPictureCache(tmp_path / "cache")
    with pytest.raises(ValueError, match="changed"):
        gpu_raw.developed(cache, str(photo), header, _payload(8, 12, (0.1, 0.1, 0.1)))
    assert cache.cached(photo, 640, "grade-thumbnail") is None


def test_invalid_gpu_pixels_are_rejected(tmp_path):
    photo = tmp_path / "photo.ARW"
    photo.write_bytes(b"fixture")
    cache = LibraryPictureCache(tmp_path / "cache")
    with pytest.raises(ValueError, match="invalid"):
        gpu_raw.developed(cache, str(photo), _header(photo), _payload(8, 12, (np.nan, 0.1, 0.1)))


def test_native_gpu_source_is_retained_once_and_cropped_without_cpu_decode(tmp_path, monkeypatch):
    photo = tmp_path / "photo.ARW"; photo.write_bytes(b"read-only native fixture")
    cache = LibraryPictureCache(tmp_path / "cache")
    header = _header(photo, height=8, width=12)
    header.update(native_mode=True, edge=100000, source_width=12, source_height=8)
    from hdr_finisher import library_pictures
    monkeypatch.setattr(library_pictures, "decode_picture", lambda *a, **k: (
        np.full((8,12,3), .05, dtype=np.float32), None, {"route":"camera-raw", "raw_input":True}))
    cpu_crop = cache.build_native(photo,.5,.5,6,4)
    result = gpu_raw.developed(cache, str(photo), header, _payload(8,12,(.1,.2,.3)))
    assert result == {"native_ready":True,"renderer":"gpu"}
    assert cache.gpu_native_ready(photo)
    from hdr_finisher import library_pictures
    monkeypatch.setattr(library_pictures, "decode_picture", lambda *a, **k: pytest.fail("native GPU scene must not redevelop on CPU"))
    crop = cache.build_native(photo,.5,.5,6,4)
    assert crop['key'] != cpu_crop['key']
    assert (crop['width'],crop['height'],crop['crop_x'],crop['crop_y']) == (6,4,3,2)
    assert crop['renderer'] == 'gpu'
    assert cache.default_document(photo)
    other = tmp_path / 'other.ARW';other.write_bytes(b'another photo')
    header = _header(other,height=8,width=12)
    header.update(native_mode=True,source_width=12,source_height=8)
    gpu_raw.developed(cache,str(other),header,_payload(8,12,(.2,.3,.4)))
    assert cache.gpu_native_ready(other) and not cache.gpu_native_ready(photo)


def test_gpu_handoff_preserves_nanosecond_identity_and_rejects_same_size_changes(tmp_path):
    photo = tmp_path / "photo.ARW"
    photo.write_bytes(b"read-only fixture")
    stamp = 1792815693440161676
    os.utime(photo, ns=(stamp, stamp))
    stat = photo.stat()
    assert int(float(stat.st_mtime_ns)) != stat.st_mtime_ns
    header = _header(photo)
    # Model JSON.parse / JSON.stringify in the renderer: numeric identity
    # fields pass through IEEE-754 doubles, while strings remain exact.
    header["identity"] = json.loads(json.dumps(header["identity"]), parse_int=lambda value: int(float(value)))
    cache = LibraryPictureCache(tmp_path / "cache")
    payload = _payload(8, 12, (0.1, 0.2, 0.3))
    result = gpu_raw.developed(cache, str(photo), header, payload)
    assert result["renderer"] == "gpu"
    assert photo.read_bytes() == b"read-only fixture"
    # Still reject a same-size source whose timestamp changed by less than
    # the precision lost in the browser handoff.
    changed_stamp = stat.st_mtime_ns + 100
    os.utime(photo, ns=(stat.st_atime_ns, changed_stamp))
    assert photo.stat().st_mtime_ns != stat.st_mtime_ns
    with pytest.raises(ValueError, match="changed"):
        gpu_raw.developed(cache, str(photo), header, payload)
