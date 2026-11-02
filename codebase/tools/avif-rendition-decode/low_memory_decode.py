"""Opt in the rendition helper to tile-only AOM decoding in libavif v1.4.1.

Other users of the shared DLL retain upstream row threading. The helper sets
HDRF_AVIF_TILE_THREADS in its own process before opening a decoder.
"""
from pathlib import Path
import sys


def patch(root):
    path = Path(root) / "src/codec_aom.c"
    data = path.read_bytes()
    ending = "\r\n" if b"\r\n" in data else "\n"
    text = data.decode().replace("\r\n", "\n")
    if "HDRF bounded AV1 tile decoding" in text:
        return
    anchor = "        codec->internal->decoderInitialized = AVIF_TRUE;"
    assert text.count(anchor) == 1
    text = text.replace(anchor, anchor + '''

        // HDRF bounded AV1 tile decoding: row threading allocates coefficient
        // buffers for every superblock in both full images. Keep tile workers,
        // but only opt in inside the short-lived rendition helper process.
        const char * tileThreads = getenv("HDRF_AVIF_TILE_THREADS");
        if (tileThreads && !strcmp(tileThreads, "1") &&
            aom_codec_control(&codec->internal->decoder, AV1D_SET_ROW_MT, 0)) {
            avifDiagnosticsPrintf(codec->diag, "Could not select bounded AV1 tile decoding");
            return AVIF_FALSE;
        }''', 1)
    path.write_bytes(text.replace("\n", ending).encode())


if __name__ == "__main__":
    patch(sys.argv[1])
