"""Verify/download a committed research manifest; run explicitly with python -I."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


def digest(path, algorithm='sha256'):
    checksum = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def download_file(entry, destination):
    filename = entry['file']
    if Path(filename).name != filename or not entry['url'].startswith('https://dataverse.uclouvain.be/api/access/datafile/'):
        raise ValueError('Manifest path or source is not allowed')
    target = destination / filename
    expected = entry['sha256']
    if not expected or len(expected) != 64:
        raise ValueError('A pinned SHA-256 is required')
    if target.exists():
        if target.stat().st_size == entry['bytes'] and digest(target) == expected:
            return
        raise ValueError(f'Existing file differs; not overwritten: {target}')
    temporary = target.with_suffix(target.suffix + '.part')
    try:
        with urllib.request.urlopen(entry['url'], timeout=120) as source, temporary.open('xb') as output:
            size = 0
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > entry['bytes']:
                    raise ValueError('Download exceeds pinned size')
                output.write(chunk)
        if size != entry['bytes'] or digest(temporary) != expected:
            raise ValueError(f'Size/SHA-256 mismatch: {filename}')
        temporary.rename(target)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('rawnind-manifest.json'))
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    destination = args.destination or Path(__file__).resolve().parents[3] / 'output/denoise-v1/datasets/rawnind'
    if sum(entry['bytes'] for entry in manifest['files']) > 8_000_000_000:
        raise ValueError('Manifest exceeds the 8 GB research allowance')
    destination.mkdir(parents=True, exist_ok=True)
    for index, entry in enumerate(manifest['files']):
        print(f'{index + 1}/{len(manifest["files"])} {entry["file"]}', flush=True)
        download_file(entry, destination)


if __name__ == '__main__':
    main()
