#!/usr/bin/env bash
set -euo pipefail

manifest_dir="$(cd "$(dirname "$0")" && pwd)"

command -v flatpak-node-generator >/dev/null 2>&1 || { echo "flatpak-node-generator is required." >&2; exit 1; }
command -v flatpak-pip-generator >/dev/null 2>&1 || { echo "flatpak-pip-generator is required." >&2; exit 1; }
python3 -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' || {
  echo "Run this generator with Python 3.12 so wheel tags match the bundled Flatpak interpreter." >&2
  exit 1
}

flatpak-node-generator npm "$manifest_dir/npm/package-lock.json" \
  --node-sdk-extension org.freedesktop.Sdk.Extension.node24//25.08 \
  --output "$manifest_dir/generated-sources/node-sources.json"
flatpak-pip-generator \
  --requirements-file "$manifest_dir/requirements-flatpak.txt" \
  --output "$manifest_dir/generated-sources/python-sources.json" \
  --cleanup scripts \
  --runtime org.freedesktop.Sdk//25.08 \
  --prefer-wheels numpy,pillow,pydantic-core,imagecodecs,openexr,pillow-heif,rawpy,httptools,pyyaml,uvloop,watchfiles,websockets \
  --wheel-arches x86_64

echo "Offline Flatpak source manifests regenerated."
