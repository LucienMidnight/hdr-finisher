"""Header-only eligibility for the approved smaller Exposure working grant."""
from pathlib import Path


RATE = 12  # Steve approved November 10; measured peak plus at least 25%.


def _canon_size(path, page):
    # Full mosaic CR2 uses 2/4 unsubsampled lossless-JPEG components. Reduced
    # sRAW/mRAW uses colour/chroma sampling and must retain the CPU estimate.
    # See LibRaw src/decoders/decoders_dcraw.cpp, ljpeg_start's sraw flag.
    if int(page.compression) != 6 or int(page.photometric) != 0:
        return None
    if (page.samplesperpixel not in (2, 4) or page.bitspersample != 16
            or int(page.sampleformat) != 1 or len(page.dataoffsets) != 1):
        return None
    with path.open('rb') as source:
        source.seek(page.dataoffsets[0])
        data = source.read(min(int(page.databytecounts[0]), 65536))
    if not data.startswith(b'\xff\xd8'):
        return None
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 255 or data[pos + 1] in (0xda, 0xd9):
            return None
        marker = data[pos + 1]
        size = int.from_bytes(data[pos + 2:pos + 4], 'big')
        end = pos + 2 + size
        if size < 2 or end > len(data):
            return None
        if marker == 0xc3:
            frame = data[pos + 4:end]
            if len(frame) < 6:
                return None
            bits, height, width, channels = (frame[0], int.from_bytes(frame[1:3], 'big'),
                                            int.from_bytes(frame[3:5], 'big'), frame[5])
            if (channels not in (2, 4) or len(frame) != 6 + channels * 3
                    or not 1 <= bits <= 16 or not width or not height
                    or (width, height, channels) != (page.imagewidth, page.imagelength, page.samplesperpixel)
                    or any(frame[7 + i * 3] != 0x11 for i in range(channels))):
                return None
            return width * channels, height
        pos = end
    return None


def sensor_size(path):
    """Return proven flat sensor dimensions, otherwise None; never unpack pixels."""
    path = Path(path)
    if path.suffix.lower() not in {'.arw', '.cr2'}:
        return None
    import tifffile
    try:
        with path.open('rb') as source:
            header = source.read(16)
        with tifffile.TiffFile(path) as image:
            if path.suffix.lower() == '.cr2':
                if header[:4] != b'II*\x00' or header[8:12] != b'CR\x02\x00':
                    return None
                offset = int.from_bytes(header[12:16], 'little')
                page = next((p for p in image.pages if p.offset == offset), None)
                return _canon_size(path, page) if page is not None else None
            found = []
            stack = list(image.pages)
            while stack:
                page = stack.pop()
                if (int(page.photometric) == 32803 and page.samplesperpixel == 1
                        and page.bitspersample in (12, 14, 16) and int(page.sampleformat) == 1
                        and 33421 in page.tags and page.tags[33421].value == (2, 2)
                        and 33422 in page.tags and page.tags[33422].count == 4):
                    found.append((page.imagewidth, page.imagelength))
                if page.pages is not None:
                    stack.extend(page.pages)
            if len(found) == 1 and all(v > 0 for v in found[0]):
                return found[0]
    except Exception:
        pass
    return None
