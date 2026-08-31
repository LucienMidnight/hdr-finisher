#!/bin/sh
export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}"
exec zypak-wrapper /app/hdr-finisher/hdr-finisher "$@"
