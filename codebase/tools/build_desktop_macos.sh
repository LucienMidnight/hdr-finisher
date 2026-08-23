#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS desktop package must be built on macOS." >&2
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

if [[ ! -x "$python_bin" ]]; then
  echo "Python environment not found at $python_bin." >&2
  echo "Create codebase/.venv with Python 3.12+ and install requirements-dev.txt." >&2
  exit 1
fi

"$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' || {
  echo "HDR Finisher requires Python 3.12 or newer." >&2
  exit 1
}
export PATH="$(dirname "$python_bin"):$PATH"
export PYINSTALLER_CONFIG_DIR="$codebase_dir/.pyinstaller-cache"

if [[ $skip_native_tools -eq 0 ]]; then
  "$script_dir/build_native_macos.sh"
fi

for tool in avifenc avifdec avifgainmaputil ultrahdr_app; do
  if [[ ! -x "$codebase_dir/bin/$tool" ]]; then
    echo "Missing native encoder tool: codebase/bin/$tool" >&2
    echo "Run build_native_macos.sh or use --skip-native-tools only for a capability-limited package." >&2
    exit 1
  fi
done

cd "$codebase_dir"
"$python_bin" -m PyInstaller --noconfirm --clean HDRFinisherBackend.spec

backend_executable="$codebase_dir/dist/HDR Finisher Backend/HDR Finisher Backend"
if [[ ! -x "$backend_executable" ]]; then
  echo "PyInstaller did not produce the expected macOS backend executable." >&2
  exit 1
fi

cd "$desktop_dir"
if [[ ! -x "$desktop_dir/node_modules/.bin/electron-builder" ]]; then
  npm ci
fi

electron_arch="$(uname -m)"
if [[ "$electron_arch" == "x86_64" ]]; then
  electron_arch="x64"
fi

CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}" npm run dist:mac -- "--$electron_arch" --publish never

cd "$codebase_dir/dist-electron"
package_version="$(node -p "require('$desktop_dir/package.json').version")"
shasum -a 256 \
  "HDR-Finisher-${package_version}-macOS-${electron_arch}.dmg" \
  "HDR-Finisher-${package_version}-macOS-${electron_arch}.zip" \
  > SHA256SUMS-macOS.txt
echo "macOS package complete: $codebase_dir/dist-electron"
