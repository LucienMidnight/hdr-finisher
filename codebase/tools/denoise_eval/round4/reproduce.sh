#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."
source=tools/denoise_eval/round4
round3=output/predemosaic-round3-2026-11-20
python=.venv/bin/python

# Round 3's hash-checked, read-only staging cache is shared with the prior study.
# Keep one process under the shared machine lock for each photo.
for tag in canon sony ordinary atrium; do
    if [ ! -f "$round3/cache/$tag/raw.json" ]; then
        printf '%s\n' "Missing round 3 staging for $tag. See the round 3 report." >&2
        exit 1
    fi
    "$python" tools/gpu-run-lock.py --label "denoise-round4-$tag-final" --minutes 8 -- \
        "$python" "$source/round4.py" "$tag" final --lead tail
done
"$python" tools/gpu-run-lock.py --label denoise-round4-luminance-sweep --minutes 8 -- \
    "$python" "$source/round4.py" canon sweep --lead tail
"$python" "$source/gallery.py"
"$python" "$source/gallery.py" --inline-chart
"$python" tools/gpu-run-lock.py --label denoise-round4-verification --minutes 8 -- \
    "$python" "$source/verify_round4.py"
