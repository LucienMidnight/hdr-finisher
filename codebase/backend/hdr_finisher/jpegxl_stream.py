"""Small binding to bundled libjxl's chunked input and scanline output APIs.

No full quantized frame or full decoded RGB frame is allocated. The encoder
requests ~2048-square rectangles (including its small group border); callbacks retain each until libjxl releases
it. C ABI declarations follow libjxl 0.11+ public headers (BSD-3-Clause).
"""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
import ctypes as C

import numpy as np

P = C.c_void_p
S = C.c_size_t
U = C.c_uint32
I = C.c_int


class BasicInfo(C.Structure):
    _fields_ = [(name, kind) for name, kind in [
        ('have_container', I), ('xsize', U), ('ysize', U), ('bits_per_sample', U),
        ('exponent_bits_per_sample', U), ('intensity_target', C.c_float),
        ('min_nits', C.c_float), ('relative_to_max_display', I),
        ('linear_below', C.c_float), ('uses_original_profile', I),
        ('have_preview', I), ('have_animation', I), ('orientation', I),
        ('num_color_channels', U), ('num_extra_channels', U), ('alpha_bits', U),
        ('alpha_exponent_bits', U), ('alpha_premultiplied', I),
        ('preview', U * 2), ('animation', U * 4),
        ('intrinsic_xsize', U), ('intrinsic_ysize', U), ('padding', C.c_uint8 * 100)]]


class PixelFormat(C.Structure):
    _fields_ = [('num_channels', U), ('data_type', I), ('endianness', I), ('align', S)]


class BitDepth(C.Structure):
    _fields_ = [('type', I), ('bits_per_sample', U), ('exponent_bits_per_sample', U)]


class ColorEncoding(C.Structure):
    _fields_ = [('color_space', I), ('white_point', I), ('white_point_xy', C.c_double * 2),
                ('primaries', I), ('red', C.c_double * 2), ('green', C.c_double * 2),
                ('blue', C.c_double * 2), ('transfer_function', I),
                ('gamma', C.c_double), ('rendering_intent', I)]


GetFormat = C.CFUNCTYPE(None, P, C.POINTER(PixelFormat))
GetPixels = C.CFUNCTYPE(P, P, S, S, S, S, C.POINTER(S))
ReleasePixels = C.CFUNCTYPE(None, P, P)
GetBuffer = C.CFUNCTYPE(P, P, C.POINTER(S))
ReleaseBuffer = C.CFUNCTYPE(None, P, S)
Seek = C.CFUNCTYPE(None, P, C.c_uint64)
Scanline = C.CFUNCTYPE(None, P, S, S, S, P)


class Input(C.Structure):
    _fields_ = [('opaque', P), ('format', GetFormat), ('pixels', GetPixels),
                ('extra_format', P), ('extra_pixels', P), ('release', ReleasePixels)]


class Output(C.Structure):
    _fields_ = [('opaque', P), ('buffer', GetBuffer), ('release', ReleaseBuffer),
                ('seek', Seek), ('finalize', Seek)]


@lru_cache(maxsize=1)
def library():
    import imagecodecs
    from .binaries import resolve_binary
    folder = Path(imagecodecs.__file__).parent
    candidates = [*folder.glob('.dylibs/libjxl.[0-9]*.dylib'),
                  *folder.parent.glob('imagecodecs.libs/libjxl-*.so*')]
    bundled = resolve_binary('jxl.dll')
    if bundled:
        candidates.append(bundled)
    errors = []
    for path in candidates:
        try:
            lib = C.CDLL(str(path))
            if lib.JxlEncoderVersion() < 11000:
                continue
            declarations = {
                'JxlEncoderCreate': (P, [P]), 'JxlEncoderDestroy': (None, [P]),
                'JxlEncoderInitBasicInfo': (None, [C.POINTER(BasicInfo)]),
                'JxlEncoderSetBasicInfo': (I, [P, C.POINTER(BasicInfo)]),
                'JxlEncoderUseContainer': (I, [P, I]),
                'JxlEncoderSetColorEncoding': (I, [P, C.POINTER(ColorEncoding)]),
                'JxlEncoderFrameSettingsCreate': (P, [P, P]),
                'JxlEncoderSetFrameLossless': (I, [P, I]),
                'JxlEncoderSetFrameBitDepth': (I, [P, C.POINTER(BitDepth)]),
                'JxlEncoderFrameSettingsSetOption': (I, [P, I, C.c_int64]),
                'JxlEncoderSetOutputProcessor': (I, [P, Output]),
                'JxlEncoderAddChunkedFrame': (I, [P, I, Input]),
                'JxlDecoderCreate': (P, [P]), 'JxlDecoderDestroy': (None, [P]),
                'JxlDecoderSubscribeEvents': (I, [P, I]),
                'JxlDecoderSetInput': (I, [P, P, S]),
                'JxlDecoderCloseInput': (None, [P]),
                'JxlDecoderProcessInput': (I, [P]),
                'JxlDecoderGetBasicInfo': (I, [P, C.POINTER(BasicInfo)]),
                'JxlDecoderSetImageOutCallback': (I, [P, C.POINTER(PixelFormat), Scanline, P]),
                'JxlDecoderSetImageOutBitDepth': (I, [P, C.POINTER(BitDepth)]),
            }
            for name, (result, arguments) in declarations.items():
                fn = getattr(lib, name)
                fn.restype, fn.argtypes = result, arguments
            return lib
        except (OSError, AttributeError) as error:
            errors.append(str(error))
    raise ValueError('Bounded JPEG XL requires bundled libjxl 0.11+ with chunked input. ' + '; '.join(errors))


def checked(status):
    if status:
        raise ValueError(f'Bounded JPEG XL codec failed (status {status}).')


