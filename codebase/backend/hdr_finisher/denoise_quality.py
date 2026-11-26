"""Developer-only QUAL-1 switches; never serialized into a grade."""

import os


COLOUR_NOISE_REFERENCE = 0.001
BAYER_NOISE_REFERENCE = 0.001


def enabled(candidate):
    return os.environ.get(f"HDR_FINISHER_QUAL_{candidate}") == "1"


def colour_reference():
    return COLOUR_NOISE_REFERENCE if enabled("COLOUR_LEVELS") else 0.0


def raw_cache_suffix():
    return ":qual-raw_levels-v1" if enabled("RAW_LEVELS") else ""
