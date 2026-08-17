#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script builds native macOS tools and must run on macOS." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
codebase_dir="$(cd "$script_dir/.." && pwd)"
work_dir="$codebase_dir/output/macos-native-tools"
bin_dir="$codebase_dir/bin"
license_dir="$bin_dir/licenses"
libavif_ref="${HDR_FINISHER_LIBAVIF_REF:-v1.4.1}"
libultrahdr_ref="${HDR_FINISHER_LIBULTRAHDR_REF:-ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b}"
run_tests=1

if [[ -x "$codebase_dir/.venv/bin/cmake" ]]; then
  export PATH="$codebase_dir/.venv/bin:$PATH"
fi

if [[ "${1:-}" == "--skip-tests" ]]; then
  run_tests=0
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--skip-tests]" >&2
  exit 2
fi

for command in git cmake xcrun; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required build tool is missing: $command" >&2
    exit 1
  fi
done

mkdir -p "$work_dir" "$bin_dir" "$license_dir"

checkout_ref() {
  local repository="$1"
  local source_dir="$2"
  local ref="$3"
  if [[ ! -d "$source_dir/.git" ]]; then
    git clone --filter=blob:none "$repository" "$source_dir"
  fi
  git -C "$source_dir" fetch --depth 1 origin "$ref"
  git -C "$source_dir" checkout --detach FETCH_HEAD
}

copy_executable() {
  local build_dir="$1"
  local name="$2"
  local destination="$bin_dir/$name"
  local source_path
  source_path="$(find "$build_dir" -type f -name "$name" -perm -111 | head -n 1)"
  if [[ -z "$source_path" ]]; then
    echo "Build completed without producing $name." >&2
    exit 1
  fi
  cp "$source_path" "$destination"
  chmod 755 "$destination"
  if otool -L "$destination" | grep -Eq '/opt/homebrew|/usr/local|macos-native-tools'; then
    echo "$name has a non-portable library dependency:" >&2
    otool -L "$destination" >&2
    exit 1
  fi
}

libavif_source="$work_dir/libavif-source"
libavif_build="$work_dir/libavif-build"
checkout_ref "https://github.com/AOMediaCodec/libavif.git" "$libavif_source" "$libavif_ref"
cmake -S "$libavif_source" -B "$libavif_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" \
  -DBUILD_SHARED_LIBS=OFF \
  -DAVIF_CODEC_AOM=LOCAL \
  -DAVIF_LIBYUV=LOCAL \
  -DAVIF_LIBSHARPYUV=LOCAL \
  -DAVIF_JPEG=LOCAL \
  -DAVIF_ZLIBPNG=LOCAL \
  -DAVIF_BUILD_APPS=ON \
  -DAVIF_BUILD_TESTS="$([[ $run_tests -eq 1 ]] && echo ON || echo OFF)"
cmake --build "$libavif_build" --config Release --parallel
if [[ $run_tests -eq 1 ]]; then
  ctest --test-dir "$libavif_build" -C Release --output-on-failure
fi
for tool in avifenc avifdec avifgainmaputil; do
  copy_executable "$libavif_build" "$tool"
done
cp "$libavif_source/LICENSE" "$license_dir/libavif-LICENSE.txt"
cp "$libavif_build/_deps/libaom-src/LICENSE" "$license_dir/libaom-LICENSE.txt"
cp "$libavif_build/_deps/libaom-src/PATENTS" "$license_dir/libaom-PATENTS.txt"
cp "$libavif_build/_deps/libaom-src/third_party/fastfeat/LICENSE" "$license_dir/libaom-fastfeat-LICENSE.txt"
cp "$libavif_build/_deps/libaom-src/third_party/vector/LICENSE" "$license_dir/libaom-vector-LICENSE.txt"
cp "$libavif_build/_deps/libargparse-src/LICENSE.md" "$license_dir/libargparse-LICENSE.md"
cp "$libavif_build/_deps/libpng-src/LICENSE" "$license_dir/libpng-LICENSE.txt"
cp "$libavif_build/_deps/libwebp-src/COPYING" "$license_dir/libwebp-COPYING.txt"
cp "$libavif_build/_deps/libwebp-src/PATENTS" "$license_dir/libwebp-PATENTS.txt"
cp "$libavif_build/_deps/libyuv-src/LICENSE" "$license_dir/libyuv-LICENSE.txt"
cp "$libavif_build/_deps/libyuv-src/PATENTS" "$license_dir/libyuv-PATENTS.txt"
cp "$libavif_build/_deps/zlib-src/LICENSE" "$license_dir/zlib-LICENSE.txt"
cp "$libavif_build/libjpeg/src/libjpeg/LICENSE.md" "$license_dir/libjpeg-turbo-LICENSE.md"

libultrahdr_source="$work_dir/libultrahdr-source"
libultrahdr_build="$work_dir/libultrahdr-build"
checkout_ref "https://github.com/google/libultrahdr.git" "$libultrahdr_source" "$libultrahdr_ref"
cmake -S "$libultrahdr_source" -B "$libultrahdr_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" \
  -DBUILD_SHARED_LIBS=OFF \
  -DUHDR_BUILD_DEPS=ON \
  -DUHDR_BUILD_EXAMPLES=ON \
  -DUHDR_BUILD_TESTS="$([[ $run_tests -eq 1 ]] && echo ON || echo OFF)" \
  -DUHDR_WRITE_XMP=ON \
  -DUHDR_WRITE_ISO=ON
cmake --build "$libultrahdr_build" --config Release --parallel
if [[ $run_tests -eq 1 ]]; then
  ctest --test-dir "$libultrahdr_build" -C Release --output-on-failure
fi
copy_executable "$libultrahdr_build" "ultrahdr_app"
cp "$libultrahdr_source/LICENSE" "$license_dir/libultrahdr-LICENSE.txt"
cp "$libultrahdr_source/LICENSE-APACHE" "$license_dir/libultrahdr-LICENSE-APACHE.txt"
cp "$libultrahdr_source/LICENSE-MIT" "$license_dir/libultrahdr-LICENSE-MIT.txt"
cp "$libultrahdr_source/adobe-hdr-gain-map-license/NOTICE" "$license_dir/adobe-hdr-gain-map-NOTICE.txt"

for tool in avifenc avifdec avifgainmaputil ultrahdr_app; do
  "$bin_dir/$tool" --help >/dev/null 2>&1 || true
  file "$bin_dir/$tool"
done

echo "Native macOS encoder tools are ready in $bin_dir."