def encode(shape, samples, bits, *, hdr, effort=3):
    """Encode exact integer samples, quantizing only requested rectangles."""
    lib = library()
    encoder = lib.JxlEncoderCreate(None)
    if not encoder:
        raise ValueError('Could not allocate the JPEG XL encoder.')
    held, failures = {}, []
    stream = BytesIO()
    buffer = C.create_string_buffer(1024 * 1024)
    dtype = np.uint16 if bits > 8 else np.uint8

    @GetFormat
    def get_format(_, fmt):
        fmt[0] = PixelFormat(3, 3 if bits > 8 else 2, 0, 0)

    @GetPixels
    def pixels(_, x, y, width, height, stride):
        try:
            value = np.ascontiguousarray(samples(y, y + height, x, x + width), dtype=dtype)
            if value.shape != (height, width, 3):
                raise ValueError('Invalid chunked JPEG XL input rectangle.')
            pointer = value.ctypes.data
            held[pointer] = value
            stride[0] = value.strides[0]
            return pointer
        except Exception as error:
            failures.append(error)
            return None

    @ReleasePixels
    def release(_, pointer):
        held.pop(pointer, None)

    @GetBuffer
    def get_buffer(_, size):
        size[0] = len(buffer)
        return C.addressof(buffer)

    @ReleaseBuffer
    def write(_, count):
        try:
            stream.write(C.string_at(buffer, count))
        except Exception as error:
            failures.append(error)

    @Seek
    def seek(_, position):
        try:
            stream.seek(position)
        except Exception as error:
            failures.append(error)

    @Seek
    def finalize(_, position):
        pass

    try:
        info = BasicInfo()
        lib.JxlEncoderInitBasicInfo(C.byref(info))
        info.xsize, info.ysize = shape[1], shape[0]
        info.bits_per_sample, info.num_color_channels = bits, 3
        info.uses_original_profile = 1
        checked(lib.JxlEncoderSetBasicInfo(encoder, C.byref(info)))
        checked(lib.JxlEncoderUseContainer(encoder, 1))
        color = ColorEncoding()
        color.color_space, color.white_point = 0, 1  # RGB, D65
        color.primaries, color.transfer_function = (9, 16) if hdr else (1, 13)
        checked(lib.JxlEncoderSetColorEncoding(encoder, C.byref(color)))
        frame = lib.JxlEncoderFrameSettingsCreate(encoder, None)
        checked(lib.JxlEncoderSetFrameLossless(frame, 1))
        checked(lib.JxlEncoderSetFrameBitDepth(frame, C.byref(BitDepth(1, 0, 0))))
        checked(lib.JxlEncoderFrameSettingsSetOption(frame, 0, effort))
        checked(lib.JxlEncoderFrameSettingsSetOption(frame, 34, 2))  # streaming input
        checked(lib.JxlEncoderSetOutputProcessor(encoder, Output(None, get_buffer, write, seek, finalize)))
        status = lib.JxlEncoderAddChunkedFrame(frame, 1, Input(None, get_format, pixels, None, None, release))
        if failures:
            raise ValueError(f'JPEG XL input/output callback failed: {failures[0]}')
        checked(status)
        return stream.getvalue()
    finally:
        lib.JxlEncoderDestroy(encoder)
        held.clear()
        stream.close()


def decode(payload, visit, *, expected_shape, bits):
    """Visit each exact integer RGB sample once without a full RGB output."""
    lib = library()
    decoder = lib.JxlDecoderCreate(None)
    if not decoder:
        raise ValueError('Could not allocate the JPEG XL decoder.')
    failures = []
    count = 0
    dtype = C.c_uint16 if bits > 8 else C.c_uint8

    @Scanline
    def scan(_, x, y, length, pointer):
        nonlocal count
        if failures:
            return
        try:
            if y >= expected_shape[0] or x + length > expected_shape[1]:
                raise ValueError('JPEG XL returned an out-of-bounds scanline.')
            pixels = np.ctypeslib.as_array(C.cast(pointer, C.POINTER(dtype)), shape=(length * 3,)).reshape(length, 3)
            visit(x, y, pixels)
            count += length
        except Exception as error:
            failures.append(error)

    try:
        checked(lib.JxlDecoderSubscribeEvents(decoder, 0x40 | 0x1000))  # basic info / full image
        checked(lib.JxlDecoderSetInput(decoder, C.cast(C.c_char_p(payload), P), len(payload)))
        lib.JxlDecoderCloseInput(decoder)
        while True:
            status = lib.JxlDecoderProcessInput(decoder)
            if failures:
                raise ValueError(f'JPEG XL verification failed: {failures[0]}')
            if status == 0:
                break
            if status == 0x40:
                info = BasicInfo()
                checked(lib.JxlDecoderGetBasicInfo(decoder, C.byref(info)))
                if ((info.ysize, info.xsize) != expected_shape or info.bits_per_sample != bits
                        or info.exponent_bits_per_sample or info.num_color_channels != 3
                        or info.num_extra_channels or info.have_animation or info.orientation != 1):
                    raise ValueError('JPEG XL output dimensions, channels or integer precision do not match.')
            elif status == 5:  # need image output
                fmt = PixelFormat(3, 3 if bits > 8 else 2, 0, 0)
                checked(lib.JxlDecoderSetImageOutCallback(decoder, C.byref(fmt), scan, None))
                checked(lib.JxlDecoderSetImageOutBitDepth(decoder, C.byref(BitDepth(1, 0, 0))))
            elif status != 0x1000:
                raise ValueError(f'JPEG XL verification decode failed (status {status}).')
        if count != expected_shape[0] * expected_shape[1]:
            raise ValueError('JPEG XL verification did not decode every pixel exactly once.')
    finally:
        lib.JxlDecoderDestroy(decoder)
