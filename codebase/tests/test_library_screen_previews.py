"""Persistent finished pictures: identity, independent eviction and HDR ceiling."""
import json
import numpy as np
from colour.models import eotf_ST2084
from hdr_finisher.library_screen_previews import StoredScreenPreviews


def setup_cache(tmp_path):
    photo = tmp_path / 'photo.png'
    photo.write_bytes(b'source fingerprint fixture')
    document = {'global_adjustments': {'hdr': {'highlight_section_enabled': True}}}
    cache = StoredScreenPreviews(tmp_path / 'app', lambda path: document)
    return photo, document, cache


def test_restart_reuses_finished_picture_and_rejects_changed_identity(tmp_path):
    photo, document, cache = setup_cache(tmp_path)
    identity = cache.identity(str(photo), 2560, 1440, 'hdr')
    pixels = np.full((8, 32, 4), .9, dtype='<f2')
    assert cache.write(identity, pixels.tobytes(), 32, 8, 256)
    restarted = StoredScreenPreviews(tmp_path / 'app', lambda path: document)
    assert restarted.read(restarted.identity(str(photo), 2560, 1440, 'hdr')) is not None
    document['global_adjustments']['hdr']['film_look'] = {'film_stock': 'kodak_portra_400'}
    assert restarted.read(restarted.identity(str(photo), 2560, 1440, 'hdr')) is None
    document['global_adjustments']['hdr'].pop('film_look')
    assert restarted.identity(str(photo), 1920, 1080, 'hdr')['key'] != identity['key']
    assert restarted.identity(str(photo), 2560, 1440, 'sdr')['key'] != identity['key']
    photo.write_bytes(b'changed source')
    assert restarted.read(restarted.identity(str(photo), 2560, 1440, 'hdr')) is None


def test_decode_enforces_compression_ceiling_only_when_enabled(tmp_path):
    photo, document, cache = setup_cache(tmp_path)
    pixels = np.full((8, 32, 4), 1.3, dtype='<f2')
    for enabled in (True, False):
        document['global_adjustments']['hdr']['highlight_section_enabled'] = enabled
        identity = cache.identity(str(photo), 2560, 1440, 'hdr')
        cache.write(identity, pixels.tobytes(), 32, 8, 256)
        _, body = cache.read(identity)
        rgba = np.frombuffer(body, '<u2').reshape(8, 32, 4)
        peak = float(np.max(eotf_ST2084(rgba[..., :3].astype(np.float32)/65535)))
        assert (990 < peak <= 1000) if enabled else peak > 1400


def test_oldest_first_limit_does_not_touch_scenes(tmp_path, monkeypatch):
    from hdr_finisher import library_screen_previews
    photo, document, cache = setup_cache(tmp_path)
    cache.cache.prepare(); cache.directory.mkdir()
    scene = cache.directory.parent / 'library-full-pictures'
    scene.mkdir(); (scene / 'scene.npz').write_bytes(b'keep scene')
    (cache.directory / 'old.jxl').write_bytes(b'x' * 64)
    (cache.directory / 'new.jxl').write_bytes(b'x' * 64)
    monkeypatch.setattr(library_screen_previews, 'LIMIT_BYTES', 64)
    cache.trim()
    assert sum(p.stat().st_size for p in cache.directory.iterdir()) <= 64
    assert (scene / 'scene.npz').read_bytes() == b'keep scene'
