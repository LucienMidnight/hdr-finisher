from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
import tifffile
from PIL import Image

from hdr_finisher.linear_dng import DngRoute, crop_and_orient, decode_linear_dng, inspect_dng
from hdr_finisher.dng_opcodes import DngImportCancelled
from hdr_finisher.loader import LoaderError, load_image
from hdr_finisher.resource_preflight import GIB, ResourceSnapshot
from hdr_finisher.sessions import SessionStore


RESOURCES = ResourceSnapshot(64 * GIB, 48 * GIB, "test")


def _write_linear(path: Path, image: np.ndarray, *, subifd: bool = False, extra_tags=(), compression=None, compressionargs=None) -> None:
    color_matrix = tuple(value for item in np.eye(3, dtype=int).reshape(-1) for value in (int(item), 1))
    neutral = (96422, 100000, 1, 1, 82521, 100000)
    extra = [
        (50706, "B", 4, b"\x01\x04\x00\x00", False),
        (50721, "2i", 9, color_matrix, False),
        (50964, "2i", 9, color_matrix, False),
        (50778, "H", 1, 23, False),
        (50728, "2I", 3, neutral, False),
    ]
    extra.extend(extra_tags)
    if subifd:
        with tifffile.TiffWriter(path) as tif:
            tif.write(np.zeros((2, 3, 3), np.uint8), photometric="rgb", subfiletype=1, subifds=1, extratags=extra)
            tif.write(
                image,
                photometric=34892,
                planarconfig="contig",
                metadata={"axes": "YXS"},
                subfiletype=0,
                extratags=extra,
            )
    else:
        tifffile.imwrite(
            path,
            image,
            compression=compression,
            compressionargs=compressionargs,
            photometric=34892,
            planarconfig="contig",
            metadata={"axes": "YXS"},
            extratags=extra,
        )


