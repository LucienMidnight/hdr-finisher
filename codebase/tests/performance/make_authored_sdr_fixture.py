"""Disposable photo-derived Ultra HDR fixture; never overwrite any input."""
import argparse
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from reference_session import isolate_source_cache, open_reference_session


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source_project = Path(args.project).resolve()
    directory = Path(args.out).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    picture = directory / 'authored-photo.jpg'
    project = directory / 'authored-photo.hdrfinisher'
    if picture.exists() or project.exists():
        raise FileExistsError('Disposable fixture already exists')
    before = hashlib.sha256(source_project.read_bytes()).hexdigest()
    isolate_source_cache(directory / 'source-cache')
    from hdr_finisher.capabilities import _ultrahdr_status
    from hdr_finisher.exporters import JPEGUltraHDRExportBackend
    from hdr_finisher.models import AdjustmentState, ExportSettings
    from hdr_finisher.projects import save_project
    from hdr_finisher.render_cache import downsample_image
    from hdr_finisher.sessions import SessionStore
    from make_four_mask_fixture import four_mask_locals
    _, original = open_reference_session(source_project)
    adjustments = AdjustmentState()
    # Independent authored rendition, encoded in a real gain-map JPEG. Native
    # comparison later uses the actual decoded base, not a mocked GPU texture.
    adjustments.sdr.exposure = -.35
    adjustments.sdr.saturation = .85
    export_session = SimpleNamespace(image=downsample_image(original.image, 3600),
                                     sdr_reference_image=None, adjustments=adjustments)
    result = JPEGUltraHDRExportBackend(_ultrahdr_status()).export(export_session,
        ExportSettings(format='jpeg_ultrahdr', quality=100, jpeg_gain_map_quality=100,
                       jpeg_chroma_subsampling='444', dithering='off', output_path=str(picture)))
    if not result.accepted:
        raise RuntimeError(result.message)
    store = SessionStore()
    payload = store.create_session(picture, original_filename=picture.name, owns_source_path=False)
    session = store.get(payload.session_id)
    if session.sdr_reference_image is None:
        raise AssertionError('Real decoder did not provide an authored SDR base')
    session.local_adjustments = four_mask_locals()
    # Isolate native authored-base correctness from the deferred automatic
    # anchor design; both reference and GPU use the same manual anchor.
    session.adjustments.sdr.highlight_compression_peak_measurement = 'manual'
    session.adjustments.sdr.highlight_compression_manual_peak_percent = 100
    save_project(session, project, picture)
    after = hashlib.sha256(source_project.read_bytes()).hexdigest()
    assert before == after
    manifest = dict(project=str(project), source=str(picture), dimensions=list(session.image.shape[:2][::-1]),
                    authoredBase=True, inputHash=after, sourceHash=hashlib.sha256(picture.read_bytes()).hexdigest())
    (directory / 'fixture.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
