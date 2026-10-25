from types import SimpleNamespace
from threading import Barrier, Event, Thread, get_ident
import struct

import numpy as np
import pytest

from hdr_finisher import import_bands as bands
from hdr_finisher.analysis import _luma_peaks, _bt2020_channel_peaks
from hdr_finisher.color import map_negative_acescg, transform_float32_bounded
from hdr_finisher.raw_import import (_normalize_camera_rgb_float32,
    _camera_rgb_to_acescg_float32, _transport_diagnostics)


def test_bands_overlap_return_original_order_and_leave_other_contexts_serial(monkeypatch):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    barrier, threads = Barrier(2), set()
    def work(start):
        threads.add(get_ident())
        if start < 2:
            barrier.wait(2)
        return start
    with bands.grade_import_bands():
        assert list(bands.run_bands(work, range(6))) == list(range(6))
        assert len(threads) >= 2
        other = []
        def outside():
            # A simultaneous open falls back; helper/default callers stay serial.
            with bands.grade_import_bands():
                other.append(bands.parallel_import_enabled())
            other.append(list(bands.run_bands(get_ident_for_band, range(3))))
        thread = Thread(target=outside)
        thread.start(); thread.join(2)
        assert not thread.is_alive() and other[0] is False
        assert len(set(other[1])) == 1
    assert not bands.parallel_import_enabled()
    assert list(bands.run_bands(lambda start: get_ident(), range(3))) == [get_ident()] * 3


def get_ident_for_band(start):
    return get_ident()


@pytest.mark.parametrize("cores", [1])
def test_small_cpu_counts_keep_the_open_serial(monkeypatch, cores):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: cores)
    with bands.grade_import_bands():
        assert not bands.parallel_import_enabled()


def test_failed_open_joins_bands_and_releases_its_worker_slot(monkeypatch):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    started, release, finished = Event(), Event(), Event()
    def work(start):
        if start == 0:
            assert started.wait(2)
            raise RuntimeError("Import cancelled")
        started.set()
        assert release.wait(2)
        finished.set()
    def unblock():
        assert started.wait(2)
        release.set()
    thread = Thread(target=unblock)
    thread.start()
    with pytest.raises(RuntimeError, match="Import cancelled"):
        with bands.grade_import_bands():
            list(bands.run_bands(work, range(2)))
    thread.join(2)
    assert finished.is_set()
    with bands.grade_import_bands():
        assert bands.parallel_import_enabled()


def test_camera_bands_and_integer_diagnostics_are_byte_identical(monkeypatch):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    transport = np.random.default_rng(81).integers(0, 65536, (529, 1031, 3), dtype=np.uint16)
    transport[255:257, 7:9] = 65535
    metadata = SimpleNamespace(black_level=np.array([100., 120., 130.]),
        white_level=np.array([15360., 15200., 15400.]),
        as_shot_wb=np.array([2.546875, 1., 1.59375]),
        camera_to_acescg=np.array([[1.01375, .16577, -.17952],
            [-.01810, 1.38317, -.36507], [.03633, -.19228, 1.15596]]))
    serial = _normalize_camera_rgb_float32(transport, metadata)
    _camera_rgb_to_acescg_float32(serial, metadata)
    expected = _transport_diagnostics(transport)
    with bands.grade_import_bands():
        parallel = _normalize_camera_rgb_float32(transport, metadata)
        assert _camera_rgb_to_acescg_float32(parallel, metadata) is parallel
        assert _transport_diagnostics(transport) == expected
    assert serial.tobytes() == parallel.tobytes()


@pytest.mark.parametrize("all_negative", [False, True])
def test_negative_mapping_changed_band_boundaries_preserve_every_bit(monkeypatch, all_negative):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    source = np.random.default_rng(93).normal(0, 3, (407, 1001, 3)).astype(np.float32)
    if all_negative:
        source = -np.abs(source)
    source[127, 20] = [np.nan, np.inf, -np.inf]
    source[128, 20] = [-0., 0., 1.e30]
    serial = transform_float32_bounded(source.copy(), map_negative_acescg)
    parallel = source.copy()
    with bands.grade_import_bands():
        assert bands.map_import_negative(parallel, map_negative_acescg) is parallel
    assert parallel.tobytes() == serial.tobytes()


@pytest.mark.parametrize("measure", [_luma_peaks, _bt2020_channel_peaks])
def test_exact_and_robust_peaks_preserve_float_bits_and_sample_order(monkeypatch, measure):
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    source = np.random.default_rng(19).uniform(-.1, 5, (527, 701, 3)).astype(np.float32)
    source[255, 100] = [100., 1., 0.]
    expected = measure(source, maximum_quantile_samples=1000)
    with bands.grade_import_bands():
        actual = measure(source, maximum_quantile_samples=1000)
    assert struct.pack("dd", *expected) == struct.pack("dd", *actual)


@pytest.mark.parametrize("enabled", [False, True])
def test_only_opted_in_grade_stores_enable_bands(tmp_path, monkeypatch, enabled):
    from PIL import Image
    from hdr_finisher import sessions
    monkeypatch.setattr(bands.os, "cpu_count", lambda: 12)
    source = tmp_path / "boundary.png"
    Image.new("RGB", (64, 48), (100, 90, 80)).save(source)
    real_load, observed = sessions.load_image, []
    def load(*args, **kwargs):
        observed.append(bands.parallel_import_enabled())
        return real_load(*args, **kwargs)
    monkeypatch.setattr(sessions, "load_image", load)
    store = sessions.SessionStore(grade_import_parallel=True) if enabled else sessions.SessionStore()
    store.prepare_session(source)
    assert observed == [enabled]
    assert not bands.parallel_import_enabled()
    store.clear()
