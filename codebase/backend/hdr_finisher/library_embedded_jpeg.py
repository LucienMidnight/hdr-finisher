"""Camera-container preview headers. Never read sensor pixels or JPEG entropy."""
from pathlib import Path
import struct


_SOF = {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}


def _jpeg_size(handle, offset, length, file_size):
    end = offset + length
    if offset < 0 or length < 4 or end > file_size:
        return None
    handle.seek(offset)
    if handle.read(2) != b'\xff\xd8':
        return None
    while handle.tell() + 4 <= end:
        if handle.read(1) != b'\xff':
            return None
        marker = handle.read(1)
        while marker == b'\xff' and handle.tell() < end:
            marker = handle.read(1)
        if not marker or marker[0] in {0xda, 0xd9, 0x00}:
            return None
        if marker[0] == 0x01 or 0xd0 <= marker[0] <= 0xd8:
            continue
        segment = struct.unpack('>H', handle.read(2))[0]
        if segment < 2 or handle.tell() + segment - 2 > end:
            return None
        if marker[0] in _SOF:
            if segment < 8:
                return None
            precision, height, width, components = struct.unpack('>BHHB', handle.read(6))
            return (width, height) if precision == 8 and components == 3 and segment >= 8 + 3 * components and width and height else None
        handle.seek(segment - 2, 1)
    return None


def _ifd(handle, offset, endian, file_size):
    if offset < 0 or offset + 2 > file_size:
        return {}
    handle.seek(offset)
    count = struct.unpack(endian + 'H', handle.read(2))[0]
    if offset + 2 + count * 12 + 4 > file_size:
        return {}
    tags = {}
    for _ in range(count):
        tag, kind, count, body = struct.unpack(endian + 'HHI4s', handle.read(12))
        value = struct.unpack(endian + ('H' if kind == 3 and count == 1 else 'I'), body[:2] if kind == 3 and count == 1 else body)[0]
        tags[tag] = (kind, count, value)
    return tags


def _boxes(handle, start, end):
    while start + 8 <= end:
        handle.seek(start)
        length, kind = struct.unpack('>I4s', handle.read(8))
        head = 8
        if length == 1:
            length = struct.unpack('>Q', handle.read(8))[0]
            head = 16
        elif length == 0:
            length = end - start
        if length < head or start + length > end:
            raise ValueError('Invalid camera box')
        yield kind, start + head, start + length
        start += length


def _cr3_jpeg_size(handle, size):
    # LibRaw uses the JPEG image track, not the smaller PRVW/THMB picture.
    # Accept only an unambiguous single-sample, single-chunk JPEG track.
    containers = [(0, size)]
    for wanted in [b'moov', b'trak', b'mdia', b'minf', b'stbl']:
        containers = [(a, b) for start, end in containers
                      for kind, a, b in _boxes(handle, start, end) if kind == wanted]
    previews = []
    for start, end in containers:
        tables = {kind:(a,b) for kind,a,b in _boxes(handle,start,end)}
        sizes, offsets = tables.get(b'stsz'), tables.get(b'co64') or tables.get(b'stco')
        if not sizes or not offsets or sizes[1]-sizes[0] < 12 or offsets[1]-offsets[0] < 12:
            continue
        handle.seek(sizes[0]+4)
        length, count = struct.unpack('>II', handle.read(8))
        if count != 1:
            continue
        if not length:
            if sizes[1]-sizes[0] < 16:
                continue
            length = struct.unpack('>I',handle.read(4))[0]
        handle.seek(offsets[0]+4)
        if struct.unpack('>I',handle.read(4))[0] != 1:
            continue
        wide = b'co64' in tables
        if offsets[1]-offsets[0] < (16 if wide else 12):
            continue
        offset = struct.unpack('>Q' if wide else '>I',handle.read(8 if wide else 4))[0]
        preview = _jpeg_size(handle,offset,length,size)
        if preview:
            previews.append(preview)
    return previews[0] if len(previews) == 1 else None


def camera_jpeg_header(path):
    """RAF/CR3 previews and Panasonic/Olympus preview IFDs used by LibRaw.

    Unknown layouts retain the conservative estimate. All offsets and segment
    lengths are bounded by their declared container and the physical file.
    TIFF/DNG image-page selection remains in library_estimates.
    """
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix not in {'.raf', '.cr3', '.rw2', '.orf', '.ori'}:
        return None
    size = path.stat().st_size
    try:
        with path.open('rb') as handle:
            header = handle.read(16)
            if suffix == '.raf':
                if not header.startswith(b'FUJIFILMCCD-RAW '):
                    return None
                handle.seek(84)
                return _jpeg_size(handle, *struct.unpack('>II', handle.read(8)), size)
            if suffix == '.cr3':
                return _cr3_jpeg_size(handle, size)
            if header[:2] not in {b'II', b'MM'}:
                return None
            endian = '<' if header[:2] == b'II' else '>'
            root = _ifd(handle, struct.unpack(endian + 'I', header[4:8])[0], endian, size)
            if suffix == '.rw2':
                tag = root.get(0x2e)
                return _jpeg_size(handle, tag[2], tag[1], size) if tag and tag[0] == 7 else None
            exif = root.get(0x8769)
            exif = _ifd(handle, exif[2], endian, size) if exif and exif[:2] in {(4, 1), (13, 1)} else {}
            maker = exif.get(0x927c)
            if not maker or maker[0] != 7 or maker[1] < 12:
                return None
            base = maker[2]
            handle.seek(base)
            maker_header = handle.read(12)
            if maker_header[:8] != b'OLYMPUS\0' or maker_header[8:10] not in {b'II', b'MM'}:
                return None
            endian = '<' if maker_header[8:10] == b'II' else '>'
            tags = _ifd(handle, base + 12, endian, size)
            settings = tags.get(0x2020)
            if settings and settings[:2] in {(4, 1), (13, 1)}:
                tags = _ifd(handle, base + settings[2], endian, size)
                start, length = tags.get(0x101), tags.get(0x102)
            else:
                start, length = tags.get(0x88), tags.get(0x89)
            return _jpeg_size(handle, base + start[2], length[2], size) if start and length and start[:2] == (4, 1) and length[:2] == (4, 1) else None
    except (OSError, ValueError, struct.error):
        return None
