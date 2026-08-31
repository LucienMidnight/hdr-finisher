#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script builds native Linux tools and must run on Linux." >&2
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "HDR Finisher 0.8.x supports Linux x86_64 only." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
codebase_dir="$(cd "$script_dir/.." && pwd)"
work_dir="${HDR_FINISHER_NATIVE_WORK_DIR:-$codebase_dir/output/linux-native-tools}"
bin_dir="${HDR_FINISHER_NATIVE_BIN_DIR:-$codebase_dir/bin}"
license_dir="$bin_dir/licenses"
libavif_ref="${HDR_FINISHER_LIBAVIF_REF:-v1.4.1}"
libultrahdr_ref="${HDR_FINISHER_LIBULTRAHDR_REF:-ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b}"
run_tests=1

if [[ "${1:-}" == "--skip-tests" ]]; then
  run_tests=0
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--skip-tests]" >&2
  exit 2
fi

for command in git cmake ctest find file ldd; do
  command -v "$command" >/dev/null 2>&1 || { echo "Required build tool is missing: $command" >&2; exit 1; }
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

verify_elf_dependencies() {
  local executable="$1"
  local report
  report="$(ldd "$executable" 2>&1 || true)"
  if grep -q "not found" <<<"$report"; then
    echo "Missing runtime dependency for $executable:" >&2
    echo "$report" >&2
    exit 1
  fi
  if grep -Eq "$work_dir|/usr/local|/home/|/opt/" <<<"$report"; then
    echo "Build-host path leaked into $executable:" >&2
    echo "$report" >&2
    exit 1
  fi
  while read -r soname; do
    [[ -z "$soname" ]] && continue
    if [[ ! "$soname" =~ ^(linux-vdso|ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so|libgcc_s\.so|libstdc\+\+\.so|libgomp\.so) ]]; then
      echo "Unexpected dynamic dependency $soname in $executable:" >&2
      echo "$report" >&2
      exit 1
    fi
  done < <(awk '/=>/ {print $1} /^[[:space:]]*\// {name=$1; sub(/^.*\//, "", name); print name} /^linux-vdso/ {print $1}' <<<"$report")
}

copy_executable() {
  local build_dir="$1"
  local name="$2"
  local source_path
  source_path="$(find "$build_dir" -type f -name "$name" -perm -111 -print -quit)"
  [[ -n "$source_path" ]] || { echo "Build completed without producing $name." >&2; exit 1; }
  install -m 755 "$source_path" "$bin_dir/$name"
  verify_elf_dependencies "$bin_dir/$name"
}

libavif_source="$work_dir/libavif-source"
libavif_build="$work_dir/libavif-build"
checkout_ref "https://github.com/AOMediaCodec/libavif.git" "$libavif_source" "$libavif_ref"
cmake -S "$libavif_source" -B "$libavif_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DAVIF_CODEC_AOM=LOCAL \
  -DAVIF_LIBYUV=LOCAL \
  -DAVIF_LIBSHARPYUV=LOCAL \
  -DAVIF_JPEG=LOCAL \
  -DAVIF_ZLIBPNG=LOCAL \
  -DAVIF_BUILD_APPS=ON \
  -DAVIF_BUILD_TESTS="$([[ $run_tests -eq 1 ]] && echo ON || echo OFF)"
cmake --build "$libavif_build" --config Release --parallel
[[ $run_tests -eq 0 ]] || ctest --test-dir "$libavif_build" -C Release --output-on-failure
for tool in avifenc avifdec avifgainmaputil; do copy_executable "$libavif_build" "$tool"; done

install -m 644 "$libavif_source/LICENSE" "$license_dir/libavif-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libaom-src/LICENSE" "$license_dir/libaom-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libaom-src/PATENTS" "$license_dir/libaom-PATENTS.txt"
install -m 644 "$libavif_build/_deps/libaom-src/third_party/fastfeat/LICENSE" "$license_dir/libaom-fastfeat-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libaom-src/third_party/vector/LICENSE" "$license_dir/libaom-vector-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libargparse-src/LICENSE.md" "$license_dir/libargparse-LICENSE.md"
install -m 644 "$libavif_build/_deps/libpng-src/LICENSE" "$license_dir/libpng-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libwebp-src/COPYING" "$license_dir/libwebp-COPYING.txt"
install -m 644 "$libavif_build/_deps/libwebp-src/PATENTS" "$license_dir/libwebp-PATENTS.txt"
install -m 644 "$libavif_build/_deps/libyuv-src/LICENSE" "$license_dir/libyuv-LICENSE.txt"
install -m 644 "$libavif_build/_deps/libyuv-src/PATENTS" "$license_dir/libyuv-PATENTS.txt"
install -m 644 "$libavif_build/_deps/zlib-src/LICENSE" "$license_dir/zlib-LICENSE.txt"
install -m 644 "$libavif_build/libjpeg/src/libjpeg/LICENSE.md" "$license_dir/libjpeg-turbo-LICENSE.md"

libultrahdr_source="$work_dir/libultrahdr-source"
libultrahdr_build="$work_dir/libultrahdr-build"
checkout_ref "https://github.com/google/libultrahdr.git" "$libultrahdr_source" "$libultrahdr_ref"
cmake -S "$libultrahdr_source" -B "$libultrahdr_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DUHDR_BUILD_DEPS=ON \
  -DUHDR_BUILD_EXAMPLES=ON \
  -DUHDR_BUILD_TESTS="$([[ $run_tests -eq 1 ]] && echo ON || echo OFF)" \
  -DUHDR_WRITE_XMP=ON \
  -DUHDR_WRITE_ISO=ON
cmake --build "$libultrahdr_build" --config Release --parallel
[[ $run_tests -eq 0 ]] || ctest --test-dir "$libultrahdr_build" -C Release --output-on-failure
copy_executable "$libultrahdr_build" ultrahdr_app
install -m 644 "$libultrahdr_source/LICENSE" "$license_dir/libultrahdr-LICENSE.txt"
install -m 644 "$libultrahdr_source/LICENSE-APACHE" "$license_dir/libultrahdr-LICENSE-APACHE.txt"
install -m 644 "$libultrahdr_source/LICENSE-MIT" "$license_dir/libultrahdr-LICENSE-MIT.txt"
install -m 644 "$libultrahdr_source/adobe-hdr-gain-map-license/NOTICE" "$license_dir/adobe-hdr-gain-map-NOTICE.txt"

for tool in avifenc avifdec avifgainmaputil ultrahdr_app; do
  if [[ "$tool" == "ultrahdr_app" ]]; then
    smoke_output="$("$bin_dir/$tool" 2>&1 || true)"
    if ! grep -qi "ultra hdr demo application" <<<"$smoke_output"; then
      echo "$tool did not pass its command-line smoke test." >&2
      exit 1
    fi
  elif [[ "$tool" == "avifgainmaputil" ]]; then
    smoke_args=(help)
    "$bin_dir/$tool" "${smoke_args[@]}" >/dev/null
  else
    smoke_args=(--help)
    if ! "$bin_dir/$tool" "${smoke_args[@]}" >/dev/null 2>&1 && ! "$bin_dir/$tool" -h >/dev/null 2>&1 && ! "$bin_dir/$tool" --version >/dev/null 2>&1; then
      echo "$tool did not pass its command-line smoke test." >&2
      exit 1
    fi
  fi
  file "$bin_dir/$tool"
done

echo "Native Linux encoder tools are ready in $bin_dir."
