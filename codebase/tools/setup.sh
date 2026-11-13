#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
python_bin="${HDR_FINISHER_SETUP_PYTHON:-python3.12}"
exec "$python_bin" "$script_dir/setup-machine.py" "$@"
