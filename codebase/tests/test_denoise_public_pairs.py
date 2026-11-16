"""Deterministic pair registration, masking and loading; no network/private photos."""
import json
import hashlib
from pathlib import Path
import cv2
import numpy as np
import pytest
from tools.denoise_eval import metrics
from tools.denoise_eval.inputs import paired_samples
from tools.denoise_eval.datasets.prepare import translation, align_clean, fit_gain, apply_gain, metric_masks
from tools.denoise_eval.datasets.download import download_file
from tools.denoise_eval.datasets.summarize import summarize


def scene(size=192):
    generator = np.random.default_rng(81)
    texture = cv2.GaussianBlur(generator.random((size // 2, size // 2)).astype('float32'), (0, 0), 2)
    mosaic = np.empty((size, size), dtype='float32')
    for row in range(2):
        for column in range(2):
            mosaic[row::2, column::2] = .1 + .5 * texture
    return mosaic


def test_translation_and_cfa_resampling_correct_known_shift():
    clean = scene()
    pattern = np.array([[0, 1], [1, 2]])
    noisy = align_clean(clean, [2., -4.])
    estimate = translation(noisy, clean, pattern)
    assert estimate['sensor_xy'] == pytest.approx([2., -4.], abs=.15)
    corrected = align_clean(clean, np.asarray(estimate['sensor_xy'], dtype='float64'))
    assert np.sqrt(np.mean((corrected[20:-20, 20:-20] - noisy[20:-20, 20:-20])**2)) < .002


def test_global_raw_gain_preserves_greens_and_recovers_exposure():
    clean = scene()
    pattern = np.array([[0, 1], [1, 2]])
    gains = [.7, 1.15, 1.5]
    noisy = apply_gain(clean, pattern, gains)
    fitted = fit_gain([(noisy, clean)], pattern)
    assert fitted == pytest.approx(gains, rel=1e-5)
    assert np.allclose(apply_gain(clean, pattern, fitted), noisy, atol=1e-6)


def test_clipped_pixels_and_filter_support_are_excluded():
    raw = np.full((192, 192), .2, dtype='float32')
    clean = np.repeat(raw[..., None], 3, -1)
    clipped = raw.copy()
    clipped[96, 96] = 1
    masks = metric_masks(clipped, raw, raw, clean)
    assert not masks['valid'][56:137, 56:137].any()
    assert masks['valid'][45, 45]
    assert not masks['valid'][:40].any()
    for name in ('flat', 'texture', 'edge'):
        assert not (masks[name] & ~masks['valid']).any()


def test_masked_fidelity_ignores_invalid_output_and_ssim_support():
    clean = np.full((96, 96, 3), .2, dtype='float32')
    result = clean.copy()
    result[:8] = .9
    valid = np.zeros((96, 96), bool)
    valid[20:76, 20:76] = True
    masks = dict(valid=valid, flat=valid, texture=valid, edge=valid)
    measured = metrics.evaluate(result, result, clean, masks)
    assert measured['sdr']['psnr_db'] is None
    assert measured['sdr']['ssim'] == pytest.approx(1)
    assert measured['sdr']['colour_difference']['mean'] == pytest.approx(0)
    assert measured['flat_residual_sdr']['luma_std'] < 1e-12


def test_bundle_loads_bayer_truth_masks_and_contamination(tmp_path):
    rgb = np.full((96, 96, 3), .2, dtype='float32')
    raw = rgb[..., 0].copy()
    valid = np.ones((96, 96), bool)
    np.savez(tmp_path / 'crop.npz', rgb=rgb, clean=rgb, bayer=raw, clean_bayer=raw,
             valid=valid, flat=valid, texture=valid, edge=valid)
    (tmp_path / 'pairs.json').write_text(json.dumps([dict(name='trial', bundle='crop.npz', metadata=dict(held_out=True))]))
    sample = next(paired_samples(tmp_path))
    assert sample.metadata['held_out']
    assert np.array_equal(sample.clean_bayer, raw)
    assert np.array_equal(sample.bayer, raw)
    assert np.array_equal(sample.masks['valid'], valid)


def test_bundle_cannot_escape_pair_folder(tmp_path):
    (tmp_path / 'pairs.json').write_text(json.dumps([dict(name='trial', bundle='../outside.npz')]))
    with pytest.raises(ValueError, match='leaves'):
        next(paired_samples(tmp_path))


def test_downloader_verifies_existing_bytes_without_network(tmp_path):
    content = b'not an executable; dataset fixture'
    (tmp_path / 'data.raw').write_bytes(content)
    entry = dict(file='data.raw', bytes=len(content), sha256=hashlib.sha256(content).hexdigest(),
                 url='https://dataverse.uclouvain.be/api/access/datafile/1')
    download_file(entry, tmp_path)
    (tmp_path / 'data.raw').write_bytes(b'incorrect')
    with pytest.raises(ValueError, match='not overwritten'):
        download_file(entry, tmp_path)


def test_manifest_uses_explicit_cc0_and_documents_every_split():
    manifest = json.loads((Path(__file__).parents[1] / 'tools/denoise_eval/datasets/rawnind-manifest.json').read_text())
    assert sum(entry['bytes'] for entry in manifest['files']) < 8_000_000_000
    for entry in manifest['files']:
        assert entry['licence'] == 'CC0-1.0'
        assert len(entry['sha256']) == 64
        assert ': CC0, by ' in entry['licence_text']
        assert entry['held_out'] == entry['scene_id'].startswith('TEST_')
        assert entry['contamination'] == ('documented held-out' if entry['held_out'] else 'seen by RawNIND')


def test_summary_balances_scenes_and_separates_contamination():
    cases = []
    for scene_id, scores, held_out in [('scene-one', [10, 10, 10], True), ('scene-two', [30], False)]:
        for score in scores:
            cases.append(dict(metadata=dict(scene_id=scene_id, source=scene_id, iso=6400, held_out=held_out),
                              adapters=dict(off=dict(sdr=dict(psnr_db=score)))))
    rows = summarize(dict(cases=cases))['rows']
    combined = next(row for row in rows if row['population'] == 'all' and row['iso_band'] == 'mid: 3201..12800')
    assert combined['metrics']['sdr.psnr_db'] == dict(mean=20, scenes=2, captures=2, crops=4)
    held = next(row for row in rows if row['population'] == 'held-out' and row['iso_band'] == 'all ISOs')
    assert held['metrics']['sdr.psnr_db']['mean'] == 10
