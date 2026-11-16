"""Instrument only the unpackaged Electron test backend, never the shipped app."""
import os

if os.environ.get("HDR_FINISHER_TEST_CAPTURE_DIR"):
    from capture import install

    install()
