#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 path/to/HDR-Finisher-<version>-Linux-x86_64.deb" >&2
  exit 2
fi

package_path="$(realpath "$1")"
extract_dir="$(mktemp -d)"
trap 'rm -rf "$extract_dir"' EXIT
dpkg-deb --info "$package_path" >/dev/null
dpkg-deb --extract "$package_path" "$extract_dir"

library_path="$extract_dir/opt/HDR Finisher:$extract_dir/opt/HDR Finisher/resources/backend/_internal"
while IFS= read -r -d '' library_dir; do
  library_path+="${library_path:+:}$library_dir"
done < <(find "$extract_dir" -type d -name '*.libs' -print0)

elf_count=0
while IFS= read -r -d '' candidate; do
  if ! file "$candidate" | grep -q 'ELF'; then continue; fi
  elf_count=$((elf_count + 1))
  report="$(LD_LIBRARY_PATH="$library_path:${candidate%/*}" ldd "$candidate" 2>&1 || true)"
  if grep -q 'not found' <<<"$report"; then
    echo "Missing dependency in packaged ELF: $candidate" >&2
    echo "$report" >&2
    exit 1
  fi
  if grep -Eq '/home/|linux-native-tools|/usr/local/' <<<"$report"; then
    echo "Build-host dependency leaked into packaged ELF: $candidate" >&2
    echo "$report" >&2
    exit 1
  fi
done < <(find "$extract_dir" -type f -print0)

[[ $elf_count -gt 0 ]] || { echo "No ELF files were found in the package." >&2; exit 1; }
for tool in avifenc avifdec avifgainmaputil ultrahdr_app; do
  find "$extract_dir" -type f -name "$tool" -perm -111 -print -quit | grep -q . || {
    echo "Packaged encoder is missing: $tool" >&2
    exit 1
  }
done
find "$extract_dir" -type f -path '*/licenses/*' -print -quit | grep -q . || {
  echo "Packaged third-party notices are missing." >&2
  exit 1
}

echo "Verified $elf_count packaged ELF files and all native encoders."
