"""Neutral import defaults shared by Grade and Library; no image metering."""
import struct
from io import BytesIO
from pathlib import Path

import numpy as np

from .adjustments import SDR_SCENE_TO_DISPLAY_SCALE
from .color_context import scene_linear_to_nits
from .models import AdjustmentState

RAW_CALIBRATION_EV = -0.8


def fuji_dynamic_range(path):
    """Read the actual DR percentage from the embedded JPEG's Fuji maker notes.

    ExifTool FujiFilm.pm: 0x1402 selects manual/auto, 0x1403 is valid
    for manual only, 0x140b records the automatic selection. RawExposureBias
    includes a camera base offset and is deliberately not used.
    """
    if Path(path).suffix.lower() != '.raf':
        return None
    try:
        with Path(path).open('rb') as handle:
            header = handle.read(100)
            if len(header) != 100 or not header.startswith(b'FUJIFILMCCD-RAW '):
                return None
            offset, length = struct.unpack_from('>II', header, 84)
            if offset < 100 or not 2 <= length <= 64 * 1024 * 1024:
                return None
            handle.seek(offset)
            jpeg = handle.read(length)
        if len(jpeg) != length:
            return None
        from PIL import Image
        with Image.open(BytesIO(jpeg)) as image:
            note = image.getexif().get_ifd(34665).get(37500)
        if not isinstance(note, bytes) or note[:8] != b'FUJIFILM':
            return None
        offset = struct.unpack_from('<I', note, 8)[0]
        if offset < 12:
            return None
        count = struct.unpack_from('<H', note, offset)[0]
        if count > 1024 or offset + 2 + count * 12 + 4 > len(note):
            return None
        fields = {}
        for _ in range(count):
            position = offset + 2 + _ * 12
            tag, kind, size = struct.unpack_from('<HHI', note, position)
            if tag in {0x1402, 0x1403, 0x140b}:
                if kind != 3 or size != 1 or tag in fields:
                    return None
                fields[tag] = struct.unpack_from('<H', note, position + 8)[0]
        setting = fields.get(0x1402)
        selected = fields.get(0x1403) if setting == 1 else fields.get(0x140b) if setting == 0 else {
            0x100: 100, 0x201: 400}.get(setting)
        return selected if selected in {100, 200, 400} else None
    except (OSError, ValueError, TypeError, struct.error):
        return None


def calibrate_camera_raw(pixels, path):
    """One uniform linear gain plus explicitly recorded Fuji brightness."""
    dr = fuji_dynamic_range(path)
    recorded_ev = {200: 1.0, 400: 2.0}.get(dr, 0.0)
    pixels *= np.float32(2.0 ** (RAW_CALIBRATION_EV + recorded_ev))
    return {'calibration_ev': RAW_CALIBRATION_EV,
            'recorded_brightness_ev': recorded_ev,
            'fuji_dynamic_range_percent': dr}


def apply_import_defaults(adjustments, reference):
    if reference is not None:
        # The SDR base is already an authored rendition.
        adjustments.sdr.highlight_section_enabled = False


def starting_adjustments(analysis, reference=None, white=203):
    adjustments = AdjustmentState()
    apply_import_defaults(adjustments, reference)
    sync_highlight_source_peaks(adjustments, analysis, reference, white)
    return adjustments


def sync_highlight_source_peaks(adjustments, analysis, reference, white):
    hdr = adjustments.hdr
    color_handling = hdr.highlight_compression_color_handling
    grouped_channels = color_handling in {"smooth_rolloff", "path_to_white", "agx_attenuate"}
    robust = hdr.highlight_compression_peak_measurement == "robust"
    if color_handling in {"smooth_rolloff", "agx_attenuate"}:
        measured = analysis.robust_peak_bt2020_linear if robust else analysis.peak_bt2020_linear
    elif grouped_channels:
        measured = analysis.robust_peak_linear if robust else analysis.peak_linear
    else:
        measured = analysis.robust_peak_luma_linear if robust else analysis.peak_luma_linear
    if measured is None:
        measured = analysis.peak_linear
    source_peak_nits = max(1.0, float(scene_linear_to_nits(float(measured), white)))
    hdr.highlight_compression_source_peak_nits = source_peak_nits

    sdr = adjustments.sdr
    if reference is not None and sdr.use_authored_base:
        sdr_measured = float(np.max(np.clip(reference, 0.0, None)))
    else:
        sdr_robust = sdr.highlight_compression_peak_measurement == "robust"
        if sdr.highlight_compression_color_handling == "preserve_color":
            sdr_measured = analysis.robust_peak_luma_linear if sdr_robust else analysis.peak_luma_linear
        else:
            sdr_measured = analysis.robust_peak_linear if sdr_robust else analysis.peak_linear
        if sdr_measured is None:
            sdr_measured = analysis.peak_linear
        sdr_measured = float(sdr_measured) * float(SDR_SCENE_TO_DISPLAY_SCALE)
    sdr.highlight_compression_source_peak_percent = max(1.0, sdr_measured * 100.0)
