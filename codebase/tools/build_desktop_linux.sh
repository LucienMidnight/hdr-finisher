#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "The Linux desktop package must be built on Linux x86_64." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
codebase_dir="$(cd "$script_dir/.." && pwd)"
desktop_dir="$codebase_dir/desktop"
python_bin="${HDR_FINISHER_PYTHON:-$codebase_dir/.venv/bin/python}"
skip_native_tools=0

if [[ "${1:-}" == "--skip-native-tools" ]]; then
  skip_native_tools=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--skip-native-tools]" >&2
  exit 2
fi

[[ -x "$python_bin" ]] || { echo "Python 3.12 environment not found at $python_bin." >&2; exit 1; }
"$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' || {
  echo "Linux release builds require Python 3.12 exactly for a stable PyInstaller baseline." >&2
  exit 1
}
export PATH="$(dirname "$python_bin"):$PATH"
export PYINSTALLER_CONFIG_DIR="$codebase_dir/.pyinstaller-cache"

if [[ $skip_native_tools -eq 0 ]]; then "$script_dir/build_native_linux.sh"; fi
for tool in avifenc avifdec avifgainmaputil ultrahdr_app; do
  [[ -x "$codebase_dir/bin/$tool" ]] || { echo "Missing Linux encoder: codebase/bin/$tool" >&2; exit 1; }
done

cd "$codebase_dir"
"$python_bin" -m PyInstaller --noconfirm --clean HDRFinisherBackend.spec
backend_executable="$codebase_dir/dist/HDR Finisher Backend/HDR Finisher Backend"
[[ -x "$backend_executable" ]] || { echo "PyInstaller did not produce the Linux backend executable." >&2; exit 1; }

package_version="$(node -p "require('$desktop_dir/package.json').version")"
sidecar_output="$(HDR_FINISHER_DESKTOP_SECRET=build-check HDR_FINISHER_DESKTOP_CONTROL_SECRET=build-check "$backend_executable" --desktop-sidecar --parent-pid 999999999)"
grep -q "\"backend_version\":\"$package_version\"" <<<"$sidecar_output" || { echo "Packaged backend version/startup check failed." >&2; exit 1; }
backend_ldd="$(ldd "$backend_executable" 2>&1 || true)"
if grep -q "not found" <<<"$backend_ldd"; then
  echo "The packaged backend has missing ELF dependencies:" >&2
  echo "$backend_ldd" >&2
  exit 1
fi

cd "$desktop_dir"
[[ -x node_modules/.bin/electron-builder ]] || npm ci
npm test
npm run dist:linux -- --publish never

cd "$codebase_dir/dist-electron"
deb="HDR-Finisher-${package_version}-Linux-x86_64.deb"
[[ -f "$deb" ]] || { echo "Expected package was not produced: $deb" >&2; exit 1; }
dpkg-deb --info "$deb" >/dev/null
dpkg-deb --contents "$deb" | grep './opt/HDR Finisher/hdr-finisher$' >/dev/null || { echo "The deb package has no hdr-finisher executable." >&2; exit 1; }
sha256sum "$deb" > SHA256SUMS-Linux.txt
echo "Linux package complete: $codebase_dir/dist-electron/$deb"