def test_root_preview_full_primary_subifd_is_selected_and_decoded(tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    source = np.asarray([[[0, 32768, 65535], [65535, 0, 32768]]], dtype=np.uint16)
    _write_linear(path, source, subifd=True)
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.LINEAR_DNG
    assert (inspection.width, inspection.height) == (2, 1)
    assert inspection.primary_series_index == 1
    image, metadata = decode_linear_dng(path, inspection)
    assert image.shape == source.shape
    assert image.dtype == np.float32
    assert metadata["experimental_dng_label"] == "Experimental DNG Import"


def test_full_resolution_rendered_preview_becomes_compact_sdr_reference(tmp_path: Path) -> None:
    path = tmp_path / "linear-with-rendered-preview.dng"
    color_matrix = tuple(value for item in np.eye(3, dtype=int).reshape(-1) for value in (int(item), 1))
    neutral = (96422, 100000, 1, 1, 82521, 100000)
    extra = [
        (50706, "B", 4, b"\x01\x04\x00\x00", False),
        (50721, "2i", 9, color_matrix, False),
        (50964, "2i", 9, color_matrix, False),
        (50778, "H", 1, 23, False),
        (50728, "2I", 3, neutral, False),
    ]
    rendered = np.full((2, 3, 3), 128, dtype=np.uint8)
    with tifffile.TiffWriter(path) as tif:
        tif.write(
            np.zeros((2, 3, 3), dtype=np.uint16),
            photometric=34892,
            planarconfig="contig",
            metadata={"axes": "YXS"},
            extratags=extra,
        )
        tif.write(rendered, photometric="rgb", subfiletype=1, metadata={"axes": "YXS"})

    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    assert inspection.metadata["sdr_preview_series_index"] == 1
    _image, metadata = decode_linear_dng(path, inspection)
    reference = metadata["sdr_reference_image"]
    assert reference.dtype == np.float16
    assert reference.shape == rendered.shape
    assert float(reference[0, 0, 0]) == pytest.approx(0.21586, abs=3e-4)
    assert metadata["dng_sdr_rendition"] == "embedded_full_resolution"


def test_mosaiced_primary_wins_over_reduced_linear_proxy(tmp_path: Path) -> None:
    path = tmp_path / "mosaic.dng"
    with tifffile.TiffWriter(path) as tif:
        tif.write(
            np.zeros((8, 12), np.uint16),
            photometric=32803,
            subifds=1,
            extratags=[
                (50706, "B", 4, b"\x01\x04\x00\x00", False),
                (33422, "B", 4, b"\x00\x01\x01\x02", False),
            ],
        )
        tif.write(np.zeros((2, 3, 3), np.uint16), photometric=34892, subfiletype=1)
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.MOSAICED_RAW_DNG
    assert (inspection.width, inspection.height) == (12, 8)


def test_inspection_does_not_decode_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    _write_linear(path, np.zeros((2, 3, 3), np.uint16))

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("payload decode attempted")

    monkeypatch.setattr(tifffile.TiffPage, "asarray", forbidden)
    assert inspect_dng(path, resource_snapshot=RESOURCES).route is DngRoute.LINEAR_DNG


def test_active_area_crop_precedes_orientation() -> None:
    image = np.arange(5 * 6 * 3, dtype=np.float32).reshape(5, 6, 3)
    metadata = {
        "active_area": (1, 1, 5, 6),
        "default_crop_origin": (1.0, 1.0),
        "default_crop_size": (3.0, 2.0),
        "orientation": 6,
    }
    cropped = image[2:4, 2:5]
    assert np.array_equal(crop_and_orient(image, metadata), np.rot90(cropped, 3))


def test_untouched_hdr_merge_xmp_crop_follows_orientation() -> None:
    image = np.arange(6 * 8 * 3, dtype=np.float32).reshape(6, 8, 3)
    metadata = {
        "active_area": (0, 0, 6, 8),
        "default_crop_origin": (0.0, 0.0),
        "default_crop_size": (8.0, 6.0),
        "orientation": 1,
        "xmp_merge_crop": (0.125, 1.0 / 6.0, 0.875, 5.0 / 6.0),
    }
    assert np.array_equal(crop_and_orient(image, metadata), image[1:5, 1:7])


def test_changed_file_fingerprint_rejects_before_decode(tmp_path: Path) -> None:
    path = tmp_path / "linear.dng"
    _write_linear(path, np.zeros((2, 3, 3), np.uint16))
    inspection = inspect_dng(path, resource_snapshot=RESOURCES)
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
    with pytest.raises(Exception, match="changed after inspection"):
        decode_linear_dng(path, inspection)


def test_real_local_corpus_routes_when_present() -> None:
    root = Path("local-test-media/inputs/linear-dng")
    if not root.exists():
        pytest.skip("Ignored private Linear DNG corpus is not present.")
    expected = {
        "2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng": DngRoute.LINEAR_DNG,
        "DSC06885_DxO.dng": DngRoute.LINEAR_DNG,
        "DSC06885_DxO-neutral.dng": DngRoute.LINEAR_DNG,
        "lightroom-classic-DNG-test-1.dng": DngRoute.MOSAICED_RAW_DNG,
        "DSC01204_ACR_Linear.dng": DngRoute.LINEAR_DNG,
        "DJI_0071-2-HDR.dng": DngRoute.LINEAR_DNG,
        "DJI_0071.DNG": DngRoute.MOSAICED_RAW_DNG,
        "DJI_0072.DNG": DngRoute.MOSAICED_RAW_DNG,
    }
    for path in root.rglob("*.[dD][nN][gG]"):
        inspection = inspect_dng(path, resource_snapshot=RESOURCES)
        assert inspection.route is expected[path.name], (path, inspection.rejection)


def test_loader_routes_linear_dng_before_generic_raw_decoder(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("hdr_finisher.linear_dng.detect_memory_resources", lambda: RESOURCES)
    path = tmp_path / "linear.dng"
    _write_linear(path, np.zeros((2, 3, 3), np.uint16))
    monkeypatch.setattr(
        "hdr_finisher.loader.decode_raw",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("generic RAW route used")),
    )
    image, descriptor, metadata, _analysis, _sdr = load_image(path)
    assert image.shape == (2, 3, 3)
    assert descriptor.source_color_space == "Camera native (embedded DNG profile)"
    assert descriptor.working_space == "ACEScg"
    assert metadata["experimental_dng_import"] is True
    assert metadata["dng_highlight_color_recovery"] == "spatial_camera_neutral_reconstruction_near_linear_response_limit"


def test_loader_preserves_mosaiced_route_and_passes_inspection_plan(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "mosaic.dng"
    with tifffile.TiffWriter(path) as tif:
        tif.write(
            np.zeros((8, 12), np.uint16),
            photometric=32803,
            extratags=[
                (50706, "B", 4, b"\x01\x04\x00\x00", False),
                (33422, "B", 4, b"\x00\x01\x01\x02", False),
            ],
        )
    captured: dict[str, object] = {}

    def fake_raw(_path: Path, _settings: object, **kwargs: object) -> tuple[np.ndarray, dict[str, object]]:
        captured.update(kwargs)
        return np.full((8, 12, 3), 0.18, np.float32), {
            "bit_depth": "test",
            "color_space": "ACEScg",
            "transfer_function": "LINEAR",
            "decoder_normalized_to_acescg": True,
            "raw_mosaiced": True,
        }

    monkeypatch.setattr("hdr_finisher.loader.decode_raw", fake_raw)
    load_image(path)
    assert captured["dng_inspection"].route is DngRoute.MOSAICED_RAW_DNG


def test_failed_dng_candidate_does_not_replace_active_session(tmp_path: Path) -> None:
    source = tmp_path / "current.png"
    Image.new("RGB", (4, 3), (32, 64, 96)).save(source)
    store = SessionStore()
    active = store.prepare_session(source)
    store.activate_session(active)
    invalid = tmp_path / "invalid.dng"
    tifffile.imwrite(invalid, np.zeros((2, 2), np.uint8))
    with pytest.raises(LoaderError, match="DNGVersion"):
        store.prepare_session(invalid)
    assert store.current() is active


def test_dng_memory_failure_is_clear_and_transactional(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("hdr_finisher.linear_dng.detect_memory_resources", lambda: RESOURCES)
    source = tmp_path / "current.png"
    Image.new("RGB", (4, 3), (32, 64, 96)).save(source)
    candidate = tmp_path / "candidate.dng"
    _write_linear(candidate, np.zeros((2, 3, 3), np.uint16))
    store = SessionStore()
    active = store.prepare_session(source)
    store.activate_session(active)
    monkeypatch.setattr(
        "hdr_finisher.loader.decode_linear_dng",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(MemoryError()),
    )
    with pytest.raises(LoaderError, match="ran out of memory.*not changed"):
        store.prepare_session(candidate)
    assert store.current() is active


def test_dng_cancellation_is_transactional(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("hdr_finisher.linear_dng.detect_memory_resources", lambda: RESOURCES)
    source = tmp_path / "current.png"
    Image.new("RGB", (4, 3), (32, 64, 96)).save(source)
    candidate = tmp_path / "candidate.dng"
    _write_linear(candidate, np.zeros((2, 3, 3), np.uint16))
    store = SessionStore()
    active = store.prepare_session(source)
    store.activate_session(active)
    monkeypatch.setattr(
        "hdr_finisher.loader.decode_linear_dng",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            DngImportCancelled("Experimental DNG import cancelled")
        ),
    )
    with pytest.raises(LoaderError, match="cancelled"):
        store.prepare_session(candidate)
    assert store.current() is active


@pytest.mark.parametrize('compression',[None,'jpegxl','jpegxl_lossy'])
@pytest.mark.parametrize('bits',[10,12,16])
@pytest.mark.usefixtures("ample_preflight_memory")
def test_table_dng_matches_expanded_neutral_dng_and_selects_cpu(tmp_path,compression,bits):
    from hdr_finisher.library_estimates import gpu_metadata
    from hdr_finisher.library_dng import decoded
    from hdr_finisher.library_live import recipe
    from hdr_finisher.library_gpu_raw import NotEligible
    if compression in {'jpegxl','jpegxl_lossy'}:
        import imagecodecs
        if not imagecodecs.JPEGXL.available: pytest.skip('JPEG XL decoder unavailable')
    source=np.random.default_rng(bits).integers(0,2**bits,(24,32,3),dtype=np.uint16)
    table=np.rint(np.linspace(0,65535,2**bits)**1.0).astype(np.uint16)
    table[:4]=[0,2,5,11]
    path=tmp_path/'table.dng';expanded=tmp_path/'expanded.dng'
    _write_linear(path,source,compression='jpegxl' if compression=='jpegxl_lossy' else compression,
                  compressionargs={'distance':1.0,'lossless':False} if compression=='jpegxl_lossy' else None,extra_tags=[
        (50712,'H',len(table),table,False),
        (52525,'B',4,b'look',False),
        (50717,'H',3,(65535,65535,65535),False),
        (274,'H',1,6,False)])
    stored=tifffile.imread(path)
    _write_linear(expanded,table[np.minimum(stored,len(table)-1)],extra_tags=[(274,'H',1,6,False)])
    inspection=inspect_dng(path,resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.LINEAR_DNG
    assert any('ProfileGainTableMap' in warning and 'neutral' in warning for warning in inspection.warnings)
    actual,metadata=decode_linear_dng(path,inspection,library_edge=16)
    expected,_=decode_linear_dng(expanded,inspect_dng(expanded,resource_snapshot=RESOURCES))
    np.testing.assert_array_equal(actual,expected)
    assert actual.shape==(32,24,3)
    assert metadata['dng_linearization']=='lookup_table'
    assert gpu_metadata(path)['cpu_route']=='unsupported-gpu'
    with pytest.raises(NotEligible,match='LinearizationTable'):
        decoded(path,recipe(None))


@pytest.mark.parametrize('image,tag_type,values',[
    (np.zeros((2,3,3),np.float32),'H',[0,100]),
    (np.zeros((2,3,3),np.uint16),'f',[0.,100.]),
])
def test_invalid_table_metadata_never_opens_as_linear(tmp_path,image,tag_type,values):
    path=tmp_path/'invalid-table.dng'
    _write_linear(path,image,extra_tags=[(50712,tag_type,len(values),values,False)])
    inspection=inspect_dng(path,resource_snapshot=RESOURCES)
    assert inspection.route is DngRoute.UNSUPPORTED_DNG
    assert inspection.rejection.code=='invalid_linearization_table'


@pytest.mark.parametrize('tag',[52525,52544])
def test_optional_profile_gain_look_is_skipped_without_changing_hdr_pixels(tmp_path,tag):
    path=tmp_path/'neutral.dng';reference=tmp_path/'reference.dng'
    image=np.full((12,16,3),32768,np.uint16)
    exposure=(50730,'2i',1,(2,1),False)
    _write_linear(path,image,extra_tags=[(tag,'B',4,b'look',False),exposure])
    _write_linear(reference,image,extra_tags=[exposure])
    inspection=inspect_dng(path,resource_snapshot=RESOURCES)
    actual,metadata=decode_linear_dng(path,inspection)
    expected,_=decode_linear_dng(reference,inspect_dng(reference,resource_snapshot=RESOURCES))
    np.testing.assert_array_equal(actual,expected)
    assert float(actual.max())>1.0, 'Import must retain editable HDR headroom'
    assert 'Skipped optional ProfileGainTableMap' in metadata['dng_warnings']
